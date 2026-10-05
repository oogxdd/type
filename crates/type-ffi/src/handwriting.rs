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

#[uniffi::export(async_runtime = "tokio")]
pub async fn save_handwriting_attachment_from_file(
    source_path: String,
    args_json: String,
) -> Result<String, CoreError> {
    run_blocking(move || {
        let source = crate::media_source(&source_path)?;
        let mut value: serde_json::Value = from_json(&args_json)?;
        value
            .as_object_mut()
            .ok_or("Expected media options object.")?
            .insert(
                "image_base64".into(),
                serde_json::Value::String(String::new()),
            );
        let args = serde_json::from_value(value).map_err(|error| error.to_string())?;
        let env = unlocked_env()?;
        let root = type_core::notes_root(&env)?;
        type_core::application::workspace::with_workspace_write(&root, || {
            to_json(&HandwritingAdapter::new(env).save_from_file(&source, args)?)
        })
    })
    .await
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
