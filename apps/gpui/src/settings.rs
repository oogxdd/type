use super::*;
use commands::Choice;
use gpui_kit::base::{Disableable, Selectable};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Section {
    General,
    Profiles,
    Appearance,
    Sync,
    Transcription,
    Handwriting,
    Import,
    Security,
    Keyboard,
    Updates,
}
impl Section {
    pub const ALL: [Self; 10] = [
        Self::General,
        Self::Profiles,
        Self::Appearance,
        Self::Sync,
        Self::Transcription,
        Self::Handwriting,
        Self::Import,
        Self::Security,
        Self::Keyboard,
        Self::Updates,
    ];
    fn title(self) -> &'static str {
        match self {
            Self::General => "General",
            Self::Profiles => "Profiles",
            Self::Appearance => "Appearance & editor",
            Self::Sync => "Sync",
            Self::Transcription => "Voice transcription",
            Self::Handwriting => "Handwriting",
            Self::Import => "Import & backup",
            Self::Security => "Security",
            Self::Keyboard => "Keyboard",
            Self::Updates => "Updates",
        }
    }
    fn description(self) -> &'static str {
        match self {
            Self::General => "How new files are named.",
            Self::Profiles => "A profile is simply the folder you work in.",
            Self::Appearance => {
                "Make the editor comfortable. These preferences stay on this device."
            }
            Self::Sync => "Sync the current profile folder with Git or pair your phone.",
            Self::Transcription => {
                "Choose where recordings are transcribed and which provider this desktop uses."
            }
            Self::Handwriting => {
                "Turn imported images into text. Provider credentials stay on this device."
            }
            Self::Import => "Bring notes into Type or make a portable copy of your collections.",
            Self::Security => "Encrypt note bodies. Filenames and frontmatter remain readable.",
            Self::Keyboard => "Application shortcuts and editor navigation.",
            Self::Updates => "Keep Type up to date on this Mac.",
        }
    }
    pub fn adjacent(self, direction: isize) -> Self {
        let index = Self::ALL.iter().position(|s| *s == self).unwrap_or(0);
        Self::ALL[index
            .saturating_add_signed(direction)
            .min(Self::ALL.len() - 1)]
    }
}

impl TypeApp {
    fn editor_preference(
        &self,
        id: &'static str,
        label: &'static str,
        enabled: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        Button::new(id)
            .ghost()
            .label(format!(
                "{label}: {} · {}",
                if enabled { "On" } else { "Off" },
                if enabled { "disable" } else { "enable" }
            ))
            .on_click(cx.listener(move |this, _, window, cx| {
                match id {
                    "line-numbers" => this.prefs.line_numbers = !this.prefs.line_numbers,
                    "heading-folding" => {
                        this.prefs.heading_folding = !this.prefs.heading_folding;
                        for note in this.notes.values() {
                            if let Some(editor) = &note.editor {
                                editor.update(cx, |state, cx| {
                                    state.set_folding(this.prefs.heading_folding, window, cx)
                                });
                            }
                        }
                    }
                    "current-line-highlight" => {
                        this.prefs.current_line_highlight = !this.prefs.current_line_highlight
                    }
                    _ => unreachable!(),
                }
                this.persist_preferences();
                cx.notify();
            }))
    }
    pub fn leave_settings(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.settings = false;
        self.focus_editor(window, cx);
        if self.active.is_empty() {
            self.focus.focus(window, cx);
        }
        cx.notify();
    }

    pub fn render_settings_navigation(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let mut nav = v_flex()
            .id("settings-navigation")
            .size_full()
            .p_4()
            .gap_2()
            .track_focus(&self.navigation_focus)
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| this.navigation_focus.focus(window, cx)),
            )
            .child(self.command_button("settings-back", "← Back to notes", Choice::BackToNotes, cx))
            .child(
                div()
                    .px_2()
                    .py_3()
                    .text_lg()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Settings"),
            );
        for section in Section::ALL {
            nav = nav.child(
                Button::new(SharedString::from(format!("settings-{:?}", section)))
                    .ghost()
                    .w_full()
                    .label(section.title())
                    .selected(self.settings_section == section)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.settings_section = section;
                        this.navigation_focus.focus(window, cx);
                        cx.notify();
                    })),
            );
        }
        nav.child(div().flex_1()).child(
            div()
                .px_2()
                .text_sm()
                .text_color(cx.theme().muted_foreground)
                .child("↑ / ↓ or j / k · Ctrl W: switch pane · Esc: notes"),
        )
    }

    fn settings_card(&self, title: &'static str, description: &'static str, cx: &App) -> Div {
        v_flex()
            .gap_3()
            .p_4()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_lg()
            .child(div().font_weight(FontWeight::SEMIBOLD).child(title))
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .whitespace_normal()
                    .child(description),
            )
    }

    pub fn setting_value(&self, field: &str) -> String {
        if field == "transcription_provider"
            && self.profiles.app_config.transcription_provider != "assemblyai"
        {
            return "whisper".into();
        }
        if field == "profile_name" {
            return self
                .active_profile()
                .map(|p| p.name.clone())
                .unwrap_or_default();
        }
        if field == "transcription_mode" {
            return self
                .active_profile()
                .and_then(|p| {
                    serde_json::to_value(p.settings.transcription_mode.unwrap_or(
                        if p.settings.mobile_auto_transcription_enabled {
                            type_core::ports::profiles::TranscriptionMode::AssemblyAi
                        } else {
                            type_core::ports::profiles::TranscriptionMode::Desktop
                        },
                    ))
                    .ok()
                })
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_else(|| "desktop".into());
        }
        serde_json::to_value(&self.profiles.app_config)
            .ok()
            .and_then(|v| v.get(field).cloned())
            .or_else(|| {
                self.active_profile()
                    .and_then(|p| serde_json::to_value(&p.settings).ok())
                    .and_then(|v| v.get(field).cloned())
            })
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default()
    }

    fn setting_row(
        &self,
        field: &'static str,
        label: &'static str,
        help: &'static str,
        secret: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let value = self.setting_value(field);
        let display = if value.is_empty() {
            "Not set".into()
        } else if secret {
            "••••••••".into()
        } else {
            value
        };
        h_flex()
            .gap_4()
            .items_start()
            .w_full()
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .gap_1()
                    .child(div().text_sm().child(label))
                    .child(
                        div()
                            .text_sm()
                            .text_color(cx.theme().muted_foreground)
                            .whitespace_normal()
                            .child(help),
                    )
                    .child(div().text_sm().whitespace_normal().child(display)),
            )
            .child(self.command_button(field, "Edit…", Choice::Config(field), cx))
    }

    // Preset controls and text fields share validation and persistence.
    pub fn choose_setting(
        &mut self,
        field: &'static str,
        value: &'static str,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy || self.locked {
            return;
        }
        self.error = self.save_setting(field, value.to_owned()).err();
        cx.notify();
    }

    fn setting_options(
        &self,
        field: &'static str,
        options: &[(&'static str, &'static str)],
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let value = self.setting_value(field);
        let mut row = h_flex().flex_wrap().gap_2();
        for &(key, label) in options {
            row = row.child(
                Button::new(SharedString::from(format!("{field}-{key}")))
                    .small()
                    .ghost()
                    .selected(value == key)
                    .label(label)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.choose_setting(field, key, window, cx);
                    })),
            );
        }
        row
    }

    pub fn render_settings(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let profile = self.active_profile();
        let mut settings = v_flex()
            .w_full()
            .max_w(px(860.))
            .gap_5()
            .p_6()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(self.settings_section.title()),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .whitespace_normal()
                    .child(self.settings_section.description()),
            );
        match self.settings_section {
            Section::Updates => {
                let available = self.updater.is_some();
                let automatic = self.updater.as_ref().is_some_and(|u| u.automatic());
                settings = settings.child(
                    self.settings_card(
                        "Type",
                        if available { "Updates are signed and installed with your confirmation. Type saves your notes before restarting." }
                        else { "Updates are available in configured macOS release builds. Development builds use manual installation." },
                        cx,
                    )
                    .child(div().text_sm().child(format!("Version {}", env!("CARGO_PKG_VERSION"))))
                    .child(Button::new("check-updates").label("Check for updates…").disabled(!available)
                        .on_click(cx.listener(|this, _, _, cx| {
                            if this.prepare_update(cx) {
                                if let Some(updater) = &this.updater { updater.check(); }
                            }
                        })))
                    .child(Button::new("automatic-updates").ghost().disabled(!available)
                        .label(format!("Automatically check: {}", if automatic { "On" } else { "Off" }))
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(updater) = &this.updater { updater.set_automatic(!updater.automatic()); }
                            cx.notify();
                        })))
                );
            }
            Section::General => {
                settings = settings
                    .child(
                        self.settings_card(
                            "New notes",
                            "Naming applies to newly created files.",
                            cx,
                        )
                        .child(self.setting_options(
                            "note_file_name_format",
                            &[
                                ("utc_timestamp_slug", "UTC timestamp + title"),
                                ("uuid_v7", "UUID v7"),
                                ("uuid_v7_prefix_slug", "UUID prefix + title"),
                            ],
                            cx,
                        )),
                    )
                    .child(
                        self.settings_card(
                            "Trash",
                            "Restore archived files or delete them permanently.",
                            cx,
                        )
                        .child(self.command_button(
                            "settings-trash",
                            "Open Trash",
                            Choice::TrashView,
                            cx,
                        )),
                    );
            }
            Section::Profiles => {
                let mut card = self.settings_card(
                    "Profiles",
                    "Open an existing notes folder or create one by entering a new path.",
                    cx,
                );
                for p in &self.profiles.profiles {
                    let id = p.id.clone();
                    card = card.child(
                        v_flex()
                            .gap_1()
                            .child(
                                Button::new(SharedString::from(format!("profile-{}", p.id)))
                                    .ghost()
                                    .selected(p.id == self.profiles.active_profile_id)
                                    .label(p.name.clone())
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        this.execute(Choice::Profile(id.clone()), window, cx)
                                    })),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(cx.theme().muted_foreground)
                                    .whitespace_normal()
                                    .child(p.notes_root.clone()),
                            ),
                    );
                }
                settings = settings.child(card.child(h_flex().gap_2()
                    .child(self.command_button("pick-profile", "Choose folder…", Choice::PickProfile, cx))
                    .child(self.command_button("new-profile", "Enter path…", Choice::NewProfile, cx))))
                    .child(self.settings_card("Active profile",
                        "To relocate this folder, move it in Finder, add its new path here, then remove the old entry. Removing a profile keeps all its files.", cx)
                        .child(self.setting_row("profile_name", "Name", "A display name for this folder.", false, cx))
                        .child(h_flex().gap_2()
                            .child(self.command_button("reveal-profile", "Show in Finder", Choice::RevealProfile, cx))
                            .child(Button::new("remove-profile").ghost()
                                .label("Remove from Type")
                                .disabled(self.profiles.profiles.len() <= 1)
                                .on_click(cx.listener(|this, _, window, cx| this.execute(Choice::RemoveProfile, window, cx))))));
            }
            Section::Appearance => {
                settings = settings.child(
                    self.settings_card("Appearance", "Switch the app color scheme.", cx)
                        .child(self.command_button(
                            "theme",
                            if self.prefs.dark {
                                "Theme: Dark · switch to Light"
                            } else {
                                "Theme: Light · switch to Dark"
                            },
                            Choice::Theme,
                            cx,
                        )),
                );
                let mut size_row = h_flex().gap_2().child(
                    div()
                        .text_sm()
                        .child(format!("{} px", self.prefs.font_size)),
                );
                for (id, label, delta) in [
                    ("font-smaller", "−", -1.),
                    ("font-larger", "+", 1.),
                    ("font-default", "Reset", 0.),
                ] {
                    size_row =
                        size_row.child(Button::new(id).small().ghost().label(label).on_click(
                            cx.listener(move |this, _, _, cx| {
                                this.prefs.font_size = if delta == 0. {
                                    17.
                                } else {
                                    (this.prefs.font_size + delta).clamp(10., 40.)
                                };
                                this.persist_preferences();
                                cx.notify();
                            }),
                        ));
                }
                settings = settings.child(
                    self.settings_card(
                        "Editor",
                        "Font size, gutter controls and modal editing.",
                        cx,
                    )
                    .child(size_row)
                    .child(self.editor_preference(
                        "line-numbers",
                        "Line numbers",
                        self.prefs.line_numbers,
                        cx,
                    ))
                    .child(self.editor_preference(
                        "heading-folding",
                        "Collapse headings",
                        self.prefs.heading_folding,
                        cx,
                    ))
                    .child(self.editor_preference(
                        "current-line-highlight",
                        "Highlight current line",
                        self.prefs.current_line_highlight,
                        cx,
                    ))
                    .child(self.command_button(
                        "vim",
                        if self.prefs.vim {
                            "Vim: On · disable"
                        } else {
                            "Vim: Off · enable"
                        },
                        Choice::Vim,
                        cx,
                    )),
                );
            }
            Section::Sync => {
                let mut git = self.settings_card("Git sync", "Sync this profile folder with a remote repository. Credentials stay on this device.", cx)
                    .child(div().text_sm().whitespace_normal().child(profile.map(|p| p.settings.git_remote_url.clone()).filter(|s| !s.is_empty()).unwrap_or_else(|| "No remote connected".into())))
                    .child(h_flex().flex_wrap().gap_2()
                        .child(self.command_button("remote", "Connect…", Choice::Remote, cx))
                        .child(self.command_button("pull", "Pull", Choice::Pull, cx))
                        .child(self.command_button("push", "Commit + push", Choice::Push, cx))
                        .child(self.command_button("commit", "Checkpoint", Choice::Commit, cx)))
                    .child(h_flex().gap_2().child(self.command_button("ssh", "Copy SSH key", Choice::Ssh, cx)).child(self.command_button("history", "History", Choice::History, cx)));
                for (field, label, help, secret) in [
                    (
                        "git_branch",
                        "Branch",
                        "Remote branch for this profile folder.",
                        false,
                    ),
                    (
                        "git_username",
                        "Username",
                        "For HTTPS authentication.",
                        false,
                    ),
                    (
                        "git_password",
                        "Access token / password",
                        "Stored in the local device configuration.",
                        true,
                    ),
                    (
                        "git_commit_message",
                        "Commit message",
                        "Message used when saving a checkpoint.",
                        false,
                    ),
                ] {
                    git = git.child(self.setting_row(field, label, help, secret, cx));
                }
                settings = settings.child(git).child(
                    self.settings_card(
                        "Phone sync",
                        "Start the local server, then scan the pairing code on your phone.",
                        cx,
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .child(self.command_button(
                                "server-start",
                                "Start server",
                                Choice::Server,
                                cx,
                            ))
                            .child(self.command_button(
                                "server-stop",
                                "Stop server",
                                Choice::StopServer,
                                cx,
                            )),
                    ),
                );
                if let Some(status) = &self.local_server {
                    if status.running {
                        if let Some(link) = jobs::pairing_link(
                            status,
                            profile.map(|p| p.name.as_str()).unwrap_or("Type"),
                            &self.backend.env,
                        ) {
                            if let Ok(code) = qrcode::QrCode::new(link.as_bytes()) {
                                let width = code.width();
                                let cells = code.to_colors();
                                settings = settings.child(
                                    div().size(px(240.)).child(
                                        canvas(
                                            move |_, _, _| (),
                                            move |bounds, _, window, _| {
                                                let scale = f32::from(bounds.size.width)
                                                    / (width + 8) as f32;
                                                window.paint_quad(fill(bounds, rgb(0xffffff)));
                                                for y in 0..width {
                                                    for x in 0..width {
                                                        if cells[y * width + x]
                                                            == qrcode::Color::Dark
                                                        {
                                                            window.paint_quad(fill(
                                                                Bounds::new(
                                                                    point(
                                                                        bounds.origin.x
                                                                            + px((x + 4) as f32
                                                                                * scale),
                                                                        bounds.origin.y
                                                                            + px((y + 4) as f32
                                                                                * scale),
                                                                    ),
                                                                    size(
                                                                        px(scale + 0.1),
                                                                        px(scale + 0.1),
                                                                    ),
                                                                ),
                                                                rgb(0x000000),
                                                            ));
                                                        }
                                                    }
                                                }
                                            },
                                        )
                                        .size_full(),
                                    ),
                                );
                            }
                            settings = settings.child(
                                Button::new("pairing-copy")
                                    .ghost()
                                    .label("Copy phone pairing link")
                                    .on_click(move |_, _, cx| {
                                        cx.write_to_clipboard(ClipboardItem::new_string(
                                            link.clone(),
                                        ))
                                    }),
                            );
                        }
                        settings = settings.child(
                            div()
                                .text_sm()
                                .child(format!("{} paired devices", status.paired_devices.len())),
                        );
                    }
                    if let Some(error) = &status.error {
                        settings = settings.child(
                            div()
                                .text_sm()
                                .text_color(cx.theme().danger)
                                .child(error.clone()),
                        );
                    }
                }
            }
            Section::Transcription => {
                settings = settings.child(self.settings_card("Recording destination", "This preference syncs with the profile folder. Processing is currently started manually with Process queue.", cx)
                    .child(self.setting_options("transcription_mode", &[("off", "Off"), ("desktop", "Desktop"), ("assemblyai", "AssemblyAI"), ("native", "Native mobile")], cx)))
                    .child(self.settings_card("Desktop provider", "Whisper processes audio locally. AssemblyAI uploads recordings to its cloud service when processing.", cx)
                        .child(self.setting_options("transcription_provider", &[("whisper", "Local Whisper"), ("assemblyai", "AssemblyAI cloud")], cx))
                        .child(if self.profiles.app_config.transcription_provider == "assemblyai" {
                            self.setting_row("assemblyai_api_key", "AssemblyAI API key", "Stored on this device.", true, cx).into_any_element()
                        } else {
                            self.setting_row("whisper_model", "Whisper model", "Local speech recognition model.", false, cx).into_any_element()
                        }))
                    .child(self.settings_card("Recording & queue", "Capture audio or process pending recordings.", cx)
                        .child(h_flex().gap_2().child(self.command_button("recording", if self.recording { "Stop recording" } else { "Start recording" }, Choice::Record, cx))
                            .child(self.command_button("queue", "Process queue", Choice::Queue, cx)))
                        .child(div().text_sm().whitespace_normal().child(self.processing_status.clone())));
            }
            Section::Handwriting => {
                let provider = self.profiles.app_config.handwriting_ocr_provider.as_str();
                let mut card = self.settings_card("Recognition provider", "Local OCR stays on your device. Cloud providers upload the image when processing.", cx)
                    .child(self.setting_options("handwriting_ocr_provider", &[("local", "Local OCR"), ("openai", "OpenAI"), ("huggingface", "Hugging Face")], cx));
                let fields = match provider {
                    "huggingface" => vec![
                        ("huggingface_api_key", "Hugging Face API key", true),
                        ("huggingface_model", "Model", false),
                    ],
                    "openai" => vec![
                        ("openai_api_key", "OpenAI API key", true),
                        ("openai_model", "Model", false),
                    ],
                    _ => vec![("local_ocr_model_path", "Local model path", false)],
                };
                for (field, label, secret) in fields {
                    card = card.child(self.setting_row(
                        field,
                        label,
                        "Stored on this device.",
                        secret,
                        cx,
                    ));
                }
                settings = settings.child(card).child(
                    self.settings_card(
                        "Images",
                        "Import an image and process the pending queue.",
                        cx,
                    )
                    .child(
                        h_flex()
                            .gap_2()
                            .child(self.command_button(
                                "handwriting",
                                "Import image…",
                                Choice::Handwriting,
                                cx,
                            ))
                            .child(self.command_button(
                                "ocr-queue",
                                "Process queue",
                                Choice::Queue,
                                cx,
                            )),
                    ),
                );
            }
            Section::Import => {
                settings = settings
                    .child(
                        self.settings_card(
                            "Import",
                            "Bring an Apple Notes export into the current profile folder.",
                            cx,
                        )
                        .child(self.command_button(
                            "import",
                            "Import Apple Notes…",
                            Choice::Import,
                            cx,
                        )),
                    )
                    .child(
                        self.settings_card(
                            "Backup & export",
                            "Save a backup archive or export your notes.",
                            cx,
                        )
                        .child(
                            h_flex()
                                .gap_2()
                                .child(self.command_button(
                                    "backup",
                                    "Backup ZIP…",
                                    Choice::Backup,
                                    cx,
                                ))
                                .child(self.command_button(
                                    "export",
                                    "Export…",
                                    Choice::Export,
                                    cx,
                                )),
                        ),
                    );
            }
            Section::Security => {
                let state = self.backend.security().state();
                let enabled = state.as_ref().is_ok_and(|s| s.encryption_enabled);
                let mut card = self
                    .settings_card("Encryption", "Protect note bodies with a password.", cx)
                    .child(div().text_sm().child(if enabled {
                        "Encryption is enabled"
                    } else {
                        "Encryption is disabled"
                    }));
                if let Ok(state) = &state {
                    let auto_lock = state.auto_lock_on_background;
                    card = card.child(
                        Button::new("security-auto-lock")
                            .ghost()
                            .label(if auto_lock {
                                "Lock in background: On · disable"
                            } else {
                                "Lock in background: Off · enable"
                            })
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.error = this
                                    .backend
                                    .security()
                                    .set_preferences(type_core::SetSecurityPreferencesArgs {
                                        auto_lock_on_background: !auto_lock,
                                    })
                                    .err();
                                cx.notify();
                            })),
                    );
                }
                if let Err(error) = state {
                    card = card.child(div().text_sm().text_color(cx.theme().danger).child(error));
                }
                card = card.child(if enabled {
                    self.command_button("lock", "Lock now", Choice::Lock, cx)
                } else {
                    self.command_button("enable-security", "Enable encryption…", Choice::Enable, cx)
                });
                settings = settings.child(card);
            }
            Section::Keyboard => {
                for (title, help) in [
                    (
                        "Application",
                        "⌘/Ctrl K — command palette\n⌘/Ctrl N — new note\nCtrl W — switch navigation / content\n⌘/Ctrl , — settings\nEsc — back to notes from settings\n⌘/Ctrl S — save\n⌘/Ctrl + / − / 0 — font size\n⌘/Ctrl Shift L — lock",
                    ),
                    (
                        "Navigation",
                        "j / k or ↑ / ↓ — navigate\nShift J / K or Shift ↑ / ↓ — select range\nSpace — toggle selection · Esc — clear\nm — move selection (or Cmd K → mv)\nn — new folder (child in Folders, root in Stream)\nShift N — new root folder\nh / l — collapse / expand\nEnter — open\nTab — Stream / Folders (notes navigation)\n⌘/Ctrl Backspace — move to Trash\n⌘/Ctrl Shift Backspace — delete permanently",
                    ),
                    (
                        "Vim editor",
                        "i / a / I / A — Insert\no / O — new line\nv / V — Visual / line selection\nCtrl D / Ctrl U — half page down / up\ndd / cc / yy — delete / change / copy line\np / P — paste\nu / Ctrl R — undo / redo\n/ — search\nEsc — Normal mode",
                    ),
                ] {
                    settings = settings.child(
                        self.settings_card(title, "", cx)
                            .child(div().text_sm().whitespace_normal().child(help)),
                    );
                }
            }
        }
        if !self.job_status.is_empty() {
            settings = settings.child(
                div()
                    .text_sm()
                    .whitespace_normal()
                    .child(self.job_status.clone()),
            );
        }
        div()
            .id(SharedString::from(format!(
                "settings-scroll-{:?}",
                self.settings_section
            )))
            .size_full()
            .overflow_y_scroll()
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| this.focus.focus(window, cx)),
            )
            .child(settings)
    }
}
