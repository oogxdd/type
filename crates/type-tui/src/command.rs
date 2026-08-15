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
    /// Borderless navigation rails feeding a contained writing surface.
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
            Self::Focus => "focus",
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
}

struct CatalogEntry {
    input: &'static str,
    label: &'static str,
    keywords: &'static str,
}

/// Discoverable commands. Their execution still goes through [`parse`], so
/// the palette and `:` line cannot drift into subtly different behaviors.
const CATALOG: &[CatalogEntry] = &[
    CatalogEntry {
        input: "mv ",
        label: "Move note to folder…",
        keywords: "move file folder destination",
    },
    CatalogEntry {
        input: "mark:archive",
        label: "Mark note archived",
        keywords: "archive hide marker",
    },
    CatalogEntry {
        input: "mark:unarchive",
        label: "Mark note unarchived",
        keywords: "restore archive marker",
    },
    CatalogEntry {
        input: "mark:reviewed",
        label: "Mark note reviewed",
        keywords: "review done marker",
    },
    CatalogEntry {
        input: "mark:unreviewed",
        label: "Mark note unreviewed",
        keywords: "review pending marker",
    },
    CatalogEntry {
        input: "new",
        label: "Create note",
        keywords: "add write note",
    },
    CatalogEntry {
        input: "search ",
        label: "Search in note…",
        keywords: "find pattern regex",
    },
    CatalogEntry {
        input: "feed",
        label: "Open Feed",
        keywords: "navigate inbox",
    },
    CatalogEntry {
        input: "folders",
        label: "Open folders",
        keywords: "navigate tree knowledge",
    },
    CatalogEntry {
        input: "panels",
        label: "Toggle navigation panels",
        keywords: "hide show focus zen",
    },
    CatalogEntry {
        input: "ui:next",
        label: "Try next UI layout",
        keywords: "appearance experiment chrome cycle",
    },
    CatalogEntry {
        input: "ui:frame",
        label: "UI: shared outer frame",
        keywords: "appearance container dividers layout",
    },
    CatalogEntry {
        input: "ui:panes",
        label: "UI: separate pane cards",
        keywords: "appearance containers cards layout",
    },
    CatalogEntry {
        input: "ui:focus",
        label: "UI: writing-focused hybrid",
        keywords: "appearance custom editor rail layout",
    },
    CatalogEntry {
        input: "write",
        label: "Save note",
        keywords: "write persist",
    },
    CatalogEntry {
        input: "delete",
        label: "Delete note",
        keywords: "remove trash",
    },
    CatalogEntry {
        input: "open ",
        label: "Open working folder…",
        keywords: "cd root browse",
    },
    CatalogEntry {
        input: "sync",
        label: "Pull, then push",
        keywords: "git synchronize",
    },
    CatalogEntry {
        input: "pull",
        label: "Pull changes",
        keywords: "git download",
    },
    CatalogEntry {
        input: "push",
        label: "Push changes",
        keywords: "git upload",
    },
    CatalogEntry {
        input: "status",
        label: "Show git status",
        keywords: "git changes",
    },
    CatalogEntry {
        input: "key",
        label: "Show SSH public key",
        keywords: "git connect ssh",
    },
    CatalogEntry {
        input: "help",
        label: "Show key reminder",
        keywords: "shortcuts keys",
    },
    CatalogEntry {
        input: "quit",
        label: "Save and quit",
        keywords: "exit close",
    },
    CatalogEntry {
        input: "q!",
        label: "Quit without saving",
        keywords: "exit force discard",
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
        "ui" | "ui:next" => Command::NextUiStyle,
        "ui:frame" => Command::SetUiStyle(UiStyle::Frame),
        "ui:panes" => Command::SetUiStyle(UiStyle::Panes),
        "ui:focus" => Command::SetUiStyle(UiStyle::Focus),
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
    let mut scored: Vec<((u8, usize, usize), &CatalogEntry)> = CATALOG
        .iter()
        .filter_map(|entry| {
            let searchable =
                format!("{} {} {}", entry.input, entry.label, entry.keywords).to_lowercase();
            fuzzy_score(&needle, &searchable).map(|score| (score, entry))
        })
        .collect();
    scored.sort_by(|a, b| a.0.cmp(&b.0));
    scored
        .into_iter()
        .map(|(_, entry)| PaletteSuggestion {
            input: entry.input.to_string(),
            label: entry.label.to_string(),
            detail: entry.input.trim().to_string(),
        })
        .collect()
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
