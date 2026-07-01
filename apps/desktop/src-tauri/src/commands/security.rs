use type_core::{
    application::security::SecurityUseCases, EnableSecurityArgs, SecurityState,
    SecurityUnlockResult, SetSecurityPreferencesArgs, SecurityAdapter, UnlockSecurityArgs,
};

fn security_use_cases(app: tauri::AppHandle) -> Result<SecurityUseCases<SecurityAdapter>, String> {
    Ok(SecurityUseCases::new(SecurityAdapter::new(crate::app_env(&app)?)))
}

#[tauri::command]
pub(super) fn get_security_state(app: tauri::AppHandle) -> Result<SecurityState, String> {
    security_use_cases(app)?.state()
}

#[tauri::command]
pub(super) fn enable_security(
    app: tauri::AppHandle,
    args: EnableSecurityArgs,
) -> Result<SecurityState, String> {
    security_use_cases(app)?.enable(args)
}

#[tauri::command]
pub(super) fn lock_security(app: tauri::AppHandle) -> Result<SecurityState, String> {
    security_use_cases(app)?.lock()
}

#[tauri::command]
pub(super) fn unlock_security(
    app: tauri::AppHandle,
    args: UnlockSecurityArgs,
) -> Result<SecurityUnlockResult, String> {
    security_use_cases(app)?.unlock(args)
}

#[tauri::command]
pub(super) fn set_security_preferences(
    app: tauri::AppHandle,
    args: SetSecurityPreferencesArgs,
) -> Result<SecurityState, String> {
    security_use_cases(app)?.set_preferences(args)
}
