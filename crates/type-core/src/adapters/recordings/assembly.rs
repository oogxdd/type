//! AssemblyAI cloud transcription, including full provider JSON for desktop retries.

use std::thread;
use std::time::Duration;

use reqwest::blocking::Client;
use serde::Deserialize;

const ASSEMBLY_UPLOAD_URL: &str = "https://api.assemblyai.com/v2/upload";
const ASSEMBLY_TRANSCRIPT_URL: &str = "https://api.assemblyai.com/v2/transcript";
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

pub(crate) struct AssemblyTranscript {
    pub text: String,
    pub id: String,
    pub json: String,
}

pub fn transcribe_audio_bytes_with_assembly(
    audio_bytes: Vec<u8>,
    api_key: &str,
) -> Result<(String, String), String> {
    let result = transcribe_with_assembly(audio_bytes, api_key)?;
    Ok((result.text, result.id))
}

pub(crate) fn transcribe_with_assembly(
    audio_bytes: Vec<u8>,
    api_key: &str,
) -> Result<AssemblyTranscript, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    transcribe_with_client(
        &client,
        audio_bytes,
        api_key,
        ASSEMBLY_UPLOAD_URL,
        ASSEMBLY_TRANSCRIPT_URL,
        ASSEMBLY_POLL_INTERVAL,
        ASSEMBLY_MAX_POLL_ATTEMPTS,
    )
}

fn transcribe_with_client(
    client: &Client,
    audio_bytes: Vec<u8>,
    api_key: &str,
    upload_url: &str,
    transcript_url: &str,
    poll_interval: Duration,
    max_poll_attempts: usize,
) -> Result<AssemblyTranscript, String> {
    let upload_response = client
        .post(upload_url)
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
        .post(transcript_url)
        .header("authorization", api_key)
        .json(&serde_json::json!({
            "audio_url": upload_payload.upload_url,
            "speech_models": ["universal-3-pro", "universal-2"],
            "language_detection": true
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

    for _ in 0..max_poll_attempts {
        thread::sleep(poll_interval);
        let poll_response = client
            .get(format!("{}/{}", transcript_url, transcript_id))
            .header("authorization", api_key)
            .send()
            .map_err(|error| format!("AssemblyAI polling request failed: {}", error))?;
        if !poll_response.status().is_success() {
            let status = poll_response.status();
            let body = poll_response.text().unwrap_or_default();
            return Err(crate::response_error(status, body, "AssemblyAI polling"));
        }
        let json = poll_response.text().map_err(|error| error.to_string())?;
        let poll_payload = serde_json::from_str::<AssemblyTranscriptResponse>(&json)
            .map_err(|error| format!("AssemblyAI polling response parse failed: {}", error))?;
        match poll_payload.status.as_str() {
            "completed" => {
                let transcript_text = poll_payload.text.unwrap_or_default();
                return Ok(AssemblyTranscript {
                    text: transcript_text,
                    id: transcript_id,
                    json,
                });
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
    use std::{
        io::{Read, Write},
        net::TcpListener,
        time::Instant,
    };

    #[test]
    fn cloud_protocol_keeps_full_response_and_requests_language_detection() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let completed = serde_json::json!({
            "id": "fixture-id", "status": "completed", "text": "Привет, fixture!",
            "language_code": "ru", "speech_model_used": "universal-2",
            "words": [{"text":"Привет,", "start":0, "end":500, "confidence":0.97}],
            "confidence":0.96, "provider_extra": {"keep": true}
        })
        .to_string();
        let response_json = completed.clone();
        let server = thread::spawn(move || {
            for step in 0..4 {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut socket = loop {
                    match listener.accept() {
                        Ok((socket, _)) => break socket,
                        Err(error)
                            if error.kind() == std::io::ErrorKind::WouldBlock
                                && Instant::now() < deadline =>
                        {
                            thread::sleep(Duration::from_millis(5))
                        }
                        Err(error) => panic!("mock request {step} did not arrive: {error}"),
                    }
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut raw = Vec::new();
                let (header, body_start, length) = loop {
                    let mut buf = [0; 4096];
                    let read = socket.read(&mut buf).unwrap();
                    assert!(read > 0);
                    raw.extend_from_slice(&buf[..read]);
                    if let Some(index) = raw.windows(4).position(|part| part == b"\r\n\r\n") {
                        let header = String::from_utf8(raw[..index].to_vec()).unwrap();
                        let length = header
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .map(|value| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        break (header, index + 4, length);
                    }
                };
                while raw.len() < body_start + length {
                    let mut buf = [0; 4096];
                    let read = socket.read(&mut buf).unwrap();
                    assert!(read > 0);
                    raw.extend_from_slice(&buf[..read]);
                }
                assert!(header
                    .to_lowercase()
                    .contains("authorization: synthetic-test-key"));
                let response = match step {
                    0 => {
                        assert!(header.starts_with("POST /upload "));
                        assert_eq!(&raw[body_start..], b"synthetic wav");
                        r#"{"upload_url":"https://fixture.invalid/audio"}"#.to_string()
                    }
                    1 => {
                        assert!(header.starts_with("POST /transcript "));
                        let request: serde_json::Value =
                            serde_json::from_slice(&raw[body_start..]).unwrap();
                        assert_eq!(
                            request["speech_models"],
                            serde_json::json!(["universal-3-pro", "universal-2"])
                        );
                        assert_eq!(request["language_detection"], true);
                        assert_eq!(request["audio_url"], "https://fixture.invalid/audio");
                        r#"{"id":"fixture-id","status":"queued"}"#.to_string()
                    }
                    2 => {
                        assert!(header.starts_with("GET /transcript/fixture-id "));
                        r#"{"id":"fixture-id","status":"processing"}"#.to_string()
                    }
                    _ => response_json.clone(),
                };
                write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response.len(), response).unwrap();
            }
        });
        let result = transcribe_with_client(
            &Client::builder().no_proxy().build().unwrap(),
            b"synthetic wav".to_vec(),
            "synthetic-test-key",
            &format!("{base}/upload"),
            &format!("{base}/transcript"),
            Duration::ZERO,
            2,
        )
        .unwrap();
        server.join().unwrap();
        assert_eq!(result.text, "Привет, fixture!");
        assert_eq!(result.id, "fixture-id");
        assert_eq!(result.json, completed);
    }
}
