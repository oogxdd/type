//! Application state and key dispatch.
//!
//! Three areas divided by thin rules: navigation on the left (the Feed's
//! date-grouped tree, or the folder tree — `Tab` flips between them), that
//! selection's notes in the middle, the editor on the right. `Ctrl+W` moves
//! focus between them, `:` opens the command line from anywhere.
//!
//! The editor follows the note list: moving `j`/`k` previews each note's body
//! without opening it; `Enter` drops into the editor for real.
//!
//! Core calls are synchronous. For filesystem work that is invisible; for git
//! it means `:sync` blocks the UI until it returns. That is a deliberate v1
//! trade — a background worker would need a channel and a redraw signal, and
//! the status line already tells the user what is happening.

use std::collections::HashSet;

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use type_core::{CreateNoteArgs, FolderNode, GitPushArgs, GitSyncArgs, NoteFileNameFormat};

use crate::{
    command::{self, Command},
    core::Core,
    editor::Editor,
    model::{self, FeedBucket, FeedRow, FolderRow, NoteRow},
    vim::{Mode, Vim, VimAction},
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Pane {
    Folders,
    Notes,
    Editor,
}

/// What the left panel shows: the folder tree, or the Feed's synthetic
/// time buckets. `Tab` in the left panel flips between them.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NavMode {
    Folders,
    Feed,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PromptKind {
    /// `:` — a command line.
    Command,
    /// `/` — an in-buffer search.
    Search,
}

/// The active prompt overlay, if any.
pub struct Prompt {
    pub kind: PromptKind,
    pub input: String,
    /// Folder completions for `:mv`, cycled with Tab.
    pub completions: Vec<String>,
    pub completion_index: usize,
}

pub struct App {
    pub core: Core,
    /// Whole tree as the core last returned it.
    pub tree: FolderNode,
    /// Paths of expanded folders — the only tree state the core does not own.
    pub expanded: HashSet<String>,
    pub folder_rows: Vec<FolderRow>,
    /// Cursor into whichever set of rows the left panel is showing. Shared by
    /// both nav modes since only one is on screen at a time.
    pub folder_cursor: usize,
    /// Folder whose notes are listed in the middle pane (folders mode).
    pub open_folder: Option<String>,
    /// Feed state. Built from a bulk preview of every note in the Feed folder.
    pub nav_mode: NavMode,
    pub feed_buckets: Vec<FeedBucket>,
    pub feed_rows: Vec<FeedRow>,
    /// Expanded feed bucket ids (`feed:today`, `feed:month:2026:8`, …).
    pub feed_expanded: HashSet<String>,
    /// Bucket whose notes are listed in the middle pane (feed mode).
    pub active_feed_id: Option<String>,
    pub notes: Vec<NoteRow>,
    pub note_cursor: usize,
    pub editor: Editor,
    pub vim: Vim,
    pub focus: Pane,
    pub prompt: Option<Prompt>,
    /// Status-bar message; also where errors surface.
    pub status: String,
    pub root_label: String,
    pub should_quit: bool,
    /// True after `Ctrl+W`, waiting for a direction key.
    pub pending_window: bool,
}

impl App {
    pub fn new(core: Core) -> Result<Self, String> {
        let tree = core.notes()?.get_tree()?;
        let root_label = core
            .root_path()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| "?".to_string());

        let mut app = Self {
            core,
            tree,
            expanded: HashSet::new(),
            folder_rows: Vec::new(),
            folder_cursor: 0,
            open_folder: None,
            nav_mode: NavMode::Feed,
            feed_buckets: Vec::new(),
            feed_rows: Vec::new(),
            feed_expanded: HashSet::new(),
            active_feed_id: None,
            notes: Vec::new(),
            note_cursor: 0,
            editor: Editor::new(),
            vim: Vim::new(),
            focus: Pane::Folders,
            prompt: None,
            status: "Tab feed/folders · j/k move · Enter open · Ctrl+W panes · : for commands".to_string(),
            root_label,
            should_quit: false,
            pending_window: false,
        };
        // Feed is the default view: it is where new notes land and where the
        // date-grouped browse the desktop offers lives.
        app.reload_feed();
        app.rebuild_left_rows();
        app.select_first_feed();
        // Fall back to the folder tree if the Feed folder is empty or absent,
        // so a fresh notes root still shows something to navigate.
        if app.feed_rows.is_empty() {
            app.nav_mode = NavMode::Folders;
            app.rebuild_left_rows();
            if let Some(index) = app.folder_rows.iter().position(|row| row.path == "Feed") {
                app.folder_cursor = index;
                app.select_left();
            }
        }
        Ok(app)
    }

    // ── Data loading ───────────────────────────────────────────────────────

    pub fn refresh_tree(&mut self) {
        match self.core.notes().and_then(|notes| notes.get_tree()) {
            Ok(tree) => {
                self.tree = tree;
                self.rebuild_left_rows();
            }
            Err(err) => self.status = format!("tree: {err}"),
        }
    }

    /// Rebuild the middle pane and (in feed mode) the feed tree, after a
    /// structural change. Call this wherever the old code paired
    /// `refresh_tree` + `reload_notes`.
    fn refresh_current(&mut self) {
        self.refresh_tree();
        match self.nav_mode {
            NavMode::Folders => self.reload_notes(),
            NavMode::Feed => {
                self.reload_feed();
                self.reload_feed_selection();
            }
        }
    }

    fn left_len(&self) -> usize {
        match self.nav_mode {
            NavMode::Folders => self.folder_rows.len(),
            NavMode::Feed => self.feed_rows.len(),
        }
    }

    fn clamp_left_cursor(&mut self) {
        let len = self.left_len();
        if self.folder_cursor >= len {
            self.folder_cursor = len.saturating_sub(1);
        }
    }

    /// Rebuild the rows the left panel is currently drawing.
    fn rebuild_left_rows(&mut self) {
        match self.nav_mode {
            NavMode::Folders => {
                self.folder_rows = model::flatten_folders(&self.tree, &self.expanded);
                self.clamp_left_cursor();
            }
            NavMode::Feed => {
                self.feed_rows = model::flatten_feed(&self.feed_buckets, &self.feed_expanded);
                self.clamp_left_cursor();
            }
        }
    }

    fn rebuild_folder_rows(&mut self) {
        self.folder_rows = model::flatten_folders(&self.tree, &self.expanded);
        if self.folder_cursor >= self.folder_rows.len() {
            self.folder_cursor = self.folder_rows.len().saturating_sub(1);
        }
    }

    /// Load the note list for `open_folder`.
    ///
    /// The tree gives us names and paths only — `get_tree` never reads note
    /// bodies. Titles and the audio badge come from one bulk preview call,
    /// which is the same trade the desktop makes.
    pub fn reload_notes(&mut self) {
        let Some(folder) = self.open_folder.clone() else {
            self.notes.clear();
            return;
        };
        let paths: Vec<String> = match model::find_folder(&self.tree, &folder) {
            Some(node) => node.notes.iter().map(|note| note.path.clone()).collect(),
            None => Vec::new(),
        };
        match self
            .core
            .notes()
            .and_then(|notes| notes.list_note_previews(paths))
        {
            Ok(previews) => {
                self.notes = model::note_rows(previews);
                if self.note_cursor >= self.notes.len() {
                    self.note_cursor = self.notes.len().saturating_sub(1);
                }
            }
            Err(err) => self.status = format!("previews: {err}"),
        }
    }

    // ── Feed mode ──────────────────────────────────────────────────────────

    /// Rebuild the feed tree from a fresh bulk preview of the Feed folder.
    ///
    /// The feed groups notes by time bucket, so every preview has to be read
    /// to learn its timestamp. We reuse `list_note_previews` — the same call
    /// `reload_notes` makes for a flat folder — and hand the rows to the model
    /// builder.
    pub fn reload_feed(&mut self) {
        let paths: Vec<String> = model::find_folder(&self.tree, "Feed")
            .map(|node| node.notes.iter().map(|n| n.path.clone()).collect())
            .unwrap_or_default();
        let rows = match self
            .core
            .notes()
            .and_then(|notes| notes.list_note_previews(paths))
        {
            Ok(previews) => model::note_rows(previews),
            Err(err) => {
                self.status = format!("feed: {err}");
                Vec::new()
            }
        };
        self.feed_buckets = model::build_feed_tree(rows);
        self.rebuild_left_rows();
    }

    /// Re-read the middle-pane notes for the active feed bucket, if any.
    fn reload_feed_selection(&mut self) {
        let Some(id) = self.active_feed_id.clone() else {
            return;
        };
        let Some(bucket) = model::find_bucket(&self.feed_buckets, &id) else {
            return;
        };
        self.notes = model::collect_bucket_notes(bucket);
        if self.note_cursor >= self.notes.len() {
            self.note_cursor = self.notes.len().saturating_sub(1);
        }
    }

    /// On launch, open the first feed bucket so the middle pane is never empty.
    fn select_first_feed(&mut self) {
        let Some(first) = self.feed_rows.first() else {
            return;
        };
        self.active_feed_id = Some(first.id.clone());
        self.open_folder = Some("Feed".to_string());
        self.reload_feed_selection();
    }

    /// j/k in the left panel, generic over nav mode.
    fn select_left(&mut self) {
        match self.nav_mode {
            NavMode::Folders => self.select_folder_at_cursor(),
            NavMode::Feed => self.select_feed_at_cursor(),
        }
    }

    fn select_folder_at_cursor(&mut self) {
        let Some(row) = self.folder_rows.get(self.folder_cursor) else {
            return;
        };
        self.open_folder = Some(row.path.clone());
        self.note_cursor = 0;
        self.reload_notes();
    }

    fn select_feed_at_cursor(&mut self) {
        let Some(row) = self.feed_rows.get(self.folder_cursor) else {
            return;
        };
        self.active_feed_id = Some(row.id.clone());
        self.open_folder = Some("Feed".to_string());
        self.note_cursor = 0;
        self.reload_feed_selection();
    }

    fn toggle_feed_expanded(&mut self, expand: bool) {
        let Some(row) = self.feed_rows.get(self.folder_cursor) else {
            return;
        };
        let id = row.id.clone();
        if expand {
            self.feed_expanded.insert(id);
        } else {
            self.feed_expanded.remove(&id);
        }
        self.rebuild_left_rows();
    }

    /// Switch the left panel between the folder tree and the feed tree.
    pub fn set_nav_mode(&mut self, mode: NavMode) {
        if self.nav_mode == mode {
            return;
        }
        self.nav_mode = mode;
        self.folder_cursor = 0;
        match mode {
            NavMode::Folders => {
                self.rebuild_folder_rows();
                self.select_folder_at_cursor();
            }
            NavMode::Feed => {
                self.reload_feed();
                self.select_first_feed();
            }
        }
    }

    /// Flush the open note, then load the note under the list cursor.
    fn open_selected_note(&mut self) {
        self.flush_editor();
        let Some(row) = self.notes.get(self.note_cursor) else {
            return;
        };
        let path = row.path.clone();
        match self.core.notes().and_then(|notes| notes.read_note(&path)) {
            Ok(body) => {
                self.editor.open(path, body);
                self.focus = Pane::Editor;
                self.vim = Vim::new();
            }
            Err(err) => self.status = format!("open: {err}"),
        }
    }

    /// Show the note under the list cursor without claiming focus for editing.
    ///
    /// This is the "auto-preview": moving j/k in the list instantly shows the
    /// note's body in the editor. It reuses [`Editor::open`] because an
    /// unedited buffer is never dirty, so a later flush is a no-op — moving on
    /// from a preview never writes. Press `Enter` to actually drop into the
    /// editor.
    fn preview_selected_note(&mut self) {
        self.flush_editor();
        let Some(row) = self.notes.get(self.note_cursor).cloned() else {
            return;
        };
        let path = row.path;
        // If the editor already shows this note (e.g. it was opened for
        // editing and focus moved back to the list), don't thrash the buffer.
        if self.editor.path.as_deref() == Some(path.as_str()) {
            return;
        }
        match self.core.notes().and_then(|notes| notes.read_note(&path)) {
            Ok(body) => self.editor.preview(path, body),
            Err(err) => self.status = format!("preview: {err}"),
        }
    }

    /// Write pending edits and apply the empty-note / auto-rename policies.
    ///
    /// Called before every navigation and on quit, so an unsaved buffer can
    /// never outlive the thing that owns it.
    pub fn flush_editor(&mut self) {
        let Ok(notes) = self.core.notes() else {
            return;
        };
        match self.editor.flush(&notes) {
            Ok(outcome) => {
                if outcome.deleted {
                    self.status = "note was empty — deleted".to_string();
                    self.refresh_current();
                } else if let Some(path) = outcome.renamed_to {
                    self.status = format!("renamed → {}", model::file_stem(&path));
                    self.refresh_current();
                }
            }
            Err(err) => self.status = format!("save: {err}"),
        }
    }

    /// Called once per event-loop tick: writes the buffer when it has been
    /// idle for the debounce interval.
    pub fn tick(&mut self) {
        if self.editor.debounce_elapsed() {
            self.flush_editor();
        }
    }

    // ── Key dispatch ───────────────────────────────────────────────────────

    pub fn on_key(&mut self, key: KeyEvent) {
        // A prompt swallows everything while it is open.
        if self.prompt.is_some() {
            self.prompt_key(key);
            return;
        }

        // `Ctrl+W` then a direction — vim's window commands.
        if self.pending_window {
            self.pending_window = false;
            self.focus = match key.code {
                KeyCode::Char('h') | KeyCode::Left => self.pane_left(),
                KeyCode::Char('l') | KeyCode::Right => self.pane_right(),
                // A second Ctrl+W cycles, matching vim's `<C-w><C-w>`.
                KeyCode::Char('w') => self.pane_right(),
                _ => self.focus,
            };
            return;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('w') {
            self.pending_window = true;
            return;
        }

        match self.focus {
            Pane::Folders => self.folders_key(key),
            Pane::Notes => self.notes_key(key),
            Pane::Editor => self.editor_key(key),
        }
    }

    fn pane_left(&self) -> Pane {
        match self.focus {
            Pane::Folders => Pane::Folders,
            Pane::Notes => Pane::Folders,
            Pane::Editor => Pane::Notes,
        }
    }

    fn pane_right(&self) -> Pane {
        match self.focus {
            Pane::Folders => Pane::Notes,
            Pane::Notes => Pane::Editor,
            Pane::Editor => Pane::Folders,
        }
    }

    fn folders_key(&mut self, key: KeyEvent) {
        match key.code {
            // `Tab` flips the left panel between the feed and the folder tree.
            KeyCode::Tab => {
                self.set_nav_mode(match self.nav_mode {
                    NavMode::Folders => NavMode::Feed,
                    NavMode::Feed => NavMode::Folders,
                });
                self.preview_selected_note();
            }
            KeyCode::Char('j') | KeyCode::Down => {
                self.folder_cursor = (self.folder_cursor + 1).min(self.left_len().saturating_sub(1));
                self.select_left();
                self.preview_selected_note();
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.folder_cursor = self.folder_cursor.saturating_sub(1);
                self.select_left();
                self.preview_selected_note();
            }
            KeyCode::Char('g') => {
                self.folder_cursor = 0;
                self.select_left();
                self.preview_selected_note();
            }
            KeyCode::Char('G') => {
                self.folder_cursor = self.left_len().saturating_sub(1);
                self.select_left();
                self.preview_selected_note();
            }
            // Expand / collapse. `l` and `h` double as "descend"/"ascend" so
            // hjkl navigates the tree the way it navigates text.
            KeyCode::Char('l') | KeyCode::Right | KeyCode::Char(' ') => self.toggle_left_expand(true),
            KeyCode::Char('h') | KeyCode::Left => self.toggle_left_expand(false),
            KeyCode::Enter => {
                self.select_left();
                self.focus = Pane::Notes;
                self.preview_selected_note();
            }
            KeyCode::Char(':') => self.open_prompt(PromptKind::Command),
            _ => {}
        }
    }

    fn toggle_left_expand(&mut self, expand: bool) {
        match self.nav_mode {
            NavMode::Folders => {
                let Some(row) = self.folder_rows.get(self.folder_cursor) else {
                    return;
                };
                let path = row.path.clone();
                if expand {
                    self.expanded.insert(path);
                } else {
                    self.expanded.remove(&path);
                }
                self.rebuild_left_rows();
            }
            NavMode::Feed => self.toggle_feed_expanded(expand),
        }
    }

    fn notes_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('j') | KeyCode::Down => {
                self.note_cursor = (self.note_cursor + 1).min(self.notes.len().saturating_sub(1));
                self.preview_selected_note();
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.note_cursor = self.note_cursor.saturating_sub(1);
                self.preview_selected_note();
            }
            KeyCode::Char('g') => {
                self.note_cursor = 0;
                self.preview_selected_note();
            }
            KeyCode::Char('G') => {
                self.note_cursor = self.notes.len().saturating_sub(1);
                self.preview_selected_note();
            }
            KeyCode::Enter | KeyCode::Char('l') | KeyCode::Right => self.open_selected_note(),
            KeyCode::Char('h') | KeyCode::Left => self.focus = Pane::Folders,
            KeyCode::Char('o') => self.create_note(None),
            KeyCode::Char(':') => self.open_prompt(PromptKind::Command),
            _ => {}
        }
    }

    fn editor_key(&mut self, key: KeyEvent) {
        let action = self.vim.handle(&mut self.editor.area, key);
        match action {
            VimAction::Edited => self.editor.touch(),
            VimAction::EnterCommand => self.open_prompt(PromptKind::Command),
            VimAction::EnterSearch => self.open_prompt(PromptKind::Search),
            VimAction::SearchNext(forward) => {
                let found = if forward {
                    self.editor.area.search_forward(false)
                } else {
                    self.editor.area.search_back(false)
                };
                if !found {
                    self.status = "pattern not found".to_string();
                }
            }
            // In normal mode an unbound key is free to mean "leave the pane".
            VimAction::Ignored => {
                if self.vim.mode == Mode::Normal && key.code == KeyCode::Esc {
                    self.focus = Pane::Notes;
                }
            }
            VimAction::Moved => {}
        }
    }

    // ── Prompt ─────────────────────────────────────────────────────────────

    fn open_prompt(&mut self, kind: PromptKind) {
        self.prompt = Some(Prompt {
            kind,
            input: String::new(),
            completions: Vec::new(),
            completion_index: 0,
        });
    }

    fn prompt_key(&mut self, key: KeyEvent) {
        let Some(prompt) = self.prompt.as_mut() else {
            return;
        };
        match key.code {
            KeyCode::Esc => self.prompt = None,
            KeyCode::Backspace => {
                prompt.input.pop();
                prompt.completions.clear();
            }
            KeyCode::Char(ch) => {
                prompt.input.push(ch);
                prompt.completions.clear();
            }
            KeyCode::Tab => self.complete_prompt(),
            KeyCode::Enter => {
                let Some(prompt) = self.prompt.take() else {
                    return;
                };
                match prompt.kind {
                    PromptKind::Command => self.run_command(&prompt.input),
                    PromptKind::Search => self.run_search(&prompt.input),
                }
            }
            _ => {}
        }
    }

    /// Tab completion for `:mv`. Cycles through ranked folders, replacing the
    /// argument in place so repeated Tabs walk the list.
    fn complete_prompt(&mut self) {
        let Some(prompt) = self.prompt.as_mut() else {
            return;
        };
        if prompt.kind != PromptKind::Command {
            return;
        }
        let Some(argument) = prompt
            .input
            .strip_prefix("mv ")
            .or_else(|| prompt.input.strip_prefix("move "))
        else {
            return;
        };

        if prompt.completions.is_empty() {
            let mut folders = Vec::new();
            model::collect_folder_paths(&self.tree, &mut folders);
            prompt.completions = command::complete_folders(argument, &folders);
            prompt.completion_index = 0;
        } else {
            prompt.completion_index = (prompt.completion_index + 1) % prompt.completions.len();
        }

        if let Some(folder) = prompt.completions.get(prompt.completion_index) {
            prompt.input = format!("mv {folder}");
        }
    }

    fn run_search(&mut self, pattern: &str) {
        match self.editor.area.set_search_pattern(pattern) {
            Ok(()) => {
                if !self.editor.area.search_forward(false) {
                    self.status = format!("pattern not found: {pattern}");
                }
            }
            Err(err) => self.status = format!("bad pattern: {err}"),
        }
    }

    // ── Commands ───────────────────────────────────────────────────────────

    fn run_command(&mut self, input: &str) {
        match command::parse(input) {
            Command::Empty => {}
            Command::Write => {
                self.flush_editor();
                self.status = "written".to_string();
            }
            Command::Quit => {
                self.flush_editor();
                self.should_quit = true;
            }
            Command::QuitNoSave => self.should_quit = true,
            Command::WriteQuit => {
                self.flush_editor();
                self.should_quit = true;
            }
            Command::Move(destination) => self.move_note(&destination),
            Command::New(folder) => self.create_note(folder),
            Command::Delete => self.delete_note(),
            Command::Connect(url) => self.git_connect(&url),
            Command::Sync => self.git_sync(),
            Command::Pull => self.git_pull(),
            Command::Push => self.git_push(),
            Command::Status => self.git_status(),
            Command::SshKey => self.ssh_key(),
            Command::Feed => {
                self.set_nav_mode(NavMode::Feed);
                self.preview_selected_note();
            }
            Command::Folders => {
                self.set_nav_mode(NavMode::Folders);
                self.preview_selected_note();
            }
            Command::Help => {
                self.status =
                    "Tab feed/folders · j/k move · Enter open · Ctrl+W pane · i insert · :mv <folder> · :new · :d · :feed · :folders · :connect · :sync · :q"
                        .to_string();
            }
            Command::Unknown(name) => self.status = format!("unknown command: {name}"),
        }
    }

    /// The note a command acts on: the open one, else the list selection.
    fn target_note(&self) -> Option<String> {
        self.editor
            .path
            .clone()
            .or_else(|| self.notes.get(self.note_cursor).map(|row| row.path.clone()))
    }

    fn move_note(&mut self, destination: &str) {
        if destination.is_empty() {
            self.status = "usage: :mv <folder>".to_string();
            return;
        }
        // Flush first: moving a file out from under an unsaved buffer would
        // write the note back to its old path on the next debounce tick.
        self.flush_editor();
        let Some(path) = self.target_note() else {
            self.status = "no note selected".to_string();
            return;
        };
        match self
            .core
            .notes()
            .and_then(|notes| notes.move_items(vec![path.clone()], destination.to_string()))
        {
            Ok(()) => {
                // The buffer now points at a path that no longer exists, so
                // close it rather than let a later flush recreate the file.
                if self.editor.path.as_deref() == Some(path.as_str()) {
                    self.editor.close();
                }
                self.status = format!("moved → {destination}");
                self.refresh_current();
            }
            Err(err) => self.status = format!("move: {err}"),
        }
    }

    fn create_note(&mut self, folder: Option<String>) {
        self.flush_editor();
        let folder_path = folder.or_else(|| self.open_folder.clone());
        let args = CreateNoteArgs {
            folder_path,
            content: None,
            timestamp_ms: None,
            file_name_format: NoteFileNameFormat::default(),
        };
        match self.core.notes().and_then(|notes| notes.create_note(args)) {
            Ok(result) => {
                self.refresh_current();
                // Jump straight into insert mode: a new note exists to be typed
                // into, and this is the app's signature interaction elsewhere.
                // `open_created` marks it for cleanup if it is never typed into.
                self.editor.open_created(result.path.clone());
                self.focus = Pane::Editor;
                self.vim = Vim::new();
                self.vim.mode = Mode::Insert;
                self.status = format!("new note in {}", model::file_stem(&result.path));
            }
            Err(err) => self.status = format!("create: {err}"),
        }
    }

    fn delete_note(&mut self) {
        let Some(path) = self.target_note() else {
            self.status = "no note selected".to_string();
            return;
        };
        match self
            .core
            .notes()
            .and_then(|notes| notes.delete_items(vec![path.clone()]))
        {
            Ok(()) => {
                if self.editor.path.as_deref() == Some(path.as_str()) {
                    self.editor.close();
                    self.focus = Pane::Notes;
                }
                self.status = "deleted".to_string();
                self.refresh_current();
            }
            Err(err) => self.status = format!("delete: {err}"),
        }
    }

    // ── Git sync ───────────────────────────────────────────────────────────

    fn git_status(&mut self) {
        match self.core.git().status() {
            Ok(status) => {
                self.status = if status.repo_initialized {
                    format!(
                        "{} · {} · ahead {} behind {}{}",
                        status.current_branch.unwrap_or_else(|| "?".into()),
                        status.remote_url.unwrap_or_else(|| "no remote".into()),
                        status.ahead,
                        status.behind,
                        if status.has_uncommitted_changes {
                            " · uncommitted"
                        } else {
                            ""
                        }
                    )
                } else {
                    "no git repo in this notes root".to_string()
                };
            }
            Err(err) => self.status = format!("git status: {err}"),
        }
    }

    /// `:connect <url> [branch]` — initialise the repo, set `origin`, fetch.
    ///
    /// The core handles first-sync bootstrapping: if this device already holds
    /// notes, they are committed so the first pull merges both sides instead of
    /// one overwriting the other.
    fn git_connect(&mut self, argument: &str) {
        let mut parts = argument.split_whitespace();
        let Some(url) = parts.next() else {
            self.status = "usage: :connect <url> [branch]".to_string();
            return;
        };
        self.flush_editor();
        let args = type_core::ConnectGitArgs {
            remote_url: Some(url.to_string()),
            branch: parts.next().map(str::to_string),
            username: None,
            password: None,
        };
        match self.core.git().connect(args) {
            Ok(status) => {
                self.status = format!(
                    "connected · {}",
                    status.current_branch.unwrap_or_else(|| "?".into())
                );
                self.refresh_current();
            }
            Err(err) => self.status = format!("connect: {err}"),
        }
    }

    fn git_pull(&mut self) {
        // Pull rewrites files under us, so the buffer has to be on disk first.
        self.flush_editor();
        let args = GitSyncArgs {
            branch: None,
            username: None,
            password: None,
        };
        match self.core.git().pull(args) {
            Ok(status) => {
                self.status = format!("pulled · behind {}", status.behind);
                self.refresh_current();
                self.reload_open_note();
            }
            Err(err) => self.status = format!("pull: {err}"),
        }
    }

    fn git_push(&mut self) {
        self.flush_editor();
        let args = GitPushArgs {
            message: None,
            branch: None,
            username: None,
            password: None,
        };
        match self.core.git().push(args) {
            Ok(status) => self.status = format!("pushed · ahead {}", status.ahead),
            Err(err) => self.status = format!("push: {err}"),
        }
    }

    fn git_sync(&mut self) {
        self.git_pull();
        if !self.status.starts_with("pull:") {
            self.git_push();
        }
    }

    /// Re-read the open note after a pull, which may have rewritten it.
    ///
    /// Only safe because `git_pull` flushes first: the buffer and the file
    /// agreed before the merge, so whatever is on disk now is the merged truth.
    fn reload_open_note(&mut self) {
        let Some(path) = self.editor.path.clone() else {
            return;
        };
        match self.core.notes().and_then(|notes| notes.read_note(&path)) {
            Ok(body) => self.editor.open(path, body),
            // The note may have been deleted on the other device.
            Err(_) => {
                self.editor.close();
                self.focus = Pane::Notes;
            }
        }
    }

    fn ssh_key(&mut self) {
        let git = self.core.git();
        let existing = git.ssh_public_key().unwrap_or(None);
        let key = match existing {
            Some(key) => Ok(key),
            None => git.generate_ssh_key(),
        };
        match key {
            Ok(key) => self.status = key.trim().to_string(),
            Err(err) => self.status = format!("ssh key: {err}"),
        }
    }
}

/// Rows currently visible in the note pane, exposed for rendering.
impl App {
    pub fn note_rows(&self) -> &[NoteRow] {
        &self.notes
    }
}
