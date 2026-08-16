//! Commands shared by the vim `:` line and the discoverable command palette.
//!
//! There is deliberately one parser and one catalog. `:` stays fast for users
//! who already know a command, while `/` and Cmd/Ctrl+K render the catalog with
//! labels, fuzzy filtering, and folder-aware `mv` suggestions.

/// A feed marker changed by a `mark:*` command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Marker {
    Archived,
    Reviewed,
}

/// The three chrome experiments the user can switch between at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UiStyle {
    /// One parent frame; borderless panels separated by vertical rules.
    Frame,
    /// Three independent rounded panel containers; no parent frame.
    Panes,
    /// Dedicated panel headers and a completely open writing surface.
    Focus,
}

impl UiStyle {
    pub fn next(self) -> Self {
        match self {
            Self::Frame => Self::Panes,
            Self::Panes => Self::Focus,
            Self::Focus => Self::Frame,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Frame => "frame",
            Self::Panes => "panes",
            Self::Focus => "writing",
        }
    }
}

/// Where the note list lives — the terminal counterpart of the desktop's
/// `notesListMode`.
///
/// This is orthogonal to [`UiStyle`]: it changes how many navigation columns
/// there are, not how they are framed, so every chrome experiment renders both.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavLayout {
    /// Two navigation panels: containers on the left, the selected container's
    /// notes beside them.
    Split,
    /// One navigation panel: each note is drawn inside the folder — or, in the
    /// Feed, the date bucket — it belongs to.
    Nested,
}

impl NavLayout {
    pub fn next(self) -> Self {
        match self {
            Self::Split => Self::Nested,
            Self::Nested => Self::Split,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Split => "split",
            Self::Nested => "nested",
        }
    }
}

/// A parsed command line. Unknown input is preserved so the status bar can
/// echo it back rather than failing silently.
#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Write,
    Quit,
    /// `:q!` — discard the buffer and quit without flushing.
    QuitNoSave,
    WriteQuit,
    /// `:mv <folder>` — move the open note; the folder is created if missing.
    Move(String),
    /// `:new [folder]` — create a note in the given folder, else the selected one.
    New(Option<String>),
    /// `:d` — delete the open note.
    Delete,
    /// `mark:archive`, `mark:reviewed`, and their explicit inverse forms.
    SetMarker(Marker, bool),
    /// `search <pattern>` — set the editor's search pattern and jump forward.
    Search(String),
    /// `:open [path]` — browse any folder; without a path, go back to the
    /// active profile's notes root.
    Open(Option<String>),
    /// `:panels` — the `Ctrl+T` toggle, for terminals that eat the chord.
    Panels,
    /// Switch the chrome experiment immediately.
    SetUiStyle(UiStyle),
    /// Cycle frame → panes → focus without remembering a name.
    NextUiStyle,
    /// Put the note list in its own panel, or nest it inside the tree.
    SetNavLayout(NavLayout),
    /// Flip between the two without remembering a name.
    NextNavLayout,
    /// Show the open note as rendered Markdown (read-only).
    ViewMarkdown,
    /// Return the open note to its editable Markdown source.
    ViewSource,
    /// Switch between source and rendered Markdown.
    ToggleMarkdownView,
    /// `:connect <url>` — point this notes root at a git remote, initialising
    /// the repo if needed. Without it there is nothing for `:sync` to talk to.
    Connect(String),
    /// `:sync` — pull, then push. The common case, bound to one word.
    Sync,
    Pull,
    Push,
    Status,
    /// `:key` — print the app-managed SSH public key, generating it if absent.
    SshKey,
    /// `:feed` — show the Feed's time-grouped tree in the left panel.
    Feed,
    /// `:folders` — show the folder tree in the left panel.
    Folders,
    Help,
    Empty,
    Unknown(String),
}

/// One row in the Cmd/Ctrl+K and `/` palette.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PaletteSuggestion {
    /// Text dispatched through [`parse`] when the row is accepted. A trailing
    /// space means the command still needs an argument, so accepting it keeps
    /// the palette open and moves into that command's argument mode.
    pub input: String,
    pub label: String,
    pub detail: String,
    pub group: PaletteGroup,
    pub icon: &'static str,
}

/// Stable palette sections. Suggestions are returned in this order so the
/// keyboard cursor and the grouped renderer always agree about what is next.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum PaletteGroup {
    Note,
    Navigate,
    View,
    Git,
    App,
}

impl PaletteGroup {
    pub fn label(self) -> &'static str {
        match self {
            Self::Note => "Note",
            Self::Navigate => "Navigate",
            Self::View => "View",
            Self::Git => "Git",
            Self::App => "App",
        }
    }

    pub fn icon(self) -> &'static str {
        match self {
            Self::Note => "✎",
            Self::Navigate => "↪",
            Self::View => "◉",
            Self::Git => "⎇",
            Self::App => "⌘",
        }
    }
}

struct CatalogEntry {
    input: &'static str,
    label: &'static str,
    keywords: &'static str,
    group: PaletteGroup,
    icon: &'static str,
}

/// Discoverable commands. Their execution still goes through [`parse`], so
/// the palette and `:` line cannot drift into subtly different behaviors.
const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        input: "mv ",
        label: "Move note to folder…",
        keywords: "move file folder destination",
        group: PaletteGroup::Note,
        icon: "→",
    },
    CatalogEntry {
        input: "mark:archive",
        label: "Mark note archived",
        keywords: "archive hide marker",
        group: PaletteGroup::Note,
        icon: "◇",
    },
    CatalogEntry {
        input: "mark:unarchive",
        label: "Mark note unarchived",
        keywords: "restore archive marker",
        group: PaletteGroup::Note,
        icon: "◇",
    },
    CatalogEntry {
        input: "mark:reviewed",
        label: "Mark note reviewed",
        keywords: "review done marker",
        group: PaletteGroup::Note,
        icon: "✓",
    },
    CatalogEntry {
        input: "mark:unreviewed",
        label: "Mark note unreviewed",
        keywords: "review pending marker",
        group: PaletteGroup::Note,
        icon: "✓",
    },
    CatalogEntry {
        input: "new",
        label: "Create note",
        keywords: "add write note",
        group: PaletteGroup::Note,
        icon: "+",
    },
    CatalogEntry {
        input: "search ",
        label: "Search in note…",
        keywords: "find pattern regex",
        group: PaletteGroup::Navigate,
        icon: "?",
    },
    CatalogEntry {
        input: "feed",
        label: "Open Feed",
        keywords: "navigate inbox",
        group: PaletteGroup::Navigate,
        icon: "≡",
    },
    CatalogEntry {
        input: "folders",
        label: "Open folders",
        keywords: "navigate tree knowledge",
        group: PaletteGroup::Navigate,
        icon: "▸",
    },
    CatalogEntry {
        input: "panels",
        label: "Toggle navigation panels",
        keywords: "hide show focus zen",
        group: PaletteGroup::View,
        icon: "◫",
    },
    CatalogEntry {
        input: "view:toggle",
        label: "Toggle Markdown preview",
        keywords: "render rendered markdown glow source preview",
        group: PaletteGroup::View,
        icon: "M",
    },
    CatalogEntry {
        input: "view:markdown",
        label: "View rendered Markdown",
        keywords: "render markdown glow preview read",
        group: PaletteGroup::View,
        icon: "M",
    },
    CatalogEntry {
        input: "view:source",
        label: "Edit Markdown source",
        keywords: "raw source markdown edit",
        group: PaletteGroup::View,
        icon: "#",
    },
    CatalogEntry {
        input: "ui:next",
        label: "Try next UI layout",
        keywords: "appearance experiment chrome cycle",
        group: PaletteGroup::View,
        icon: "◌",
    },
    CatalogEntry {
        input: "ui:frame",
        label: "UI: shared outer frame",
        keywords: "appearance container dividers layout",
        group: PaletteGroup::View,
        icon: "□",
    },
    CatalogEntry {
        input: "ui:panes",
        label: "UI: separate pane cards",
        keywords: "appearance containers cards layout",
        group: PaletteGroup::View,
        icon: "▦",
    },
    CatalogEntry {
        input: "ui:focus",
        label: "UI: writing-focused hybrid",
        keywords: "appearance custom editor rail layout",
        group: PaletteGroup::View,
        icon: "✎",
    },
    CatalogEntry {
        input: "nav:toggle",
        label: "Toggle nested / split notes",
        keywords: "panel panes one two nested list desktop layout notes",
        group: PaletteGroup::View,
        icon: "◨",
    },
    CatalogEntry {
        input: "nav:nested",
        label: "Notes inside their folder",
        keywords: "one panel nested tree inline notes layout",
        group: PaletteGroup::View,
        icon: "◧",
    },
    CatalogEntry {
        input: "nav:split",
        label: "Notes in their own panel",
        keywords: "two panels split list column notes layout",
        group: PaletteGroup::View,
        icon: "◨",
    },
    CatalogEntry {
        input: "write",
        label: "Save note",
        keywords: "write persist",
        group: PaletteGroup::Note,
        icon: "✓",
    },
    CatalogEntry {
        input: "delete",
        label: "Delete note",
        keywords: "remove trash",
        group: PaletteGroup::Note,
        icon: "×",
    },
    CatalogEntry {
        input: "open ",
        label: "Open working folder…",
        keywords: "cd root browse",
        group: PaletteGroup::Navigate,
        icon: "↪",
    },
    CatalogEntry {
        input: "sync",
        label: "Pull, then push",
        keywords: "git synchronize",
        group: PaletteGroup::Git,
        icon: "⇅",
    },
    CatalogEntry {
        input: "pull",
        label: "Pull changes",
        keywords: "git download",
        group: PaletteGroup::Git,
        icon: "↓",
    },
    CatalogEntry {
        input: "push",
        label: "Push changes",
        keywords: "git upload",
        group: PaletteGroup::Git,
        icon: "↑",
    },
    CatalogEntry {
        input: "status",
        label: "Show git status",
        keywords: "git changes",
        group: PaletteGroup::Git,
        icon: "●",
    },
    CatalogEntry {
        input: "connect ",
        label: "Connect git remote…",
        keywords: "git remote url branch setup",
        group: PaletteGroup::Git,
        icon: "⌘",
    },
    CatalogEntry {
        input: "key",
        label: "Show SSH public key",
        keywords: "git connect ssh",
        group: PaletteGroup::Git,
        icon: "◇",
    },
    CatalogEntry {
        input: "help",
        label: "Show key reminder",
        keywords: "shortcuts keys",
        group: PaletteGroup::App,
        icon: "?",
    },
    CatalogEntry {
        input: "quit",
        label: "Save and quit",
        keywords: "exit close",
        group: PaletteGroup::App,
        icon: "✕",
    },
    CatalogEntry {
        input: "q!",
        label: "Quit without saving",
        keywords: "exit force discard",
        group: PaletteGroup::App,
        icon: "!",
    },
];

pub fn parse(input: &str) -> Command {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Command::Empty;
    }
    let (head, rest) = match trimmed.split_once(char::is_whitespace) {
        Some((head, rest)) => (head, rest.trim()),
        None => (trimmed, ""),
    };

    match head {
        "w" | "write" => Command::Write,
        "q" | "quit" => Command::Quit,
        "q!" | "quit!" => Command::QuitNoSave,
        "wq" | "x" => Command::WriteQuit,
        "mv" | "move" => Command::Move(rest.to_string()),
        "new" | "n" => {
            if rest.is_empty() {
                Command::New(None)
            } else {
                Command::New(Some(rest.to_string()))
            }
        }
        "d" | "delete" => Command::Delete,
        "mark:archive" => Command::SetMarker(Marker::Archived, true),
        "mark:unarchive" => Command::SetMarker(Marker::Archived, false),
        "mark:reviewed" => Command::SetMarker(Marker::Reviewed, true),
        "mark:unreviewed" => Command::SetMarker(Marker::Reviewed, false),
        "search" | "find" => Command::Search(rest.to_string()),
        "open" | "o" | "cd" => {
            if rest.is_empty() {
                Command::Open(None)
            } else {
                Command::Open(Some(rest.to_string()))
            }
        }
        "panels" | "t" => Command::Panels,
        "nav" | "nav:toggle" => Command::NextNavLayout,
        "nav:nested" | "nested" => Command::SetNavLayout(NavLayout::Nested),
        "nav:split" | "split" => Command::SetNavLayout(NavLayout::Split),
        "ui" | "ui:next" => Command::NextUiStyle,
        "ui:frame" => Command::SetUiStyle(UiStyle::Frame),
        "ui:panes" => Command::SetUiStyle(UiStyle::Panes),
        "ui:focus" => Command::SetUiStyle(UiStyle::Focus),
        "view" | "view:toggle" => Command::ToggleMarkdownView,
        "markdown" | "md" | "preview" | "view:markdown" => Command::ViewMarkdown,
        "source" | "view:source" => Command::ViewSource,
        "connect" => Command::Connect(rest.to_string()),
        "sync" => Command::Sync,
        "pull" => Command::Pull,
        "push" => Command::Push,
        "status" | "st" => Command::Status,
        "key" | "sshkey" => Command::SshKey,
        "feed" => Command::Feed,
        "folders" => Command::Folders,
        "h" | "help" => Command::Help,
        _ => Command::Unknown(head.to_string()),
    }
}

/// Fuzzy command suggestions for the palette.
///
/// `mv` is a small mode of its own: once the prefix is present, rows are real
/// root-relative folder paths from the current tree. The command never knows
/// where system folders live, which keeps it valid if `Feed` later moves under
/// a `system/` directory.
pub fn palette_suggestions(query: &str, folders: &[String]) -> Vec<PaletteSuggestion> {
    let query = query.trim_start_matches([':', '/']);
    if let Some(argument) = query
        .strip_prefix("mv ")
        .or_else(|| query.strip_prefix("move "))
    {
        return move_suggestions(argument, folders);
    }

    let needle = query.trim().to_lowercase();
    let mut scored: Vec<(PaletteGroup, (u8, usize, usize), usize, &CatalogEntry)> = CATALOG
        .iter()
        .enumerate()
        .filter_map(|(index, entry)| {
            let searchable = format!(
                "{} {} {} {}",
                entry.input,
                entry.label,
                entry.keywords,
                entry.group.label()
            )
            .to_lowercase();
            let score = if needle.is_empty() {
                Some((0, catalog_order(entry.input), 0))
            } else {
                fuzzy_score(&needle, &searchable)
            };
            score
                // Very loose cross-word subsequences create surprising rows
                // (`glow` used to match "Open working folder"). Keep fuzzy
                // discovery, but require the matched span to stay close to
                // what the user typed.
                .filter(|(tier, span, _)| {
                    *tier < 2 || *span <= needle.chars().count().saturating_mul(3)
                })
                .map(|score| (entry.group, score, index, entry))
        })
        .collect();
    scored.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
    scored
        .into_iter()
        .map(|(_, _, _, entry)| PaletteSuggestion {
            input: entry.input.to_string(),
            label: entry.label.to_string(),
            detail: entry.input.trim().to_string(),
            group: entry.group,
            icon: entry.icon,
        })
        .collect()
}

/// Default order inside each section. A filtered palette still ranks by its
/// fuzzy score; these priorities only shape the useful, query-empty overview.
fn catalog_order(input: &str) -> usize {
    match input {
        "new" | "feed" | "view:toggle" | "sync" | "help" => 0,
        "write" | "folders" | "nav:toggle" | "pull" | "quit" => 1,
        "mv " | "open " | "nav:nested" | "push" | "q!" => 2,
        "delete" | "search " | "nav:split" | "status" => 3,
        "mark:archive" | "view:markdown" | "connect " => 4,
        "mark:unarchive" | "view:source" | "key" => 5,
        "mark:reviewed" | "panels" => 6,
        "mark:unreviewed" | "ui:focus" => 7,
        "ui:next" => 8,
        "ui:panes" => 9,
        "ui:frame" => 10,
        _ => usize::MAX,
    }
}

fn move_suggestions(argument: &str, folders: &[String]) -> Vec<PaletteSuggestion> {
    let argument = argument.trim();
    let matches = complete_folders(argument, folders);
    let exact = folders.iter().any(|folder| folder == argument);
    let mut rows = Vec::new();

    if !argument.is_empty() {
        rows.push(PaletteSuggestion {
            input: format!("mv {argument}"),
            label: if exact {
                format!("Move note to {argument}")
            } else {
                format!("Create {argument} and move note")
            },
            detail: if exact {
                "folder".into()
            } else {
                "new folder".into()
            },
            group: PaletteGroup::Note,
            icon: "→",
        });
    }

    for folder in matches {
        if folder == argument {
            continue;
        }
        rows.push(PaletteSuggestion {
            input: format!("mv {folder}"),
            label: format!("Move note to {folder}"),
            detail: folder,
            group: PaletteGroup::Note,
            icon: "→",
        });
    }
    rows
}

/// Lower is better: prefix, substring, then subsequence. The second and third
/// fields keep tighter and shorter matches ahead of loose coincidences.
fn fuzzy_score(needle: &str, haystack: &str) -> Option<(u8, usize, usize)> {
    if needle.is_empty() {
        return Some((0, 0, haystack.len()));
    }
    if haystack.starts_with(needle) {
        return Some((0, 0, haystack.len()));
    }
    if let Some(index) = haystack.find(needle) {
        return Some((1, index, haystack.len()));
    }

    let mut chars = haystack.char_indices();
    let mut first = None;
    let mut last = 0;
    for wanted in needle.chars() {
        let (index, _) = chars.find(|(_, candidate)| *candidate == wanted)?;
        first.get_or_insert(index);
        last = index;
    }
    Some((2, last.saturating_sub(first.unwrap_or(0)), haystack.len()))
}

/// Rank folder paths against a query for `:mv` completion.
///
/// Three tiers, best first: the folder's own name starts with the query, the
/// path contains it, or the query is a subsequence of the path (so `perwrk`
/// finds `personal/work`). Shorter paths win inside a tier, which keeps the
/// obvious shallow match ahead of a deeply nested coincidence.
pub fn complete_folders(query: &str, folders: &[String]) -> Vec<String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        let mut all = folders.to_vec();
        all.sort();
        return all;
    }

    let mut scored: Vec<(u8, usize, &String)> = folders
        .iter()
        .filter_map(|path| {
            let lower = path.to_lowercase();
            let name = lower.rsplit('/').next().unwrap_or(&lower);
            let tier = if name.starts_with(&needle) {
                0
            } else if lower.contains(&needle) {
                1
            } else if is_subsequence(&needle, &lower) {
                2
            } else {
                return None;
            };
            Some((tier, path.len(), path))
        })
        .collect();

    scored.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)).then(a.2.cmp(b.2)));
    scored
        .into_iter()
        .map(|(_, _, path)| path.clone())
        .collect()
}

/// Whether every character of `needle` appears in `haystack` in order.
fn is_subsequence(needle: &str, haystack: &str) -> bool {
    let mut chars = haystack.chars();
    needle
        .chars()
        .all(|wanted| chars.any(|candidate| candidate == wanted))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bare_and_argument_commands() {
        assert_eq!(parse("w"), Command::Write);
        assert_eq!(parse("  sync  "), Command::Sync);
        assert_eq!(
            parse("mv personal/work"),
            Command::Move("personal/work".into())
        );
        assert_eq!(parse("new"), Command::New(None));
        assert_eq!(parse("new Feed"), Command::New(Some("Feed".into())));
        assert_eq!(
            parse("mark:archive"),
            Command::SetMarker(Marker::Archived, true)
        );
        assert_eq!(
            parse("mark:unreviewed"),
            Command::SetMarker(Marker::Reviewed, false)
        );
        assert_eq!(parse("search roadmap"), Command::Search("roadmap".into()));
        assert_eq!(parse("ui"), Command::NextUiStyle);
        assert_eq!(parse("ui:focus"), Command::SetUiStyle(UiStyle::Focus));
        assert_eq!(parse("md"), Command::ViewMarkdown);
        assert_eq!(parse("view:source"), Command::ViewSource);
        assert_eq!(parse("view"), Command::ToggleMarkdownView);
        assert_eq!(parse("nope"), Command::Unknown("nope".into()));
        assert_eq!(parse("   "), Command::Empty);
    }

    #[test]
    fn open_takes_an_optional_folder() {
        assert_eq!(parse("open"), Command::Open(None));
        assert_eq!(parse("open ~/notes"), Command::Open(Some("~/notes".into())));
        assert_eq!(
            parse("cd /tmp/wiki"),
            Command::Open(Some("/tmp/wiki".into()))
        );
    }

    #[test]
    fn quit_variants_are_distinct() {
        // `:q` flushes first; `:q!` must not, or it would defeat its purpose.
        assert_eq!(parse("q"), Command::Quit);
        assert_eq!(parse("q!"), Command::QuitNoSave);
    }

    #[test]
    fn completion_prefers_name_prefix_then_shortest() {
        let folders = vec![
            "archive/personal".to_string(),
            "personal".to_string(),
            "personal/work".to_string(),
        ];
        let hits = complete_folders("per", &folders);
        // Both "personal" and "archive/personal" match by name prefix; the
        // shorter path wins. "personal/work" only matches by path contains.
        assert_eq!(hits[0], "personal");
        assert_eq!(hits[1], "archive/personal");
        assert_eq!(hits[2], "personal/work");
    }

    #[test]
    fn completion_matches_subsequences() {
        let folders = vec!["personal/work".to_string(), "notes".to_string()];
        assert_eq!(complete_folders("perwrk", &folders), vec!["personal/work"]);
    }

    #[test]
    fn empty_query_lists_everything_sorted() {
        let folders = vec!["b".to_string(), "a".to_string()];
        assert_eq!(complete_folders("", &folders), vec!["a", "b"]);
    }

    #[test]
    fn palette_finds_commands_by_name_label_and_keyword() {
        let rows = palette_suggestions("archive", &[]);
        assert_eq!(rows[0].input, "mark:archive");

        let rows = palette_suggestions("destination", &[]);
        assert_eq!(rows[0].input, "mv ");
    }

    #[test]
    fn empty_palette_is_grouped_in_visual_navigation_order() {
        let rows = palette_suggestions("", &[]);
        assert!(rows.windows(2).all(|pair| pair[0].group <= pair[1].group));
        assert_eq!(rows.first().map(|row| row.group), Some(PaletteGroup::Note));
        assert_eq!(rows.last().map(|row| row.group), Some(PaletteGroup::App));
    }

    #[test]
    fn markdown_reader_commands_live_in_view() {
        let rows = palette_suggestions("glow", &[]);
        assert_eq!(rows[0].input, "view:markdown");
        assert!(rows.iter().all(|row| row.group == PaletteGroup::View));
    }

    #[test]
    fn move_mode_suggests_real_paths_and_an_explicit_create_action() {
        let folders = vec!["projects/type/tui".into(), "personal".into()];
        let rows = palette_suggestions("mv proj", &folders);
        assert_eq!(rows[0].input, "mv proj");
        assert_eq!(rows[0].detail, "new folder");
        assert_eq!(rows[1].input, "mv projects/type/tui");
    }

    #[test]
    fn exact_move_path_is_not_duplicated() {
        let folders = vec!["projects/type/tui".into()];
        let rows = palette_suggestions("mv projects/type/tui", &folders);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].detail, "folder");
    }
}
