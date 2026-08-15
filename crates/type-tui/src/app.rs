//! Application state and key dispatch.
//!
//! Three panes inside one frame: navigation on the left (the Feed's
//! date-grouped tree, or the folder tree — `Tab` flips between them), that
//! selection's notes in the middle, the editor on the right. `Ctrl+W` moves
//! focus between them, `Ctrl+T` hides the two left panes so the editor has the
//! whole frame, and `/` or Cmd/Ctrl+K opens the command palette from anywhere.
//!
//! The editor follows the note list: moving `j`/`k` previews each note's body
//! without opening it; `Enter` drops into the editor for real.
//!
//! The open root is either the active profile's notes root (the default) or any
//! folder the user pointed us at — `type-tui <path>` / `:open <path>`. A folder
//! with no `Feed` in it simply has no Feed view: the left pane is the folder
//! tree, and nothing scaffolds the missing folder into place.
//!
//! State is decomposed into [`NavState`] (the folder/feed tree + note list) and
//! [`EditorState`] (the buffer + vim mode machine). [`App`] wires them together
//! with the core, the prompt overlay, and top-level flags.
//!
//! Core calls are synchronous — for filesystem work that is invisible at this
//! scale. Git is the one slow operation, so those commands queue a [`GitTask`]
//! which `main.rs` runs on a background thread via tokio; the result comes
//! back through a channel as an [`AsyncOutcome`] and lands in
//! [`App::apply_async`]. See `ASYNC.md` for a walkthrough of that path.

use std::{collections::HashSet, path::Path};

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use type_core::{CreateNoteArgs, FolderNode, GitPushArgs, GitSyncArgs, NoteFileNameFormat};

use crate::{
    command::{self, Command, Marker, PaletteSuggestion, UiStyle},
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
    /// The discoverable command palette opened by `/` or Cmd/Ctrl+K.
    Palette,
}

/// The active prompt overlay, if any.
pub struct Prompt {
    pub kind: PromptKind,
    pub input: String,
    /// Folder completions for `:mv`, cycled with Tab.
    pub completions: Vec<String>,
    pub completion_index: usize,
    /// Filtered command rows for [`PromptKind::Palette`].
    pub suggestions: Vec<PaletteSuggestion>,
    pub suggestion_index: usize,
}

/// A git operation queued by a command, waiting for the event loop to spawn it
/// on a background thread. App does not know about tokio — it just sets
/// `pending_git` and lets `main.rs` drain it.
#[derive(Clone)]
pub enum GitTask {
    Pull,
    Push,
    /// Pull then push — the common `:sync` path.
    Sync,
    /// `:connect <url> [branch]` — arguments captured at request time.
    Connect(String),
}

/// The result of a background git operation. The event loop applies this to
/// the app: update the status line, optionally refresh the tree, optionally
/// reload the open note (after a pull that may have rewritten it).
pub struct AsyncOutcome {
    pub status: String,
    pub refresh: bool,
    pub reload_note: bool,
}

impl AsyncOutcome {
    fn done(msg: impl Into<String>) -> Self {
        Self { status: msg.into(), refresh: false, reload_note: false }
    }
    fn refreshed(msg: impl Into<String>) -> Self {
        Self { status: msg.into(), refresh: true, reload_note: false }
    }
    fn pulled(msg: impl Into<String>) -> Self {
        Self { status: msg.into(), refresh: true, reload_note: true }
    }
    fn error(msg: impl Into<String>) -> Self {
        Self { status: msg.into(), refresh: false, reload_note: false }
    }
}

// ── Sub-models ─────────────────────────────────────────────────────────────

/// All navigation state: the folder tree, the feed tree, the note list, and
/// every cursor / expansion flag that drives the left and middle panes.
///
/// Pure view-model methods that only rearrange this data live here. Anything
/// that needs the core (loading notes, moving files) stays on [`App`], which
/// holds a `NavState` as `self.nav`.
pub struct NavState {
    /// Whole tree as the core last returned it.
    pub tree: FolderNode,
    /// Display name of the open root, shown as the tree's first row.
    pub root_name: String,
    /// Paths of expanded folders — the only tree state the core does not own.
    /// Always contains [`model::ROOT_PATH`], so the tree opens expanded.
    pub expanded: HashSet<String>,
    pub folder_rows: Vec<FolderRow>,
    /// Cursor into whichever set of rows the left panel is showing. Shared by
    /// both nav modes since only one is on screen at a time.
    pub folder_cursor: usize,
    /// Folder whose notes are listed in the middle pane (folders mode).
    pub open_folder: Option<String>,
    /// The root-level feed folder, when this root has one. `None` disables the
    /// whole Feed view — no tab, no `:feed`, no time buckets — which is the
    /// normal state for a plain folder opened from the command line.
    pub feed_path: Option<String>,
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
}

impl NavState {
    pub fn new(tree: FolderNode, root_name: String) -> Self {
        Self {
            tree,
            root_name,
            expanded: HashSet::from([model::ROOT_PATH.to_string()]),
            folder_rows: Vec::new(),
            folder_cursor: 0,
            open_folder: None,
            feed_path: None,
            nav_mode: NavMode::Folders,
            feed_buckets: Vec::new(),
            feed_rows: Vec::new(),
            feed_expanded: HashSet::new(),
            active_feed_id: None,
            notes: Vec::new(),
            note_cursor: 0,
        }
    }

    /// Number of visible rows in the left panel for the active nav mode.
    pub fn left_len(&self) -> usize {
        match self.nav_mode {
            NavMode::Folders => self.folder_rows.len(),
            NavMode::Feed => self.feed_rows.len(),
        }
    }

    pub fn clamp_left_cursor(&mut self) {
        let len = self.left_len();
        if self.folder_cursor >= len {
            self.folder_cursor = len.saturating_sub(1);
        }
    }

    /// Rebuild the rows the left panel is currently drawing.
    pub fn rebuild_left_rows(&mut self) {
        match self.nav_mode {
            NavMode::Folders => self.rebuild_folder_rows(),
            NavMode::Feed => {
                self.feed_rows = model::flatten_feed(&self.feed_buckets, &self.feed_expanded);
                self.clamp_left_cursor();
            }
        }
    }

    pub fn rebuild_folder_rows(&mut self) {
        self.folder_rows = model::flatten_folders(&self.tree, &self.expanded, &self.root_name);
        if self.folder_cursor >= self.folder_rows.len() {
            self.folder_cursor = self.folder_rows.len().saturating_sub(1);
        }
    }

    /// Toggle a feed bucket's expansion state.
    pub fn toggle_feed_expanded(&mut self, expand: bool) {
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

    /// Whether the row under the cursor can be opened up, and whether it
    /// already is — the two facts arrow-key tree navigation runs on.
    fn cursor_row_shape(&self) -> Option<(bool, bool)> {
        match self.nav_mode {
            NavMode::Folders => self
                .folder_rows
                .get(self.folder_cursor)
                .map(|row| (row.has_children, row.expanded)),
            NavMode::Feed => self
                .feed_rows
                .get(self.folder_cursor)
                .map(|row| (row.has_children, row.expanded)),
        }
    }

    fn row_depth(&self, index: usize) -> Option<usize> {
        match self.nav_mode {
            NavMode::Folders => self.folder_rows.get(index).map(|row| row.depth),
            NavMode::Feed => self.feed_rows.get(index).map(|row| row.depth),
        }
    }

    /// Index of the row that owns `index`: the nearest row above it at a
    /// smaller depth. Works for both trees because the flattened rows are in
    /// depth-first order, so no parent pointers are needed.
    fn parent_index(&self, index: usize) -> Option<usize> {
        let depth = self.row_depth(index)?;
        if depth == 0 {
            return None;
        }
        (0..index)
            .rev()
            .find(|&i| self.row_depth(i).is_some_and(|other| other < depth))
    }

    /// The note a command acts on: the open one, else the list selection.
    pub fn target_note(&self, editor_path: Option<&str>) -> Option<String> {
        self.notes
            .get(self.note_cursor)
            .map(|row| row.path.clone())
            .or_else(|| editor_path.map(str::to_string))
    }
}

/// The editor buffer and its vim mode machine. These two are inseparable —
/// every keystroke in the editor passes through `Vim::handle` which mutates
/// the `TextArea` — so they live as one unit.
pub struct EditorState {
    pub editor: Editor,
    pub vim: Vim,
}

impl EditorState {
    pub fn new() -> Self {
        Self {
            editor: Editor::new(),
            vim: Vim::new(),
        }
    }

    /// Reset the vim machine to normal mode, as when opening a different note.
    pub fn reset_vim(&mut self) {
        self.vim = Vim::new();
    }
}

// ── App ────────────────────────────────────────────────────────────────────

/// The one-line key reminder, shown at startup and by `:h`. `{tab}` is where
/// the Feed/Folders hint goes in a root that has a Feed to switch to.
const HELP_LINE: &str =
    "j/k move · →/← open/close · Enter edit · {tab}Ctrl+W pane · Ctrl+T panels · / commands";

/// A modifier + letter chord, accepting any of `modifiers`.
///
/// `Cmd` only arrives in terminals that report the Super modifier (kitty
/// keyboard protocol: Kitty, WezTerm, Ghostty, …) — macOS Terminal.app and
/// iTerm keep `Cmd` for themselves and never forward it. That is why `Ctrl` is
/// the binding we document, with `Cmd` and `Alt` accepted where they arrive.
fn is_chord(key: &KeyEvent, ch: char, modifiers: KeyModifiers) -> bool {
    key.modifiers.intersects(modifiers)
        && matches!(key.code, KeyCode::Char(pressed) if pressed.eq_ignore_ascii_case(&ch))
}

/// `Ctrl+W` / `Cmd+W` — cycle panes.
const PANE_CHORD: KeyModifiers = KeyModifiers::CONTROL.union(KeyModifiers::SUPER);
/// `Ctrl+T` / `Cmd+T` / `Alt+T` — hide the left panes. `Alt` is here because a
/// terminal that forwards neither `Cmd` nor a free `Ctrl+T` usually forwards
/// `Alt` (macOS: Option-as-Meta).
const PANELS_CHORD: KeyModifiers = PANE_CHORD.union(KeyModifiers::ALT);
/// `Ctrl+K` / `Cmd+K` — open the discoverable command palette.
const PALETTE_CHORD: KeyModifiers = KeyModifiers::CONTROL.union(KeyModifiers::SUPER);

/// Placeholder tree used for the split second between constructing `App` and
/// loading the real root.
fn empty_tree() -> FolderNode {
    FolderNode {
        name: String::new(),
        path: String::new(),
        children: Vec::new(),
        notes: Vec::new(),
    }
}

/// Name for the tree's root row: the folder's own name, falling back to the
/// whole path for roots like `/` that have none.
fn root_display_name(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| root.display().to_string())
}

pub struct App {
    pub core: Core,
    pub nav: NavState,
    pub ed: EditorState,
    pub focus: Pane,
    pub prompt: Option<Prompt>,
    /// Status-bar message; also where errors surface.
    pub status: String,
    pub root_label: String,
    pub should_quit: bool,
    /// `Ctrl+T`: the two left panes are hidden and the editor has the frame.
    pub panels_hidden: bool,
    /// Runtime-selectable chrome experiment; the data panes do not care which
    /// visual container strategy draws them.
    pub ui_style: UiStyle,
    /// Where focus goes when the panes come back.
    focus_before_hide: Pane,
    /// A git operation queued by a command, drained by the event loop.
    pub pending_git: Option<GitTask>,
    /// How many background git operations are in flight. One at a time:
    /// overlapping pulls and pushes on the same repo race each other.
    pub git_in_flight: usize,
}

impl App {
    pub fn new(core: Core) -> Result<Self, String> {
        let mut app = Self {
            core,
            nav: NavState::new(empty_tree(), String::new()),
            ed: EditorState::new(),
            focus: Pane::Folders,
            prompt: None,
            status: String::new(),
            root_label: String::new(),
            should_quit: false,
            panels_hidden: false,
            ui_style: UiStyle::Frame,
            focus_before_hide: Pane::Folders,
            pending_git: None,
            git_in_flight: 0,
        };
        app.load_root()?;
        Ok(app)
    }

    // ── Roots ──────────────────────────────────────────────────────────────

    /// Read the open root from scratch: tree, labels, whether it has a Feed,
    /// and the initial selection. Shared by startup and `:open`.
    fn load_root(&mut self) -> Result<(), String> {
        let tree = self.core.notes()?.get_tree()?;
        let root = self.core.root_path()?;
        self.root_label = root.display().to_string();
        self.ed.editor.close();
        self.nav = NavState::new(tree, root_display_name(&root));
        self.nav.feed_path = model::find_feed_folder(&self.nav.tree);

        // Feed is the default view where there is one: it is where new notes
        // land, and the date-grouped browse is the reason it exists.
        if self.nav.feed_path.is_some() {
            self.nav.nav_mode = NavMode::Feed;
            self.reload_feed();
            self.select_first_feed();
        }
        // No feed folder, or one with nothing in it: navigate plain folders.
        if self.nav.feed_rows.is_empty() {
            self.nav.nav_mode = NavMode::Folders;
            self.nav.rebuild_left_rows();
            if let Some(feed) = self.nav.feed_path.clone() {
                if let Some(index) = self.nav.folder_rows.iter().position(|row| row.path == feed) {
                    self.nav.folder_cursor = index;
                }
            }
            self.select_left();
        }
        self.focus = Pane::Folders;
        self.preview_selected_note();
        self.status = self.help_line();
        Ok(())
    }

    /// The key reminder, minus the parts this root cannot do.
    fn help_line(&self) -> String {
        let tab = if self.nav.feed_path.is_some() {
            "Tab feed/folders · "
        } else {
            ""
        };
        HELP_LINE.replace("{tab}", tab)
    }

    /// `:open <path>` — browse any folder. Without an argument it goes back to
    /// the active profile's notes root.
    ///
    /// The previous `Core` is kept until the new root has loaded, so a typo
    /// leaves you where you were instead of in a half-opened folder.
    fn open_root(&mut self, path: Option<String>) {
        self.flush_editor();
        let previous = self.core.clone();
        let opened = match &path {
            Some(path) => self.core.open_folder(path),
            None => {
                self.core.close_folder();
                Ok(())
            }
        };
        let result = opened.and_then(|()| self.load_root());
        match result {
            Ok(()) => self.status = format!("opened {}", self.root_label),
            Err(err) => {
                self.core = previous;
                let _ = self.load_root();
                self.status = format!("open: {err}");
            }
        }
    }

    // ── Data loading ───────────────────────────────────────────────────────

    pub fn refresh_tree(&mut self) {
        match self.core.notes().and_then(|notes| notes.get_tree()) {
            Ok(tree) => {
                self.nav.tree = tree;
                // A Feed folder can appear or vanish under us — a pull, a
                // rename, a `:mv` into a new folder — so this is re-derived on
                // every refresh rather than cached at load time.
                self.nav.feed_path = model::find_feed_folder(&self.nav.tree);
                if self.nav.feed_path.is_none() && self.nav.nav_mode == NavMode::Feed {
                    self.nav.nav_mode = NavMode::Folders;
                    self.nav.folder_cursor = 0;
                }
                self.nav.rebuild_left_rows();
            }
            Err(err) => self.status = format!("tree: {err}"),
        }
    }

    /// Rebuild the middle pane and (in feed mode) the feed tree, after a
    /// structural change.
    fn refresh_current(&mut self) {
        self.refresh_tree();
        match self.nav.nav_mode {
            NavMode::Folders => self.reload_notes(),
            NavMode::Feed => {
                self.reload_feed();
                self.reload_feed_selection();
            }
        }
    }

    /// Load the note list for `open_folder`.
    ///
    /// The tree gives us names and paths only — `get_tree` never reads note
    /// bodies. Titles and the audio badge come from one bulk preview call,
    /// which is the same trade the desktop makes.
    pub fn reload_notes(&mut self) {
        let Some(folder) = self.nav.open_folder.clone() else {
            self.nav.notes.clear();
            return;
        };
        let paths: Vec<String> = match model::find_folder(&self.nav.tree, &folder) {
            Some(node) => node.notes.iter().map(|note| note.path.clone()).collect(),
            None => Vec::new(),
        };
        match self
            .core
            .notes()
            .and_then(|notes| notes.list_note_previews(paths))
        {
            Ok(previews) => {
                self.nav.notes = model::note_rows(previews);
                if self.nav.note_cursor >= self.nav.notes.len() {
                    self.nav.note_cursor = self.nav.notes.len().saturating_sub(1);
                }
            }
            Err(err) => self.status = format!("previews: {err}"),
        }
    }

    // ── Feed mode ──────────────────────────────────────────────────────────

    /// Rebuild the feed tree from a fresh bulk preview of the Feed folder.
    ///
    /// A root with no feed folder gets an empty tree rather than an error: the
    /// Feed view is simply not offered there.
    pub fn reload_feed(&mut self) {
        let Some(feed) = self.nav.feed_path.clone() else {
            self.nav.feed_buckets.clear();
            self.nav.rebuild_left_rows();
            return;
        };
        let paths: Vec<String> = model::find_folder(&self.nav.tree, &feed)
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
        self.nav.feed_buckets = model::build_feed_tree(rows);
        self.nav.rebuild_left_rows();
    }

    /// Re-read the middle-pane notes for the active feed bucket, if any.
    fn reload_feed_selection(&mut self) {
        let Some(id) = self.nav.active_feed_id.clone() else {
            return;
        };
        let Some(bucket) = model::find_bucket(&self.nav.feed_buckets, &id) else {
            return;
        };
        self.nav.notes = model::collect_bucket_notes(bucket);
        if self.nav.note_cursor >= self.nav.notes.len() {
            self.nav.note_cursor = self.nav.notes.len().saturating_sub(1);
        }
    }

    /// On launch, open the first feed bucket so the middle pane is never empty.
    fn select_first_feed(&mut self) {
        let Some(first) = self.nav.feed_rows.first() else {
            return;
        };
        self.nav.active_feed_id = Some(first.id.clone());
        self.nav.open_folder = self.nav.feed_path.clone();
        self.reload_feed_selection();
    }

    /// j/k in the left panel, generic over nav mode.
    fn select_left(&mut self) {
        match self.nav.nav_mode {
            NavMode::Folders => self.select_folder_at_cursor(),
            NavMode::Feed => self.select_feed_at_cursor(),
        }
    }

    fn select_folder_at_cursor(&mut self) {
        let Some(row) = self.nav.folder_rows.get(self.nav.folder_cursor) else {
            return;
        };
        self.nav.open_folder = Some(row.path.clone());
        self.nav.note_cursor = 0;
        self.reload_notes();
    }

    fn select_feed_at_cursor(&mut self) {
        let Some(row) = self.nav.feed_rows.get(self.nav.folder_cursor) else {
            return;
        };
        self.nav.active_feed_id = Some(row.id.clone());
        self.nav.open_folder = self.nav.feed_path.clone();
        self.nav.note_cursor = 0;
        self.reload_feed_selection();
    }

    /// Switch the left panel between the folder tree and the feed tree.
    pub fn set_nav_mode(&mut self, mode: NavMode) {
        if mode == NavMode::Feed && self.nav.feed_path.is_none() {
            self.status = "no Feed folder here — this root is folders only".to_string();
            return;
        }
        if self.nav.nav_mode == mode {
            return;
        }
        self.nav.nav_mode = mode;
        self.nav.folder_cursor = 0;
        match mode {
            NavMode::Folders => {
                self.nav.rebuild_folder_rows();
                self.select_folder_at_cursor();
            }
            NavMode::Feed => {
                self.reload_feed();
                self.select_first_feed();
            }
        }
    }

    // ── Editor ─────────────────────────────────────────────────────────────

    /// Flush the open note, then load the note under the list cursor.
    fn open_selected_note(&mut self) {
        self.flush_editor();
        let Some(row) = self.nav.notes.get(self.nav.note_cursor) else {
            return;
        };
        let path = row.path.clone();
        match self.core.notes().and_then(|notes| notes.read_note(&path)) {
            Ok(body) => {
                self.ed.editor.open(path, body);
                self.focus = Pane::Editor;
                self.ed.reset_vim();
            }
            Err(err) => self.status = format!("open: {err}"),
        }
    }

    /// Show the note under the list cursor without claiming focus for editing.
    fn preview_selected_note(&mut self) {
        self.flush_editor();
        let Some(row) = self.nav.notes.get(self.nav.note_cursor).cloned() else {
            return;
        };
        let path = row.path;
        if self.ed.editor.path.as_deref() == Some(path.as_str()) {
            return;
        }
        match self.core.notes().and_then(|notes| notes.read_note(&path)) {
            Ok(body) => self.ed.editor.preview(path, body),
            Err(err) => self.status = format!("preview: {err}"),
        }
    }

    /// Write pending edits and apply the empty-note / auto-rename policies.
    pub fn flush_editor(&mut self) {
        let Ok(notes) = self.core.notes() else {
            return;
        };
        match self.ed.editor.flush(&notes) {
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
        if self.ed.editor.debounce_elapsed() {
            self.flush_editor();
        }
    }

    // ── Key dispatch ───────────────────────────────────────────────────────

    pub fn on_key(&mut self, key: KeyEvent) {
        if self.prompt.is_some() {
            self.prompt_key(key);
            return;
        }

        // Global chords, checked before the focused pane sees the key so they
        // behave the same everywhere — including inside insert mode.
        if is_chord(&key, 'k', PALETTE_CHORD) {
            self.open_palette();
            return;
        }
        if is_chord(&key, 'w', PANE_CHORD) {
            self.cycle_focus();
            return;
        }
        if is_chord(&key, 't', PANELS_CHORD) {
            self.toggle_panels();
            return;
        }

        // Like Outl, bare `/` is the discoverable command surface in normal
        // navigation. Insert mode keeps it literal so URLs and paths remain
        // pleasant to type; Cmd/Ctrl+K still opens the palette from there.
        let slash_opens_palette = key.code == KeyCode::Char('/')
            && key.modifiers.is_empty()
            && !(self.focus == Pane::Editor && self.ed.vim.mode == Mode::Insert);
        if slash_opens_palette {
            self.open_palette();
            return;
        }

        match self.focus {
            Pane::Folders => self.folders_key(key),
            Pane::Notes => self.notes_key(key),
            Pane::Editor => self.editor_key(key),
        }
    }

    /// One `Ctrl+W` moves to the next pane. It used to be vim's two-key
    /// `Ctrl+W` *then* a direction, which left the app swallowing the next
    /// keystroke — pressing `→` after it switched panes instead of expanding
    /// the row under the cursor.
    fn cycle_focus(&mut self) {
        if self.panels_hidden {
            self.status = "panels are hidden — Ctrl+T brings them back".to_string();
            return;
        }
        self.focus = match self.focus {
            Pane::Folders => Pane::Notes,
            Pane::Notes => Pane::Editor,
            Pane::Editor => Pane::Folders,
        };
    }

    /// `Ctrl+T` (or `Cmd+T` / `Alt+T` where the terminal forwards them) hides
    /// both left panes and gives the whole frame to the editor.
    pub fn toggle_panels(&mut self) {
        self.panels_hidden = !self.panels_hidden;
        if self.panels_hidden {
            self.focus_before_hide = self.focus;
            self.focus = Pane::Editor;
            self.status = "panels hidden · Ctrl+T to show".to_string();
        } else {
            self.focus = self.focus_before_hide;
            self.status = "panels shown".to_string();
        }
    }

    /// Bring the left panes back, for commands whose whole effect happens over
    /// there — `:feed` with the navigation hidden would otherwise look inert.
    fn show_panels(&mut self) {
        if self.panels_hidden {
            self.toggle_panels();
        }
    }

    fn folders_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Tab | KeyCode::BackTab => {
                self.set_nav_mode(match self.nav.nav_mode {
                    NavMode::Folders => NavMode::Feed,
                    NavMode::Feed => NavMode::Folders,
                });
                self.preview_selected_note();
            }
            KeyCode::Char('j') | KeyCode::Down => {
                self.nav.folder_cursor = (self.nav.folder_cursor + 1).min(self.nav.left_len().saturating_sub(1));
                self.select_left();
                self.preview_selected_note();
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.nav.folder_cursor = self.nav.folder_cursor.saturating_sub(1);
                self.select_left();
                self.preview_selected_note();
            }
            KeyCode::Char('g') => {
                self.nav.folder_cursor = 0;
                self.select_left();
                self.preview_selected_note();
            }
            KeyCode::Char('G') => {
                self.nav.folder_cursor = self.nav.left_len().saturating_sub(1);
                self.select_left();
                self.preview_selected_note();
            }
            KeyCode::Char('l') | KeyCode::Right | KeyCode::Char(' ') => self.expand_or_descend(),
            KeyCode::Char('h') | KeyCode::Left => self.collapse_or_ascend(),
            KeyCode::Enter => {
                self.select_left();
                self.focus = Pane::Notes;
                self.preview_selected_note();
            }
            KeyCode::Char(':') => self.open_prompt(PromptKind::Command),
            _ => {}
        }
    }

    /// `→` / `l`: open the row under the cursor, one step at a time — expand a
    /// collapsed row, then step into its first child, then hand over to the
    /// note list once there is nothing left to open.
    fn expand_or_descend(&mut self) {
        match self.nav.cursor_row_shape() {
            Some((true, false)) => self.toggle_left_expand(true),
            Some((true, true)) => {
                self.nav.folder_cursor =
                    (self.nav.folder_cursor + 1).min(self.nav.left_len().saturating_sub(1));
                self.select_left();
                self.preview_selected_note();
            }
            Some((false, _)) => {
                self.focus = Pane::Notes;
                self.preview_selected_note();
            }
            None => {}
        }
    }

    /// `←` / `h`: the mirror image — collapse an open row, otherwise jump out
    /// to the row that owns it.
    fn collapse_or_ascend(&mut self) {
        match self.nav.cursor_row_shape() {
            Some((_, true)) => self.toggle_left_expand(false),
            Some(_) | None => {
                let Some(parent) = self.nav.parent_index(self.nav.folder_cursor) else {
                    return;
                };
                self.nav.folder_cursor = parent;
                self.select_left();
                self.preview_selected_note();
            }
        }
    }

    fn toggle_left_expand(&mut self, expand: bool) {
        match self.nav.nav_mode {
            NavMode::Folders => {
                let Some(row) = self.nav.folder_rows.get(self.nav.folder_cursor) else {
                    return;
                };
                let path = row.path.clone();
                if expand {
                    self.nav.expanded.insert(path);
                } else {
                    self.nav.expanded.remove(&path);
                }
                self.nav.rebuild_left_rows();
            }
            NavMode::Feed => self.nav.toggle_feed_expanded(expand),
        }
    }

    fn notes_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('j') | KeyCode::Down => {
                self.nav.note_cursor = (self.nav.note_cursor + 1).min(self.nav.notes.len().saturating_sub(1));
                self.preview_selected_note();
            }
            KeyCode::Char('k') | KeyCode::Up => {
                self.nav.note_cursor = self.nav.note_cursor.saturating_sub(1);
                self.preview_selected_note();
            }
            KeyCode::Char('g') => {
                self.nav.note_cursor = 0;
                self.preview_selected_note();
            }
            KeyCode::Char('G') => {
                self.nav.note_cursor = self.nav.notes.len().saturating_sub(1);
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
        let action = self.ed.vim.handle(&mut self.ed.editor.area, key);
        match action {
            VimAction::Edited => self.ed.editor.touch(),
            VimAction::EnterCommand => self.open_prompt(PromptKind::Command),
            VimAction::EnterSearch => self.open_palette(),
            VimAction::SearchNext(forward) => {
                let found = if forward {
                    self.ed.editor.area.search_forward(false)
                } else {
                    self.ed.editor.area.search_back(false)
                };
                if !found {
                    self.status = "pattern not found".to_string();
                }
            }
            VimAction::Ignored => {
                if self.ed.vim.mode == Mode::Normal && key.code == KeyCode::Esc {
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
            suggestions: Vec::new(),
            suggestion_index: 0,
        });
    }

    fn open_palette(&mut self) {
        self.open_prompt(PromptKind::Palette);
        self.refresh_palette();
    }

    fn prompt_key(&mut self, key: KeyEvent) {
        if self
            .prompt
            .as_ref()
            .is_some_and(|prompt| prompt.kind == PromptKind::Palette)
        {
            self.palette_key(key);
            return;
        }
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
                    PromptKind::Palette => unreachable!("palette keys route separately"),
                }
            }
            _ => {}
        }
    }

    fn palette_key(&mut self, key: KeyEvent) {
        if is_chord(&key, 'k', PALETTE_CHORD) {
            self.prompt = None;
            return;
        }

        match key.code {
            KeyCode::Esc => self.prompt = None,
            KeyCode::Up | KeyCode::BackTab => {
                if let Some(prompt) = self.prompt.as_mut() {
                    prompt.suggestion_index = prompt.suggestion_index.saturating_sub(1);
                }
            }
            KeyCode::Down => {
                if let Some(prompt) = self.prompt.as_mut() {
                    prompt.suggestion_index = (prompt.suggestion_index + 1)
                        .min(prompt.suggestions.len().saturating_sub(1));
                }
            }
            KeyCode::Backspace => {
                if let Some(prompt) = self.prompt.as_mut() {
                    prompt.input.pop();
                }
                self.refresh_palette();
            }
            KeyCode::Char(ch)
                if !key
                    .modifiers
                    .intersects(KeyModifiers::CONTROL.union(KeyModifiers::SUPER)) =>
            {
                if let Some(prompt) = self.prompt.as_mut() {
                    prompt.input.push(ch);
                }
                self.refresh_palette();
            }
            // Tab completes the highlighted row into the input. Enter then
            // executes it; for argument-taking commands it simply enters the
            // mode (`mv ` / `search `) and keeps the palette open.
            KeyCode::Tab => {
                let selected = self.prompt.as_ref().and_then(|prompt| {
                    prompt
                        .suggestions
                        .get(prompt.suggestion_index)
                        .cloned()
                });
                if let (Some(prompt), Some(selected)) = (self.prompt.as_mut(), selected) {
                    prompt.input = selected.input;
                }
                self.refresh_palette();
            }
            KeyCode::Enter => {
                let selected = self.prompt.as_ref().and_then(|prompt| {
                    prompt
                        .suggestions
                        .get(prompt.suggestion_index)
                        .map(|row| row.input.clone())
                        .or_else(|| (!prompt.input.trim().is_empty()).then(|| prompt.input.clone()))
                });
                let Some(input) = selected else {
                    return;
                };
                if input.ends_with(' ') {
                    if let Some(prompt) = self.prompt.as_mut() {
                        prompt.input = input;
                    }
                    self.refresh_palette();
                } else {
                    self.prompt = None;
                    self.run_command(&input);
                }
            }
            _ => {}
        }
    }

    fn refresh_palette(&mut self) {
        let Some(prompt) = self.prompt.as_mut() else {
            return;
        };
        let mut folders = Vec::new();
        model::collect_folder_paths(&self.nav.tree, &mut folders);
        prompt.suggestions = command::palette_suggestions(&prompt.input, &folders);
        prompt.suggestion_index = prompt
            .suggestion_index
            .min(prompt.suggestions.len().saturating_sub(1));
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
            model::collect_folder_paths(&self.nav.tree, &mut folders);
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
        if pattern.is_empty() {
            self.status = "usage: search <pattern>".to_string();
            return;
        }
        match self.ed.editor.area.set_search_pattern(pattern) {
            Ok(()) => {
                if !self.ed.editor.area.search_forward(false) {
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
                if self.git_busy() {
                    self.status = "git in progress — wait or :q! to force".to_string();
                    return;
                }
                self.should_quit = true;
            }
            Command::QuitNoSave => self.should_quit = true,
            Command::WriteQuit => {
                self.flush_editor();
                if self.git_busy() {
                    self.status = "git in progress — wait or :q! to force".to_string();
                    return;
                }
                self.should_quit = true;
            }
            Command::Move(destination) => self.move_note(&destination),
            Command::New(folder) => self.create_note(folder),
            Command::Delete => self.delete_note(),
            Command::SetMarker(marker, enabled) => self.set_note_marker(marker, enabled),
            Command::Search(pattern) => self.run_search(&pattern),
            Command::Open(path) => self.open_root(path),
            Command::Connect(url) => self.git_connect(&url),
            Command::Sync => self.git_sync(),
            Command::Pull => self.git_pull(),
            Command::Push => self.git_push(),
            Command::Status => self.git_status(),
            Command::SshKey => self.ssh_key(),
            Command::Panels => self.toggle_panels(),
            Command::SetUiStyle(style) => self.set_ui_style(style),
            Command::NextUiStyle => self.set_ui_style(self.ui_style.next()),
            Command::Feed => {
                self.show_panels();
                self.set_nav_mode(NavMode::Feed);
                self.preview_selected_note();
            }
            Command::Folders => {
                self.show_panels();
                self.set_nav_mode(NavMode::Folders);
                self.preview_selected_note();
            }
            Command::Help => self.status = self.help_line(),
            Command::Unknown(name) => self.status = format!("unknown command: {name}"),
        }
    }

    fn move_note(&mut self, destination: &str) {
        if destination.is_empty() {
            self.status = "usage: :mv <folder>".to_string();
            return;
        }
        self.flush_editor();
        let Some(path) = self.nav.target_note(self.ed.editor.path.as_deref()) else {
            self.status = "no note selected".to_string();
            return;
        };
        match self
            .core
            .notes()
            .and_then(|notes| notes.move_items(vec![path.clone()], destination.to_string()))
        {
            Ok(()) => {
                if self.ed.editor.path.as_deref() == Some(path.as_str()) {
                    self.ed.editor.close();
                }
                self.status = format!("moved → {destination}");
                self.refresh_current();
            }
            Err(err) => self.status = format!("move: {err}"),
        }
    }

    fn set_ui_style(&mut self, style: UiStyle) {
        self.ui_style = style;
        self.status = format!("UI layout → {}", style.label());
    }

    fn set_note_marker(&mut self, marker: Marker, enabled: bool) {
        self.flush_editor();
        let Some(path) = self.nav.target_note(self.ed.editor.path.as_deref()) else {
            self.status = "no note selected".to_string();
            return;
        };
        let (archived, reviewed, label) = match marker {
            Marker::Archived => (
                Some(enabled),
                None,
                if enabled { "archived" } else { "unarchived" },
            ),
            Marker::Reviewed => (
                None,
                Some(enabled),
                if enabled { "reviewed" } else { "unreviewed" },
            ),
        };
        match self
            .core
            .notes()
            .and_then(|notes| notes.update_note_markers(&path, archived, reviewed))
        {
            Ok(()) => {
                self.status = format!("marked {label}");
                self.refresh_current();
            }
            Err(err) => self.status = format!("mark: {err}"),
        }
    }

    fn create_note(&mut self, folder: Option<String>) {
        self.flush_editor();
        // The core reads an empty folder as "put it in Feed". That is the right
        // default for a notes root and the wrong one for a folder someone
        // opened to browse, so the root row spells itself out as ".".
        let folder_path = match folder.or_else(|| self.nav.open_folder.clone()) {
            Some(path) if path.is_empty() => Some(".".to_string()),
            Some(path) => Some(path),
            None if self.nav.feed_path.is_none() => Some(".".to_string()),
            None => None,
        };
        let args = CreateNoteArgs {
            folder_path,
            content: None,
            timestamp_ms: None,
            file_name_format: NoteFileNameFormat::default(),
        };
        match self.core.notes().and_then(|notes| notes.create_note(args)) {
            Ok(result) => {
                self.refresh_current();
                self.ed.editor.open_created(result.path.clone());
                self.focus = Pane::Editor;
                self.ed.reset_vim();
                self.ed.vim.mode = Mode::Insert;
                self.status = format!("new note in {}", model::file_stem(&result.path));
            }
            Err(err) => self.status = format!("create: {err}"),
        }
    }

    fn delete_note(&mut self) {
        let Some(path) = self.nav.target_note(self.ed.editor.path.as_deref()) else {
            self.status = "no note selected".to_string();
            return;
        };
        match self
            .core
            .notes()
            .and_then(|notes| notes.delete_items(vec![path.clone()]))
        {
            Ok(()) => {
                if self.ed.editor.path.as_deref() == Some(path.as_str()) {
                    self.ed.editor.close();
                    self.focus = Pane::Notes;
                }
                self.status = "deleted".to_string();
                self.refresh_current();
            }
            Err(err) => self.status = format!("delete: {err}"),
        }
    }

    // ── Git sync ───────────────────────────────────────────────────────────

    /// Git sync belongs to the profile: the remote, branch, credentials and SSH
    /// key all live there. A folder opened for browsing has none of that, and
    /// running these against the profile root instead would be a quiet lie
    /// about which files are being pushed.
    fn git_available(&mut self) -> bool {
        if self.core.is_custom_root() {
            self.status =
                "git sync belongs to the notes root — `:open` with no path returns to it".to_string();
            return false;
        }
        true
    }

    fn git_status(&mut self) {
        if !self.git_available() {
            return;
        }
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
    fn git_connect(&mut self, argument: &str) {
        if !self.git_available() {
            return;
        }
        if argument.split_whitespace().next().is_none() {
            self.status = "usage: :connect <url> [branch]".to_string();
            return;
        }
        // The remote work reads and writes the repo, so the buffer must be on
        // disk before the task starts — same reason as `git_pull`.
        self.flush_editor();
        self.status = "connecting…".to_string();
        self.pending_git = Some(GitTask::Connect(argument.to_string()));
    }

    fn git_pull(&mut self) {
        if !self.git_available() {
            return;
        }
        // Pull rewrites files under us, so the buffer has to be on disk first.
        self.flush_editor();
        self.status = "pulling…".to_string();
        self.pending_git = Some(GitTask::Pull);
    }

    fn git_push(&mut self) {
        if !self.git_available() {
            return;
        }
        self.flush_editor();
        self.status = "pushing…".to_string();
        self.pending_git = Some(GitTask::Push);
    }

    fn git_sync(&mut self) {
        if !self.git_available() {
            return;
        }
        self.flush_editor();
        self.status = "syncing…".to_string();
        self.pending_git = Some(GitTask::Sync);
    }

    /// Hand the queued git task to the event loop, which spawns it on the
    /// tokio runtime. Returns `None` when nothing is queued or another
    /// operation is already in flight.
    pub fn take_git_task(&mut self) -> Option<GitTask> {
        let task = self.pending_git.take()?;
        if self.git_in_flight > 0 {
            self.status = "git: another operation is already running".to_string();
            return None;
        }
        self.git_in_flight += 1;
        Some(task)
    }

    /// Apply a finished background operation: status line, then the side
    /// effects the outcome asks for.
    pub fn apply_async(&mut self, outcome: AsyncOutcome) {
        self.git_in_flight = self.git_in_flight.saturating_sub(1);
        self.status = outcome.status;
        if outcome.refresh {
            self.refresh_current();
        }
        if outcome.reload_note {
            self.reload_open_note();
        }
    }

    /// True while a background git operation is running. `:q` refuses to quit
    /// in this state; `:q!` still quits immediately.
    pub fn git_busy(&self) -> bool {
        self.git_in_flight > 0
    }

    /// Re-read the open note after a pull, which may have rewritten it.
    ///
    /// Only safe because the pull path flushes first: the buffer and the file
    /// agreed before the merge, so whatever is on disk now is the merged truth.
    /// If the user typed *during* the pull (buffer dirty again), we keep the
    /// buffer — reloading would silently discard those keystrokes, and
    /// overwriting the merged file with the stale buffer would be worse.
    fn reload_open_note(&mut self) {
        let Some(path) = self.ed.editor.path.clone() else {
            return;
        };
        if self.ed.editor.is_dirty() {
            self.status.push_str(" · open note kept (unsaved edits)");
            return;
        }
        match self.core.notes().and_then(|notes| notes.read_note(&path)) {
            Ok(body) => self.ed.editor.open(path, body),
            Err(_) => {
                self.ed.editor.close();
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

// ── Background git execution ───────────────────────────────────────────────
//
// These run on a worker thread (`tokio::task::spawn_blocking`), not on the
// async runtime's own threads: libgit2 is a blocking C library, and blocking
// work must never occupy an async worker. They take a cloned `Core`, which is
// two `PathBuf`s — cheap to clone, safe to move across threads (`Send`), and
// it rebuilds its services per call, so the background thread never shares
// mutable state with the UI thread.

/// Run one queued git task to completion and describe the result.
pub fn run_git_task(core: &Core, task: GitTask) -> AsyncOutcome {
    match task {
        GitTask::Pull => match do_pull(core) {
            Ok(msg) => AsyncOutcome::pulled(msg),
            Err(err) => AsyncOutcome::error(format!("pull: {err}")),
        },
        GitTask::Push => match do_push(core) {
            Ok(msg) => AsyncOutcome::done(msg),
            Err(err) => AsyncOutcome::error(format!("push: {err}")),
        },
        GitTask::Sync => match do_pull(core) {
            Ok(pull_msg) => match do_push(core) {
                // The pull already changed files on disk, so even a failed
                // push must refresh and reload — hence `pulled`, not `error`.
                Ok(push_msg) => AsyncOutcome::pulled(format!("{pull_msg} · {push_msg}")),
                Err(err) => AsyncOutcome::pulled(format!("{pull_msg} · push: {err}")),
            },
            Err(err) => AsyncOutcome::error(format!("pull: {err}")),
        },
        GitTask::Connect(argument) => match do_connect(core, &argument) {
            Ok(msg) => AsyncOutcome::refreshed(msg),
            Err(err) => AsyncOutcome::error(format!("connect: {err}")),
        },
    }
}

fn do_pull(core: &Core) -> Result<String, String> {
    let args = GitSyncArgs { branch: None, username: None, password: None };
    core.git()
        .pull(args)
        .map(|status| format!("pulled · behind {}", status.behind))
}

fn do_push(core: &Core) -> Result<String, String> {
    let args = GitPushArgs { message: None, branch: None, username: None, password: None };
    core.git()
        .push(args)
        .map(|status| format!("pushed · ahead {}", status.ahead))
}

fn do_connect(core: &Core, argument: &str) -> Result<String, String> {
    let mut parts = argument.split_whitespace();
    let url = parts.next().unwrap_or_default();
    let args = type_core::ConnectGitArgs {
        remote_url: Some(url.to_string()),
        branch: parts.next().map(str::to_string),
        username: None,
        password: None,
    };
    core.git().connect(args).map(|status| {
        format!("connected · {}", status.current_branch.unwrap_or_else(|| "?".into()))
    })
}
