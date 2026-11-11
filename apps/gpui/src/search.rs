//! Grep-style literal search: scan disk on demand, retain only bounded results.
use crate::{backend::Backend, navigation};
use std::{
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

pub const LIMIT: usize = 100;
#[derive(Clone, Debug)]
pub struct Hit {
    pub path: String,
    pub title: String,
    pub snippet: String,
}
#[derive(Default)]
pub struct Results {
    pub hits: Vec<Hit>,
    pub total: usize,
    pub skipped: usize,
}

/// No index, startup work, subprocess dependency or retained note corpus.
/// Core reads strip frontmatter and decrypt bodies only while unlocked.
pub fn scan(backend: &Backend, query: &str, cancel: &AtomicBool) -> Result<Results, String> {
    let terms: Vec<_> = query.split_whitespace().collect();
    let matchers = terms
        .iter()
        .map(|term| {
            regex::RegexBuilder::new(&regex::escape(term))
                .case_insensitive(true)
                .build()
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut results = Results::default();
    if terms.is_empty() || cancel.load(Ordering::Relaxed) {
        return Ok(results);
    }
    let notes = backend.notes()?;
    walk(&backend.root, "", cancel, &mut |path| {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        match notes.read_note(path) {
            Ok(body) => {
                if !matchers
                    .iter()
                    .all(|matcher| matcher.is_match(&body) || matcher.is_match(path))
                {
                    return;
                }
                results.total += 1;
                if results.hits.len() < LIMIT {
                    results.hits.push(Hit {
                        path: path.to_owned(),
                        title: navigation::title(&body),
                        snippet: excerpt(&body, &matchers),
                    });
                }
            }
            Err(_) => results.skipped += 1,
        }
    })?;
    Ok(results)
}

fn walk(
    root: &Path,
    relative: &str,
    cancel: &AtomicBool,
    visit: &mut impl FnMut(&str),
) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        return Ok(());
    }
    let mut entries = std::fs::read_dir(root.join(relative))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    entries.sort_unstable_by_key(|entry| entry.file_name());
    for entry in entries {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        if path == "AGENTS.md"
            || (path.starts_with("_system/")
                && path != "_system/stream"
                && !path.starts_with("_system/stream/"))
        {
            continue;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        // Never follow symlinks outside the selected profile or into cycles.
        if kind.is_dir() {
            walk(root, &path, cancel, visit)?;
        } else if kind.is_file() && name.ends_with(".md") {
            visit(&path);
        }
    }
    Ok(())
}

fn excerpt(body: &str, matchers: &[regex::Regex]) -> String {
    let line = body
        .lines()
        .find(|line| matchers.iter().any(|matcher| matcher.is_match(line)))
        .unwrap_or_else(|| body.lines().next().unwrap_or(""));
    let found = matchers
        .iter()
        .filter_map(|matcher| matcher.find(line).map(|hit| hit.start()))
        .min()
        .unwrap_or(0);
    let at = line[..found].chars().count();
    let start = at.saturating_sub(50);
    let text: String = line.chars().skip(start).take(180).collect();
    format!("{}{}", if start > 0 { "…" } else { "" }, text)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(Backend);
    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "type-search-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            Self(Backend::new(type_core::AppEnv::new(dir)).unwrap())
        }
        fn write(&self, path: &str, body: &str) {
            let path = self.0.root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, body).unwrap();
        }
        fn search(&self, query: &str) -> Results {
            scan(&self.0, query, &AtomicBool::new(false)).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0.env.app_data_dir);
        }
    }
    #[test]
    fn disk_search_handles_full_bodies_unicode_scope_edits_and_cancellation() {
        let f = Fixture::new();
        f.write(
            "Work/a.md",
            &format!(
                "---\nsecret: metadataonly\n---\nOther\n{}\nПРИВЕТ мир",
                "padding\n".repeat(500)
            ),
        );
        f.write("_system/stream/b.md", "Привет мир\nİstanbul 🦀");
        for path in [
            "_system/agent/memory.md",
            "_system/archive/trash.md",
            ".hidden/note.md",
            "Work/.hidden.md",
            "AGENTS.md",
        ] {
            f.write(path, "Привет мир");
        }
        assert_eq!(f.search("привет МИР").total, 2);
        assert_eq!(f.search("padding мир").total, 1);
        assert_eq!(f.search("metadataonly").total, 0);
        assert_eq!(f.search("Work/a").total, 1);
        assert_eq!(f.search("  ").total, 0);
        assert!(f.search("İSTANBUL 🦀").hits[0].snippet.contains("İstanbul"));
        f.write("Work/a.md", "Changed");
        assert_eq!(f.search("привет мир").total, 1);
        std::fs::rename(f.0.root.join("Work/a.md"), f.0.root.join("Work/moved.md")).unwrap();
        assert_eq!(f.search("Changed").hits[0].path, "Work/moved.md");
        std::fs::remove_file(f.0.root.join("Work/moved.md")).unwrap();
        assert_eq!(f.search("Changed").total, 0);
        assert_eq!(scan(&f.0, "мир", &AtomicBool::new(true)).unwrap().total, 0);
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&f.0.root, f.0.root.join("loop")).unwrap();
            assert_eq!(f.search("мир").total, 1);
        }
    }
    #[test]
    fn benchmark_3000_notes_on_disk() {
        let f = Fixture::new();
        for n in 0..3000 {
            f.write(
                &format!("Work/{n:04}.md"),
                &format!(
                    "Note {n}\n{}\nneedle{n} конец",
                    "English текст заметки. ".repeat(500)
                ),
            );
        }
        let mut timings = Vec::new();
        for query in [
            "текст",
            "absent",
            "needle2999",
            "заметки конец",
            "NEEDLE",
            "Work/0001",
        ] {
            let start = std::time::Instant::now();
            let result = f.search(query);
            timings.push((query, start.elapsed()));
            assert!(result.hits.len() <= LIMIT);
            if query == "needle2999" {
                assert_eq!(result.total, 1);
            }
            if query == "текст" {
                assert_eq!(result.total, 3000);
                assert_eq!(result.hits.len(), LIMIT);
            }
        }
        eprintln!("3000 files (~18KB each), real core reads, query times={timings:?}");
    }
}
