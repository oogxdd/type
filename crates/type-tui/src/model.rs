//! View models derived from the core's `FolderNode` tree.
//!
//! The core hands back a recursive tree that already hides dot-entries and the
//! `Recordings` storage folder. All we add here is presentation state: which
//! folders are expanded, and how a note's preview text and badges are derived.

use std::collections::HashSet;

use type_core::{FolderNode, NotePreviewEntry};

/// One visible row in the folder pane.
pub struct FolderRow {
    pub path: String,
    pub name: String,
    /// Nesting level, used only for the indent prefix.
    pub depth: usize,
    pub expanded: bool,
    /// Drives the ▸ / ▾ marker; leaf folders get neither.
    pub has_children: bool,
}

/// Flatten the tree into the rows the folder pane draws, honouring collapse
/// state: a collapsed folder contributes its own row but none of its children.
///
/// The root node itself is not rendered — its children (`Feed`, `Archieve`, and
/// the user's folders) are the top level.
pub fn flatten_folders(root: &FolderNode, expanded: &HashSet<String>) -> Vec<FolderRow> {
    let mut rows = Vec::new();
    for child in &root.children {
        push_folder_rows(child, expanded, 0, &mut rows);
    }
    rows
}

fn push_folder_rows(
    node: &FolderNode,
    expanded: &HashSet<String>,
    depth: usize,
    rows: &mut Vec<FolderRow>,
) {
    let is_expanded = expanded.contains(&node.path);
    rows.push(FolderRow {
        path: node.path.clone(),
        name: node.name.clone(),
        depth,
        expanded: is_expanded,
        has_children: !node.children.is_empty(),
    });
    if is_expanded {
        for child in &node.children {
            push_folder_rows(child, expanded, depth + 1, rows);
        }
    }
}

/// Depth-first lookup of a folder by its root-relative path.
pub fn find_folder<'a>(root: &'a FolderNode, path: &str) -> Option<&'a FolderNode> {
    if root.path == path {
        return Some(root);
    }
    root.children
        .iter()
        .find_map(|child| find_folder(child, path))
}

/// Every folder path in the tree, used by `:mv` completion.
pub fn collect_folder_paths(root: &FolderNode, out: &mut Vec<String>) {
    for child in &root.children {
        out.push(child.path.clone());
        collect_folder_paths(child, out);
    }
}

/// One row in the note list.
#[derive(Clone, Debug)]
pub struct NoteRow {
    pub path: String,
    /// First meaningful line of the body, falling back to the file name.
    pub title: String,
    /// True when the note was created from an audio recording. This comes free
    /// from front matter (`recording_audio_path`) — no recordings code needed,
    /// which is why the TUI can skip the whole `recordings` feature.
    pub is_audio: bool,
    /// Creation and last-edit timestamps from front matter.
    ///
    /// The feed buckets by creation time first (matching the desktop), falling
    /// back to the edit time; the flat note list sorts newest-first by the same
    /// value so both views agree on ordering.
    pub created_ms: Option<i64>,
    pub updated_ms: Option<i64>,
}

impl NoteRow {
    /// The timestamp a feed bucket keys off: creation preferred, edit as a
    /// fallback, mirroring the desktop's `getFeedTimestamp`.
    pub fn feed_ts(&self) -> Option<i64> {
        self.created_ms.or(self.updated_ms)
    }
}

/// Build note rows from a bulk preview fetch.
///
/// `previews` may be shorter than the folder's note list: `list_note_previews`
/// silently skips notes that vanished or failed to decrypt, so a single broken
/// file cannot blank out the pane.
pub fn note_rows(previews: Vec<NotePreviewEntry>) -> Vec<NoteRow> {
    let mut rows: Vec<NoteRow> = previews
        .into_iter()
        .map(|entry| NoteRow {
            title: preview_title(&entry.content, &entry.path),
            is_audio: entry.meta.recording_audio_path.is_some(),
            created_ms: entry.meta.created_ms,
            updated_ms: entry.meta.updated_ms,
            path: entry.path,
        })
        .collect();
    // Newest first. Notes without any timestamp sink to the bottom rather than
    // jumping to the top, which is what `None` would do under a naive sort.
    rows.sort_by(|a, b| b.feed_ts().unwrap_or(i64::MIN).cmp(&a.feed_ts().unwrap_or(i64::MIN)));
    rows
}

/// Derive a one-line title: first non-blank line, with markdown heading and
/// list markers stripped. Falls back to the file name for empty notes.
fn preview_title(content: &str, path: &str) -> String {
    let line = content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or("");

    let cleaned = line
        .trim_start_matches('#')
        .trim_start_matches(['>', '-', '*', '+'])
        .trim();

    if cleaned.is_empty() {
        file_stem(path).to_string()
    } else {
        cleaned.chars().take(120).collect()
    }
}

/// File name without directories or the `.md` extension.
pub fn file_stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md").unwrap_or(name)
}

// ── Feed: synthetic time buckets ─────────────────────────────────────────
//
// The Feed folder is flat on disk — every note is a sibling. The desktop groups
// those siblings into a synthetic time tree so you can browse recent work by
// Today / Yesterday / This week / Last week / Month → Week → Day, with older
// months nesting under Year → Quarter. This is a straight port of the desktop's
// `feed-tree-model.ts`, in local time, using ISO weeks (Monday → Sunday).
//
// The TUI does not back-date new notes, so unlike the desktop we carry no range
// ms — only the labels, the routing, and a rank for newest-first ordering.

use std::cmp::Ordering;

use chrono::{Datelike, Days, Local, NaiveDate, TimeZone};

const DAY_MS: i64 = 86_400_000;
const WEEK_MS: i64 = 604_800_000;

/// A relative bucket at the top of the feed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpecialBucket {
    Today,
    Yesterday,
    ThisWeek,
    LastWeek,
    Undated,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FeedKind {
    Special(SpecialBucket),
    Year,
    Quarter,
    Month,
    Week,
    Day,
}

/// One node of the built feed tree.
#[derive(Clone, Debug)]
pub struct FeedBucket {
    pub id: String,
    pub label: String,
    pub kind: FeedKind,
    /// Newest-first ordering value: special buckets use a fixed tier; calendar
    /// buckets use the negated start-of-period timestamp.
    pub rank: i64,
    pub latest_ms: i64,
    pub children: Vec<FeedBucket>,
    pub notes: Vec<NoteRow>,
}

impl FeedBucket {
    /// Total notes anywhere beneath this node, including descendants.
    pub fn note_count(&self) -> usize {
        self.notes.len() + self.children.iter().map(Self::note_count).sum::<usize>()
    }
}

/// A visible row in the feed pane (a bucket, flattened with collapse state).
pub struct FeedRow {
    pub id: String,
    pub label: String,
    pub depth: usize,
    pub expanded: bool,
    /// `true` only where there are child buckets to reveal.
    pub has_children: bool,
    /// Notes anywhere beneath, shown as a count suffix.
    pub count: usize,
    /// What kind of bucket this is — used to emphasise relative buckets.
    pub kind: FeedKind,
}

/// Build the feed tree from a folder's note previews, newest-first.
///
/// Notes without a timestamp fall into a trailing "Undated" bucket.
pub fn build_feed_tree(notes: Vec<NoteRow>) -> Vec<FeedBucket> {
    let now = Local::now();
    let bounds = feed_boundaries(&now);
    let mut builder = FeedTreeBuilder::new();
    for note in notes {
        let Some(ts) = note.feed_ts() else {
            builder.add_undated(note);
            continue;
        };
        let dt = match Local.timestamp_millis_opt(ts).single() {
            Some(dt) => dt,
            None => {
                builder.add_undated(note);
                continue;
            }
        };
        builder.add_dated_note(note, ts, dt, &now, &bounds);
    }
    builder.into_buckets()
}

/// Flatten the feed tree into display rows honouring collapse state.
pub fn flatten_feed(buckets: &[FeedBucket], expanded: &HashSet<String>) -> Vec<FeedRow> {
    let mut rows = Vec::new();
    for bucket in buckets {
        push_feed_rows(bucket, expanded, 0, &mut rows);
    }
    rows
}

fn push_feed_rows(bucket: &FeedBucket, expanded: &HashSet<String>, depth: usize, rows: &mut Vec<FeedRow>) {
    let is_expanded = expanded.contains(&bucket.id);
    rows.push(FeedRow {
        id: bucket.id.clone(),
        label: bucket.label.clone(),
        depth,
        expanded: is_expanded,
        has_children: !bucket.children.is_empty(),
        count: bucket.note_count(),
        kind: bucket.kind.clone(),
    });
    if is_expanded {
        for child in &bucket.children {
            push_feed_rows(child, expanded, depth + 1, rows);
        }
    }
}

/// Find a bucket by id anywhere in the tree.
pub fn find_bucket<'a>(buckets: &'a [FeedBucket], id: &str) -> Option<&'a FeedBucket> {
    for bucket in buckets {
        if bucket.id == id {
            return Some(bucket);
        }
        if let Some(found) = find_bucket(&bucket.children, id) {
            return Some(found);
        }
    }
    None
}

/// Collect every note beneath a bucket (including its own), newest-first.
pub fn collect_bucket_notes(bucket: &FeedBucket) -> Vec<NoteRow> {
    let mut out: Vec<NoteRow> = Vec::new();
    collect_notes(bucket, &mut out);
    out.sort_by(|a, b| {
        b.feed_ts()
            .unwrap_or(i64::MIN)
            .cmp(&a.feed_ts().unwrap_or(i64::MIN))
    });
    out
}

fn collect_notes(bucket: &FeedBucket, out: &mut Vec<NoteRow>) {
    for note in &bucket.notes {
        out.push(note.clone());
    }
    for child in &bucket.children {
        collect_notes(child, out);
    }
}

// ── Building ──────────────────────────────────────────────────────────────

const ROOT: usize = 0;

/// Fixed ranks for the relative half — lowest renders first.
const RANK_TODAY: i64 = 0;
const RANK_YESTERDAY: i64 = 1;
const RANK_THIS_WEEK: i64 = 2;
const RANK_LAST_WEEK: i64 = 3;
const RANK_UNDATED: i64 = 99_999;

struct FeedBoundaries {
    today_start: i64,
    yesterday_start: i64,
    this_week_start: i64,
    /// Start of the previous ISO week; the seam between relative and calendar.
    calendar_cutoff: i64,
}

fn local_midnight_ms(date: NaiveDate) -> i64 {
    date.and_hms_opt(0, 0, 0)
        .and_then(|dt| Local.from_local_datetime(&dt).single())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

fn feed_boundaries(now: &chrono::DateTime<Local>) -> FeedBoundaries {
    let today = now.date_naive();
    let today_start = local_midnight_ms(today);
    let offset = now.weekday().num_days_from_monday() as i64;
    let monday = today
        .checked_sub_days(Days::new(offset as u64))
        .unwrap_or(today);
    let this_week_start = local_midnight_ms(monday);
    FeedBoundaries {
        today_start,
        yesterday_start: today_start - DAY_MS,
        this_week_start,
        calendar_cutoff: this_week_start - WEEK_MS,
    }
}

fn feed_id(segments: &[String]) -> String {
    let mut id = String::from("feed:");
    for (i, seg) in segments.iter().enumerate() {
        if i > 0 {
            id.push(':');
        }
        id.push_str(seg);
    }
    id
}

/// Monday of the note's week.
fn week_monday(dt: &chrono::DateTime<Local>) -> NaiveDate {
    let offset = dt.weekday().num_days_from_monday() as i64;
    dt.date_naive()
        .checked_sub_days(Days::new(offset as u64))
        .unwrap_or_else(|| dt.date_naive())
}

fn week_label(monday: NaiveDate) -> String {
    let n = monday.iso_week().week();
    let sunday = monday.checked_add_days(Days::new(6)).unwrap_or(monday);
    let start = format!("{} {}", monday.format("%b"), monday.day());
    let end = if monday.month() == sunday.month() {
        format!("{}", sunday.day())
    } else {
        format!("{} {}", sunday.format("%b"), sunday.day())
    };
    format!("Week {n} · {start} – {end}")
}

fn day_label(dt: &chrono::DateTime<Local>) -> String {
    format!("{} {}", dt.format("%A"), dt.day())
}

fn bucket_cmp(a: &FeedBucket, b: &FeedBucket) -> Ordering {
    a.rank
        .cmp(&b.rank)
        .then_with(|| b.latest_ms.cmp(&a.latest_ms))
        .then_with(|| a.label.cmp(&b.label))
}

struct Builder {
    id: String,
    label: String,
    kind: FeedKind,
    rank: i64,
    children: Vec<usize>,
    notes: Vec<NoteRow>,
    latest_ms: i64,
}

struct FeedTreeBuilder {
    nodes: Vec<Builder>,
    by_id: std::collections::HashMap<String, usize>,
}

impl FeedTreeBuilder {
    fn new() -> Self {
        let mut s = Self {
            nodes: Vec::new(),
            by_id: std::collections::HashMap::new(),
        };
        s.nodes.push(Builder {
            id: "feed:root".into(),
            label: "Feed".into(),
            kind: FeedKind::Special(SpecialBucket::Undated),
            rank: 0,
            children: Vec::new(),
            notes: Vec::new(),
            latest_ms: 0,
        });
        s
    }

    fn ensure_child(
        &mut self,
        parent: usize,
        id: String,
        label: String,
        kind: FeedKind,
        rank: i64,
    ) -> usize {
        if let Some(&existing) = self.by_id.get(&id) {
            return existing;
        }
        let idx = self.nodes.len();
        self.nodes.push(Builder {
            id: id.clone(),
            label,
            kind,
            rank,
            children: Vec::new(),
            notes: Vec::new(),
            latest_ms: 0,
        });
        self.by_id.insert(id, idx);
        self.nodes[parent].children.push(idx);
        idx
    }

    fn add_note(&mut self, node: usize, note: NoteRow, ts: i64) {
        if ts > self.nodes[node].latest_ms {
            self.nodes[node].latest_ms = ts;
        }
        self.nodes[node].notes.push(note);
    }

    fn add_undated(&mut self, note: NoteRow) {
        let id = "feed:undated".to_string();
        let node = self.ensure_child(
            ROOT,
            id,
            "Undated".into(),
            FeedKind::Special(SpecialBucket::Undated),
            RANK_UNDATED,
        );
        self.add_note(node, note, 0);
    }

    fn add_dated_note(
        &mut self,
        note: NoteRow,
        ts: i64,
        dt: chrono::DateTime<Local>,
        now: &chrono::DateTime<Local>,
        bounds: &FeedBoundaries,
    ) {
        if ts >= bounds.today_start {
            let node = self.ensure_child(
                ROOT,
                "feed:today".into(),
                "Today".into(),
                FeedKind::Special(SpecialBucket::Today),
                RANK_TODAY,
            );
            self.add_note(node, note, ts);
            return;
        }
        if ts >= bounds.yesterday_start {
            let node = self.ensure_child(
                ROOT,
                "feed:yesterday".into(),
                "Yesterday".into(),
                FeedKind::Special(SpecialBucket::Yesterday),
                RANK_YESTERDAY,
            );
            self.add_note(node, note, ts);
            return;
        }
        if ts >= bounds.this_week_start {
            let node = self.ensure_child(
                ROOT,
                "feed:this-week".into(),
                "This week".into(),
                FeedKind::Special(SpecialBucket::ThisWeek),
                RANK_THIS_WEEK,
            );
            self.add_note_to_day(node, vec!["this-week".into()], note, ts, &dt, now);
            return;
        }
        if ts >= bounds.calendar_cutoff {
            let node = self.ensure_child(
                ROOT,
                "feed:last-week".into(),
                "Last week".into(),
                FeedKind::Special(SpecialBucket::LastWeek),
                RANK_LAST_WEEK,
            );
            self.add_note_to_day(node, vec!["last-week".into()], note, ts, &dt, now);
            return;
        }
        self.add_note_to_calendar(note, ts, &dt, now);
    }

    /// A day row under any parent (a relative week or a calendar week).
    fn add_note_to_day(
        &mut self,
        parent: usize,
        parent_segs: Vec<String>,
        note: NoteRow,
        ts: i64,
        dt: &chrono::DateTime<Local>,
        _now: &chrono::DateTime<Local>,
    ) {
        let mut segs = parent_segs;
        segs.push("day".into());
        segs.push(dt.day().to_string());
        let id = feed_id(&segs);
        let label = day_label(dt);
        let rank = -local_midnight_ms(dt.date_naive());
        let day = self.ensure_child(parent, id, label, FeedKind::Day, rank);
        self.add_note(day, note, ts);
    }

    fn add_note_to_calendar(
        &mut self,
        note: NoteRow,
        ts: i64,
        dt: &chrono::DateTime<Local>,
        now: &chrono::DateTime<Local>,
    ) {
        let monday = week_monday(dt);
        // ISO ownership rule: the week belongs to the month of its Thursday.
        let thursday = monday.checked_add_days(Days::new(3)).unwrap_or(monday);
        let owner_year = thursday.year();
        let owner_month = thursday.month();

        let (month_node, month_segs) = self.ensure_calendar_month(owner_year, owner_month, now);

        let week_n = monday.iso_week().week();
        let mut week_segs = month_segs;
        week_segs.push("week".into());
        week_segs.push(week_n.to_string());
        let week_id = feed_id(&week_segs);
        let label = week_label(monday);
        let rank = -local_midnight_ms(monday);
        let week = self.ensure_child(month_node, week_id, label, FeedKind::Week, rank);
        self.add_note_to_day(week, week_segs, note, ts, dt, now);
    }

    /// Months of the running year sit at the root; older ones nest under
    /// Year → Quarter → Month.
    fn ensure_calendar_month(
        &mut self,
        year: i32,
        month: u32,
        now: &chrono::DateTime<Local>,
    ) -> (usize, Vec<String>) {
        let month_rank = 10 + (12 - month as i64);
        let month_date = NaiveDate::from_ymd_opt(year, month, 1);
        let month_label = month_date
            .map(|d| d.format("%B").to_string())
            .unwrap_or_else(|| format!("Month {month}"));

        if year == now.year() {
            let segs = vec!["month".into(), year.to_string(), month.to_string()];
            let id = feed_id(&segs);
            let node = self.ensure_child(ROOT, id, month_label, FeedKind::Month, month_rank);
            return (node, segs);
        }

        let year_segs = vec!["year".into(), year.to_string()];
        let year_id = feed_id(&year_segs);
        let year_node = self.ensure_child(
            ROOT,
            year_id,
            year.to_string(),
            FeedKind::Year,
            10_000 - year as i64,
        );

        let quarter = (month - 1) / 3 + 1;
        let q_segs = vec![
            "year".into(),
            year.to_string(),
            "quarter".into(),
            quarter.to_string(),
        ];
        let q_id = feed_id(&q_segs);
        let q_node = self.ensure_child(
            year_node,
            q_id,
            format!("Q{quarter}"),
            FeedKind::Quarter,
            4 - quarter as i64,
        );

        let month_segs = vec![
            "year".into(),
            year.to_string(),
            "quarter".into(),
            quarter.to_string(),
            "month".into(),
            month.to_string(),
        ];
        let month_id = feed_id(&month_segs);
        let month_node = self.ensure_child(q_node, month_id, month_label, FeedKind::Month, month_rank);
        (month_node, month_segs)
    }

    fn into_buckets(mut self) -> Vec<FeedBucket> {
        let root_children = std::mem::take(&mut self.nodes[ROOT].children);
        root_children
            .into_iter()
            .filter_map(|i| self.finalize_node(i))
            .collect()
    }

    fn finalize_node(&mut self, idx: usize) -> Option<FeedBucket> {
        let child_idxs = std::mem::take(&mut self.nodes[idx].children);
        let mut children: Vec<FeedBucket> = child_idxs
            .into_iter()
            .filter_map(|c| self.finalize_node(c))
            .collect();
        children.sort_by(bucket_cmp);

        let mut notes = std::mem::take(&mut self.nodes[idx].notes);
        let b = &self.nodes[idx];
        if notes.is_empty() && children.is_empty() {
            return None;
        }
        notes.sort_by(|a, c| {
            c.feed_ts()
                .unwrap_or(i64::MIN)
                .cmp(&a.feed_ts().unwrap_or(i64::MIN))
        });
        Some(FeedBucket {
            id: b.id.clone(),
            label: b.label.clone(),
            kind: b.kind.clone(),
            rank: b.rank,
            latest_ms: b.latest_ms,
            children,
            notes,
        })
    }
}

#[cfg(test)]
mod feed_tests {
    use super::*;
    use chrono::Local;

    const DAY_MS: i64 = 86_400_000;

    fn note(path: &str, created_ms: i64) -> NoteRow {
        NoteRow {
            path: path.into(),
            title: path.into(),
            is_audio: false,
            created_ms: Some(created_ms),
            updated_ms: Some(created_ms),
        }
    }

    fn now_ms() -> i64 {
        Local::now().timestamp_millis()
    }

    fn labels(buckets: &[FeedBucket]) -> Vec<String> {
        buckets.iter().map(|b| b.label.clone()).collect()
    }

    #[test]
    fn relative_buckets_route_and_order_newest_first() {
        let now = now_ms();
        let buckets = build_feed_tree(vec![
            note("Feed/today.md", now),
            note("Feed/yesterday.md", now - DAY_MS - 1),
        ]);
        let today = buckets.iter().position(|b| b.label == "Today").unwrap();
        let yesterday = buckets.iter().position(|b| b.label == "Yesterday").unwrap();
        assert!(today < yesterday, "{:?}", labels(&buckets));
    }

    #[test]
    fn undated_notes_collect_into_one_bucket() {
        let rows = vec![NoteRow {
            path: "Feed/x.md".into(),
            title: "x".into(),
            is_audio: false,
            created_ms: None,
            updated_ms: None,
        }];
        let buckets = build_feed_tree(rows);
        assert_eq!(buckets.len(), 1);
        assert_eq!(buckets[0].label, "Undated");
        assert_eq!(buckets[0].note_count(), 1);
    }

    #[test]
    fn collect_bucket_notes_walks_the_subtree() {
        let now = now_ms();
        let buckets = build_feed_tree(vec![
            note("Feed/today.md", now),
            note("Feed/yesterday.md", now - DAY_MS - 1),
        ]);
        let today = buckets.iter().find(|b| b.label == "Today").unwrap();
        assert_eq!(collect_bucket_notes(today).len(), 1);
    }

    #[test]
    fn a_month_bucket_counts_all_notes_beneath_it() {
        // Three notes spread across one calendar week ~10 weeks ago all land
        // under the same month, so the month's note_count must be 3 even though
        // its own `.notes` is empty (they live on day leaves).
        let now = now_ms();
        let base = now - DAY_MS * 70;
        let buckets = build_feed_tree(vec![
            note("Feed/a.md", base),
            note("Feed/b.md", base + DAY_MS),
            note("Feed/c.md", base + DAY_MS * 2),
        ]);
        let any_with_notes = buckets.iter().any(|b| b.note_count() == 3);
        assert!(any_with_notes, "{:?}", labels(&buckets));
    }

    #[test]
    fn flatten_only_shows_top_level_when_collapsed() {
        let now = now_ms();
        let buckets = build_feed_tree(vec![note("Feed/old.md", now - DAY_MS * 70)]);
        let rows = flatten_feed(&buckets, &HashSet::new());
        assert!(!rows.is_empty());
        assert!(
            rows.iter().all(|r| r.depth == 0),
            "collapsed feed must show only the top level"
        );
    }

    #[test]
    fn expanding_a_bucket_reveals_children() {
        let now = now_ms();
        let buckets = build_feed_tree(vec![note("Feed/old.md", now - DAY_MS * 70)]);
        let top = &buckets[0];
        let mut expanded = HashSet::new();
        expanded.insert(top.id.clone());
        let rows = flatten_feed(&buckets, &expanded);
        assert!(rows.iter().any(|r| r.depth == 1), "expanding must reveal children");
    }

    #[test]
    fn notes_from_last_year_nest_under_a_year_bucket() {
        // ~13 months ago crosses a year boundary, so the top-level bucket must
        // be the year (Year -> Quarter -> Month -> Week -> Day).
        let now = now_ms();
        let buckets = build_feed_tree(vec![note("Feed/last-year.md", now - DAY_MS * 400)]);
        assert!(!buckets.is_empty());
        assert_eq!(buckets[0].kind, FeedKind::Year, "expected a Year bucket, got {:?}", labels(&buckets));
        assert_eq!(buckets[0].note_count(), 1);
    }
}
