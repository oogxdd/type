//! Handwriting attachment exports for mobile shells.
//!
//! Mobile only saves the image-backed note. OCR deliberately remains a
//! desktop concern: after sync, the desktop queue discovers the pending note.

use type_core::{
    application::handwriting::HandwritingUseCases, HandwritingAdapter,
    SaveHandwritingAttachmentArgs,
};

use crate::{from_json, run_blocking, to_json, unlocked_env, CoreError};

fn handwriting_use_cases() -> Result<HandwritingUseCases<HandwritingAdapter>, String> {
    Ok(HandwritingUseCases::new(HandwritingAdapter::new(
        unlocked_env()?,
    )))
}

/// Save an image under Attachments and create a pending handwriting note.
#[uniffi::export(async_runtime = "tokio")]
pub async fn save_handwriting_attachment(args_json: String) -> Result<String, CoreError> {
    run_blocking(move || {
        let args: SaveHandwritingAttachmentArgs = from_json(&args_json)?;
        to_json(&handwriting_use_cases()?.save(args)?)
    })
    .await
}
