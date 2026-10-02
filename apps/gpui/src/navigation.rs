use chrono::{Datelike, Local, NaiveDate, TimeZone};
use std::collections::{BTreeMap, HashSet};
use type_core::{ARCHIVE_FOLDER, FolderNode, NotePreviewEntry, STREAM_FOLDER};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum View {
    Feed,
    Folders,
    Trash,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Filter {
    All,
    #[default]
    Active,
    Reviewed,
    Unreviewed,
    Archived,
}
impl Filter {
    pub const ALL: [Self; 5] = [
        Self::All,
        Self::Active,
        Self::Reviewed,
        Self::Unreviewed,
        Self::Archived,
    ];
    pub fn label(self) -> &'static str {
        match self {
            Self::All => "All",
            Self::Active => "Active",
            Self::Reviewed => "Reviewed",
            Self::Unreviewed => "Unreviewed",
            Self::Archived => "Archived",
        }
    }
    pub fn matches(self, note: &NotePreviewEntry) -> bool {
        match self {
            Self::All => true,
            Self::Active => note.meta.archived_ms.is_none(),
            Self::Reviewed => note.meta.reviewed_ms.is_some(),
            Self::Unreviewed => note.meta.reviewed_ms.is_none() && note.meta.archived_ms.is_none(),
            Self::Archived => note.meta.archived_ms.is_some(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Item {
    pub id: String,
    pub label: String,
    pub folder: bool,
    pub synthetic: bool,
    pub children: Vec<Item>,
}
impl Item {
    fn note(note: &NotePreviewEntry) -> Self {
        Self {
            id: note.path.clone(),
            label: title(&note.content),
            folder: false,
            synthetic: false,
            children: vec![],
        }
    }
}

pub fn title(body: &str) -> String {
    // Skip tag-only lines; use the first prose/heading line, up to five words.
    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with(":::") {
            continue;
        }
        let heading = line.trim_start_matches('#');
        let text = if line.starts_with('#') && !heading.starts_with(char::is_whitespace) {
            line.split_whitespace()
                .skip_while(|word| word.starts_with('#'))
                .collect::<Vec<_>>()
                .join(" ")
        } else {
            heading.trim().to_string()
        };
        if !text.is_empty() {
            return text
                .split_whitespace()
                .take(5)
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(90)
                .collect();
        }
    }
    "New note".into()
}

pub fn folders(
    root: &FolderNode,
    notes: &std::collections::HashMap<String, NotePreviewEntry>,
) -> Vec<Item> {
    root.children
        .iter()
        .filter(|f| f.path != "_system")
        .map(|f| Item {
            id: f.path.clone(),
            label: f.name.clone(),
            folder: true,
            synthetic: false,
            children: folders(f, notes),
        })
        .chain(root.notes.iter().map(|entry| {
            notes.get(&entry.path).map(Item::note).unwrap_or(Item {
                id: entry.path.clone(),
                label: entry.name.clone(),
                folder: false,
                synthetic: false,
                children: vec![],
            })
        }))
        .collect()
}

pub fn note_paths(root: &FolderNode) -> Vec<String> {
    root.notes
        .iter()
        .map(|n| n.path.clone())
        .chain(root.children.iter().flat_map(note_paths))
        .collect()
}

/// Date groups are projections, never filesystem destinations. Assign a whole
/// ISO week to its Thursday's month so a month boundary cannot split it.
pub fn feed(
    notes: &std::collections::HashMap<String, NotePreviewEntry>,
    filter: Filter,
    today: NaiveDate,
    trash: bool,
) -> Vec<Item> {
    if !trash {
        return stream(notes, filter, today);
    }
    let folder = if trash { ARCHIVE_FOLDER } else { STREAM_FOLDER };
    let mut ordered: Vec<_> = notes
        .values()
        .filter(|n| {
            type_core::note_parent_folder_path(&n.path) == folder && (trash || filter.matches(n))
        })
        .collect();
    ordered.sort_by(|a, b| {
        b.meta
            .created_ms
            .cmp(&a.meta.created_ms)
            .then_with(|| b.path.cmp(&a.path))
    });
    let week = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let mut groups = BTreeMap::<String, Item>::new();
    for note in ordered {
        let date = note
            .meta
            .created_ms
            .and_then(|t| Local.timestamp_millis_opt(t).single())
            .map(|t| t.date_naive());
        let (key, label) = match date {
            Some(d) if d == today => ("9-today".into(), "Today".into()),
            Some(d) if Some(d) == today.pred_opt() => ("8-yesterday".into(), "Yesterday".into()),
            Some(d) if d >= week && d < today => ("7-week".into(), "This week".into()),
            Some(d) if d >= week - chrono::Duration::days(7) && d < week => {
                ("6-last-week".into(), "Last week".into())
            }
            Some(d) => {
                let monday = d - chrono::Duration::days(d.weekday().num_days_from_monday() as i64);
                let anchor = monday + chrono::Duration::days(3);
                (
                    format!("5-{}-{:02}", anchor.year(), anchor.month()),
                    anchor.format("%B %Y").to_string(),
                )
            }
            None => ("0-undated".into(), "Undated".into()),
        };
        let group = groups.entry(key.clone()).or_insert_with(|| Item {
            id: format!("feed:{key}"),
            label,
            folder: true,
            synthetic: true,
            children: vec![],
        });
        if key.starts_with("5-") {
            let d = date.unwrap();
            let iso = d.iso_week();
            let week_id = format!("feed:week:{}-{:02}", iso.year(), iso.week());
            let pos = group
                .children
                .iter()
                .position(|i| i.id == week_id)
                .unwrap_or_else(|| {
                    group.children.push(Item {
                        id: week_id.clone(),
                        label: format!("Week {}", iso.week()),
                        folder: true,
                        synthetic: true,
                        children: vec![],
                    });
                    group.children.len() - 1
                });
            group.children[pos].children.push(Item::note(note));
        } else {
            group.children.push(Item::note(note));
        }
    }
    groups.into_values().rev().collect()
}

fn bucket(id: String, label: String, children: Vec<Item>) -> Item {
    Item {
        id,
        label,
        folder: true,
        synthetic: true,
        children,
    }
}

/// Match the calendar hierarchy used by the desktop Stream: the current week
/// has a row for every elapsed day, and older notes sit under month/week/day.
fn stream(
    notes: &std::collections::HashMap<String, NotePreviewEntry>,
    filter: Filter,
    today: NaiveDate,
) -> Vec<Item> {
    let monday = today - chrono::Duration::days(today.weekday().num_days_from_monday() as i64);
    let mut days = BTreeMap::<NaiveDate, Vec<&NotePreviewEntry>>::new();
    let mut earlier = BTreeMap::<
        (i32, u32),
        BTreeMap<NaiveDate, BTreeMap<NaiveDate, Vec<&NotePreviewEntry>>>,
    >::new();
    let mut undated = Vec::new();
    for note in notes.values().filter(|note| {
        type_core::note_parent_folder_path(&note.path) == STREAM_FOLDER && filter.matches(note)
    }) {
        let date = note
            .meta
            .created_ms
            .or(note.meta.updated_ms)
            .and_then(|t| Local.timestamp_millis_opt(t).single())
            .map(|t| t.date_naive());
        match date {
            Some(date) if date >= monday && date <= today => {
                days.entry(date).or_default().push(note)
            }
            Some(date) => {
                let week =
                    date - chrono::Duration::days(date.weekday().num_days_from_monday() as i64);
                let owner = week + chrono::Duration::days(3);
                earlier
                    .entry((owner.year(), owner.month()))
                    .or_default()
                    .entry(week)
                    .or_default()
                    .entry(date)
                    .or_default()
                    .push(note);
            }
            None => undated.push(note),
        }
    }
    fn note_items(mut entries: Vec<&NotePreviewEntry>) -> Vec<Item> {
        entries.sort_by(|a, b| {
            b.meta
                .created_ms
                .or(b.meta.updated_ms)
                .cmp(&a.meta.created_ms.or(a.meta.updated_ms))
                .then_with(|| b.path.cmp(&a.path))
        });
        entries.into_iter().map(Item::note).collect()
    }
    let this_week = (0..=today.signed_duration_since(monday).num_days())
        .rev()
        .map(|offset| {
            let date = monday + chrono::Duration::days(offset);
            let label = if date == today {
                "Today".into()
            } else if date == today - chrono::Duration::days(1) {
                "Yesterday".into()
            } else {
                date.format("%A").to_string()
            };
            bucket(
                format!("feed:this-week:day:{}", date.format("%Y-%m-%d")),
                label,
                note_items(days.remove(&date).unwrap_or_default()),
            )
        })
        .collect();
    let mut earlier_items = Vec::new();
    for ((year, month), weeks) in earlier.into_iter().rev() {
        let mut week_items = Vec::new();
        for (monday, dates) in weeks.into_iter().rev() {
            let sunday = monday + chrono::Duration::days(6);
            let month_start = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
            let mut first_owned_week = month_start
                - chrono::Duration::days(month_start.weekday().num_days_from_monday() as i64);
            if (first_owned_week + chrono::Duration::days(3)).month() != month {
                first_owned_week += chrono::Duration::days(7);
            }
            let week_number = 1 + monday.signed_duration_since(first_owned_week).num_days() / 7;
            let first = if monday.month() == sunday.month() {
                monday.day().to_string()
            } else {
                monday.format("%-d %b").to_string()
            };
            let label = format!(
                "Week {} ({}–{})",
                week_number,
                first,
                sunday.format("%-d %b")
            );
            let day_items = dates
                .into_iter()
                .rev()
                .map(|(date, notes)| {
                    bucket(
                        format!("feed:day:{}", date.format("%Y-%m-%d")),
                        format!(
                            "{} ({} {})",
                            date.format("%A"),
                            date.day(),
                            date.format("%b")
                        ),
                        note_items(notes),
                    )
                })
                .collect();
            week_items.push(bucket(
                format!("feed:week:{}", monday.format("%G-%V")),
                label,
                day_items,
            ));
        }
        let month_date = NaiveDate::from_ymd_opt(year, month, 1).unwrap();
        let label = if year == today.year() {
            month_date.format("%B").to_string()
        } else {
            month_date.format("%B %Y").to_string()
        };
        earlier_items.push(bucket(
            format!("feed:month:{year}-{month:02}"),
            label,
            week_items,
        ));
    }
    if !undated.is_empty() {
        earlier_items.push(bucket(
            "feed:undated".into(),
            "Undated".into(),
            note_items(undated),
        ));
    }
    let mut result = vec![bucket(
        "feed:section:this-week".into(),
        "This week".into(),
        this_week,
    )];
    if !earlier_items.is_empty() {
        result.push(bucket(
            "feed:section:earlier".into(),
            "Earlier".into(),
            earlier_items,
        ));
    }
    result
}

pub fn contains(items: &[Item], id: &str) -> bool {
    items
        .iter()
        .any(|i| i.id == id || contains(&i.children, id))
}

pub fn visible<'a>(items: &'a [Item], expanded: &HashSet<String>) -> Vec<&'a Item> {
    items
        .iter()
        .flat_map(|i| {
            let mut rows = vec![i];
            if expanded.contains(&i.id) {
                rows.extend(visible(&i.children, expanded));
            }
            rows
        })
        .collect()
}

/// Palette destinations need only folder metadata, never note bodies/titles.
pub fn folder_destinations(root: &FolderNode) -> Vec<String> {
    root.children
        .iter()
        .filter(|f| !crate::backend::is_protected(&f.path))
        .flat_map(|f| std::iter::once(f.path.clone()).chain(folder_destinations(f)))
        .collect()
}

pub fn retain_day(
    items: &mut Vec<Item>,
    notes: &std::collections::HashMap<String, NotePreviewEntry>,
    day: NaiveDate,
) {
    items.retain_mut(|item| {
        if item.folder {
            retain_day(&mut item.children, notes, day);
            !item.children.is_empty()
        } else {
            notes
                .get(&item.id)
                .and_then(|n| n.meta.created_ms.or(n.meta.updated_ms))
                .and_then(|ms| Local.timestamp_millis_opt(ms).single())
                .is_some_and(|t| t.date_naive() == day)
        }
    });
}

pub fn destinations(items: &[Item]) -> Vec<String> {
    items
        .iter()
        .flat_map(|i| {
            let mut dirs = vec![];
            if i.folder && !i.synthetic && !crate::backend::is_protected(&i.id) {
                dirs.push(i.id.clone());
                dirs.extend(destinations(&i.children));
            }
            dirs
        })
        .collect()
}

pub fn move_suggestions(folders: &[String], query: &str) -> Vec<String> {
    let query = query.trim().to_lowercase();
    let mut matches: Vec<_> = folders
        .iter()
        .filter(|path| {
            let path = path.to_lowercase();
            if query.ends_with('/') {
                let tail = path.strip_prefix(&query);
                tail.is_some_and(|tail| !tail.is_empty() && !tail.contains('/'))
            } else if query.contains('/') {
                path.starts_with(&query)
            } else {
                let mut chars = query.chars();
                let mut next = chars.next();
                for ch in path.rsplit('/').next().unwrap_or("").chars() {
                    if Some(ch) == next {
                        next = chars.next();
                    }
                }
                next.is_none()
            }
        })
        .cloned()
        .collect();
    matches.sort();
    matches
}

#[cfg(test)]
mod tests {
    #[test]
    fn titles_use_prose_after_tags_and_at_most_five_words() {
        assert_eq!(super::title(""), "New note");
        assert_eq!(super::title("#work #idea\n\n"), "New note");
        assert_eq!(
            super::title("#work #idea\n\nПервая строка с содержанием заметки дальше"),
            "Первая строка с содержанием заметки"
        );
        assert_eq!(
            super::title("## Heading with six words in it"),
            "Heading with six words in"
        );
        assert_eq!(
            super::title("#work Some actual prose\nMore"),
            "Some actual prose"
        );
    }

    use super::*;
    fn note(path: &str, timestamp: i64) -> NotePreviewEntry {
        NotePreviewEntry {
            path: path.into(),
            version: None,
            content: "hello".into(),
            meta: type_core::NoteMeta {
                created_ms: Some(timestamp),
                updated_ms: None,
                note_type: None,
                archived_ms: None,
                reviewed_ms: None,
                tags: None,
                recording_audio_path: None,
                handwriting_attachment_path: None,
                transcription_status: None,
                transcription_error: None,
                transcription_updated_ms: None,
                ocr_status: None,
                ocr_error: None,
                ocr_updated_ms: None,
            },
        }
    }
    #[test]
    fn feed_groups_iso_week_across_months_once_and_orders_newest_first() {
        let mut notes = std::collections::HashMap::new();
        for date in ["2026-08-31", "2026-09-01", "2026-09-30"] {
            let d = NaiveDate::parse_from_str(date, "%Y-%m-%d").unwrap();
            let t = Local
                .from_local_datetime(&d.and_hms_opt(12, 0, 0).unwrap())
                .unwrap()
                .timestamp_millis();
            let p = format!("{STREAM_FOLDER}/{date}.md");
            notes.insert(p.clone(), note(&p, t));
        }
        let groups = feed(
            &notes,
            Filter::All,
            NaiveDate::from_ymd_opt(2026, 9, 30).unwrap(),
            false,
        );
        assert_eq!(groups[0].label, "This week");
        assert_eq!(groups[0].children[0].label, "Today");
        assert_eq!(groups[0].children.len(), 3); // Monday through Wednesday, including empty days
        assert_eq!(groups[1].label, "Earlier");
        assert_eq!(groups[1].children[0].label, "September");
        assert_eq!(groups[1].children[0].children.len(), 1); // boundary week belongs to September
        assert_eq!(groups[1].children[0].children[0].children.len(), 2); // Aug 31 and Sep 1
        fn collect_ids<'a>(items: &'a [Item], out: &mut HashSet<&'a str>) {
            for item in items {
                out.insert(&item.id);
                collect_ids(&item.children, out);
            }
        }
        let mut ids = HashSet::new();
        collect_ids(&groups, &mut ids);
        assert_eq!(ids.iter().filter(|id| id.ends_with(".md")).count(), 3);
    }
    #[test]
    fn filters_are_independent_and_empty_groups_disappear() {
        let p = format!("{STREAM_FOLDER}/a.md");
        let mut n = note(&p, 1);
        n.meta.archived_ms = Some(2);
        n.meta.reviewed_ms = Some(3);
        assert!(Filter::Reviewed.matches(&n));
        assert!(Filter::Archived.matches(&n));
        assert!(!Filter::Active.matches(&n));
        let map = [(p, n)].into();
        let active = feed(&map, Filter::Active, Local::now().date_naive(), false);
        assert_eq!(active.len(), 1); // current-week calendar remains visible when empty
        assert!(active[0].children.iter().all(|day| day.children.is_empty()));
    }
    #[test]
    fn collapsed_descendants_and_system_destinations_are_excluded() {
        let rows = vec![Item {
            id: "Work".into(),
            label: "Work".into(),
            folder: true,
            synthetic: false,
            children: vec![Item {
                id: "Work/a.md".into(),
                label: "a".into(),
                folder: false,
                synthetic: false,
                children: vec![],
            }],
        }];
        assert_eq!(visible(&rows, &HashSet::new()).len(), 1);
        assert_eq!(visible(&rows, &["Work".into()].into()).len(), 2);
        assert_eq!(destinations(&rows), vec!["Work"]);
        assert_eq!(
            move_suggestions(&["Work/Ideas".into(), "Work/Ideas/Deep".into()], "Work/"),
            vec!["Work/Ideas"]
        );
        assert_eq!(
            move_suggestions(&["Projects".into(), "Work".into()], "pj"),
            vec!["Projects"]
        );
    }
}
