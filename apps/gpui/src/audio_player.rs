//! Thin, file-backed native playback. No audio copies or temporary previews.
use std::path::Path;

#[cfg(target_os = "macos")]
mod native {
    use std::ffi::{c_char, c_void};
    unsafe extern "C" {
        pub fn type_audio_open(
            path: *const c_char,
            error: *mut c_char,
            capacity: usize,
        ) -> *mut c_void;
        pub fn type_audio_play(handle: *mut c_void) -> bool;
        pub fn type_audio_pause(handle: *mut c_void);
        pub fn type_audio_playing(handle: *mut c_void) -> bool;
        pub fn type_audio_duration(handle: *mut c_void) -> f64;
        pub fn type_audio_position(handle: *mut c_void) -> f64;
        pub fn type_audio_seek(handle: *mut c_void, seconds: f64);
        pub fn type_audio_destroy(handle: *mut c_void);
    }
}

pub struct Player {
    #[cfg(target_os = "macos")]
    handle: std::ptr::NonNull<std::ffi::c_void>,
}

impl Player {
    pub fn open(path: &Path) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            use std::{
                ffi::{CStr, CString},
                os::unix::ffi::OsStrExt,
            };
            let path = CString::new(path.as_os_str().as_bytes()).map_err(|e| e.to_string())?;
            let mut error = [0i8; 1024];
            let handle =
                unsafe { native::type_audio_open(path.as_ptr(), error.as_mut_ptr(), error.len()) };
            let handle = std::ptr::NonNull::new(handle).ok_or_else(|| unsafe {
                CStr::from_ptr(error.as_ptr())
                    .to_string_lossy()
                    .into_owned()
            })?;
            Ok(Self { handle })
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = path;
            Err(
                "Inline audio playback is currently available on macOS. Use Open externally."
                    .into(),
            )
        }
    }

    pub fn play(&self) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        if unsafe { native::type_audio_play(self.handle.as_ptr()) } {
            return Ok(());
        }
        Err("Audio could not start. Check your output device or open it externally.".into())
    }
    pub fn pause(&self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native::type_audio_pause(self.handle.as_ptr())
        }
    }
    pub fn playing(&self) -> bool {
        #[cfg(target_os = "macos")]
        {
            unsafe { native::type_audio_playing(self.handle.as_ptr()) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            false
        }
    }
    pub fn duration(&self) -> f64 {
        #[cfg(target_os = "macos")]
        {
            unsafe { native::type_audio_duration(self.handle.as_ptr()) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            0.
        }
    }
    pub fn position(&self) -> f64 {
        #[cfg(target_os = "macos")]
        {
            unsafe { native::type_audio_position(self.handle.as_ptr()) }
        }
        #[cfg(not(target_os = "macos"))]
        {
            0.
        }
    }
    pub fn seek(&self, seconds: f64) {
        if !seconds.is_finite() {
            return;
        }
        #[cfg(target_os = "macos")]
        unsafe {
            native::type_audio_seek(self.handle.as_ptr(), seconds)
        }
    }
}
impl Drop for Player {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        unsafe {
            native::type_audio_destroy(self.handle.as_ptr())
        }
    }
}

pub fn clock(seconds: f64) -> String {
    let seconds = if seconds.is_finite() {
        seconds.max(0.).floor() as u64
    } else {
        0
    };
    format!("{}:{:02}", seconds / 60, seconds % 60)
}
