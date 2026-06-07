//! OpenAI Responses-API handwriting OCR provider.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use reqwest::blocking::Client;
use std::time::Duration;

use crate::response_error;

use super::{HANDWRITING_OCR_PROMPT, OPENAI_RESPONSES_URL};

fn extract_openai_output_text(payload: &serde_json::Value) -> Option<String> {
    if let Some(value) = payload.get("output_text") {
        if let Some(text) = value.as_str() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
        if let Some(items) = value.as_array() {
            let joined = items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            if !joined.trim().is_empty() {
                return Some(joined);
            }
        }
    }
    let mut chunks = Vec::new();
    if let Some(output) = payload.get("output").and_then(|value| value.as_array()) {
        for block in output {
            if let Some(contents) = block.get("content").and_then(|value| value.as_array()) {
                for item in contents {
                    if let Some(text) = item.get("text").and_then(|value| value.as_str()) {
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            chunks.push(trimmed.to_string());
                        }
                    }
                }
            }
        }
    }
    if chunks.is_empty() {
        None
    } else {
        Some(chunks.join("\n"))
    }
}

pub(crate) fn transcribe_handwriting_with_openai(
    image_bytes: &[u8],
    mime_type: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    let image_data_url = format!("data:{};base64,{}", mime_type, BASE64.encode(image_bytes));
    let response = client
        .post(OPENAI_RESPONSES_URL)
        .header("authorization", format!("Bearer {}", api_key))
        .json(&serde_json::json!({
            "model": model,
            "input": [{
                "role": "user",
                "content": [
                    { "type": "input_text", "text": HANDWRITING_OCR_PROMPT },
                    { "type": "input_image", "image_url": image_data_url }
                ]
            }]
        }))
        .send()
        .map_err(|error| format!("OpenAI OCR request failed: {}", error))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(response_error(status, body, "OpenAI OCR request"));
    }
    let payload = response
        .json::<serde_json::Value>()
        .map_err(|error| format!("OpenAI OCR response parse failed: {}", error))?;
    extract_openai_output_text(&payload)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| "OpenAI OCR did not return text.".to_string())
}
