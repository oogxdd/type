//! Hugging Face Inference-API handwriting OCR provider.

use reqwest::blocking::Client;
use std::{thread, time::Duration};

use crate::response_error;

use super::{
    HUGGINGFACE_INFERENCE_BASE_URL, HUGGINGFACE_MAX_RETRIES, HUGGINGFACE_RETRYABLE_STATUS,
    HUGGINGFACE_RETRY_DELAY,
};

fn parse_huggingface_text(payload: &serde_json::Value) -> Option<String> {
    if let Some(text) = payload
        .get("generated_text")
        .and_then(|value| value.as_str())
    {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(text) = payload.get("text").and_then(|value| value.as_str()) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(items) = payload.as_array() {
        for item in items {
            if let Some(found) = parse_huggingface_text(item) {
                return Some(found);
            }
        }
    }
    None
}

pub(crate) fn transcribe_handwriting_with_huggingface(
    image_bytes: &[u8],
    mime_type: &str,
    api_key: &str,
    model: &str,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    let endpoint = format!("{}/{}", HUGGINGFACE_INFERENCE_BASE_URL, model);
    for attempt in 0..HUGGINGFACE_MAX_RETRIES {
        let response = client
            .post(&endpoint)
            .header("authorization", format!("Bearer {}", api_key))
            .header("content-type", mime_type)
            .body(image_bytes.to_vec())
            .send()
            .map_err(|error| format!("Hugging Face OCR request failed: {}", error))?;
        if response.status().is_success() {
            let payload = response
                .json::<serde_json::Value>()
                .map_err(|error| format!("Hugging Face OCR response parse failed: {}", error))?;
            if let Some(message) = payload.get("error").and_then(|value| value.as_str()) {
                let retryable = message.to_lowercase().contains("loading");
                if retryable && attempt + 1 < HUGGINGFACE_MAX_RETRIES {
                    thread::sleep(HUGGINGFACE_RETRY_DELAY);
                    continue;
                }
                return Err(format!("Hugging Face OCR failed: {}", message));
            }
            return parse_huggingface_text(&payload)
                .filter(|text| !text.trim().is_empty())
                .ok_or_else(|| "Hugging Face OCR did not return text.".to_string());
        }
        if response.status() == HUGGINGFACE_RETRYABLE_STATUS
            && attempt + 1 < HUGGINGFACE_MAX_RETRIES
        {
            thread::sleep(HUGGINGFACE_RETRY_DELAY);
            continue;
        }
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(response_error(status, body, "Hugging Face OCR request"));
    }
    Err("Hugging Face OCR timed out while waiting for the model to load.".to_string())
}
