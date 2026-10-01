//! Native update UI belongs to the desktop shell, never to type-core.
use super::*;

pub struct Updater {
    #[cfg(target_os = "macos")]
    handle: *mut std::ffi::c_void,
    #[cfg(target_os = "macos")]
    _prepare: Box<Box<dyn Fn() -> bool>>,
}

#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn type_updater_create(
        prepare: extern "C" fn(*mut std::ffi::c_void) -> bool,
        context: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void;
    fn type_updater_check(handle: *mut std::ffi::c_void);
    fn type_updater_automatic(handle: *mut std::ffi::c_void) -> bool;
    fn type_updater_set_automatic(handle: *mut std::ffi::c_void, enabled: bool);
    fn type_updater_destroy(handle: *mut std::ffi::c_void);
}

impl Updater {
    pub fn new(prepare: impl Fn() -> bool + 'static) -> Option<Self> {
        if cfg!(debug_assertions) || std::env::args().any(|arg| arg == "--dev") {
            return None;
        }
        #[cfg(target_os = "macos")]
        {
            extern "C" fn callback(context: *mut std::ffi::c_void) -> bool {
                // A disappearing entity or an unexpected GPUI borrow must
                // prevent restart; never unwind across Objective-C/FFI.
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| unsafe {
                    (&*context.cast::<Box<dyn Fn() -> bool>>())()
                }))
                .unwrap_or(false)
            }
            let mut prepare: Box<Box<dyn Fn() -> bool>> = Box::new(Box::new(prepare));
            let handle = unsafe {
                type_updater_create(
                    callback,
                    (&mut *prepare as *mut Box<dyn Fn() -> bool>).cast(),
                )
            };
            if handle.is_null() {
                return None;
            }
            Some(Self {
                handle,
                _prepare: prepare,
            })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = prepare;
            None
        }
    }
    pub fn check(&self) {
        #[cfg(target_os = "macos")]
        unsafe {
            type_updater_check(self.handle);
        }
    }
    pub fn automatic(&self) -> bool {
        #[cfg(target_os = "macos")]
        unsafe {
            type_updater_automatic(self.handle)
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }
    pub fn set_automatic(&self, enabled: bool) {
        #[cfg(target_os = "macos")]
        unsafe {
            type_updater_set_automatic(self.handle, enabled);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = enabled;
    }
}
impl Drop for Updater {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        unsafe {
            type_updater_destroy(self.handle);
        }
    }
}

impl TypeApp {
    pub(crate) fn prepare_update(&mut self, cx: &mut Context<Self>) -> bool {
        if self.busy || self.recording || self.pending_recording.is_some() {
            self.error = Some("Finish the current operation, then check for updates again.".into());
            cx.notify();
            return false;
        }
        if let Err(error) = self.flush(false, cx) {
            self.error = Some(format!(
                "Update paused: {error} Resolve this before checking for updates again."
            ));
            cx.notify();
            return false;
        }
        self.persist_preferences();
        true
    }
}
