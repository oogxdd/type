//! Shell recordings gateway: native iOS AVAudioRecorder capture on top of the
//! core recordings adapter (storage, transcription queue, listing).
//!
//! The core adapter reports "native recorder unsupported"; this wrapper
//! overrides the three native_* methods with the Objective-C recorder on iOS
//! and delegates everything else straight through.

use type_core::ports::recordings::RecordingsGateway;
use type_core::RecordingsAdapter;

#[cfg(target_os = "ios")]
use type_core::{
    now_ms, NativeRecorderCapabilities, RecordingAudioPayload, BASE64,
};

#[cfg(target_os = "ios")]
use base64::Engine as _;
#[cfg(target_os = "ios")]
use objc::runtime::Object;
#[cfg(target_os = "ios")]
use objc::{msg_send, sel, sel_impl};
#[cfg(target_os = "ios")]
use std::fs;

pub(crate) struct TauriRecordingsAdapter {
    core: RecordingsAdapter,
    #[cfg(target_os = "ios")]
    env: type_core::AppEnv,
}

impl TauriRecordingsAdapter {
    pub(crate) fn new(env: type_core::AppEnv) -> Self {
        Self {
            #[cfg(target_os = "ios")]
            env: env.clone(),
            core: RecordingsAdapter::new(env),
        }
    }
}

impl RecordingsGateway for TauriRecordingsAdapter {
    type NativeCapabilities = <RecordingsAdapter as RecordingsGateway>::NativeCapabilities;
    type AudioPayload = <RecordingsAdapter as RecordingsGateway>::AudioPayload;
    type SaveArgs = <RecordingsAdapter as RecordingsGateway>::SaveArgs;
    type WriteResult = <RecordingsAdapter as RecordingsGateway>::WriteResult;
    type CloudQueueArgs = <RecordingsAdapter as RecordingsGateway>::CloudQueueArgs;
    type LocalQueueArgs = <RecordingsAdapter as RecordingsGateway>::LocalQueueArgs;
    type QueueResult = <RecordingsAdapter as RecordingsGateway>::QueueResult;
    type RetriggerArgs = <RecordingsAdapter as RecordingsGateway>::RetriggerArgs;
    type WhisperArgs = <RecordingsAdapter as RecordingsGateway>::WhisperArgs;
    type WhisperStatus = <RecordingsAdapter as RecordingsGateway>::WhisperStatus;
    type ListResult = <RecordingsAdapter as RecordingsGateway>::ListResult;
    type ReadArgs = <RecordingsAdapter as RecordingsGateway>::ReadArgs;

    fn native_capabilities(&self) -> Result<Self::NativeCapabilities, String> {
        #[cfg(target_os = "ios")]
        {
            let (recording, started_ms) = crate::ios_native_recorder_state()
                .lock()
                .map(|guard| {
                    let Some(state) = guard.as_ref() else {
                        return (false, None);
                    };
                    let recorder = state.recorder_ptr as *mut Object;
                    let resumed = crate::ios_ensure_recorder_active(recorder);
                    (resumed, state.started_ms)
                })
                .unwrap_or((false, None));
            return Ok(NativeRecorderCapabilities {
                supported: true,
                recording,
                started_ms,
            });
        }

        #[cfg(not(target_os = "ios"))]
        {
            self.core.native_capabilities()
        }
    }

    fn start_native(&self) -> Result<(), String> {
        #[cfg(target_os = "ios")]
        {
            let mut guard = crate::ios_native_recorder_state()
                .lock()
                .map_err(|_| "Native recorder state lock poisoned.".to_string())?;
            if guard.is_some() {
                return Err("Native audio recorder is already active.".to_string());
            }
            let output_path = crate::next_native_recording_path(&self.env)?;
            crate::ensure_avfoundation_loaded()?;
            crate::configure_ios_audio_for_recording()?;
            let recorder = crate::create_ios_audio_recorder(&output_path).inspect_err(|_| {
                crate::deactivate_ios_audio();
            })?;

            *guard = Some(crate::IosNativeRecorderState {
                recorder_ptr: recorder as usize,
                output_path,
                mime_type: crate::IOS_AUDIO_MIME_TYPE.to_string(),
                started_ms: now_ms(),
            });
            return Ok(());
        }

        #[cfg(not(target_os = "ios"))]
        {
            self.core.start_native()
        }
    }

    fn stop_native(&self) -> Result<Self::AudioPayload, String> {
        #[cfg(target_os = "ios")]
        {
            let state = {
                let mut guard = crate::ios_native_recorder_state()
                    .lock()
                    .map_err(|_| "Native recorder state lock poisoned.".to_string())?;
                guard
                    .take()
                    .ok_or_else(|| "Native audio recorder is not active.".to_string())?
            };

            unsafe {
                let recorder = state.recorder_ptr as *mut Object;
                let _: () = msg_send![recorder, stop];
                let _: () = msg_send![recorder, release];
            }
            crate::deactivate_ios_audio();

            let audio_bytes = fs::read(&state.output_path).map_err(|error| error.to_string())?;
            let _ = fs::remove_file(&state.output_path);
            if audio_bytes.is_empty() {
                return Err("Native recorder returned an empty audio file.".to_string());
            }

            return Ok(RecordingAudioPayload {
                mime_type: state.mime_type,
                audio_base64: BASE64.encode(audio_bytes),
            });
        }

        #[cfg(not(target_os = "ios"))]
        {
            self.core.stop_native()
        }
    }

    fn save(&self, args: Self::SaveArgs) -> Result<Self::WriteResult, String> {
        self.core.save(args)
    }

    fn queue_cloud(&self, args: Self::CloudQueueArgs) -> Result<Self::QueueResult, String> {
        self.core.queue_cloud(args)
    }

    fn queue_local(&self, args: Self::LocalQueueArgs) -> Result<Self::QueueResult, String> {
        self.core.queue_local(args)
    }

    fn retrigger(&self, args: Self::RetriggerArgs) -> Result<(), String> {
        self.core.retrigger(args)
    }

    fn whisper_status(&self, args: Self::WhisperArgs) -> Self::WhisperStatus {
        self.core.whisper_status(args)
    }

    fn list(&self) -> Result<Self::ListResult, String> {
        self.core.list()
    }

    fn read_audio(&self, args: Self::ReadArgs) -> Result<Self::AudioPayload, String> {
        self.core.read_audio(args)
    }
}
