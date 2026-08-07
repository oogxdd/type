//! S3-compatible transport: AWS SigV4 request signing over blocking reqwest.
//!
//! Hand-rolled rather than pulled from `aws-sdk-s3` because the sync engine
//! needs five verbs, the crate already depends on `reqwest` + `sha2` + `hmac`,
//! and the official SDK is async-first and enormous. The signing implementation
//! is checked against the AWS SigV4 test-suite vectors in this module's tests.
//!
//! Verified against R2, B2, MinIO and S3 by keeping to the common subset:
//! no conditional writes, no multipart, no bucket-level configuration.

use std::sync::OnceLock;
use std::time::Duration;

use hmac::{Hmac, Mac};
use reqwest::blocking::{Client, RequestBuilder};
use reqwest::{StatusCode, Url};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;

use crate::ports::object_sync::{ObjectListing, ObjectStore, ObjectStoreSettings};

const SERVICE: &str = "s3";
const ALGORITHM: &str = "AWS4-HMAC-SHA256";
const MAX_ATTEMPTS: usize = 3;

type HmacSha256 = Hmac<Sha256>;

// ── Shared client ──────────────────────────────────────────────────────────────

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

/// One client for every request: connection reuse matters when a round moves
/// hundreds of small objects.
fn http_client() -> Result<&'static Client, String> {
    if let Some(client) = HTTP_CLIENT.get() {
        return Ok(client);
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))?;
    Ok(HTTP_CLIENT.get_or_init(|| client))
}

// ── Encoding helpers ───────────────────────────────────────────────────────────

const UNRESERVED: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~";

/// Percent-encode per SigV4 rules. S3 signs object paths without normalizing
/// them, so `/` stays literal in a path but is escaped inside a query value.
fn uri_encode(input: &str, encode_slash: bool) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.as_bytes() {
        if UNRESERVED.contains(byte) {
            out.push(*byte as char);
        } else if *byte == b'/' && !encode_slash {
            out.push('/');
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub(crate) fn sha256_hex(data: &[u8]) -> String {
    to_hex(&Sha256::digest(data))
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC accepts keys of any length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

/// `(20150830, 20150830T123600Z)` — the scope date and the `x-amz-date` stamp.
///
/// Formatted by hand rather than through `time`'s format descriptions, whose
/// item types have churned across 0.3 releases.
fn amz_timestamps(now: OffsetDateTime) -> (String, String) {
    let date = format!(
        "{:04}{:02}{:02}",
        now.year(),
        u8::from(now.month()),
        now.day()
    );
    let stamp = format!(
        "{date}T{:02}{:02}{:02}Z",
        now.hour(),
        now.minute(),
        now.second()
    );
    (date, stamp)
}

// ── Signing ────────────────────────────────────────────────────────────────────

/// Everything the signer needs that isn't the credentials.
struct CanonicalRequest<'a> {
    method: &'a str,
    /// Already percent-encoded, leading slash included.
    path: &'a str,
    /// Sorted, already percent-encoded `key=value` pairs.
    query: &'a str,
    /// Headers to sign: lowercase names, sorted by name. Every `x-amz-*`
    /// header actually sent must appear here.
    headers: &'a [(&'a str, &'a str)],
    payload_hash: &'a str,
    amz_date: &'a str,
}

/// The `Authorization` header value for one request.
///
/// `service` and the header list are parameters so the published AWS SigV4
/// test-suite vectors — which sign for a service literally named `service`,
/// with only `host` and `x-amz-date` — drive this exact code path.
fn authorization_header(
    request: &CanonicalRequest<'_>,
    access_key_id: &str,
    secret_access_key: &str,
    region: &str,
    service: &str,
    scope_date: &str,
) -> String {
    let signed_headers = request
        .headers
        .iter()
        .map(|(name, _)| *name)
        .collect::<Vec<_>>()
        .join(";");
    let canonical_headers = request
        .headers
        .iter()
        .map(|(name, value)| format!("{name}:{}\n", value.trim()))
        .collect::<String>();
    let canonical_request = format!(
        "{}\n{}\n{}\n{}\n{}\n{}",
        request.method,
        request.path,
        request.query,
        canonical_headers,
        signed_headers,
        request.payload_hash
    );

    let scope = format!("{scope_date}/{region}/{service}/aws4_request");
    let string_to_sign = format!(
        "{ALGORITHM}\n{}\n{scope}\n{}",
        request.amz_date,
        sha256_hex(canonical_request.as_bytes())
    );

    let key_date = hmac_sha256(format!("AWS4{secret_access_key}").as_bytes(), scope_date.as_bytes());
    let key_region = hmac_sha256(&key_date, region.as_bytes());
    let key_service = hmac_sha256(&key_region, service.as_bytes());
    let key_signing = hmac_sha256(&key_service, b"aws4_request");
    let signature = to_hex(&hmac_sha256(&key_signing, string_to_sign.as_bytes()));

    format!(
        "{ALGORITHM} Credential={access_key_id}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
}

// ── Store ──────────────────────────────────────────────────────────────────────

/// A configured bucket, ready to sign requests.
pub struct S3ObjectStore {
    settings: ObjectStoreSettings,
    endpoint: Url,
}

impl S3ObjectStore {
    pub fn new(settings: ObjectStoreSettings) -> Result<Self, String> {
        if !settings.is_configured() {
            return Err("Object storage is not configured.".to_string());
        }
        let raw = settings.endpoint.trim().trim_end_matches('/');
        let normalized = if raw.contains("://") {
            raw.to_string()
        } else {
            // Users paste bare hostnames constantly; assume TLS rather than
            // failing with a URL parse error they can't act on.
            format!("https://{raw}")
        };
        let endpoint = Url::parse(&normalized)
            .map_err(|error| format!("Invalid endpoint '{}': {error}", settings.endpoint))?;
        let Some(host) = endpoint.host_str() else {
            return Err(format!("Endpoint '{}' has no host.", settings.endpoint));
        };

        // Refuse plaintext HTTP to anything off the local network. Without TLS
        // every note, filename and — worse — the signing credentials travel in
        // the clear, which on a public network means anyone nearby can read
        // and then impersonate. Self-hosted MinIO on localhost or a LAN
        // address is a deliberate setup and stays allowed, the same line the
        // git transport already draws between local and internet hosts.
        if endpoint.scheme() == "http" && !crate::adapters::git::is_local_hostname(host) {
            return Err(format!(
                "Refusing to sync to '{host}' over plain http — notes and access keys would \
                 travel unencrypted and be readable by anyone on the same network. Use https://."
            ));
        }

        Ok(Self { settings, endpoint })
    }

    /// Path-style unless the endpoint looks like AWS, which is retiring it.
    /// An explicit setting always wins.
    fn use_path_style(&self) -> bool {
        if let Some(forced) = self.settings.force_path_style {
            return forced;
        }
        let host = self.endpoint.host_str().unwrap_or_default().to_lowercase();
        !(host.ends_with("amazonaws.com") || host.starts_with("s3."))
    }

    /// The request URL plus the host header value and canonical path to sign.
    fn resolve(&self, key: &str) -> Result<(Url, String, String), String> {
        let encoded_key = uri_encode(key.trim_start_matches('/'), false);
        let bucket = self.settings.bucket.trim();

        let (mut url, canonical_path) = if self.use_path_style() {
            let path = format!("/{}/{}", uri_encode(bucket, true), encoded_key);
            let mut url = self.endpoint.clone();
            url.set_path(&path);
            (url, path)
        } else {
            let host = self.endpoint.host_str().unwrap_or_default();
            let mut url = self.endpoint.clone();
            url.set_host(Some(&format!("{bucket}.{host}")))
                .map_err(|error| format!("Invalid bucket host: {error}"))?;
            let path = format!("/{encoded_key}");
            url.set_path(&path);
            (url, path)
        };
        url.set_query(None);

        let host_header = match url.port() {
            Some(port) => format!("{}:{port}", url.host_str().unwrap_or_default()),
            None => url.host_str().unwrap_or_default().to_string(),
        };
        Ok((url, host_header, canonical_path))
    }

    /// Sign and send. `query` must already be sorted by key.
    fn send(
        &self,
        method: &str,
        key: &str,
        query: &[(String, String)],
        body: Option<Vec<u8>>,
        content_type: Option<&str>,
    ) -> Result<reqwest::blocking::Response, String> {
        let (mut url, host_header, canonical_path) = self.resolve(key)?;

        let canonical_query = query
            .iter()
            .map(|(name, value)| format!("{}={}", uri_encode(name, true), uri_encode(value, true)))
            .collect::<Vec<_>>()
            .join("&");
        if !query.is_empty() {
            url.set_query(Some(&canonical_query));
        }

        let payload = body.unwrap_or_default();
        let payload_hash = sha256_hex(&payload);
        let (scope_date, amz_date) = amz_timestamps(OffsetDateTime::now_utc());

        // Sorted by header name, as the canonical form requires.
        let signed = [
            ("host", host_header.as_str()),
            ("x-amz-content-sha256", payload_hash.as_str()),
            ("x-amz-date", amz_date.as_str()),
        ];
        let authorization = authorization_header(
            &CanonicalRequest {
                method,
                path: &canonical_path,
                query: &canonical_query,
                headers: &signed,
                payload_hash: &payload_hash,
                amz_date: &amz_date,
            },
            self.settings.access_key_id.trim(),
            self.settings.secret_access_key.trim(),
            self.settings.region.trim(),
            SERVICE,
            &scope_date,
        );

        let client = http_client()?;
        let build = |attempt_body: Vec<u8>| -> RequestBuilder {
            let mut builder = client
                .request(
                    reqwest::Method::from_bytes(method.as_bytes())
                        .unwrap_or(reqwest::Method::GET),
                    url.clone(),
                )
                .header("x-amz-content-sha256", &payload_hash)
                .header("x-amz-date", &amz_date)
                .header("authorization", &authorization);
            if let Some(content_type) = content_type {
                builder = builder.header("content-type", content_type);
            }
            if !attempt_body.is_empty() {
                builder = builder.body(attempt_body);
            }
            builder
        };

        // The signature covers the payload hash, not the connection, so a
        // retry can reuse it as long as the clock hasn't drifted past the
        // 15-minute skew window — which these backoffs stay well inside.
        let mut last_error = String::new();
        for attempt in 0..MAX_ATTEMPTS {
            match build(payload.clone()).send() {
                Ok(response) => {
                    if response.status().is_server_error() && attempt + 1 < MAX_ATTEMPTS {
                        last_error = format!("HTTP {}", response.status());
                    } else {
                        return Ok(response);
                    }
                }
                Err(error) if attempt + 1 < MAX_ATTEMPTS => {
                    last_error = error.to_string();
                }
                Err(error) => return Err(format!("{method} {key} failed: {error}")),
            }
            std::thread::sleep(Duration::from_millis(300 * (1 << attempt)));
        }
        Err(format!("{method} {key} failed after {MAX_ATTEMPTS} attempts: {last_error}"))
    }
}

/// Pull `<Message>` out of an S3 error document — that text is what tells a
/// user their key is wrong versus their bucket name.
fn describe_error(status: StatusCode, body: &str) -> String {
    match xml_tag(body, "Message") {
        Some(message) => format!("HTTP {status}: {message}"),
        None if body.trim().is_empty() => format!("HTTP {status}"),
        None => format!("HTTP {status}: {}", body.trim().replace('\n', " ")),
    }
}

impl ObjectStore for S3ObjectStore {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let response = self.send("GET", key, &[], None, None)?;
        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !status.is_success() {
            let body = response.text().unwrap_or_default();
            return Err(format!("Failed to read '{key}' — {}", describe_error(status, &body)));
        }
        response
            .bytes()
            .map(|bytes| Some(bytes.to_vec()))
            .map_err(|error| format!("Failed to read '{key}': {error}"))
    }

    fn put(&self, key: &str, body: Vec<u8>, content_type: &str) -> Result<(), String> {
        let response = self.send("PUT", key, &[], Some(body), Some(content_type))?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let text = response.text().unwrap_or_default();
        Err(format!("Failed to upload '{key}' — {}", describe_error(status, &text)))
    }

    fn delete(&self, key: &str) -> Result<(), String> {
        let response = self.send("DELETE", key, &[], None, None)?;
        let status = response.status();
        // S3 answers 204 for keys that were already gone; treat an explicit
        // 404 the same way so GC and replayed rounds stay idempotent.
        if status.is_success() || status == StatusCode::NOT_FOUND {
            return Ok(());
        }
        let text = response.text().unwrap_or_default();
        Err(format!("Failed to delete '{key}' — {}", describe_error(status, &text)))
    }

    fn list(&self, prefix: &str) -> Result<Vec<ObjectListing>, String> {
        let mut out = Vec::new();
        let mut continuation: Option<String> = None;

        loop {
            // Sorted by key name, as the canonical query string requires.
            let mut query = vec![
                ("list-type".to_string(), "2".to_string()),
                ("prefix".to_string(), prefix.to_string()),
            ];
            if let Some(token) = &continuation {
                query.insert(0, ("continuation-token".to_string(), token.clone()));
            }

            let response = self.send("GET", "", &query, None, None)?;
            let status = response.status();
            let body = response
                .text()
                .map_err(|error| format!("Failed to list '{prefix}': {error}"))?;
            if !status.is_success() {
                return Err(format!(
                    "Failed to list '{prefix}' — {}",
                    describe_error(status, &body)
                ));
            }

            for block in xml_blocks(&body, "Contents") {
                let Some(key) = xml_tag(block, "Key") else {
                    continue;
                };
                let size = xml_tag(block, "Size")
                    .and_then(|value| value.trim().parse::<u64>().ok())
                    .unwrap_or(0);
                out.push(ObjectListing { key, size });
            }

            // A truncated listing that we treated as complete would make GC
            // delete live blobs, so only stop when S3 says there is no more.
            let truncated = xml_tag(&body, "IsTruncated")
                .map(|value| value.trim().eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            match xml_tag(&body, "NextContinuationToken") {
                Some(token) if truncated => continuation = Some(token),
                _ => break,
            }
        }

        Ok(out)
    }

    fn check_access(&self) -> Result<(), String> {
        // A zero-key listing round-trips auth, endpoint, and bucket name
        // without needing any object to exist yet.
        self.list(&self.settings.key_for("probe-nonexistent/"))
            .map(|_| ())
    }
}

// ── Minimal XML reading ────────────────────────────────────────────────────────
//
// S3 listings are a fixed, flat shape, so a full XML parser would be a
// dependency bought for two tag lookups.

fn decode_entities(value: &str) -> String {
    if !value.contains('&') {
        return value.to_string();
    }
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        // Ampersand last, so "&amp;lt;" decodes to "&lt;" rather than "<".
        .replace("&amp;", "&")
}

/// First `<tag>…</tag>` body, entity-decoded.
fn xml_tag(xml: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = xml.find(&open)? + open.len();
    let end = xml[start..].find(&close)? + start;
    Some(decode_entities(&xml[start..end]))
}

/// Every `<tag>…</tag>` body, for repeated elements.
fn xml_blocks<'a>(xml: &'a str, tag: &str) -> Vec<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(start) = xml[cursor..].find(&open) {
        let body_start = cursor + start + open.len();
        let Some(end) = xml[body_start..].find(&close) else {
            break;
        };
        out.push(&xml[body_start..body_start + end]);
        cursor = body_start + end + close.len();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(endpoint: &str, force_path_style: Option<bool>) -> ObjectStoreSettings {
        ObjectStoreSettings {
            endpoint: endpoint.to_string(),
            bucket: "notes".to_string(),
            prefix: "type-notes/p1".to_string(),
            region: "auto".to_string(),
            access_key_id: "AKID".to_string(),
            secret_access_key: "SECRET".to_string(),
            force_path_style,
            device_id: "device".to_string(),
            enabled: true,
        }
    }

    /// AWS SigV4 test suite, `get-vanilla` — the published vector, verbatim.
    /// Any drift in canonicalization, the string-to-sign, or the key schedule
    /// breaks this exact string.
    #[test]
    fn signs_the_aws_test_suite_vector() {
        let authorization = authorization_header(
            &CanonicalRequest {
                method: "GET",
                path: "/",
                query: "",
                headers: &[
                    ("host", "example.amazonaws.com"),
                    ("x-amz-date", "20150830T123600Z"),
                ],
                payload_hash: &sha256_hex(b""),
                amz_date: "20150830T123600Z",
            },
            "AKIDEXAMPLE",
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            "us-east-1",
            "service",
            "20150830",
        );

        assert_eq!(
            authorization,
            "AWS4-HMAC-SHA256 \
             Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, \
             SignedHeaders=host;x-amz-date, \
             Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        );
    }

    /// Same suite, `get-vanilla-query-order-key-case`: a signed query string,
    /// which the plain vector never exercises.
    #[test]
    fn signs_the_aws_query_string_vector() {
        let authorization = authorization_header(
            &CanonicalRequest {
                method: "GET",
                path: "/",
                query: "Param1=value1&Param2=value2",
                headers: &[
                    ("host", "example.amazonaws.com"),
                    ("x-amz-date", "20150830T123600Z"),
                ],
                payload_hash: &sha256_hex(b""),
                amz_date: "20150830T123600Z",
            },
            "AKIDEXAMPLE",
            "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
            "us-east-1",
            "service",
            "20150830",
        );

        assert!(
            authorization.ends_with(
                "Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500"
            ),
            "{authorization}"
        );
    }

    #[test]
    fn signing_is_sensitive_to_every_input() {
        let headers = [
            ("host", "example.amazonaws.com"),
            ("x-amz-content-sha256", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
            ("x-amz-date", "20150830T123600Z"),
        ];
        let signature = |method: &str, path: &str, query: &str, hash: &str| {
            authorization_header(
                &CanonicalRequest {
                    method,
                    path,
                    query,
                    headers: &headers,
                    payload_hash: hash,
                    amz_date: "20150830T123600Z",
                },
                "AKID",
                "SECRET",
                "us-east-1",
                "s3",
                "20150830",
            )
        };
        let empty = sha256_hex(b"");
        let reference = signature("GET", "/", "", &empty);

        assert_ne!(signature("PUT", "/", "", &empty), reference);
        assert_ne!(signature("GET", "/other", "", &empty), reference);
        assert_ne!(signature("GET", "/", "list-type=2", &empty), reference);
        assert_ne!(signature("GET", "/", "", &sha256_hex(b"body")), reference);
    }

    #[test]
    fn uri_encoding_follows_the_sigv4_rules() {
        assert_eq!(uri_encode("a/b c", false), "a/b%20c");
        assert_eq!(uri_encode("a/b c", true), "a%2Fb%20c");
        assert_eq!(uri_encode("-_.~", false), "-_.~");
        assert_eq!(uri_encode("привет", false), "%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
        // '+' must be escaped, not treated as a space.
        assert_eq!(uri_encode("a+b", false), "a%2Bb");
    }

    #[test]
    fn path_style_is_the_default_and_aws_endpoints_use_virtual_host() {
        let r2 = S3ObjectStore::new(settings("https://acct.r2.cloudflarestorage.com", None)).unwrap();
        assert!(r2.use_path_style());
        let (url, host, path) = r2.resolve("type-notes/p1/objects/abc").unwrap();
        assert_eq!(url.as_str(), "https://acct.r2.cloudflarestorage.com/notes/type-notes/p1/objects/abc");
        assert_eq!(host, "acct.r2.cloudflarestorage.com");
        assert_eq!(path, "/notes/type-notes/p1/objects/abc");

        let aws = S3ObjectStore::new(settings("https://s3.eu-west-1.amazonaws.com", None)).unwrap();
        assert!(!aws.use_path_style());
        let (url, host, path) = aws.resolve("objects/abc").unwrap();
        assert_eq!(url.as_str(), "https://notes.s3.eu-west-1.amazonaws.com/objects/abc");
        assert_eq!(host, "notes.s3.eu-west-1.amazonaws.com");
        assert_eq!(path, "/objects/abc");

        // An explicit setting overrides the guess in both directions.
        assert!(!S3ObjectStore::new(settings("https://acct.r2.cloudflarestorage.com", Some(false)))
            .unwrap()
            .use_path_style());
        assert!(S3ObjectStore::new(settings("https://s3.amazonaws.com", Some(true)))
            .unwrap()
            .use_path_style());
    }

    #[test]
    fn a_non_default_port_stays_in_the_host_header() {
        let minio = S3ObjectStore::new(settings("http://localhost:9000", None)).unwrap();
        let (url, host, _) = minio.resolve("objects/abc").unwrap();
        assert_eq!(url.as_str(), "http://localhost:9000/notes/objects/abc");
        assert_eq!(host, "localhost:9000");

        // …and a default one does not, or the signature won't match.
        let plain = S3ObjectStore::new(settings("https://store.example.com:443", None)).unwrap();
        assert_eq!(plain.resolve("k").unwrap().1, "store.example.com");
    }

    #[test]
    fn a_bare_hostname_is_assumed_to_be_https() {
        let store = S3ObjectStore::new(settings("acct.r2.cloudflarestorage.com", None)).unwrap();
        assert_eq!(store.endpoint.scheme(), "https");
    }

    /// The public-wifi case: without TLS a bystander reads the notes *and*
    /// captures the signing credentials.
    #[test]
    fn plaintext_http_is_refused_for_internet_endpoints() {
        let error = S3ObjectStore::new(settings("http://storage.example.com", None))
            .err()
            .expect("plain http to a public host must be refused");
        assert!(error.contains("plain http"), "{error}");
        assert!(error.contains("https://"), "should say what to do instead: {error}");

        // …but a deliberate self-hosted MinIO stays workable.
        for local in [
            "http://localhost:9000",
            "http://127.0.0.1:9000",
            "http://192.168.1.10:9000",
            "http://nas.local:9000",
        ] {
            assert!(
                S3ObjectStore::new(settings(local, None)).is_ok(),
                "{local} should be allowed"
            );
        }

        // https to the same public host is fine.
        assert!(S3ObjectStore::new(settings("https://storage.example.com", None)).is_ok());
    }

    #[test]
    fn unconfigured_settings_are_rejected() {
        let mut incomplete = settings("https://example.com", None);
        incomplete.secret_access_key = String::new();
        assert!(S3ObjectStore::new(incomplete).is_err());
    }

    /// A single missing zero shifts the whole signature, so every component
    /// here is deliberately one digit wide.
    #[test]
    fn timestamps_are_zero_padded() {
        let time = OffsetDateTime::from_unix_timestamp(1_425_704_769).unwrap();
        let (date, stamp) = amz_timestamps(time);
        assert_eq!(date, "20150307");
        assert_eq!(stamp, "20150307T050609Z");
    }

    #[test]
    fn listings_parse_keys_sizes_and_continuation() {
        let xml = r#"<?xml version="1.0"?>
<ListBucketResult>
  <IsTruncated>true</IsTruncated>
  <Contents><Key>a/b.md</Key><Size>12</Size></Contents>
  <Contents><Key>a/c&amp;d.md</Key><Size>34</Size></Contents>
  <NextContinuationToken>tok/en+1</NextContinuationToken>
</ListBucketResult>"#;

        let blocks = xml_blocks(xml, "Contents");
        assert_eq!(blocks.len(), 2);
        assert_eq!(xml_tag(blocks[0], "Key").as_deref(), Some("a/b.md"));
        assert_eq!(xml_tag(blocks[1], "Key").as_deref(), Some("a/c&d.md"));
        assert_eq!(xml_tag(blocks[1], "Size").as_deref(), Some("34"));
        assert_eq!(xml_tag(xml, "IsTruncated").as_deref(), Some("true"));
        assert_eq!(xml_tag(xml, "NextContinuationToken").as_deref(), Some("tok/en+1"));
    }

    #[test]
    fn error_bodies_surface_the_provider_message() {
        let body = "<Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message></Error>";
        let described = describe_error(StatusCode::FORBIDDEN, body);
        assert!(described.contains("does not match"), "{described}");
        assert!(describe_error(StatusCode::NOT_FOUND, "").contains("404"));
    }

    #[test]
    fn entity_decoding_does_not_double_unescape() {
        assert_eq!(decode_entities("&amp;lt;"), "&lt;");
        assert_eq!(decode_entities("plain"), "plain");
    }
}
