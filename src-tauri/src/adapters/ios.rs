//! iOS-specific: native AVAudioRecorder, WKWebView termination recovery.

use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Protocol, Sel, BOOL, NO, YES};
use objc::{msg_send, sel, sel_impl};
use std::{
    collections::HashMap,
    ffi::{CStr, CString},
    fs,
    os::raw::{c_char, c_int},
    path::{Path, PathBuf},
    ptr,
    sync::{mpsc, Mutex, OnceLock},
};
use tauri::Manager;

use crate::{app_data_dir, now_ms};

// ── Constants ──────────────────────────────────────────────────────────────────

const IOS_WEBVIEW_TERMINATION_PROXY_CLASS: &str = "TypeWebViewTerminationProxy";
const IOS_WEBVIEW_RELOAD_THROTTLE_MS: i64 = 1_000;
pub(crate) const IOS_AUDIO_MIME_TYPE: &str = "audio/mp4";
const IOS_AUDIO_FILE_EXT: &str = "m4a";
const K_AUDIO_FORMAT_MPEG4AAC: u32 = 0x6161_6320;
const RTLD_NOW: c_int = 2;
const UI_USER_INTERFACE_STYLE_LIGHT: isize = 1;
const UI_USER_INTERFACE_STYLE_DARK: isize = 2;

// ── FFI ────────────────────────────────────────────────────────────────────────

unsafe extern "C" {
    fn dlopen(filename: *const c_char, flag: c_int) -> *mut core::ffi::c_void;
    fn dlerror() -> *const c_char;
}

// ── Types ──────────────────────────────────────────────────────────────────────

/// Holds the active AVAudioRecorder pointer and metadata.
pub(crate) struct IosNativeRecorderState {
    pub(crate) recorder_ptr: usize,
    pub(crate) output_path: PathBuf,
    pub(crate) mime_type: String,
    pub(crate) started_ms: Option<i64>,
}

// ── Statics ────────────────────────────────────────────────────────────────────

static IOS_NATIVE_RECORDER: OnceLock<Mutex<Option<IosNativeRecorderState>>> = OnceLock::new();
static IOS_WEBVIEW_TERMINATION_PROXIES: OnceLock<Mutex<HashMap<usize, usize>>> = OnceLock::new();
static IOS_WEBVIEW_TERMINATION_PROXY_CLASS_PTR: OnceLock<usize> = OnceLock::new();

// ── Recorder state ─────────────────────────────────────────────────────────────

/// Access the global native recorder state mutex.
pub(crate) fn ios_native_recorder_state() -> &'static Mutex<Option<IosNativeRecorderState>> {
    IOS_NATIVE_RECORDER.get_or_init(|| Mutex::new(None))
}

// ── WKWebView termination recovery ────────────────────────────────────────────

fn ios_webview_termination_proxies() -> &'static Mutex<HashMap<usize, usize>> {
    IOS_WEBVIEW_TERMINATION_PROXIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn ios_webview_termination_proxy_class() -> &'static Class {
    let class_ptr = IOS_WEBVIEW_TERMINATION_PROXY_CLASS_PTR.get_or_init(|| {
        if let Some(existing) = Class::get(IOS_WEBVIEW_TERMINATION_PROXY_CLASS) {
            return existing as *const Class as usize;
        }

        let superclass = Class::get("NSObject")
            .expect("NSObject missing while installing iOS webview termination proxy");
        let mut decl = ClassDecl::new(IOS_WEBVIEW_TERMINATION_PROXY_CLASS, superclass)
            .expect("Failed to declare iOS webview termination proxy class");
        if let Some(protocol) = Protocol::get("WKNavigationDelegate") {
            decl.add_protocol(protocol);
        }
        decl.add_ivar::<*mut Object>("originalDelegate");
        decl.add_ivar::<i64>("lastReloadMs");
        unsafe {
            decl.add_method(
                sel!(dealloc),
                ios_webview_termination_proxy_dealloc as extern "C" fn(&mut Object, Sel),
            );
            decl.add_method(
                sel!(respondsToSelector:),
                ios_webview_termination_proxy_responds_to_selector
                    as extern "C" fn(&Object, Sel, Sel) -> BOOL,
            );
            decl.add_method(
                sel!(forwardingTargetForSelector:),
                ios_webview_termination_proxy_forwarding_target_for_selector
                    as extern "C" fn(&Object, Sel, Sel) -> *mut Object,
            );
            decl.add_method(
                sel!(webViewWebContentProcessDidTerminate:),
                ios_webview_termination_proxy_process_did_terminate
                    as extern "C" fn(&mut Object, Sel, *mut Object),
            );
        }

        decl.register() as *const Class as usize
    });

    unsafe { &*(*class_ptr as *const Class) }
}

extern "C" fn ios_webview_termination_proxy_dealloc(this: &mut Object, _cmd: Sel) {
    unsafe {
        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let _: () = msg_send![original_delegate, release];
            this.set_ivar("originalDelegate", ptr::null_mut::<Object>());
        }

        let superclass = this
            .class()
            .superclass()
            .expect("iOS webview termination proxy superclass missing");
        let _: () = msg_send![super(this, superclass), dealloc];
    }
}

extern "C" fn ios_webview_termination_proxy_responds_to_selector(
    this: &Object,
    _cmd: Sel,
    selector: Sel,
) -> BOOL {
    unsafe {
        if selector == sel!(webViewWebContentProcessDidTerminate:) {
            return YES;
        }

        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let responds: BOOL = msg_send![original_delegate, respondsToSelector: selector];
            if responds == YES {
                return YES;
            }
        }

        let superclass = this
            .class()
            .superclass()
            .expect("iOS webview termination proxy superclass missing");
        msg_send![super(this, superclass), respondsToSelector: selector]
    }
}

extern "C" fn ios_webview_termination_proxy_forwarding_target_for_selector(
    this: &Object,
    _cmd: Sel,
    selector: Sel,
) -> *mut Object {
    unsafe {
        if selector == sel!(webViewWebContentProcessDidTerminate:) {
            return ptr::null_mut();
        }

        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let responds: BOOL = msg_send![original_delegate, respondsToSelector: selector];
            if responds == YES {
                return original_delegate;
            }
        }

        let superclass = this
            .class()
            .superclass()
            .expect("iOS webview termination proxy superclass missing");
        msg_send![super(this, superclass), forwardingTargetForSelector: selector]
    }
}

extern "C" fn ios_webview_termination_proxy_process_did_terminate(
    this: &mut Object,
    _cmd: Sel,
    webview: *mut Object,
) {
    unsafe {
        if webview.is_null() {
            return;
        }

        let now = now_ms().unwrap_or(0);
        let last_reload_ms = *this.get_ivar::<i64>("lastReloadMs");
        let should_reload =
            now <= 0 || now.saturating_sub(last_reload_ms) >= IOS_WEBVIEW_RELOAD_THROTTLE_MS;
        if should_reload {
            if now > 0 {
                this.set_ivar("lastReloadMs", now);
            }
            let _: () = msg_send![webview, reload];
            println!("[ios] WKWebView content process terminated. Reload requested.");
        }

        let original_delegate = *this.get_ivar::<*mut Object>("originalDelegate");
        if !original_delegate.is_null() {
            let responds: BOOL = msg_send![
                original_delegate,
                respondsToSelector: sel!(webViewWebContentProcessDidTerminate:)
            ];
            if responds == YES {
                let _: () = msg_send![
                    original_delegate,
                    webViewWebContentProcessDidTerminate: webview
                ];
            }
        }
    }
}

unsafe fn install_ios_webview_termination_recovery_for_webview(
    webview: *mut Object,
) -> Result<(), String> {
    if webview.is_null() {
        return Err("WKWebView handle is null.".to_string());
    }

    let proxy_class = ios_webview_termination_proxy_class();
    let current_delegate: *mut Object = msg_send![webview, navigationDelegate];
    if !current_delegate.is_null() {
        let delegate_class: *const Class = msg_send![current_delegate, class];
        if std::ptr::eq(delegate_class, proxy_class as *const Class) {
            return Ok(());
        }
    }

    let proxy_alloc: *mut Object = msg_send![proxy_class, alloc];
    if proxy_alloc.is_null() {
        return Err("Failed to allocate iOS webview termination proxy.".to_string());
    }
    let proxy: *mut Object = msg_send![proxy_alloc, init];
    if proxy.is_null() {
        return Err("Failed to initialize iOS webview termination proxy.".to_string());
    }

    if !current_delegate.is_null() {
        let _: *mut Object = msg_send![current_delegate, retain];
    }
    (*proxy).set_ivar("originalDelegate", current_delegate);
    (*proxy).set_ivar("lastReloadMs", 0_i64);

    // WKWebView.navigationDelegate is weak, so keep the proxy alive.
    let _: *mut Object = msg_send![proxy, retain];
    let _: () = msg_send![webview, setNavigationDelegate: proxy];

    let mut proxies = ios_webview_termination_proxies()
        .lock()
        .map_err(|_| "Failed to lock iOS webview proxy registry.".to_string())?;
    if let Some(previous_proxy_addr) = proxies.insert(webview as usize, proxy as usize) {
        if previous_proxy_addr != proxy as usize {
            let previous_proxy = previous_proxy_addr as *mut Object;
            if !previous_proxy.is_null() {
                let _: () = msg_send![previous_proxy, release];
            }
        }
    }

    Ok(())
}

/// Install WKWebView termination recovery on the main webview.
pub(crate) fn install_ios_webview_termination_recovery(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Err(error) = window.with_webview(|platform_webview| unsafe {
        let webview = platform_webview.inner() as *mut Object;
        if let Err(error) = install_ios_webview_termination_recovery_for_webview(webview) {
            println!(
                "[ios] Failed to install WKWebView termination recovery: {}",
                error
            );
        }
    }) {
        println!(
            "[ios] Failed to access WKWebView for termination recovery: {}",
            error
        );
    }
}

/// Release all retained proxy objects.
pub(crate) fn release_ios_webview_termination_proxies() {
    let Some(proxies) = IOS_WEBVIEW_TERMINATION_PROXIES.get() else {
        return;
    };
    let mut proxies = match proxies.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    for (_, proxy_addr) in proxies.drain() {
        let proxy = proxy_addr as *mut Object;
        if proxy.is_null() {
            continue;
        }
        unsafe {
            let _: () = msg_send![proxy, release];
        }
    }
}

// ── AVFoundation ───────────────────────────────────────────────────────────────

/// Dynamically load the AVFoundation framework via dlopen.
pub(crate) fn ensure_avfoundation_loaded() -> Result<(), String> {
    let framework_path =
        CString::new("/System/Library/Frameworks/AVFoundation.framework/AVFoundation")
            .map_err(|_| "Failed to load AVFoundation framework path.".to_string())?;
    unsafe {
        let handle = dlopen(framework_path.as_ptr(), RTLD_NOW);
        if !handle.is_null() {
            return Ok(());
        }
        let error_ptr = dlerror();
        if error_ptr.is_null() {
            return Err("Failed to load AVFoundation framework.".to_string());
        }
        let message = CStr::from_ptr(error_ptr).to_string_lossy().to_string();
        Err(format!(
            "Failed to load AVFoundation framework: {}",
            message
        ))
    }
}

fn ns_class(name: &str) -> Result<&'static Class, String> {
    Class::get(name).ok_or_else(|| format!("Missing iOS runtime class: {}", name))
}

fn ns_string(value: &str) -> Result<*mut Object, String> {
    let c_value =
        CString::new(value).map_err(|_| "Failed to convert string for iOS runtime.".to_string())?;
    unsafe {
        let class = ns_class("NSString")?;
        let result: *mut Object = msg_send![class, stringWithUTF8String: c_value.as_ptr()];
        if result.is_null() {
            return Err("Failed to create NSString.".to_string());
        }
        Ok(result)
    }
}

fn ns_error_message(error: *mut Object, fallback: &str) -> String {
    if error.is_null() {
        return fallback.to_string();
    }
    unsafe {
        let localized: *mut Object = msg_send![error, localizedDescription];
        if localized.is_null() {
            return fallback.to_string();
        }
        let c_message: *const c_char = msg_send![localized, UTF8String];
        if c_message.is_null() {
            return fallback.to_string();
        }
        CStr::from_ptr(c_message).to_string_lossy().to_string()
    }
}

/// Configure the iOS audio session for recording.
pub(crate) fn configure_ios_audio_for_recording() -> Result<(), String> {
    unsafe {
        let av_audio_class = ns_class("AVAudioSession")?;
        let av_audio: *mut Object = msg_send![av_audio_class, sharedInstance];
        if av_audio.is_null() {
            return Err("Failed to access AVAudioSession.".to_string());
        }
        let category = ns_string("AVAudioSessionCategoryPlayAndRecord")?;
        let mut error: *mut Object = ptr::null_mut();
        let category_ok: BOOL = msg_send![av_audio, setCategory: category error: &mut error];
        if category_ok == NO {
            return Err(ns_error_message(
                error,
                "Failed to set AVAudioSession category.",
            ));
        }
        let active_ok: BOOL = msg_send![av_audio, setActive: YES error: &mut error];
        if active_ok == NO {
            return Err(ns_error_message(
                error,
                "Failed to activate AVAudioSession.",
            ));
        }
    }
    Ok(())
}

/// Deactivate the iOS audio session.
pub(crate) fn deactivate_ios_audio() {
    unsafe {
        if let Some(av_audio_class) = Class::get("AVAudioSession") {
            let av_audio: *mut Object = msg_send![av_audio_class, sharedInstance];
            if av_audio.is_null() {
                return;
            }
            let mut error: *mut Object = ptr::null_mut();
            let _: BOOL = msg_send![av_audio, setActive: NO error: &mut error];
        }
    }
}

/// Create and start an AVAudioRecorder at the given output path.
pub(crate) fn create_ios_audio_recorder(output_path: &Path) -> Result<*mut Object, String> {
    unsafe {
        let dictionary_class = ns_class("NSMutableDictionary")?;
        let settings: *mut Object = msg_send![dictionary_class, dictionary];
        if settings.is_null() {
            return Err("Failed to create recorder settings.".to_string());
        }

        let number_class = ns_class("NSNumber")?;
        let format_key = ns_string("AVFormatIDKey")?;
        let sample_rate_key = ns_string("AVSampleRateKey")?;
        let channels_key = ns_string("AVNumberOfChannelsKey")?;
        let bitrate_key = ns_string("AVEncoderBitRateKey")?;
        let quality_key = ns_string("AVEncoderAudioQualityKey")?;

        let format_value: *mut Object =
            msg_send![number_class, numberWithUnsignedInt: K_AUDIO_FORMAT_MPEG4AAC];
        let sample_rate_value: *mut Object = msg_send![number_class, numberWithDouble: 44_100.0f64];
        let channels_value: *mut Object = msg_send![number_class, numberWithInt: 1i32];
        let bitrate_value: *mut Object = msg_send![number_class, numberWithInt: 128_000i32];
        let quality_value: *mut Object = msg_send![number_class, numberWithInt: 96i32];

        let _: () = msg_send![settings, setObject: format_value forKey: format_key];
        let _: () = msg_send![settings, setObject: sample_rate_value forKey: sample_rate_key];
        let _: () = msg_send![settings, setObject: channels_value forKey: channels_key];
        let _: () = msg_send![settings, setObject: bitrate_value forKey: bitrate_key];
        let _: () = msg_send![settings, setObject: quality_value forKey: quality_key];

        let path_ns = ns_string(&output_path.to_string_lossy())?;
        let url_class = ns_class("NSURL")?;
        let url: *mut Object = msg_send![url_class, fileURLWithPath: path_ns];
        if url.is_null() {
            return Err("Failed to build native recorder output URL.".to_string());
        }

        let recorder_class = ns_class("AVAudioRecorder")?;
        let alloc: *mut Object = msg_send![recorder_class, alloc];
        if alloc.is_null() {
            return Err("Failed to allocate AVAudioRecorder.".to_string());
        }
        let mut error: *mut Object = ptr::null_mut();
        let recorder: *mut Object =
            msg_send![alloc, initWithURL: url settings: settings error: &mut error];
        if recorder.is_null() {
            return Err(ns_error_message(
                error,
                "Failed to initialize AVAudioRecorder.",
            ));
        }

        let prepared: BOOL = msg_send![recorder, prepareToRecord];
        if prepared == NO {
            let _: () = msg_send![recorder, release];
            return Err("Failed to prepare AVAudioRecorder.".to_string());
        }
        let started: BOOL = msg_send![recorder, record];
        if started == NO {
            let _: () = msg_send![recorder, release];
            return Err("Failed to start AVAudioRecorder.".to_string());
        }
        Ok(recorder)
    }
}

/// Check if the AVAudioRecorder is currently recording.
pub(crate) fn ios_recorder_is_recording(recorder: *mut Object) -> bool {
    if recorder.is_null() {
        return false;
    }
    unsafe {
        let recording: BOOL = msg_send![recorder, isRecording];
        recording == YES
    }
}

/// Resume the recorder if it stopped (e.g. after an interruption).
pub(crate) fn ios_ensure_recorder_active(recorder: *mut Object) -> bool {
    if ios_recorder_is_recording(recorder) {
        return true;
    }
    if configure_ios_audio_for_recording().is_err() {
        return false;
    }
    unsafe {
        let resumed: BOOL = msg_send![recorder, record];
        resumed == YES
    }
}

/// Allocate a unique file path for a native recording in app data.
pub(crate) fn next_native_recording_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = app_data_dir(app)?.join("native-recordings");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let timestamp = now_ms().unwrap_or(0);
    for attempt in 0..=512usize {
        let suffix = if attempt == 0 {
            format!("recording-{}", timestamp)
        } else {
            format!("recording-{}-{}", timestamp, attempt)
        };
        let path = root.join(format!("{}.{}", suffix, IOS_AUDIO_FILE_EXT));
        if !path.exists() {
            return Ok(path);
        }
    }
    Err("Failed to allocate native recording filename.".to_string())
}

unsafe fn apply_ios_interface_style_to_webview(
    webview: *mut Object,
    style: isize,
) -> Result<(), String> {
    if webview.is_null() {
        return Err("WKWebView handle is null.".to_string());
    }

    let _: () = msg_send![webview, setOverrideUserInterfaceStyle: style];

    let scroll_view: *mut Object = msg_send![webview, scrollView];
    if !scroll_view.is_null() {
        let _: () = msg_send![scroll_view, setOverrideUserInterfaceStyle: style];
    }

    let window: *mut Object = msg_send![webview, window];
    if !window.is_null() {
        let _: () = msg_send![window, setOverrideUserInterfaceStyle: style];

        let mut controller: *mut Object = msg_send![window, rootViewController];
        while !controller.is_null() {
            let _: () = msg_send![controller, setOverrideUserInterfaceStyle: style];
            let next_controller: *mut Object = msg_send![controller, presentedViewController];
            if next_controller.is_null() {
                break;
            }
            controller = next_controller;
        }
    }

    Ok(())
}

/// Override the iOS interface style (dark/light) on the main webview.
pub(crate) fn set_ios_native_theme(app: &tauri::AppHandle, theme: &str) -> Result<(), String> {
    let normalized = theme.trim().to_ascii_lowercase();
    let style = match normalized.as_str() {
        "dark" => UI_USER_INTERFACE_STYLE_DARK,
        "light" => UI_USER_INTERFACE_STYLE_LIGHT,
        _ => return Err(format!("Unsupported iOS theme: {}", theme)),
    };

    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };

    let (tx, rx) = mpsc::sync_channel(1);
    window
        .with_webview(move |platform_webview| {
            let result = unsafe {
                let webview = platform_webview.inner() as *mut Object;
                apply_ios_interface_style_to_webview(webview, style)
            };
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

    rx.recv()
        .map_err(|_| "Failed to receive the iOS theme update result.".to_string())?
}

unsafe fn ios_top_presenting_view_controller(webview: *mut Object) -> Result<*mut Object, String> {
    if webview.is_null() {
        return Err("WKWebView handle is null.".to_string());
    }

    let window: *mut Object = msg_send![webview, window];
    if window.is_null() {
        return Err("Failed to resolve the iOS window for file export.".to_string());
    }

    let mut controller: *mut Object = msg_send![window, rootViewController];
    if controller.is_null() {
        return Err("Failed to resolve the iOS root view controller.".to_string());
    }

    loop {
        let presented: *mut Object = msg_send![controller, presentedViewController];
        if presented.is_null() {
            break;
        }
        controller = presented;
    }

    Ok(controller)
}

unsafe fn present_ios_file_export_sheet_for_webview(
    webview: *mut Object,
    file_path: &Path,
) -> Result<(), String> {
    let controller = ios_top_presenting_view_controller(webview)?;
    let path_ns = ns_string(&file_path.to_string_lossy())?;
    let url_class = ns_class("NSURL")?;
    let url: *mut Object = msg_send![url_class, fileURLWithPath: path_ns];
    if url.is_null() {
        return Err("Failed to create the iOS export URL.".to_string());
    }

    let picker_class = ns_class("UIDocumentPickerViewController")?;
    let alloc: *mut Object = msg_send![picker_class, alloc];
    if alloc.is_null() {
        return Err("Failed to allocate the iOS export picker.".to_string());
    }

    // UIDocumentPickerModeExportToService
    let picker: *mut Object = msg_send![alloc, initWithURL: url inMode: 2usize];
    if picker.is_null() {
        return Err("Failed to initialize the iOS export picker.".to_string());
    }

    let _: () = msg_send![controller, presentViewController: picker animated: YES completion: ptr::null_mut::<Object>()];
    Ok(())
}

/// Present the native iOS share sheet for exporting a file.
pub(crate) fn present_ios_file_export_sheet(
    app: &tauri::AppHandle,
    file_path: &Path,
) -> Result<(), String> {
    if !file_path.is_absolute() {
        return Err("Export file path must be absolute.".to_string());
    }
    if !file_path.exists() || !file_path.is_file() {
        return Err(format!(
            "Export file not found: {}",
            file_path.to_string_lossy()
        ));
    }

    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window is unavailable for iOS file export.".to_string())?;
    let export_path = file_path.to_path_buf();
    let (tx, rx) = mpsc::sync_channel(1);

    window
        .with_webview(move |platform_webview| {
            let result = unsafe {
                let webview = platform_webview.inner() as *mut Object;
                present_ios_file_export_sheet_for_webview(webview, &export_path)
            };
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

    rx.recv()
        .map_err(|_| "Failed to receive the iOS export sheet result.".to_string())?
}
