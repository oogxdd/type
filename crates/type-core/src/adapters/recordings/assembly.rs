//! AssemblyAI cloud transcription (used on iOS, where local Whisper isn't available).
//!
//! Every request takes the API root as a parameter instead of reading a
//! constant, so the queue worker and the key check can both be pointed at a
//! stub server in tests; production callers pass [`ASSEMBLY_API_BASE`].

use std::thread;
use std::time::Duration;

use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde::Deserialize;

/// Production API root — endpoints hang off it: `/upload`, `/transcript`.
pub const ASSEMBLY_API_BASE: &str = "https://api.assemblyai.com/v2";

const ASSEMBLY_SPEECH_MODEL: &str = "universal-2";
const ASSEMBLY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const ASSEMBLY_MAX_POLL_ATTEMPTS: usize = 180;
const ASSEMBLY_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
/// The key check is interactive — the user is staring at a spinner in Settings —
/// so it gives up long before the upload timeout would.
const ASSEMBLY_KEY_CHECK_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Deserialize)]
struct AssemblyUploadResponse {
    upload_url: String,
}

#[derive(Deserialize)]
struct AssemblyTranscriptResponse {
    id: String,
    status: String,
    text: Option<String>,
    error: Option<String>,
}

fn endpoint(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

/// A bad key is by far the most common setup mistake, and the raw
/// `{"error": "Authentication error, ..."}` body does not tell the user where
/// to fix it — so 401/403 get a message naming the page to copy the key from.
/// Everything else falls through to the shared status+body formatting.
fn assembly_response_error(status: StatusCode, body: String, context: &str) -> String {
    if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        return format!(
            "AssemblyAI rejected this API key (HTTP {}). Copy it again from assemblyai.com/app/api-keys.",
            status.as_u16()
        );
    }
    crate::response_error(status, body, context)
}

/// Transport failures read as "AssemblyAI is broken" unless they say otherwise;
/// on a phone this is nearly always the phone's own connection.
fn assembly_transport_error(error: reqwest::Error, context: &str) -> String {
    format!("Could not reach AssemblyAI ({context}): {error}")
}

/// Confirm `api_key` is accepted, without spending transcription credit:
/// listing one transcript requires auth and answers 401 for a bad key.
///
/// This is what makes "set the key in Settings" verifiable at the moment the
/// user sets it, rather than silently at the end of the next recording.
pub fn verify_assembly_api_key(api_key: &str, base_url: &str) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("AssemblyAI API key is required.".to_string());
    }

    let client = Client::builder()
        .timeout(ASSEMBLY_KEY_CHECK_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;

    let response = client
        .get(endpoint(base_url, "transcript?limit=1"))
        .header("authorization", api_key)
        .send()
        .map_err(|error| assembly_transport_error(error, "key check"))?;

    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let body = response.text().unwrap_or_default();
    Err(assembly_response_error(status, body, "AssemblyAI key check"))
}

pub fn transcribe_audio_bytes_with_assembly(
    audio_bytes: Vec<u8>,
    api_key: &str,
    base_url: &str,
) -> Result<(String, String), String> {
    let client = Client::builder()
        .timeout(ASSEMBLY_REQUEST_TIMEOUT)
        .build()
        .map_err(|error| error.to_string())?;

    let upload_response = client
        .post(endpoint(base_url, "upload"))
        .header("authorization", api_key)
        .header("content-type", "application/octet-stream")
        .body(audio_bytes)
        .send()
        .map_err(|error| assembly_transport_error(error, "upload"))?;
    if !upload_response.status().is_success() {
        let status = upload_response.status();
        let body = upload_response.text().unwrap_or_default();
        return Err(assembly_response_error(status, body, "AssemblyAI upload"));
    }
    let upload_payload = upload_response
        .json::<AssemblyUploadResponse>()
        .map_err(|error| format!("AssemblyAI upload response parse failed: {}", error))?;

    let transcript_create_response = client
        .post(endpoint(base_url, "transcript"))
        .header("authorization", api_key)
        .json(&serde_json::json!({
            "audio_url": upload_payload.upload_url,
            "speech_models": [ASSEMBLY_SPEECH_MODEL]
        }))
        .send()
        .map_err(|error| assembly_transport_error(error, "transcript request"))?;
    if !transcript_create_response.status().is_success() {
        let status = transcript_create_response.status();
        let body = transcript_create_response.text().unwrap_or_default();
        return Err(assembly_response_error(
            status,
            body,
            "AssemblyAI transcript request",
        ));
    }
    let transcript_create_payload = transcript_create_response
        .json::<AssemblyTranscriptResponse>()
        .map_err(|error| format!("AssemblyAI transcript response parse failed: {}", error))?;
    let transcript_id = transcript_create_payload.id;

    for _ in 0..ASSEMBLY_MAX_POLL_ATTEMPTS {
        thread::sleep(ASSEMBLY_POLL_INTERVAL);
        let poll_response = client
            .get(endpoint(base_url, &format!("transcript/{}", transcript_id)))
            .header("authorization", api_key)
            .send()
            .map_err(|error| assembly_transport_error(error, "polling"))?;
        if !poll_response.status().is_success() {
            let status = poll_response.status();
            let body = poll_response.text().unwrap_or_default();
            return Err(assembly_response_error(status, body, "AssemblyAI polling"));
        }
        let poll_payload = poll_response
            .json::<AssemblyTranscriptResponse>()
            .map_err(|error| format!("AssemblyAI polling response parse failed: {}", error))?;
        match poll_payload.status.as_str() {
            "completed" => {
                let transcript_text = poll_payload.text.unwrap_or_default();
                return Ok((transcript_text, transcript_id));
            }
            "error" => {
                return Err(poll_payload
                    .error
                    .unwrap_or_else(|| "AssemblyAI reported a transcription error.".to_string()));
            }
            _ => {}
        }
    }
    Err("AssemblyAI transcription timed out.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::recordings::test_support::StubAssemblyServer;

    #[test]
    fn endpoint_joins_without_doubling_slashes() {
        assert_eq!(endpoint("http://x/v2", "upload"), "http://x/v2/upload");
        assert_eq!(endpoint("http://x/v2/", "/upload"), "http://x/v2/upload");
    }

    #[test]
    fn verify_rejects_an_empty_key_without_a_request() {
        let error = verify_assembly_api_key("   ", "http://127.0.0.1:1").unwrap_err();
        assert_eq!(error, "AssemblyAI API key is required.");
    }

    #[test]
    fn verify_accepts_a_key_the_api_accepts() {
        let server = StubAssemblyServer::start();
        verify_assembly_api_key("good-key", &server.base_url()).unwrap();
        // The check must be free: it may only read the transcript list.
        assert_eq!(server.requests(), vec!["GET /v2/transcript?limit=1"]);
    }

    #[test]
    fn verify_reports_a_rejected_key_with_the_page_to_fix_it_on() {
        let server = StubAssemblyServer::start().rejecting_keys();
        let error = verify_assembly_api_key("bad-key", &server.base_url()).unwrap_err();
        assert!(error.contains("rejected this API key"), "{error}");
        assert!(error.contains("assemblyai.com/app/api-keys"), "{error}");
    }

    #[test]
    fn verify_reports_an_unreachable_api_as_a_connection_problem() {
        // Port 1 is reserved and never listening — a stand-in for "no network".
        let error = verify_assembly_api_key("good-key", "http://127.0.0.1:1/v2").unwrap_err();
        assert!(error.starts_with("Could not reach AssemblyAI"), "{error}");
    }

    #[test]
    fn transcribe_uploads_polls_and_returns_the_transcript() {
        let server = StubAssemblyServer::start().with_transcript("hello from the stub");
        let (text, id) =
            transcribe_audio_bytes_with_assembly(b"audio".to_vec(), "good-key", &server.base_url())
                .unwrap();
        assert_eq!(text, "hello from the stub");
        assert_eq!(id, StubAssemblyServer::TRANSCRIPT_ID);
        assert_eq!(server.uploaded_bytes(), b"audio".to_vec());
        assert_eq!(
            server.requests(),
            vec![
                "POST /v2/upload".to_string(),
                "POST /v2/transcript".to_string(),
                format!("GET /v2/transcript/{}", StubAssemblyServer::TRANSCRIPT_ID),
            ]
        );
    }

    #[test]
    fn transcribe_sends_the_speech_model_assemblyai_documents() {
        let server = StubAssemblyServer::start().with_transcript("ok");
        transcribe_audio_bytes_with_assembly(b"audio".to_vec(), "good-key", &server.base_url())
            .unwrap();
        let body: serde_json::Value = serde_json::from_str(&server.transcript_request_body())
            .expect("transcript request body is JSON");
        assert_eq!(body["speech_models"], serde_json::json!(["universal-2"]));
        assert!(body["audio_url"].as_str().unwrap().contains("upload"));
    }

    #[test]
    fn transcribe_keeps_polling_past_non_terminal_statuses() {
        let server = StubAssemblyServer::start()
            .polling_through(&["queued", "processing"])
            .with_transcript("arrived late");
        let (text, _) =
            transcribe_audio_bytes_with_assembly(b"audio".to_vec(), "good-key", &server.base_url())
                .unwrap();
        assert_eq!(text, "arrived late");
        let polls = server
            .requests()
            .iter()
            .filter(|request| request.contains("/transcript/"))
            .count();
        assert_eq!(polls, 3, "two in-flight polls, then the completed one");
    }

    #[test]
    fn transcribe_surfaces_a_rejected_key_from_the_upload_step() {
        let server = StubAssemblyServer::start().rejecting_keys();
        let error =
            transcribe_audio_bytes_with_assembly(b"audio".to_vec(), "bad-key", &server.base_url())
                .unwrap_err();
        assert!(error.contains("rejected this API key"), "{error}");
    }

    #[test]
    fn transcribe_surfaces_an_api_side_transcription_error() {
        let server = StubAssemblyServer::start().failing_transcription("audio file is corrupt");
        let error =
            transcribe_audio_bytes_with_assembly(b"audio".to_vec(), "good-key", &server.base_url())
                .unwrap_err();
        assert_eq!(error, "audio file is corrupt");
    }
}
