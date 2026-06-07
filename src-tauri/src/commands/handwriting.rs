use crate::{
    application::handwriting::HandwritingUseCases, ensure_security_unlocked_for_app,
    HandwritingAttachmentWriteResult, HandwritingOcrListResult, HandwritingOcrQueueResult,
    QueueHandwritingOcrArgs, SaveHandwritingAttachmentArgs, TauriHandwritingAdapter,
};

fn handwriting_use_cases(app: tauri::AppHandle) -> HandwritingUseCases<TauriHandwritingAdapter> {
    HandwritingUseCases::new(TauriHandwritingAdapter::new(app))
}

#[tauri::command]
pub(super) fn save_handwriting_attachment(
    app: tauri::AppHandle,
    args: SaveHandwritingAttachmentArgs,
) -> Result<HandwritingAttachmentWriteResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    handwriting_use_cases(app).save(args)
}

#[tauri::command]
pub(super) fn queue_handwriting_ocr(
    app: tauri::AppHandle,
    args: QueueHandwritingOcrArgs,
) -> Result<HandwritingOcrQueueResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    handwriting_use_cases(app).queue(args)
}

#[tauri::command]
pub(super) fn list_handwriting_ocr_jobs(
    app: tauri::AppHandle,
) -> Result<HandwritingOcrListResult, String> {
    ensure_security_unlocked_for_app(&app)?;
    handwriting_use_cases(app).list()
}
