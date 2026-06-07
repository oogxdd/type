//! AssemblyAI cloud transcription (used on iOS, where local Whisper isn't available).

use std::thread;
use std::time::Duration;

use reqwest::blocking::Client;
use serde::Deserialize;

const ASSEMBLY_UPLOAD_URL: &str = "https://api.assemblyai.com/v2/upload";
const ASSEMBLY_TRANSCRIPT_URL: &str = "https://api.assemblyai.com/v2/transcript";
const ASSEMBLY_SPEECH_MODEL: &str = "universal-2";
const ASSEMBLY_POLL_INTERVAL: Duration = Duration::from_secs(2);
const ASSEMBLY_MAX_POLL_ATTEMPTS: usize = 180;

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

pub(crate) fn transcribe_audio_bytes_with_assembly(
    audio_bytes: Vec<u8>,
    api_key: &str,
) -> Result<(String, String), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;

    let upload_response = client
        .post(ASSEMBLY_UPLOAD_URL)
        .header("authorization", api_key)
        .header("content-type", "application/octet-stream")
        .body(audio_bytes)
        .send()
        .map_err(|error| format!("AssemblyAI upload request failed: {}", error))?;
    if !upload_response.status().is_success() {
        let status = upload_response.status();
        let body = upload_response.text().unwrap_or_default();
        return Err(crate::response_error(status, body, "AssemblyAI upload"));
    }
    let upload_payload = upload_response
        .json::<AssemblyUploadResponse>()
        .map_err(|error| format!("AssemblyAI upload response parse failed: {}", error))?;

    let transcript_create_response = client
        .post(ASSEMBLY_TRANSCRIPT_URL)
        .header("authorization", api_key)
        .json(&serde_json::json!({
            "audio_url": upload_payload.upload_url,
            "speech_models": [ASSEMBLY_SPEECH_MODEL]
        }))
        .send()
        .map_err(|error| format!("AssemblyAI transcript request failed: {}", error))?;
    if !transcript_create_response.status().is_success() {
        let status = transcript_create_response.status();
        let body = transcript_create_response.text().unwrap_or_default();
        return Err(crate::response_error(
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
            .get(format!("{}/{}", ASSEMBLY_TRANSCRIPT_URL, transcript_id))
            .header("authorization", api_key)
            .send()
            .map_err(|error| format!("AssemblyAI polling request failed: {}", error))?;
        if !poll_response.status().is_success() {
            let status = poll_response.status();
            let body = poll_response.text().unwrap_or_default();
            return Err(crate::response_error(status, body, "AssemblyAI polling"));
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
