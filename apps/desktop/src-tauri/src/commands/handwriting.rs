use type_core::{
    application::handwriting::HandwritingUseCases, ensure_security_unlocked_for_app,
    HandwritingAdapter, HandwritingAttachmentWriteResult, HandwritingOcrListResult,
    HandwritingOcrQueueResult, LocalOcrStatusArgs, LocalOcrStatusResult, QueueHandwritingOcrArgs,
    SaveHandwritingAttachmentArgs,
};

fn handwriting_use_cases(
    app: tauri::AppHandle,
) -> Result<HandwritingUseCases<HandwritingAdapter>, String> {
    Ok(HandwritingUseCases::new(HandwritingAdapter::new(
        crate::app_env(&app)?,
    )))
}

#[tauri::command]
pub(super) fn save_handwriting_attachment(
    app: tauri::AppHandle,
    args: SaveHandwritingAttachmentArgs,
) -> Result<HandwritingAttachmentWriteResult, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    handwriting_use_cases(app)?.save(args)
}

#[tauri::command]
pub(super) fn queue_handwriting_ocr(
    app: tauri::AppHandle,
    args: QueueHandwritingOcrArgs,
) -> Result<HandwritingOcrQueueResult, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    handwriting_use_cases(app)?.queue(args)
}

#[tauri::command]
pub(super) fn list_handwriting_ocr_jobs(
    app: tauri::AppHandle,
) -> Result<HandwritingOcrListResult, String> {
    ensure_security_unlocked_for_app(&crate::app_env(&app)?)?;
    handwriting_use_cases(app)?.list()
}

#[tauri::command]
pub(super) fn check_local_ocr_status(
    app: tauri::AppHandle,
    args: LocalOcrStatusArgs,
) -> LocalOcrStatusResult {
    let env = match crate::app_env(&app) {
        Ok(env) => env,
        Err(error) => {
            return LocalOcrStatusResult {
                available: false,
                python_found: false,
                model_path: String::new(),
                error: Some(error),
            }
        }
    };
    if let Err(error) = ensure_security_unlocked_for_app(&env) {
        return LocalOcrStatusResult {
            available: false,
            python_found: false,
            model_path: String::new(),
            error: Some(error),
        };
    }
    match handwriting_use_cases(app) {
        Ok(use_cases) => use_cases.local_status(args),
        Err(error) => LocalOcrStatusResult {
            available: false,
            python_found: false,
            model_path: String::new(),
            error: Some(error),
        },
    }
}
