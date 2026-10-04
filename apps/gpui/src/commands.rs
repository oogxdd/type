use super::*;
use type_core::{application::git_sync::GitSyncUseCases, *};

#[derive(Clone)]
pub enum ModalKind {
    Palette,
    Rename(String),
    CreateFolder(String),
    StreamDate,
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
    pub delete_focus: Option<[FocusHandle; 2]>,
}
#[derive(Clone)]
pub enum Choice {
    CommandPalette,
    New,
    NewFolder(String),
    Filter(Filter),
    StreamDate,
    ClearDate,
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
    PickProfile,
    RevealProfile,
    RemoveProfile,
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
            Self::New | Self::NewProfile | Self::NewFolder(_) => "Create",
            Self::Filter(_) | Self::StreamDate | Self::ClearDate => "View",
            Self::Feed | Self::Folders | Self::TrashView | Self::MoveNote(_) => "Navigate",
            Self::CommandPalette | Self::Settings | Self::BackToNotes | Self::Theme | Self::Vim => {
                "View"
            }
            Self::Profile(_) | Self::PickProfile | Self::RevealProfile | Self::RemoveProfile => {
                "Profiles"
            }
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
        self.navigation_focused = navigation;
        let palette = if matches!(kind, ModalKind::Palette) {
            let state = cx.new(|cx| CommandState::new(window, cx));
            state.update(cx, |state, cx| {
                state.set_query(value.to_owned(), window, cx)
            });
            Some(state)
        } else {
            None
        };
        let delete_focus =
            matches!(kind, ModalKind::Delete(_)).then(|| [cx.focus_handle(), cx.focus_handle()]);
        let handle = delete_focus
            .as_ref()
            .map(|handles| handles[0].clone())
            .unwrap_or_else(|| {
                palette
                    .as_ref()
                    .map(|s| s.focus_handle(cx))
                    .unwrap_or_else(|| input.focus_handle(cx))
            });
        self.modal = Some(Modal {
            kind,
            input: input.clone(),
            palette,
            selected: 0,
            navigation,
            delete_focus,
        });
        window.defer(cx, move |window, cx| handle.focus(window, cx));
        cx.notify();
    }

    pub fn close_modal(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let navigation = self.modal.take().map(|m| m.navigation).unwrap_or(false);
        self.modal_subscription = None;
        self.navigation_focused = navigation;
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

    /// Describes filesystem targets, never the editor's text selection.
    pub(crate) fn palette_target_label(&self, cx: &App) -> String {
        let paths = self.targets(cx);
        if paths.len() == 1 {
            let path = &paths[0];
            if self.folder_ids.contains(path.as_str()) {
                return format!("folder “{path}”");
            }
            let title = self
                .previews
                .get(path)
                .map(|note| navigation::title(&note.content))
                .unwrap_or_else(|| path.rsplit('/').next().unwrap_or(path).to_string());
            return format!("note “{title}”");
        }
        let folders = paths
            .iter()
            .filter(|path| self.folder_ids.contains(path.as_str()))
            .count();
        let notes = paths.len() - folders;
        match (folders, notes) {
            (0, 0) => "notes or folders".into(),
            (0, n) => format!("{n} notes"),
            (n, 0) => format!("{n} folders"),
            (f, n) => format!(
                "{f} {} and {n} {}",
                if f == 1 { "folder" } else { "folders" },
                if n == 1 { "note" } else { "notes" }
            ),
        }
    }

    pub fn entries(&self, query: &str, cx: &App) -> Vec<Entry> {
        if let Some(query) = query.strip_prefix("mv ") {
            let items = self
                .folder_tree
                .as_ref()
                .map(navigation::folder_destinations)
                .unwrap_or_default();
            let targets = self.targets(cx);
            let dirs: Vec<_> = items
                .iter()
                .cloned()
                .filter(|folder| {
                    !targets
                        .iter()
                        .any(|source| folder == source || folder.starts_with(&format!("{source}/")))
                })
                .collect();
            let mut entries: Vec<_> = navigation::move_suggestions(&dirs, query)
                .into_iter()
                .filter(|path| !query.is_empty() || !path.contains('/'))
                .map(|p| Entry {
                    label: format!("Move to {p}"),
                    choice: Choice::Move(p),
                })
                .collect();
            if !query.trim().is_empty()
                && !items
                    .iter()
                    .any(|d| d == query.trim().trim_end_matches('/'))
                && type_gpui::backend::validate_destination(query.trim_end_matches('/'), false)
                    .is_ok()
            {
                let path = query.trim_end_matches('/').trim().to_owned();
                entries.push(Entry {
                    label: format!("Create folder and move to {path}"),
                    choice: Choice::Move(path),
                });
            }
            let current = query.trim().trim_end_matches('/');
            if query.ends_with('/') && dirs.iter().any(|d| d == current) {
                entries.insert(
                    0,
                    Entry {
                        label: format!("Move here: {current}"),
                        choice: Choice::Move(current.into()),
                    },
                );
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
            ("New folder at root…", Choice::NewFolder(String::new())),
            ("Stream: review a day…", Choice::StreamDate),
            ("Stream: all dates", Choice::ClearDate),
            (
                "Stream: active (hide archived)",
                Choice::Filter(Filter::Active),
            ),
            (
                "Stream: unreviewed (hide reviewed and archived)",
                Choice::Filter(Filter::Unreviewed),
            ),
            ("Stream: all notes", Choice::Filter(Filter::All)),
            ("Stream: archived", Choice::Filter(Filter::Archived)),
            ("Stream: reviewed", Choice::Filter(Filter::Reviewed)),
            ("Open Stream", Choice::Feed),
            ("Open Folders", Choice::Folders),
            ("Open Trash", Choice::TrashView),
            ("Move selection to folder… (mv)", Choice::MoveMode),
            ("Rename selection…", Choice::Rename),
            ("Move selection to Trash", Choice::Trash),
            ("Delete selection permanently…", Choice::Delete),
            ("Mark / unmark reviewed · next note", Choice::Reviewed),
            ("Archive / unarchive note · next note", Choice::ArchiveFlag),
            ("Duplicate note", Choice::Duplicate),
            ("Split note at cursor", Choice::Split),
            ("Copy note body", Choice::Copy),
            ("Reload note from disk (discard draft)", Choice::Reload),
            ("Settings", Choice::Settings),
            ("Toggle light / dark theme", Choice::Theme),
            ("Toggle Vim", Choice::Vim),
            ("Add profile by path…", Choice::NewProfile),
            ("Add profile: choose folder…", Choice::PickProfile),
            ("Show profile in Finder", Choice::RevealProfile),
            ("Remove profile from Type", Choice::RemoveProfile),
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
        if self.navigation_focused && self.view == View::Folders {
            if let Some(folder) = self
                .tree
                .read(cx)
                .selected_item()
                .filter(|item| self.folder_ids.contains(&item.id))
            {
                // Put the contextual destination first when searching “new folder”.
                entries.insert(
                    1,
                    Entry {
                        label: format!("New folder inside “{}”…", folder.id),
                        choice: Choice::NewFolder(folder.id.to_string()),
                    },
                );
            }
        }
        let target = self.palette_target_label(cx);
        for entry in &mut entries {
            entry.label = match entry.choice {
                Choice::MoveMode => format!("Move {target} to folder… (mv)"),
                Choice::Rename => format!("Rename {target}…"),
                Choice::Trash => format!("Move {target} to Trash"),
                Choice::Delete => format!("Delete {target} permanently…"),
                _ => continue,
            };
        }
        for profile in &self.profiles.profiles {
            entries.push(Entry {
                label: format!("Profile: {}", profile.name),
                choice: Choice::Profile(profile.id.clone()),
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
            "Profiles",
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
                    if key == "tab" && query == "mv" {
                        palette.update(cx, |state, cx| state.set_query("mv ", window, cx));
                        window.prevent_default();
                        cx.stop_propagation();
                        cx.notify();
                    } else if query.starts_with("mv ") {
                        if let Some(index) = palette.read(cx).selected_index() {
                            if let Some(Entry {
                                choice: Choice::Move(path),
                                ..
                            }) = self
                                .palette_groups(&query, cx)
                                .get(index.section)
                                .and_then(|(_, entries)| entries.get(index.row))
                            {
                                let value = if path.is_empty() {
                                    "mv ".to_string()
                                } else {
                                    format!("mv {path}/")
                                };
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
            if let Some(handles) = &modal.delete_focus {
                match key.as_str() {
                    "tab" => {
                        let next = usize::from(handles[0].is_focused(window));
                        handles[next].focus(window, cx);
                    }
                    "escape" => self.close_modal(window, cx),
                    "enter" | "space" => {
                        if handles[1].is_focused(window) {
                            self.submit_modal(window, cx);
                        } else {
                            self.close_modal(window, cx);
                        }
                    }
                    _ => return,
                }
                window.prevent_default();
                cx.stop_propagation();
                cx.notify();
                return;
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
            type_core::shutdown_local_sync_server();
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
                    let anchor = self
                        .selection_anchor
                        .get_or_insert_with(|| id.clone().unwrap_or_default())
                        .clone();
                    let anchor_index = self.tree.read(cx).index_of(&anchor).unwrap_or(index);
                    self.selected.clear();
                    for ix in anchor_index.min(next)..=anchor_index.max(next) {
                        if let Some(row) = self.tree.read(cx).entry(ix) {
                            if !row.item().id.starts_with("feed:") {
                                self.selected.insert(row.item().id.clone());
                            }
                        }
                    }
                } else if self.selection_anchor.take().is_some() {
                    self.selected.clear();
                }
                self.tree.update(cx, |s, cx| {
                    s.set_selected_index(Some(next), cx);
                    s.scroll_to_item(next, ScrollStrategy::Nearest);
                });
            }
            "h" | "l" | "left" | "right" => {
                self.selection_anchor = None;
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
            "space" => {
                self.selection_anchor = None;
                if let Some(id) = id.filter(|id| !id.starts_with("feed:")) {
                    if !self.selected.remove(&id) {
                        self.selected.insert(id);
                    }
                }
            }
            "m" => self.execute(Choice::CommandPalette, window, cx),
            "n" if self.view != View::Trash => {
                let parent = if stroke.modifiers.shift || self.view != View::Folders {
                    String::new()
                } else {
                    id.map(|id| {
                        if self.folder_ids.contains(&id) {
                            id.to_string()
                        } else {
                            type_core::note_parent_folder_path(&id)
                        }
                    })
                    .unwrap_or_default()
                };
                self.execute(Choice::NewFolder(parent), window, cx);
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
                self.selection_anchor = None;
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
                let profile = self.active_profile().ok_or("No active profile.")?;
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
                ModalKind::CreateFolder(parent) => {
                    if value.is_empty() || value.contains(['/', '\\']) {
                        return Err("Enter a folder name without separators.".into());
                    }
                    let path = if parent.is_empty() {
                        value.clone()
                    } else {
                        format!("{parent}/{value}")
                    };
                    self.backend.create_folder(&path)?;
                    self.revision += 1;
                    self.folder_tree = Some(self.backend.notes()?.get_tree()?);
                    self.rebuild_navigation(cx);
                    if self.selected.is_empty() && self.view == View::Folders {
                        self.select_row(&path.into(), cx);
                    }
                }
                ModalKind::StreamDate => {
                    self.flush(true, cx)?;
                    self.prefs.stream_day = Some(
                        chrono::NaiveDate::parse_from_str(&value, "%Y-%m-%d")
                            .map_err(|_| "Enter a date as YYYY-MM-DD.".to_string())?,
                    );
                    self.persist_preferences();
                    self.set_view(View::Feed, window, cx);
                }
                ModalKind::Rename(path) => {
                    self.flush(false, cx)?;
                    let name = if path.ends_with(".md") && !value.ends_with(".md") {
                        format!("{value}.md")
                    } else {
                        value.clone()
                    };
                    let new = self.backend.rename(&path, &name)?;
                    self.remap(&path, &new);
                    // Preserve expansion while rebuilding from the renamed metadata.
                    fn remap_tree(items: &mut [TreeItem], old: &str, new: &str) {
                        for item in items {
                            if item.id == old {
                                item.id = new.to_owned().into();
                            } else if let Some(tail) = item.id.strip_prefix(&format!("{old}/")) {
                                item.id = format!("{new}/{tail}").into();
                            }
                            remap_tree(&mut item.children, old, new);
                        }
                    }
                    remap_tree(&mut self.roots, &path, &new);
                    self.folder_tree = Some(self.backend.notes()?.get_tree()?);
                    self.rebuild_navigation(cx);
                    self.select_row(&new.into(), cx);
                }
                ModalKind::Delete(paths) => {
                    self.delete_targets(paths, window, cx)?;
                }
                ModalKind::CreateProfile => {
                    self.open_profile_folder(&value, window, cx)?;
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
                    self.restore_phone_sync(window, cx);
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
            return Err("Finish the current operation before changing profiles.".into());
        }
        if self.local_server.as_ref().is_some_and(|s| s.running) {
            return Err("Stop the phone sync server before changing profiles.".into());
        }
        Ok(())
    }

    pub fn open_profile_folder(
        &mut self,
        path: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        self.ensure_profile_switch()?;
        self.flush(true, cx)?;
        self.backend.profiles().open_folder(path)?;
        self.reload_profiles()?;
        self.refresh(window, cx);
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
        self.selection_anchor = None;
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
                Choice::NewFolder(parent) => {
                    self.show_modal(ModalKind::CreateFolder(parent), "", window, cx)
                }
                Choice::StreamDate => self.show_modal(
                    ModalKind::StreamDate,
                    &self
                        .prefs
                        .stream_day
                        .unwrap_or_else(|| chrono::Local::now().date_naive())
                        .to_string(),
                    window,
                    cx,
                ),
                Choice::ClearDate => {
                    self.flush(true, cx)?;
                    self.prefs.stream_day = None;
                    self.persist_preferences();
                    self.set_view(View::Feed, window, cx);
                }
                Choice::Filter(filter) => {
                    self.flush(true, cx)?;
                    self.filter = filter;
                    self.prefs.stream_filter = filter;
                    self.persist_preferences();
                    self.set_view(View::Feed, window, cx);
                }
                Choice::Feed => self.set_view(View::Feed, window, cx),
                Choice::Folders => self.set_view(View::Folders, window, cx),
                Choice::TrashView => self.set_view(View::Trash, window, cx),
                Choice::MoveNote(path) => {
                    self.open_note(path.clone().into(), true, window, cx);
                    self.select_row(&path.into(), cx);
                }
                Choice::MoveMode => {
                    if self.targets(cx).is_empty() {
                        return Err("Select a note or folder first.".into());
                    }
                    self.show_modal(ModalKind::Palette, "mv ", window, cx);
                }
                Choice::Move(_) | Choice::Trash => {
                    self.flush(false, cx)?;
                    let destination = if let Choice::Move(destination) = choice {
                        destination
                    } else {
                        ARCHIVE_FOLDER.into()
                    };
                    let paths = self.targets(cx);
                    if paths.is_empty() {
                        return Err("Select a note or folder first.".into());
                    }
                    let next_note = self.next_review_note(&paths, cx);
                    self.backend.move_items(
                        paths.clone(),
                        &destination,
                        destination == ARCHIVE_FOLDER,
                    )?;
                    let mut cached_previews = std::mem::take(&mut self.previews);
                    for path in paths {
                        let name = path.rsplit('/').next().unwrap();
                        let next = if destination.is_empty() {
                            name.into()
                        } else {
                            format!("{destination}/{name}")
                        };
                        let prefix = format!("{path}/");
                        let old_keys: Vec<_> = cached_previews
                            .keys()
                            .filter(|p| **p == path || p.starts_with(&prefix))
                            .cloned()
                            .collect();
                        for key in old_keys {
                            if let Some(mut preview) = cached_previews.remove(&key) {
                                preview.path = format!("{next}{}", &key[path.len()..]);
                                cached_previews.insert(preview.path.clone(), preview);
                            }
                        }
                        self.remap(&path, &next);
                    }
                    self.previews = cached_previews;
                    self.folder_tree = Some(self.backend.notes()?.get_tree()?);
                    self.rebuild_navigation(cx);
                    self.advance_review(next_note, window, cx);
                    self.refresh(window, cx);
                }
                Choice::Rename => {
                    let paths = self.targets(cx);
                    if paths.len() > 1 {
                        return Err("Select one item to rename.".into());
                    }
                    if let Some(path) = paths.first() {
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
                        self.flush(false, cx)?;
                        let empty = paths
                            .iter()
                            .map(|path| self.backend.folder_is_empty(path))
                            .collect::<Result<Vec<_>, _>>()?;
                        if empty.iter().all(|empty| *empty) {
                            self.delete_targets(paths, window, cx)?;
                        } else {
                            self.show_modal(ModalKind::Delete(paths), "", window, cx);
                        }
                    }
                }
                Choice::Reviewed | Choice::ArchiveFlag => {
                    self.flush(false, cx)?;
                    let paths = self.targets(cx);
                    let next_note = self.next_review_note(&paths, cx);
                    for path in paths.iter().filter(|p| p.ends_with(".md")) {
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
                    for preview in self.backend.notes()?.list_note_previews(paths)? {
                        self.previews.insert(preview.path.clone(), preview);
                    }
                    self.revision += 1;
                    self.rebuild_navigation(cx);
                    self.advance_review(next_note, window, cx);
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
                Choice::PickProfile => self.pick_profile_folder(window, cx),
                Choice::RevealProfile => cx.reveal_path(&self.backend.root),
                Choice::RemoveProfile => {
                    self.flush(true, cx)?;
                    self.ensure_profile_switch()?;
                    self.backend.profiles().delete(DeleteProfileArgs {
                        profile_id: self.profiles.active_profile_id.clone(),
                    })?;
                    self.reload_profiles()?;
                    self.refresh(window, cx);
                }
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

    fn delete_targets(
        &mut self,
        paths: Vec<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        self.flush(false, cx)?;
        let next = self.next_review_note(&paths, cx);
        self.backend.notes()?.delete_items(paths.clone())?;
        let deleted = |path: &str| {
            paths
                .iter()
                .any(|parent| path == parent || path.starts_with(&format!("{parent}/")))
        };
        self.notes.retain(|path, _| !deleted(path));
        self.previews.retain(|path, _| !deleted(path));
        if deleted(&self.active) {
            self.active = "".into();
        }
        self.selected.clear();
        self.selection_anchor = None;
        self.revision += 1;
        self.folder_tree = Some(self.backend.notes()?.get_tree()?);
        self.rebuild_navigation(cx);
        self.advance_review(next, window, cx);
        Ok(())
    }

    fn next_review_note(&self, targets: &[String], cx: &App) -> Option<SharedString> {
        if self.view != View::Feed {
            return None;
        }
        let mut visible = vec![];
        let mut index = 0;
        while let Some(entry) = self.tree.read(cx).entry(index) {
            let id = &entry.item().id;
            if !self.folder_ids.contains(id) {
                visible.push(id.clone());
            }
            index += 1;
        }
        let at = visible
            .iter()
            .position(|id| targets.iter().any(|p| p == id.as_str()))?;
        visible
            .iter()
            .skip(at + 1)
            .chain(visible[..at].iter().rev())
            .find(|id| !targets.iter().any(|p| p == id.as_str()))
            .cloned()
    }

    fn advance_review(
        &mut self,
        next: Option<SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.view != View::Feed {
            return;
        }
        self.selected.clear();
        self.selection_anchor = None;
        if let Some(id) = next {
            self.select_row(&id, cx);
            self.open_note(id, true, window, cx);
        } else if !navigation::contains(&self.nav_items, &self.active) {
            self.active = "".into();
            self.tree.update(cx, |tree, cx| {
                tree.set_selected_index(None, cx);
                tree.focus(window, cx);
            });
        }
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
                ("New folder here…", Choice::NewFolder(id.to_string())),
                ("New folder at root…", Choice::NewFolder(String::new())),
                ("Move…", Choice::MoveMode),
                ("Rename…", Choice::Rename),
                ("Move to Trash", Choice::Trash),
                ("Delete permanently…", Choice::Delete),
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
                    this.tree.update(cx, |tree, cx| tree.focus(window, cx));
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
