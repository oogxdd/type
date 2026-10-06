use super::*;
use commands::Choice;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};
use type_core::{
    application::{
        git_sync::GitSyncUseCases, handwriting::HandwritingUseCases, import::ImportUseCases,
        local_sync::LocalSyncUseCases, recordings::RecordingsUseCases,
    },
    *,
};

pub struct Capture {
    stream: cpal::Stream,
    samples: Arc<Mutex<Vec<i16>>>,
    error: Arc<Mutex<Option<String>>>,
    channels: u16,
    rate: u32,
    pub folder: String,
}
impl Capture {
    pub fn start(folder: String) -> Result<Self, String> {
        let device = cpal::default_host()
            .default_input_device()
            .ok_or("No microphone found.")?;
        let supported = device.default_input_config().map_err(|e| e.to_string())?;
        let config: cpal::StreamConfig = supported.clone().into();
        let samples = Arc::new(Mutex::new(Vec::new()));
        let error = Arc::new(Mutex::new(None));
        macro_rules! stream {
            ($ty:ty, $convert:expr) => {{
                let buffer = samples.clone();
                let errors = error.clone();
                device.build_input_stream(
                    &config,
                    move |data: &[$ty], _: &cpal::InputCallbackInfo| {
                        if let Ok(mut buffer) = buffer.lock() {
                            buffer.extend(data.iter().map($convert));
                        }
                    },
                    move |e| {
                        if let Ok(mut error) = errors.lock() {
                            *error = Some(e.to_string());
                        }
                    },
                    None,
                )
            }};
        }
        let stream = match supported.sample_format() {
            cpal::SampleFormat::F32 => {
                stream!(f32, |s: &f32| (s.clamp(-1., 1.) * i16::MAX as f32) as i16)
            }
            cpal::SampleFormat::I16 => stream!(i16, |s: &i16| *s),
            cpal::SampleFormat::U16 => stream!(u16, |s: &u16| (*s as i32 - 32768) as i16),
            format => return Err(format!("Unsupported microphone format: {format}")),
        }
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;
        Ok(Self {
            stream,
            samples,
            error,
            channels: config.channels,
            rate: config.sample_rate.0,
            folder,
        })
    }

    pub fn finish(self) -> Result<(Vec<u8>, String), String> {
        drop(self.stream);
        if let Some(error) = self.error.lock().map_err(|e| e.to_string())?.take() {
            return Err(error);
        }
        let samples = self.samples.lock().map_err(|e| e.to_string())?;
        if samples.is_empty() {
            return Err("The microphone returned no samples.".into());
        }
        let mut output = std::io::Cursor::new(Vec::new());
        {
            let mut writer = hound::WavWriter::new(
                &mut output,
                hound::WavSpec {
                    channels: self.channels,
                    sample_rate: self.rate,
                    bits_per_sample: 16,
                    sample_format: hound::SampleFormat::Int,
                },
            )
            .map_err(|e| e.to_string())?;
            for sample in samples.iter() {
                writer.write_sample(*sample).map_err(|e| e.to_string())?;
            }
            writer.finalize().map_err(|e| e.to_string())?;
        }
        Ok((output.into_inner(), self.folder))
    }
}

pub struct ResultData {
    pub message: String,
    pub open: Option<String>,
    pub clipboard: Option<String>,
    pub server: Option<LocalSyncServerStatus>,
    pub report: Option<String>,
}
impl ResultData {
    pub fn message(s: impl Into<String>) -> Self {
        Self {
            message: s.into(),
            open: None,
            clipboard: None,
            server: None,
            report: None,
        }
    }
}

impl TypeApp {
    pub fn restore_phone_sync(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.locked
            || self.busy
            || self.sync_start_task.is_some()
            || !type_core::local_sync_auto_start_enabled(&self.backend.env)
        {
            return;
        }
        self.busy = true;
        let backend = self.backend.clone();
        let task = cx.background_executor().spawn(async move {
            ensure_security_unlocked_for_app(&backend.env)?;
            LocalSyncUseCases::new(LocalSyncAdapter::new(backend.env)).start()
        });
        self.sync_start_task = Some(cx.spawn_in(window, async move |view, cx| {
            let result = task.await;
            let _ = view.update_in(cx, |this, window, cx| {
                this.sync_start_task = None;
                this.busy = false;
                match result {
                    Ok(server) => {
                        this.local_server = Some(server);
                        this.refresh(window, cx);
                    }
                    Err(error) => {
                        eprintln!("[local-sync] automatic startup failed: {error}");
                        this.error = Some(format!("Phone sync could not start: {error}"));
                    }
                }
                cx.notify();
            });
        }));
    }

    pub fn run_job(
        &mut self,
        label: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
        f: impl FnOnce(Backend) -> Result<ResultData, String> + Send + 'static,
    ) {
        if self.busy || self.locked || self.flush(false, cx).is_err() {
            return;
        }
        self.busy = true;
        self.status = label.into();
        self.error = None;
        let backend = self.backend.clone();
        let task = cx.background_executor().spawn(async move {
            ensure_security_unlocked_for_app(&backend.env)?;
            f(backend)
        });
        self.job_task = Some(cx.spawn_in(window, async move |view, cx| {
            let result = task.await;
            let _ = view.update_in(cx, |this, window, cx| {
                this.busy = false;
                match result {
                    Ok(result) => {
                        this.status = result.message;
                        if let Some(text) = result.clipboard {
                            cx.write_to_clipboard(ClipboardItem::new_string(text));
                        }
                        if let Some(server) = result.server {
                            this.local_server = Some(server);
                        }
                        if let Some(report) = result.report {
                            this.job_status = report;
                            this.settings = true;
                        }
                        if let Ok(profiles) = this.backend.profiles().list() {
                            this.profiles = profiles;
                        }
                        // File versions invalidate only changed previews. A
                        // checkpoint, host toggle or backup changes no bodies.
                        this.processing_updated = None;
                        this.revision += 1;
                        if let Some(path) = result.open {
                            this.open_note(path.into(), true, window, cx);
                        }
                        this.refresh(window, cx);
                    }
                    Err(e) => this.error = Some(e),
                }
                cx.notify();
            });
        }));
        cx.notify();
    }

    pub fn execute_job(
        &mut self,
        choice: Choice,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        self.flush(false, cx)?;
        match choice {
            Choice::Pull => self.run_job("Pulling…", window, cx, |b| {
                let status =
                    GitSyncUseCases::new(GitSyncAdapter::new(b.env)).pull(GitSyncArgs {
                        branch: None,
                        username: None,
                        password: None,
                    })?;
                Ok(ResultData::message(format!(
                    "Pulled · {} ahead / {} behind",
                    status.ahead, status.behind
                )))
            }),
            Choice::Push => self.run_job("Committing and pushing…", window, cx, |b| {
                let status =
                    GitSyncUseCases::new(GitSyncAdapter::new(b.env)).push(GitPushArgs {
                        message: None,
                        branch: None,
                        username: None,
                        password: None,
                    })?;
                Ok(ResultData::message(format!(
                    "Pushed · {} ahead / {} behind",
                    status.ahead, status.behind
                )))
            }),
            Choice::Commit => self.run_job("Checkpointing…", window, cx, |b| {
                GitSyncUseCases::new(GitSyncAdapter::new(b.env)).commit(GitCommitArgs {
                    message: None,
                    branch: None,
                })?;
                Ok(ResultData::message("Local checkpoint created"))
            }),
            Choice::Server | Choice::StopServer => {
                let start = matches!(choice, Choice::Server);
                self.run_job("Updating phone sync…", window, cx, move |b| {
                    let service = LocalSyncUseCases::new(LocalSyncAdapter::new(b.env));
                    let status = if start {
                        service.start()?
                    } else {
                        service.stop()?
                    };
                    let mut result = ResultData::message(if start {
                        "Phone sync server started"
                    } else {
                        "Phone sync server stopped"
                    });
                    result.server = Some(status);
                    Ok(result)
                });
            }
            Choice::Ssh => self.run_job("Loading SSH key…", window, cx, |b| {
                let service = GitSyncUseCases::new(GitSyncAdapter::new(b.env));
                let key = service
                    .ssh_public_key()?
                    .map(Ok)
                    .unwrap_or_else(|| service.generate_ssh_key())?;
                let mut result = ResultData::message("SSH public key copied");
                result.clipboard = Some(key);
                Ok(result)
            }),
            Choice::History => self.run_job("Loading Git history…", window, cx, |b| {
                let entries = GitSyncUseCases::new(GitSyncAdapter::new(b.env))
                    .history(Some(GitHistoryArgs { limit: Some(40) }))?;
                let mut result = ResultData::message("Git history");
                result.report = Some(
                    entries
                        .into_iter()
                        .map(|e| format!("{}  {}  {}", e.short_id, e.author, e.summary))
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
                Ok(result)
            }),
            Choice::Backup => self.run_job("Creating backup…", window, cx, |b| {
                let backup = b.profiles().create_backup()?;
                Ok(ResultData::message(format!(
                    "Backup saved: {}",
                    backup.archive_path
                )))
            }),
            Choice::Export => self.run_job("Exporting…", window, cx, |b| {
                let export = b.profiles().export_to_documents()?;
                Ok(ResultData::message(format!(
                    "Exported: {}",
                    export.export_path
                )))
            }),
            Choice::Queue => self.run_job("Queuing transcription and OCR…", window, cx, queue),
            Choice::Retry => {
                let note_path = self.active.to_string();
                self.run_job("Retrying transcription…", window, cx, move |b| {
                    RecordingsUseCases::new(RecordingsAdapter::new(b.env)).retrigger(
                        RetriggerTranscriptionArgs {
                            note_path,
                            model: None,
                            provider: None,
                            assembly_api_key: None,
                        },
                    )?;
                    Ok(ResultData::message("Transcription queued"))
                });
            }
            Choice::Record => self.record(window, cx)?,
            Choice::Handwriting => self.pick_image(window, cx),
            Choice::Import => self.pick_import(window, cx),
            Choice::Play => {
                let meta = self.backend.notes()?.get_note_meta(&self.active)?;
                let relative = meta
                    .recording_audio_path
                    .or(meta.handwriting_attachment_path)
                    .ok_or("This note has no media attachment.")?;
                let path = type_core::resolve_path(&self.backend.env, &relative)?;
                cx.open_url(&format!("file://{}", percent(&path.to_string_lossy())));
            }
            _ => {}
        }
        Ok(())
    }

    pub fn record(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Result<(), String> {
        if self.recording {
            let capture = self.capture.take().ok_or("No recording.")?;
            self.recording = false;
            let (bytes, folder) = capture.finish()?;
            self.run_job("Saving recording…", window, cx, move |b| {
                let service = RecordingsUseCases::new(RecordingsAdapter::new(b.env.clone()));
                let result = service.save(SaveRecordingArgs {
                    audio_base64: BASE64.encode(bytes),
                    mime_type: Some("audio/wav".into()),
                    folder_path: Some(folder),
                    file_name_format: file_name_format(&b),
                })?;
                let mut output = ResultData::message("Recording saved");
                output.open = Some(result.note_path);
                Ok(output)
            });
        } else {
            let folder = if self.view == View::Folders {
                self.tree
                    .read(cx)
                    .selected_item()
                    .map(|i| {
                        if self.folder_ids.contains(&i.id) {
                            i.id.to_string()
                        } else {
                            note_parent_folder_path(&i.id)
                        }
                    })
                    .unwrap_or(STREAM_FOLDER.into())
            } else {
                STREAM_FOLDER.into()
            };
            self.capture = Some(Capture::start(folder)?);
            self.recording = true;
            self.status = "Recording…".into();
        }
        cx.notify();
        Ok(())
    }

    pub fn pick_profile_folder(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.close_modal(window, cx);
        if let Err(e) = self.ensure_profile_switch() {
            self.error = Some(e);
            cx.notify();
            return;
        }
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Choose the folder containing your notes".into()),
        });
        cx.spawn_in(window, async move |view, cx| match picker.await {
            Ok(Ok(Some(paths))) => {
                if let Some(path) = paths.into_iter().next() {
                    let _ = view.update_in(cx, |this, window, cx| {
                        this.error = this
                            .open_profile_folder(&path.to_string_lossy(), window, cx)
                            .err();
                        cx.notify();
                    });
                }
            }
            Ok(Err(e)) => {
                let _ = view.update_in(cx, |this, _, cx| {
                    this.error = Some(e.to_string());
                    cx.notify();
                });
            }
            _ => {}
        })
        .detach();
    }

    pub fn pick_image(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose a handwriting image".into()),
        });
        cx.spawn_in(window, async move |view, cx| {
            if let Ok(Ok(Some(paths))) = picker.await {
                if let Some(path) = paths.into_iter().next() {
                    let _ = view.update_in(cx, |this, window, cx| {
                        this.run_job("Saving handwriting…", window, cx, move |b| {
                            let mime = match path
                                .extension()
                                .and_then(|s| s.to_str())
                                .unwrap_or("")
                                .to_lowercase()
                                .as_str()
                            {
                                "png" => "image/png",
                                "jpg" | "jpeg" => "image/jpeg",
                                "webp" => "image/webp",
                                _ => return Err("Choose a PNG, JPEG or WebP image.".into()),
                            };
                            let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
                            let result =
                                HandwritingUseCases::new(HandwritingAdapter::new(b.env.clone()))
                                    .save(SaveHandwritingAttachmentArgs {
                                        image_base64: BASE64.encode(bytes),
                                        mime_type: Some(mime.into()),
                                        file_name: path
                                            .file_name()
                                            .map(|s| s.to_string_lossy().into()),
                                        folder_path: Some(STREAM_FOLDER.into()),
                                        file_name_format: file_name_format(&b),
                                    })?;
                            let mut output =
                                ResultData::message("Handwriting saved · queue OCR to transcribe");
                            output.open = Some(result.note_path);
                            Ok(output)
                        })
                    });
                }
            }
        })
        .detach();
    }

    pub fn pick_import(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Choose an exported Apple Notes folder".into()),
        });
        cx.spawn_in(window, async move |view, cx| {
            if let Ok(Ok(Some(paths))) = picker.await {
                if let Some(path) = paths.into_iter().next() {
                    let _ = view.update_in(cx, |this, window, cx| {
                        this.run_job("Starting import…", window, cx, move |b| {
                            let service = ImportUseCases::new(ImportAdapter::new(b.env.clone()));
                            let scan = service.scan(&path.to_string_lossy())?;
                            if scan.note_count == 0 {
                                return Err("No supported notes in this folder.".into());
                            }
                            service.start(AppleImportArgs {
                                source_path: path.to_string_lossy().into(),
                                mode: AppleImportMode::Preserve,
                                target_folder: None,
                                file_name_format: file_name_format(&b),
                            })?;
                            Ok(ResultData::message(format!(
                                "Importing {} notes",
                                scan.note_count
                            )))
                        })
                    });
                }
            }
        })
        .detach();
    }
}

fn file_name_format(b: &Backend) -> NoteFileNameFormat {
    match load_app_config(&b.env.app_data_dir)
        .note_file_name_format
        .as_str()
    {
        "uuid_v7" => NoteFileNameFormat::UuidV7,
        "uuid_v7_prefix_slug" => NoteFileNameFormat::UuidV7PrefixSlug,
        _ => NoteFileNameFormat::UtcTimestampSlug,
    }
}
fn queue(b: Backend) -> Result<ResultData, String> {
    let config = load_app_config(&b.env.app_data_dir);
    let recordings = RecordingsUseCases::new(RecordingsAdapter::new(b.env.clone()));
    let result = if config.transcription_provider == "assemblyai" {
        recordings.queue_cloud(QueueRecordingsArgs {
            assembly_api_key: None,
        })?
    } else {
        recordings.queue_local(QueueLocalTranscriptionsArgs { model: None })?
    };
    let ocr = HandwritingUseCases::new(HandwritingAdapter::new(b.env)).queue(
        QueueHandwritingOcrArgs {
            provider: None,
            api_key: None,
            model: None,
            model_path: None,
        },
    )?;
    Ok(ResultData::message(format!(
        "Queued {} recordings and {} handwriting images",
        result.queued, ocr.queued
    )))
}
pub fn percent(value: &str) -> String {
    value
        .bytes()
        .map(|c| {
            if c.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&c) {
                (c as char).to_string()
            } else {
                format!("%{c:02X}")
            }
        })
        .collect()
}
pub fn pairing_link(status: &LocalSyncServerStatus, name: &str, _env: &AppEnv) -> Option<String> {
    let remote = status.ssh_url.as_ref()?;
    let mut link = format!(
        "type2://sync?remote={}&branch={}&name={}",
        percent(remote),
        percent(status.branch.as_deref().unwrap_or("main")),
        percent(name)
    );
    if let Some(ticket) = &status.iroh_ticket {
        link.push_str(&format!("&irohTicket={}", percent(ticket)));
    }
    if let Some(key) = &status.host_key_sha256 {
        link.push_str(&format!("&hostKeySha256={}", percent(&key)));
    }
    Some(link)
}

#[cfg(test)]
pub(crate) static PROCESSING_SCANS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub fn processing_snapshot(b: &Backend) -> String {
    #[cfg(test)]
    PROCESSING_SCANS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let recordings = RecordingsUseCases::new(RecordingsAdapter::new(b.env.clone()))
        .list()
        .ok();
    let handwriting = HandwritingUseCases::new(HandwritingAdapter::new(b.env.clone()))
        .list()
        .ok();
    let import = ImportUseCases::new(ImportAdapter::new(b.env.clone()))
        .status()
        .ok();
    let mut lines = vec![];
    if let Some(list) = recordings {
        lines.push(format!("Transcription: {} in flight", list.queue.in_flight));
        for recording in list
            .recordings
            .iter()
            .filter(|r| r.status != "completed")
            .take(15)
        {
            lines.push(format!(
                "{} · {}{}",
                recording.note_path,
                recording.status,
                recording
                    .error
                    .as_ref()
                    .map(|e| format!(" · {e}"))
                    .unwrap_or_default()
            ));
        }
    }
    if let Some(list) = handwriting {
        lines.push(format!("OCR: {} in flight", list.queue.in_flight));
        for job in list
            .jobs
            .iter()
            .filter(|j| j.status != "completed")
            .take(15)
        {
            lines.push(format!("{} · {}", job.note_path, job.status));
        }
    }
    if let Some(import) = import {
        if import.running {
            lines.push("Apple Notes import is running".into());
        }
    }
    lines.join("\n")
}
