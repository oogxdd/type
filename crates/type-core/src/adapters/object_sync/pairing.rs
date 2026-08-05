//! Cloud pairing: hand a second device the whole configuration at once.
//!
//! Typing an endpoint, a bucket, an access key, a secret and a passphrase into
//! a phone is the single worst moment in this feature. The desktop already
//! renders a pairing QR for LAN sync, so it renders one for the bucket too —
//! the phone scans it and is configured with nothing typed.
//!
//! The payload carries bucket credentials **and the vault key**, so it is as
//! sensitive as the bucket itself. That is the same bargain the LAN pairing QR
//! already makes: it is shown on the user's own screen, to their own camera,
//! for a few seconds. The passphrase remains the path for a device that cannot
//! scan, and the recovery path if every device is lost.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};

use crate::ports::object_sync::ObjectStoreSettings;

/// Scheme + host, matching the existing `type2://sync` LAN pairing link.
pub const CLOUD_PAIRING_PREFIX: &str = "type2://cloud/";

/// What travels in the QR. Field names are short because QR density is a real
/// constraint at this payload size.
#[derive(Debug, Deserialize, Serialize)]
struct PairingPayload {
    #[serde(rename = "e")]
    endpoint: String,
    #[serde(rename = "b")]
    bucket: String,
    #[serde(rename = "p", default, skip_serializing_if = "String::is_empty")]
    prefix: String,
    #[serde(rename = "r", default, skip_serializing_if = "String::is_empty")]
    region: String,
    #[serde(rename = "k")]
    access_key_id: String,
    #[serde(rename = "s")]
    secret_access_key: String,
    /// base64 vault key, present only when the bucket is encrypted.
    #[serde(rename = "v", default, skip_serializing_if = "Option::is_none")]
    vault_key: Option<String>,
    #[serde(rename = "f", default, skip_serializing_if = "Option::is_none")]
    force_path_style: Option<bool>,
}

/// Build the link the desktop renders as a QR.
pub fn build_pairing_link(
    settings: &ObjectStoreSettings,
    vault_key_base64: Option<String>,
) -> Result<String, String> {
    if !settings.is_configured() {
        return Err("Configure the bucket before pairing another device.".to_string());
    }
    let payload = PairingPayload {
        endpoint: settings.endpoint.trim().to_string(),
        bucket: settings.bucket.trim().to_string(),
        prefix: settings.normalized_prefix(),
        region: settings.region.trim().to_string(),
        access_key_id: settings.access_key_id.trim().to_string(),
        secret_access_key: settings.secret_access_key.trim().to_string(),
        vault_key: vault_key_base64,
        force_path_style: settings.force_path_style,
    };
    let json = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    Ok(format!("{CLOUD_PAIRING_PREFIX}{}", URL_SAFE_NO_PAD.encode(json)))
}

/// What a scanned link yields: settings to save, and possibly a vault key.
#[derive(Debug)]
pub struct ScannedPairing {
    pub settings: ObjectStoreSettings,
    pub vault_key_base64: Option<String>,
}

/// Parse a scanned link.
///
/// `device_id` is threaded in from the scanning device's existing settings:
/// adopting the sender's id would make two devices write the same manifest,
/// and each would then read the other's view as its own.
pub fn parse_pairing_link(link: &str, device_id: &str) -> Result<ScannedPairing, String> {
    let encoded = link
        .trim()
        .strip_prefix(CLOUD_PAIRING_PREFIX)
        .ok_or_else(|| "That QR code is not a cloud sync pairing code.".to_string())?;
    let json = URL_SAFE_NO_PAD
        .decode(encoded.trim_end_matches('/'))
        .map_err(|error| format!("Malformed pairing code: {error}"))?;
    let payload: PairingPayload =
        serde_json::from_slice(&json).map_err(|error| format!("Malformed pairing code: {error}"))?;

    if payload.endpoint.is_empty() || payload.bucket.is_empty() {
        return Err("That pairing code is missing the bucket details.".to_string());
    }

    Ok(ScannedPairing {
        settings: ObjectStoreSettings {
            endpoint: payload.endpoint,
            bucket: payload.bucket,
            prefix: payload.prefix,
            region: if payload.region.is_empty() {
                "auto".to_string()
            } else {
                payload.region
            },
            access_key_id: payload.access_key_id,
            secret_access_key: payload.secret_access_key,
            force_path_style: payload.force_path_style,
            device_id: device_id.to_string(),
            // Pairing is an explicit "sync this here" action.
            enabled: true,
        },
        vault_key_base64: payload.vault_key,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings() -> ObjectStoreSettings {
        ObjectStoreSettings {
            endpoint: "https://acct.r2.cloudflarestorage.com".to_string(),
            bucket: "notes".to_string(),
            prefix: "type-notes/p1".to_string(),
            region: "auto".to_string(),
            access_key_id: "AKID".to_string(),
            secret_access_key: "SECRET".to_string(),
            force_path_style: Some(true),
            device_id: "desktop-device".to_string(),
            enabled: true,
        }
    }

    #[test]
    fn a_link_round_trips_every_field_needed_to_sync() {
        let link = build_pairing_link(&settings(), Some("dmF1bHQ=".to_string())).unwrap();
        assert!(link.starts_with(CLOUD_PAIRING_PREFIX));

        let scanned = parse_pairing_link(&link, "phone-device").unwrap();
        assert_eq!(scanned.settings.endpoint, settings().endpoint);
        assert_eq!(scanned.settings.bucket, "notes");
        assert_eq!(scanned.settings.prefix, "type-notes/p1");
        assert_eq!(scanned.settings.access_key_id, "AKID");
        assert_eq!(scanned.settings.secret_access_key, "SECRET");
        assert_eq!(scanned.settings.force_path_style, Some(true));
        assert_eq!(scanned.vault_key_base64.as_deref(), Some("dmF1bHQ="));
        assert!(scanned.settings.enabled);
    }

    /// Two devices sharing a device id would each overwrite the other's
    /// manifest and then read it back as their own view of the bucket.
    #[test]
    fn the_scanning_device_keeps_its_own_id() {
        let link = build_pairing_link(&settings(), None).unwrap();
        let scanned = parse_pairing_link(&link, "phone-device").unwrap();
        assert_eq!(scanned.settings.device_id, "phone-device");
        assert_ne!(scanned.settings.device_id, settings().device_id);
    }

    #[test]
    fn a_plaintext_bucket_pairs_without_a_vault_key() {
        let link = build_pairing_link(&settings(), None).unwrap();
        assert!(parse_pairing_link(&link, "phone").unwrap().vault_key_base64.is_none());
    }

    #[test]
    fn the_link_is_url_safe_so_a_qr_scanner_returns_it_intact() {
        let mut wide = settings();
        // Values that would produce '+' and '/' under standard base64.
        wide.secret_access_key = "?????>>>>>~~~~~".to_string();
        let link = build_pairing_link(&wide, None).unwrap();

        assert!(!link[CLOUD_PAIRING_PREFIX.len()..].contains('+'));
        assert!(!link[CLOUD_PAIRING_PREFIX.len()..].contains('/'));
        assert!(!link.contains('='), "padding would need escaping in a URL");
        assert_eq!(
            parse_pairing_link(&link, "phone").unwrap().settings.secret_access_key,
            wide.secret_access_key
        );
    }

    #[test]
    fn scanning_the_wrong_kind_of_code_says_so() {
        let error = parse_pairing_link("type2://sync/ssh://host/notes", "phone").unwrap_err();
        assert!(error.contains("not a cloud sync pairing code"), "{error}");
        assert!(parse_pairing_link("https://example.com", "phone").is_err());
        assert!(parse_pairing_link(&format!("{CLOUD_PAIRING_PREFIX}!!!!"), "phone").is_err());
    }

    #[test]
    fn an_unconfigured_bucket_cannot_be_paired() {
        let mut incomplete = settings();
        incomplete.secret_access_key = String::new();
        assert!(build_pairing_link(&incomplete, None).is_err());
    }

    #[test]
    fn a_payload_missing_the_bucket_is_refused_rather_than_half_applied() {
        let json = br#"{"e":"https://x","b":"","k":"a","s":"b"}"#;
        let link = format!("{CLOUD_PAIRING_PREFIX}{}", URL_SAFE_NO_PAD.encode(json));
        assert!(parse_pairing_link(&link, "phone").is_err());
    }
}
