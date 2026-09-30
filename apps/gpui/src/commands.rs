use super::*;
use type_core::{application::git_sync::GitSyncUseCases, *};

#[derive(Clone)]
pub enum ModalKind {
    Palette,
    Rename(String),
    CreateProfile,
    Remote,
    Unlock,
    Delete(Vec<String>),
    Config(&'static str),
    EnablePassword,
    EnablePanic(String),
}
pub struct Modal {
    pub kind: ModalKind,
    pub input: Entity<InputState>,
    pub palette: Option<Entity<CommandState>>,
    pub selected: usize,
    pub navigation: bool,
}
#[derive(Clone)]
pub enum Choice {
    CommandPalette,
    New,
    Feed,
    Folders,
    TrashView,
    MoveNote(String),
    Move(String),
    MoveMode,
    Rename,
    Trash,
    Delete,
    Reviewed,
    ArchiveFlag,
    Duplicate,
    Split,
    Reload,
    Copy,
    Settings,
    BackToNotes,
    Theme,
    Vim,
    Profile(String),
    NewProfile,
    Root,
    Remote,
    Pull,
    Push,
    Commit,
    Server,
    StopServer,
    Ssh,
    History,
    Backup,
    Export,
    Record,
    Handwriting,
    Import,
    Queue,
    Retry,
    Play,
    Config(&'static str),
    Lock,
    Enable,
}
#[derive(Clone)]
pub struct Entry {
    pub label: String,
    pub choice: Choice,
}

impl Choice {
    fn section(&self) -> &'static str {
        match self {
            Self::MoveMode
            | Self::Move(_)
            | Self::Rename
            | Self::Trash
            | Self::Delete
            | Self::Reviewed
            | Self::ArchiveFlag
            | Self::Duplicate
            | Self::Split
            | Self::Copy
            | Self::Reload => "Selection",
            Self::New | Self::NewProfile => "Create",
            Self::Feed | Self::Folders | Self::TrashView | Self::MoveNote(_) => "Navigate",
            Self::CommandPalette | Self::Settings | Self::BackToNotes | Self::Theme | Self::Vim => {
                "View"
            }
            Self::Profile(_) | Self::Root => "Working folders",
            Self::Remote
            | Self::Pull
            | Self::Push
            | Self::Commit
            | Self::Server
            | Self::StopServer
            | Self::Ssh
            | Self::History
            | Self::Backup
            | Self::Export => "Sync and backup",
            Self::Record
            | Self::Handwriting
            | Self::Import
            | Self::Queue
            | Self::Retry
            | Self::Play => "Capture and processing",
            Self::Lock | Self::Enable => "Security",
            Self::Config(_) => "Settings",
        }
    }
}

impl TypeApp {
    pub fn show_modal(
        &mut self,
        kind: ModalKind,
        value: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let secret = matches!(
            &kind,
            ModalKind::Unlock
                | ModalKind::EnablePassword
                | ModalKind::EnablePanic(_)
                | ModalKind::Config(
                    "assemblyai_api_key"
                        | "openai_api_key"
                        | "huggingface_api_key"
                        | "git_password"
                )
        );
        let input = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(value.to_owned())
                .masked(secret)
        });
        self.modal_subscription = Some(cx.subscribe(&input, |this, _, _: &InputEvent, cx| {
            if let Some(m) = &mut this.modal {
                m.selected = 0;
            }
            cx.notify();
        }));
        let navigation = self.navigation_focus.contains_focused(window, cx);
        let palette = if matches!(kind, ModalKind::Palette) {
            let state = cx.new(|cx| CommandState::new(window, cx));
            state.update(cx, |state, cx| {
                state.set_query(value.to_owned(), window, cx)
            });
            Some(state)
        } else {
            None
        };
        let handle = palette
            .as_ref()
            .map(|s| s.focus_handle(cx))
            .unwrap_or_else(|| input.focus_handle(cx));
        self.modal = Some(Modal {
            kind,
            input: input.clone(),
            palette,
            selected: 0,
            navigation,
        });
        window.defer(cx, move |window, cx| handle.focus(window, cx));
        cx.notify();
    }

    pub fn close_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let navigation = self.modal.take().map(|m| m.navigation).unwrap_or(false);
        self.modal_subscription = None;
        if self.settings {
            if navigation {
                self.navigation_focus.focus(window, cx);
            } else {
                self.focus.focus(window, cx);
            }
        } else if navigation {
            self.tree.update(cx, |s, cx| s.focus(window, cx));
        } else if let Some(editor) = self.notes.get(&self.active).and_then(|n| n.editor.as_ref()) {
            editor.focus_handle(cx).focus(window, cx);
        } else {
            self.focus.focus(window, cx);
        }
        cx.notify();
    }

    pub fn entries(&self, query: &str, cx: &App) -> Vec<Entry> {
        if let Some(query) = query.strip_prefix("mv ") {
            let items = self
                .folder_tree
                .as_ref()
                .map(|r| navigation::folders(r, &self.previews))
                .unwrap_or_default();
            let dirs = navigation::destinations(&items);
            let mut entries: Vec<_> = navigation::move_suggestions(&dirs, query)
                .into_iter()
                .map(|p| Entry {
                    label: format!("Move to {p}"),
                    choice: Choice::Move(p),
                })
                .collect();
            if !query.trim().is_empty()
                && !dirs.iter().any(|d| d == query.trim())
                && type_gpui::backend::validate_destination(query.trim_end_matches('/'), false)
                    .is_ok()
            {
                let path = query.trim_end_matches('/').trim().to_owned();
                entries.push(Entry {
                    label: format!("Create folder and move to {path}"),
                    choice: Choice::Move(path),
                });
            }
            if query.is_empty() {
                entries.insert(
                    0,
                    Entry {
                        label: "Move to root".into(),
                        choice: Choice::Move("".into()),
                    },
                );
            }
            return entries;
        }
        let mut entries = vec![
            ("New note", Choice::New),
            ("Open Stream", Choice::Feed),
            ("Open Folders", Choice::Folders),
            ("Open Trash", Choice::TrashView),
            ("Move selection to folder… (mv)", Choice::MoveMode),
            ("Rename selection…", Choice::Rename),
            ("Move selection to Trash", Choice::Trash),
            ("Delete selection permanently…", Choice::Delete),
            ("Toggle reviewed marker", Choice::Reviewed),
            ("Toggle archived marker", Choice::ArchiveFlag),
            ("Duplicate note", Choice::Duplicate),
            ("Split note at cursor", Choice::Split),
            ("Copy note body", Choice::Copy),
            ("Reload note from disk (discard draft)", Choice::Reload),
            ("Settings", Choice::Settings),
            ("Toggle light / dark theme", Choice::Theme),
            ("Toggle Vim", Choice::Vim),
            ("New working folder…", Choice::NewProfile),
            ("Choose notes root (move files)…", Choice::Root),
            ("Connect Git remote…", Choice::Remote),
            ("Pull from Git", Choice::Pull),
            ("Commit and push to Git", Choice::Push),
            ("Create local Git checkpoint", Choice::Commit),
            ("Start phone sync server", Choice::Server),
            ("Stop phone sync server", Choice::StopServer),
            ("Copy / generate SSH public key", Choice::Ssh),
            ("Show Git history", Choice::History),
            ("Create backup ZIP", Choice::Backup),
            ("Export to Documents", Choice::Export),
            ("Start / stop recording", Choice::Record),
            ("Import handwriting image…", Choice::Handwriting),
            ("Import exported Apple Notes folder…", Choice::Import),
            ("Queue transcription and OCR", Choice::Queue),
            ("Retry transcription for open note", Choice::Retry),
            ("Play note audio in default player", Choice::Play),
            ("Lock app", Choice::Lock),
            ("Enable note encryption…", Choice::Enable),
        ]
        .into_iter()
        .map(|(label, choice)| Entry {
            label: label.into(),
            choice,
        })
        .collect::<Vec<_>>();
        for profile in &self.profiles.profiles {
            entries.push(Entry {
                label: format!("Working folder: {}", profile.name),
                choice: Choice::Profile(profile.id.clone()),
            });
        }
        for n in self.previews.values() {
            if n.path.starts_with("_system/archive/") {
                continue;
            }
            entries.push(Entry {
                label: format!("Open: {} · {}", navigation::title(&n.content), n.path),
                choice: Choice::MoveNote(n.path.clone()),
            });
        }
        let query = query.to_lowercase();
        entries.retain(|e| e.label.to_lowercase().contains(&query));
        let _ = cx;
        entries
    }

    pub fn palette_groups(&self, query: &str, cx: &App) -> Vec<(&'static str, Vec<Entry>)> {
        let mut entries = self.entries(query, cx);
        if query.starts_with("mv ") {
            return vec![("Move to folder", entries)];
        }
        // Stable note ordering prevents a HashMap refresh from changing Enter's target.
        entries.sort_by(|a, b| match (&a.choice, &b.choice) {
            (Choice::MoveNote(_), Choice::MoveNote(_)) => {
                a.label.to_lowercase().cmp(&b.label.to_lowercase())
            }
            (Choice::MoveNote(_), _) => std::cmp::Ordering::Greater,
            (_, Choice::MoveNote(_)) => std::cmp::Ordering::Less,
            _ => std::cmp::Ordering::Equal,
        });
        [
            "Selection",
            "Create",
            "Navigate",
            "View",
            "Working folders",
            "Sync and backup",
            "Capture and processing",
            "Security",
            "Settings",
        ]
        .into_iter()
        .filter_map(|section| {
            let items: Vec<_> = entries
                .iter()
                .filter(|e| e.choice.section() == section)
                .cloned()
                .collect();
            (!items.is_empty()).then_some((section, items))
        })
        .collect()
    }

    pub fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let editor_focused = self
            .notes
            .get(&self.active)
            .and_then(|n| n.editor.as_ref())
            .is_some_and(|e| e.focus_handle(cx).is_focused(window));
        if let Some(command) = keyboard::command(event, cfg!(target_os = "macos"), editor_focused) {
            window.prevent_default();
            cx.stop_propagation();
            if self.locked {
                return;
            }
            use keyboard::Command::*;
            if self.modal.is_some() {
                if command == Palette {
                    self.close_modal(window, cx);
                }
                return;
            }
            match command {
                Palette => self.show_modal(ModalKind::Palette, "", window, cx),
                Rail => {
                    self.prefs.rail = !self.prefs.rail;
                    self.persist_preferences();
                }
                Sidebar => {
                    self.prefs.sidebar = !self.prefs.sidebar;
                    self.persist_preferences();
                    if !self.prefs.sidebar {
                        self.focus_editor(window, cx);
                    }
                }
                Focus | Cycle => {
                    if self.settings {
                        if self.navigation_focus.contains_focused(window, cx) {
                            self.focus.focus(window, cx);
                        } else {
                            self.navigation_focus.focus(window, cx);
                        }
                    } else if self.navigation_focus.contains_focused(window, cx) {
                        self.focus_editor(window, cx);
                    } else {
                        self.prefs.sidebar = true;
                        self.tree.update(cx, |s, cx| s.focus(window, cx));
                    }
                }
                New => self.new_note(window, cx),
                Trash => self.execute(Choice::Trash, window, cx),
                Delete => self.execute(Choice::Delete, window, cx),
                FontUp => {
                    self.prefs.font_size = (self.prefs.font_size + 1.).min(40.);
                    self.persist_preferences();
                }
                FontDown => {
                    self.prefs.font_size = (self.prefs.font_size - 1.).max(10.);
                    self.persist_preferences();
                }
                FontReset => {
                    self.prefs.font_size = 17.;
                    self.persist_preferences();
                }
                Lock => self.lock(window, cx),
                Save => {
                    let _ = self.flush(false, cx);
                }
                Settings => self.execute(Choice::Settings, window, cx),
                Refresh => {
                    if self.flush(false, cx).is_ok() {
                        self.refresh(window, cx);
                    }
                }
            }
            cx.notify();
            return;
        }
        if let Some(modal) = &self.modal {
            let key = &event.keystroke.key;
            if let Some(palette) = &modal.palette {
                if matches!(key.as_str(), "tab" | "right") {
                    let query = palette.read(cx).query(cx);
                    if query.starts_with("mv ") {
                        if let Some(index) = palette.read(cx).selected_index() {
                            if let Some(Entry {
                                choice: Choice::Move(path),
                                ..
                            }) = self
                                .palette_groups(&query, cx)
                                .get(index.section)
                                .and_then(|(_, entries)| entries.get(index.row))
                            {
                                let value = format!("mv {path}/");
                                palette.update(cx, |s, cx| s.set_query(value, window, cx));
                            }
                        }
                        window.prevent_default();
                        cx.stop_propagation();
                        cx.notify();
                    }
                }
                return; // Command owns arrows, Enter, Escape, scrolling and focus.
            }
            match key.as_str() {
                "escape" if !self.locked => self.close_modal(window, cx),
                "enter" => self.submit_modal(window, cx),
                _ => return,
            }
            window.prevent_default();
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if self.locked || self.busy {
            return;
        }
        if self.settings {
            let stroke = &event.keystroke;
            if stroke.modifiers.control || stroke.modifiers.platform || stroke.modifiers.alt {
                return;
            }
            match stroke.key.as_str() {
                "escape" => self.leave_settings(window, cx),
                "j" | "down" if self.navigation_focus.contains_focused(window, cx) => {
                    self.settings_section = self.settings_section.adjacent(1);
                }
                "k" | "up" if self.navigation_focus.contains_focused(window, cx) => {
                    self.settings_section = self.settings_section.adjacent(-1);
                }
                "enter" | "l" | "right" if self.navigation_focus.contains_focused(window, cx) => {
                    self.focus.focus(window, cx)
                }
                _ => return,
            }
            window.prevent_default();
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if self.navigation_focus.contains_focused(window, cx) {
            self.navigation_focused = true;
            self.navigation_key(event, window, cx);
            return;
        }
        self.navigation_focused = false;
        self.vim_key(event, window, cx);
    }

    pub fn on_quit(&mut self, _: &Quit, window: &mut Window, cx: &mut Context<Self>) {
        if self.recording || self.busy || self.pending_recording.is_some() {
            self.error = Some("Finish the current operation before quitting.".into());
            cx.notify();
            return;
        }
        if self.flush(true, cx).is_ok() {
            self.persist_preferences();
            let _ = type_core::stop_local_sync_server_impl(&self.backend.env);
            let _ = window;
            cx.quit();
        }
    }

    pub fn focus_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(editor) = self.notes.get(&self.active).and_then(|n| n.editor.as_ref()) {
            self.navigation_focused = false;
            editor.update(cx, |s, cx| {
                s.set_readonly(self.prefs.vim && self.vim.mode != vim::Mode::Insert, cx);
                s.focus(window, cx);
            });
        }
    }

    fn navigation_key(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let stroke = &event.keystroke;
        if stroke.modifiers.control || stroke.modifiers.platform || stroke.modifiers.alt {
            return;
        }
        let key = stroke.key.as_str();
        let index = self.tree.read(cx).selected_index().unwrap_or(0);
        let id = self.tree.read(cx).selected_item().map(|i| i.id.clone());
        match key {
            "j" | "k" | "down" | "up" => {
                let next = if key == "j" || key == "down" {
                    if self.tree.read(cx).entry(index + 1).is_some() {
                        index + 1
                    } else {
                        index
                    }
                } else {
                    index.saturating_sub(1)
                };
                if stroke.modifiers.shift {
                    if let Some(id) = id.filter(|i| !self.folder_ids.contains(i)) {
                        self.selected.insert(id);
                    }
                    if let Some(row) = self
                        .tree
                        .read(cx)
                        .entry(next)
                        .filter(|e| !self.folder_ids.contains(&e.item().id))
                    {
                        self.selected.insert(row.item().id.clone());
                    }
                } else {
                    self.selected.clear();
                }
                self.tree.update(cx, |s, cx| {
                    s.set_selected_index(Some(next), cx);
                    s.scroll_to_item(next, ScrollStrategy::Nearest);
                });
            }
            "h" | "l" | "left" | "right" => {
                if let Some(id) = id {
                    let folder = if self.folder_ids.contains(&id) {
                        Some(id)
                    } else {
                        parent_folder(&self.roots, &id)
                    };
                    if let Some(folder) = folder {
                        if let Some(item) = tree_moves::find(&self.roots, &folder) {
                            item.clone().expanded(key == "l" || key == "right");
                        }
                        self.tree.update(cx, |s, cx| {
                            s.set_items(self.roots.clone(), cx);
                            s.set_selected_item(Some(&TreeItem::new(folder, "")), cx);
                        });
                    }
                }
            }
            "enter" => {
                if let Some(id) = id {
                    self.click_row(id.clone(), self.folder_ids.contains(&id), false, window, cx);
                }
            }
            "tab" => {
                self.set_view(
                    if self.view == View::Folders {
                        View::Feed
                    } else {
                        View::Folders
                    },
                    window,
                    cx,
                );
            }
            "escape" => {
                self.selected.clear();
            }
            _ => return,
        }
        window.prevent_default();
        cx.stop_propagation();
        cx.notify();
    }

    pub fn save_setting(&mut self, field: &str, value: String) -> Result<(), String> {
        let mut config = self.profiles.app_config.clone();
        match field {
            "assemblyai_api_key" => config.assemblyai_api_key = value,
            "whisper_model" => config.whisper_model = value,
            "transcription_provider" => {
                if !matches!(value.as_str(), "whisper" | "assemblyai") {
                    return Err("Choose whisper or assemblyai.".into());
                }
                config.transcription_provider = value;
            }
            "handwriting_ocr_provider" => {
                if !matches!(value.as_str(), "local" | "openai" | "huggingface") {
                    return Err("Choose local, openai or huggingface.".into());
                }
                config.handwriting_ocr_provider = value;
            }
            "local_ocr_model_path" => config.local_ocr_model_path = value,
            "openai_api_key" => config.openai_api_key = value,
            "openai_model" => config.openai_model = value,
            "huggingface_api_key" => config.huggingface_api_key = value,
            "huggingface_model" => config.huggingface_model = value,
            "note_file_name_format" => {
                if !matches!(
                    value.as_str(),
                    "utc_timestamp_slug" | "uuid_v7" | "uuid_v7_prefix_slug"
                ) {
                    return Err("Choose a supported filename format.".into());
                }
                config.note_file_name_format = value;
            }
            "git_branch" | "git_username" | "git_password" | "git_commit_message"
            | "transcription_mode" | "profile_name" => {
                let profile = self.active_profile().ok_or("No working folder.")?;
                if field == "profile_name" {
                    self.profiles = self.backend.profiles().update(UpdateProfileArgs {
                        profile_id: profile.id.clone(),
                        name: Some(value),
                        description: None,
                    })?;
                    return Ok(());
                }
                let mut settings = profile.settings.clone();
                match field {
                    "git_branch" => settings.git_branch = value,
                    "git_username" => settings.git_username = value,
                    "git_password" => settings.git_password = value,
                    "git_commit_message" => settings.git_commit_message = value,
                    _ => {
                        settings.transcription_mode = Some(match value.as_str() {
                            "off" => type_core::ports::profiles::TranscriptionMode::Off,
                            "desktop" => type_core::ports::profiles::TranscriptionMode::Desktop,
                            "assemblyai" => {
                                type_core::ports::profiles::TranscriptionMode::AssemblyAi
                            }
                            "native" => type_core::ports::profiles::TranscriptionMode::Native,
                            _ => return Err("Choose off, desktop, assemblyai or native.".into()),
                        });
                    }
                }
                self.profiles =
                    self.backend
                        .profiles()
                        .update_settings(UpdateProfileSettingsArgs {
                            profile_id: profile.id.clone(),
                            settings,
                        })?;
                return Ok(());
            }
            _ => return Err("Unknown setting.".into()),
        }
        self.profiles = self
            .backend
            .profiles()
            .update_app_config(UpdateAppConfigArgs { config })?;
        Ok(())
    }

    pub fn submit_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(modal) = &self.modal else {
            return;
        };
        let value = modal.input.read(cx).value().to_string();
        let kind = modal.kind.clone();
        let selection = modal.selected;
        if matches!(kind, ModalKind::Palette) {
            let choice = self
                .entries(&value, cx)
                .get(selection)
                .map(|e| e.choice.clone());
            if let Some(choice) = choice {
                self.close_modal(window, cx);
                self.execute(choice, window, cx);
            }
            return;
        }
        if self.busy {
            return;
        }
        let value = if matches!(
            &kind,
            ModalKind::Unlock
                | ModalKind::EnablePassword
                | ModalKind::EnablePanic(_)
                | ModalKind::Config(
                    "git_password"
                        | "assemblyai_api_key"
                        | "openai_api_key"
                        | "huggingface_api_key"
                )
        ) {
            value
        } else {
            value.trim().to_string()
        };
        let result: Result<(), String> = (|| {
            match kind {
                ModalKind::Rename(path) => {
                    self.flush(false, cx)?;
                    let name = if path.ends_with(".md") && !value.ends_with(".md") {
                        format!("{value}.md")
                    } else {
                        value.clone()
                    };
                    let new = self.backend.rename(&path, &name)?;
                    self.remap(&path, &new);
                }
                ModalKind::Delete(paths) => {
                    if value != "delete" {
                        return Err("Type delete to confirm permanent deletion.".into());
                    }
                    self.flush(false, cx)?;
                    self.backend.notes()?.delete_items(paths.clone())?;
                    for path in paths {
                        self.notes.retain(|p, _| {
                            p.as_str() != path && !p.starts_with(&format!("{path}/"))
                        });
                    }
                    self.previews.clear();
                    self.revision += 1;
                }
                ModalKind::CreateProfile => {
                    if value.is_empty() {
                        return Err("Enter a working-folder name.".into());
                    }
                    self.flush(false, cx)?;
                    self.ensure_profile_switch()?;
                    self.backend.profiles().create(CreateProfileArgs {
                        name: value,
                        description: None,
                    })?;
                    self.reload_profiles()?;
                }
                ModalKind::Remote => {
                    self.flush(false, cx)?;
                    let remote = value.clone();
                    self.close_modal(window, cx);
                    self.run_job("Connecting Git…", window, cx, move |b| {
                        let s = GitSyncUseCases::new(GitSyncAdapter::new(b.env.clone())).connect(
                            ConnectGitArgs {
                                remote_url: Some(remote),
                                branch: None,
                                username: None,
                                password: None,
                            },
                        )?;
                        Ok(jobs::ResultData::message(format!(
                            "Connected · {} ahead / {} behind",
                            s.ahead, s.behind
                        )))
                    });
                    return Ok(());
                }
                ModalKind::Config(field) => self.save_setting(field, value)?,
                ModalKind::Unlock => {
                    let result = self
                        .backend
                        .security()
                        .unlock(UnlockSecurityArgs { password: value })?;
                    if !result.unlocked && !result.reset_required {
                        return Err(result.message.unwrap_or("Could not unlock.".into()));
                    }
                    self.locked = false;
                    self.reload_profiles()?;
                }
                ModalKind::EnablePassword => {
                    if value.len() < 8 {
                        return Err("Use at least 8 characters.".into());
                    }
                    self.show_modal(ModalKind::EnablePanic(value), "", window, cx);
                    return Ok(());
                }
                ModalKind::EnablePanic(password) => {
                    self.flush(false, cx)?;
                    self.close_modal(window, cx);
                    self.run_job("Enabling encryption…", window, cx, move |b| {
                        b.security().enable(EnableSecurityArgs {
                            unlock_password: password,
                            panic_password: value,
                        })?;
                        Ok(jobs::ResultData::message("Encryption enabled"))
                    });
                    return Ok(());
                }
                _ => {}
            }
            self.error = None;
            self.close_modal(window, cx);
            self.refresh(window, cx);
            Ok(())
        })();
        if let Err(error) = result {
            self.error = Some(error);
            cx.notify();
        }
    }

    pub fn active_profile(&self) -> Option<&type_core::NotesProfileEntryWithSettings> {
        self.profiles
            .profiles
            .iter()
            .find(|p| p.id == self.profiles.active_profile_id)
    }

    pub fn ensure_profile_switch(&self) -> Result<(), String> {
        if self.recording || self.busy || self.pending_recording.is_some() {
            return Err("Finish the current operation before changing working folders.".into());
        }
        if self.local_server.as_ref().is_some_and(|s| s.running) {
            return Err("Stop the phone sync server before changing working folders.".into());
        }
        Ok(())
    }

    pub fn reload_profiles(&mut self) -> Result<(), String> {
        self.backend = Backend::new(self.backend.env.clone())?;
        self.profiles = self.backend.profiles().list()?;
        self.notes.clear();
        self.previews.clear();
        self.active = "".into();
        self.folder_tree = None;
        self.roots.clear();
        self.expanded_by_view.clear();
        self.saved_selection.clear();
        self.selected.clear();
        self.revision += 1;
        self.loading = true;
        Ok(())
    }

    pub fn lock(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.busy || self.recording || self.flush(false, cx).is_err() {
            return;
        }
        if self
            .backend
            .security()
            .state()
            .is_ok_and(|s| s.encryption_enabled)
        {
            match self.backend.security().lock() {
                Ok(_) => {
                    self.locked = true;
                    self.notes.clear();
                    self.previews.clear();
                    self.roots.clear();
                    self.folder_tree = None;
                    self.tree.update(cx, |s, cx| s.set_items(vec![], cx));
                    self.revision += 1;
                    self.show_modal(ModalKind::Unlock, "", window, cx);
                }
                Err(e) => self.error = Some(e),
            }
        } else {
            self.status = "Encryption is disabled".into();
        }
        cx.notify();
    }

    pub fn execute(&mut self, choice: Choice, window: &mut Window, cx: &mut Context<Self>) {
        if self.locked || self.busy {
            return;
        }
        let result: Result<(), String> = (|| {
            match choice {
                Choice::CommandPalette => self.show_modal(ModalKind::Palette, "", window, cx),
                Choice::New => self.new_note(window, cx),
                Choice::Feed => self.set_view(View::Feed, window, cx),
                Choice::Folders => self.set_view(View::Folders, window, cx),
                Choice::TrashView => self.set_view(View::Trash, window, cx),
                Choice::MoveNote(path) => {
                    self.open_note(path.clone().into(), true, window, cx);
                    self.select_row(&path.into(), cx);
                }
                Choice::MoveMode => self.show_modal(ModalKind::Palette, "mv ", window, cx),
                Choice::Move(_) | Choice::Trash => {
                    self.flush(false, cx)?;
                    let destination = if let Choice::Move(destination) = choice {
                        destination
                    } else {
                        ARCHIVE_FOLDER.into()
                    };
                    let paths = self.targets(cx);
                    self.backend.move_items(
                        paths.clone(),
                        &destination,
                        destination == ARCHIVE_FOLDER,
                    )?;
                    for path in paths {
                        let name = path.rsplit('/').next().unwrap();
                        let next = if destination.is_empty() {
                            name.into()
                        } else {
                            format!("{destination}/{name}")
                        };
                        self.remap(&path, &next);
                    }
                    self.refresh(window, cx);
                }
                Choice::Rename => {
                    if let Some(path) = self.targets(cx).first() {
                        self.show_modal(
                            ModalKind::Rename(path.clone()),
                            path.rsplit('/').next().unwrap(),
                            window,
                            cx,
                        );
                    }
                }
                Choice::Delete => {
                    let paths = self.targets(cx);
                    if !paths.is_empty() {
                        self.show_modal(ModalKind::Delete(paths), "", window, cx);
                    }
                }
                Choice::Reviewed | Choice::ArchiveFlag => {
                    self.flush(false, cx)?;
                    for path in self.targets(cx).into_iter().filter(|p| p.ends_with(".md")) {
                        let meta = self.backend.notes()?.get_note_meta(&path)?;
                        self.backend.notes()?.update_note_markers(
                            &path,
                            if matches!(choice, Choice::ArchiveFlag) {
                                Some(meta.archived_ms.is_none())
                            } else {
                                None
                            },
                            if matches!(choice, Choice::Reviewed) {
                                Some(meta.reviewed_ms.is_none())
                            } else {
                                None
                            },
                        )?;
                    }
                    self.previews.clear();
                    self.revision += 1;
                    self.refresh(window, cx);
                }
                Choice::Duplicate => {
                    let id = self.active.clone();
                    let folder = note_parent_folder_path(&id);
                    self.add_note(folder.into(), Some(id), window, cx);
                }
                Choice::Copy => {
                    if let Some(editor) =
                        self.notes.get(&self.active).and_then(|n| n.editor.as_ref())
                    {
                        cx.write_to_clipboard(ClipboardItem::new_string(
                            editor.read(cx).value().to_string(),
                        ));
                    }
                }
                Choice::Reload => {
                    let id = self.active.clone();
                    self.notes.remove(&id);
                    self.error = None;
                    if !id.starts_with("draft:") {
                        self.open_note(id, true, window, cx);
                    } else {
                        self.new_note(window, cx);
                    }
                }
                Choice::Split => {
                    self.flush(false, cx)?;
                    let id = self.active.clone();
                    let editor = self
                        .notes
                        .get(&id)
                        .and_then(|n| n.editor.clone())
                        .ok_or("Open a note first.")?;
                    let body = editor.read(cx).value().to_string();
                    let at = editor.read(cx).cursor();
                    if at == 0 || at >= body.len() {
                        return Err("Place the cursor between the two parts.".into());
                    }
                    let created = self.backend.notes()?.get_note_meta(&id)?.created_ms;
                    let path = self
                        .backend
                        .create(STREAM_FOLDER, body[at..].into(), created)?;
                    editor.update(cx, |s, cx| {
                        s.set_readonly(false, cx);
                        s.set_selected_range(at..body.len(), cx);
                        s.replace("", window, cx);
                        s.set_readonly(self.prefs.vim, cx);
                    });
                    if let Some(n) = self.notes.get_mut(&id) {
                        n.dirty = true;
                    }
                    self.flush(false, cx)?;
                    self.open_note(path.into(), true, window, cx);
                    self.refresh(window, cx);
                }
                Choice::Settings => {
                    self.flush(false, cx)?;
                    self.settings = true;
                    self.navigation_focus.focus(window, cx);
                    cx.notify();
                }
                Choice::BackToNotes => self.leave_settings(window, cx),
                Choice::Theme => {
                    self.prefs.dark = !self.prefs.dark;
                    Self::apply_theme(self.prefs.dark, window, cx);
                    self.persist_preferences();
                }
                Choice::Vim => self.toggle_vim(window, cx),
                Choice::Profile(profile_id) => {
                    self.flush(true, cx)?;
                    self.ensure_profile_switch()?;
                    self.backend
                        .profiles()
                        .set_active(SetActiveProfileArgs { profile_id })?;
                    self.reload_profiles()?;
                    self.refresh(window, cx);
                }
                Choice::NewProfile => self.show_modal(ModalKind::CreateProfile, "", window, cx),
                Choice::Root => self.pick_root(window, cx),
                Choice::Remote => self.show_modal(
                    ModalKind::Remote,
                    self.active_profile()
                        .map(|p| p.settings.git_remote_url.clone())
                        .as_deref()
                        .unwrap_or(""),
                    window,
                    cx,
                ),
                Choice::Lock => self.lock(window, cx),
                Choice::Enable => self.show_modal(ModalKind::EnablePassword, "", window, cx),
                Choice::Config(field) => {
                    let value = self.setting_value(field);
                    self.show_modal(ModalKind::Config(field), &value, window, cx);
                }
                choice => self.execute_job(choice, window, cx)?,
            }
            Ok(())
        })();
        if let Err(e) = result {
            self.error = Some(e);
        }
        cx.notify();
    }

    pub fn menu_for(
        view: WeakEntity<Self>,
        id: SharedString,
        folder: bool,
        menu: PopupMenu,
    ) -> PopupMenu {
        let mut menu = menu.label(if folder { "Folder" } else { "Note" });
        let actions = if folder {
            vec![
                ("New note here", Choice::New),
                ("Move…", Choice::MoveMode),
                ("Rename…", Choice::Rename),
                ("Move to Trash", Choice::Trash),
            ]
        } else {
            vec![
                ("Open", Choice::MoveNote(id.to_string())),
                ("Duplicate", Choice::Duplicate),
                ("Move…", Choice::MoveMode),
                ("Rename…", Choice::Rename),
                ("Toggle reviewed", Choice::Reviewed),
                ("Toggle archived", Choice::ArchiveFlag),
                ("Copy body", Choice::Copy),
                ("Move to Trash", Choice::Trash),
                ("Delete permanently…", Choice::Delete),
            ]
        };
        for (label, choice) in actions {
            let view = view.clone();
            let id = id.clone();
            menu = menu.item(PopupMenuItem::new(label).on_click(move |_, window, cx| {
                let _ = view.update(cx, |this, cx| {
                    if id.starts_with("feed:") {
                        if matches!(choice, Choice::New) {
                            this.new_note(window, cx);
                        }
                        return;
                    }
                    this.navigation_focused = true;
                    if !this.selected.contains(&id) {
                        this.selected.clear();
                        this.selected.insert(id.clone());
                    }
                    this.select_row(&id, cx);
                    if !folder {
                        this.open_note(id.clone(), false, window, cx);
                    }
                    if folder && matches!(choice, Choice::New) {
                        this.add_note(id.clone(), None, window, cx);
                    } else {
                        this.execute(choice.clone(), window, cx);
                    }
                });
            }));
        }
        menu
    }
}
