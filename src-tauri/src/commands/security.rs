use crate::*;

#[tauri::command]
pub(super) fn get_security_state(app: tauri::AppHandle) -> Result<SecurityState, String> {
    get_security_state_impl(&app)
}

#[tauri::command]
pub(super) fn enable_security(
    app: tauri::AppHandle,
    args: EnableSecurityArgs,
) -> Result<SecurityState, String> {
    enable_security_impl(&app, args)
}

#[tauri::command]
pub(super) fn lock_security(app: tauri::AppHandle) -> Result<SecurityState, String> {
    lock_security_impl(&app)
}

#[tauri::command]
pub(super) fn unlock_security(
    app: tauri::AppHandle,
    args: UnlockSecurityArgs,
) -> Result<SecurityUnlockResult, String> {
    unlock_security_impl(&app, args)
}

#[tauri::command]
pub(super) fn set_security_preferences(
    app: tauri::AppHandle,
    args: SetSecurityPreferencesArgs,
) -> Result<SecurityState, String> {
    set_security_preferences_impl(&app, args)
}
