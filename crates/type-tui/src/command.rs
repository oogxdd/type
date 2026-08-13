//! The `:` command line.
//!
//! This is the TUI's answer to the desktop command palette, folded into vim's
//! command line so there is one prompt instead of two. `:mv` mirrors the
//! palette's move-mode, including fuzzy folder completion on Tab.

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
    scored.into_iter().map(|(_, _, path)| path.clone()).collect()
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
        assert_eq!(parse("mv personal/work"), Command::Move("personal/work".into()));
        assert_eq!(parse("new"), Command::New(None));
        assert_eq!(parse("new Feed"), Command::New(Some("Feed".into())));
        assert_eq!(parse("nope"), Command::Unknown("nope".into()));
        assert_eq!(parse("   "), Command::Empty);
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
}
