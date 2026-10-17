use super::*;
use gpui_kit::base::Disableable;
use type_core::RecordingsAdapter;

pub struct Playback {
    pub note: SharedString,
    pub audio: String,
    pub root: std::path::PathBuf,
    pub player: audio_player::Player,
}

impl TypeApp {
    pub fn stop_playback(&mut self) {
        self.playback = None;
        self.playback_task = None;
        self.playback_error = None;
        self.audio_details = false;
    }

    pub fn reconcile_playback(&mut self) {
        if self.playback.as_ref().is_some_and(|p| {
            self.locked
                || self.settings
                || self.active_folder.is_some()
                || p.note != self.active
                || p.root != self.backend.root
                || self.recordings.as_ref().is_some_and(|list| {
                    !list.recordings.iter().any(|r| {
                        r.note_path == self.active.as_ref()
                            && r.audio_path.as_deref() == Some(p.audio.as_str())
                    })
                })
        }) {
            self.stop_playback();
        }
    }

    pub(crate) fn active_is_recording(&self) -> bool {
        self.recordings.as_ref().is_some_and(|list| {
            list.recordings
                .iter()
                .any(|r| r.note_path == self.active.as_ref())
        }) || self.previews.get(self.active.as_ref()).is_some_and(|p| {
            p.meta.recording_audio_path.is_some()
                || p.meta.note_type.as_deref() == Some("audio_recording")
        })
    }

    fn recording_audio_path(&self) -> Option<String> {
        if let Some(recording) = self.recordings.as_ref().and_then(|list| {
            list.recordings
                .iter()
                .find(|r| r.note_path == self.active.as_ref())
        }) {
            return recording.audio_path.clone();
        }
        self.previews
            .get(self.active.as_ref())?
            .meta
            .recording_audio_path
            .clone()
    }

    pub fn prepare_playback(&mut self) -> Result<(), String> {
        if self.locked || self.settings || self.active_folder.is_some() {
            return Err("Open an unlocked recording note first.".into());
        }
        type_core::ensure_security_unlocked_for_app(&self.backend.env)?;
        let audio = self
            .recording_audio_path()
            .ok_or("Audio is not available on this device. Sync it from your phone.")?;
        if self.playback.as_ref().is_some_and(|p| {
            p.note == self.active && p.audio == audio && p.root == self.backend.root
        }) {
            return Ok(());
        }
        self.stop_playback();
        let path =
            RecordingsAdapter::new(self.backend.env.clone()).resolve_audio_absolute_path(&audio)?;
        self.playback = Some(Playback {
            note: self.active.clone(),
            audio,
            root: self.backend.root.clone(),
            player: audio_player::Player::open(std::path::Path::new(&path))?,
        });
        Ok(())
    }

    pub fn toggle_playback(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.playback_error = None;
        let result = self.prepare_playback().and_then(|_| {
            let player = &self.playback.as_ref().unwrap().player;
            if player.playing() {
                player.pause();
                Ok(())
            } else {
                player.play()
            }
        });
        if let Err(error) = result {
            self.playback_error = Some(error);
        }
        if self.playback_task.is_none()
            && self.playback.as_ref().is_some_and(|p| p.player.playing())
        {
            self.playback_task = Some(cx.spawn_in(window, async move |view, cx| {
                loop {
                    cx.background_executor()
                        .timer(Duration::from_millis(200))
                        .await;
                    let running = view
                        .update(cx, |this, cx| {
                            this.reconcile_playback();
                            let running =
                                this.playback.as_ref().is_some_and(|p| p.player.playing());
                            cx.notify();
                            if !running {
                                this.playback_task = None;
                            }
                            running
                        })
                        .unwrap_or(false);
                    if !running {
                        break;
                    }
                }
            }));
        }
        cx.notify();
    }

    pub fn seek_playback(&mut self, delta: f64, cx: &mut Context<Self>) {
        match self.prepare_playback() {
            Ok(()) => {
                let player = &self.playback.as_ref().unwrap().player;
                player.seek(player.position() + delta);
            }
            Err(error) => self.playback_error = Some(error),
        }
        cx.notify();
    }

    pub fn render_recording(&self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let recording = self.recordings.as_ref().and_then(|list| {
            list.recordings
                .iter()
                .find(|r| r.note_path == self.active.as_ref())
        });
        let preview = self.previews.get(self.active.as_ref());
        if recording.is_none()
            && !preview.is_some_and(|p| {
                p.meta.recording_audio_path.is_some()
                    || p.meta.note_type.as_deref() == Some("audio_recording")
            })
        {
            return None;
        }
        let audio = self.recording_audio_path();
        let queued = recording.is_some_and(|r| r.is_queued);
        let processing = recording.is_some_and(|r| r.is_processing);
        let stored_status = recording
            .map(|r| r.status.as_str())
            .or_else(|| preview.and_then(|p| p.meta.transcription_status.as_deref()))
            .unwrap_or("pending");
        let status = if processing {
            let percent = self
                .recordings
                .as_ref()
                .and_then(|list| list.queue.progress.as_ref())
                .filter(|p| p.total_seconds > 0.)
                .map(|p| {
                    format!(
                        " · {:.0}%",
                        (100. * p.processed_seconds / p.total_seconds).clamp(0., 100.)
                    )
                })
                .unwrap_or_default();
            format!("Transcribing{percent}")
        } else if queued {
            let position = self
                .recordings
                .as_ref()
                .and_then(|list| {
                    list.queue
                        .pending
                        .iter()
                        .position(|p| p == self.active.as_ref())
                })
                .map(|i| format!(" · #{}", i + 1))
                .unwrap_or_default();
            format!("Queued{position}")
        } else if audio.is_none() {
            "Awaiting audio".into()
        } else {
            match stored_status {
                "completed" => "Transcribed",
                "failed" => "Transcription failed",
                _ => "Ready to transcribe",
            }
            .into()
        };
        let player = self.playback.as_ref().map(|p| &p.player);
        let playing = player.is_some_and(|p| p.playing());
        let time = player.map(|p| {
            format!(
                "{} / {}",
                audio_player::clock(p.position()),
                audio_player::clock(p.duration())
            )
        });
        let error = recording
            .and_then(|r| r.error.as_deref())
            .or_else(|| preview.and_then(|p| p.meta.transcription_error.as_deref()));
        let mut block = v_flex().id("recording-panel").flex_shrink_0().px_3().py_2().gap_1()
            .border_b_1().border_color(cx.theme().border)
            .child(h_flex().gap_2().flex_wrap()
                .child(Icon::new(gpui_kit::assets::IconName::Mic).size_4().text_color(cx.theme().muted_foreground))
                .child(Button::new("audio-toggle").ghost().small()
                    .label(if playing { "Pause" } else { "Play" }).disabled(audio.is_none())
                    .on_click(cx.listener(|this, _, window, cx| this.toggle_playback(window, cx))))
                .child(Button::new("audio-back").ghost().small().label("−10s").disabled(audio.is_none())
                    .on_click(cx.listener(|this, _, _, cx| this.seek_playback(-10., cx))))
                .child(Button::new("audio-forward").ghost().small().label("+10s").disabled(audio.is_none())
                    .on_click(cx.listener(|this, _, _, cx| this.seek_playback(10., cx))))
                .when_some(time, |row, time| row.child(div().text_sm().child(time)))
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child(status))
                .child(self.command_button("audio-transcribe", if stored_status == "completed" { "Retranscribe" } else { "Transcribe" }, commands::Choice::Retry, cx)
                    .disabled(self.busy || queued || processing || audio.is_none()))
                .child(self.command_button("audio-external", "Open externally", commands::Choice::Play, cx).disabled(audio.is_none())))
            .when(audio.is_none(), |block| block.child(div().text_sm().text_color(cx.theme().muted_foreground)
                .child("Audio is not available on this device. Sync the recording from your phone.")))
            .when_some(self.playback_error.clone(), |block, error| block.child(div().text_sm().whitespace_normal().text_color(cx.theme().danger).child(error)));
        if let Some(error) = error.filter(|_| audio.is_some() && stored_status == "failed") {
            block = block.child(
                h_flex()
                    .gap_2()
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().danger)
                            .child(error_summary(error)),
                    )
                    .child(
                        Button::new("audio-error-details")
                            .ghost()
                            .small()
                            .label(if self.audio_details {
                                "Hide details"
                            } else {
                                "Details"
                            })
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.audio_details = !this.audio_details;
                                cx.notify();
                            })),
                    ),
            );
            if self.audio_details {
                block = block.child(
                    div()
                        .id("audio-error-text")
                        .max_h(px(140.))
                        .overflow_y_scroll()
                        .text_xs()
                        .whitespace_normal()
                        .child(error.to_owned()),
                );
            }
        }
        Some(
            block
                .map(|element| {
                    #[cfg(test)]
                    {
                        use gpui_kit::test::TestSupportExt;
                        element.test_support()
                    }
                    #[cfg(not(test))]
                    {
                        element
                    }
                })
                .into_any_element(),
        )
    }
}

fn error_summary(error: &str) -> String {
    if error.contains("Permission denied") {
        return "Whisper cannot access its model cache. Check the model path in Settings.".into();
    }
    if error.contains("Invalid data found") {
        return "The audio file is damaged or incomplete.".into();
    }
    if error.contains("model.bin") || error.contains("No such file") {
        return "Whisper model files are missing. Check the path in Settings.".into();
    }
    error
        .lines()
        .rev()
        .find(|line| !line.trim().is_empty())
        .unwrap_or(error)
        .chars()
        .take(220)
        .collect()
}
