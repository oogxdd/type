//! Rendering. Pure presentation.
//!
//! The same data panes can be rendered with three chrome experiments — one
//! shared frame with rule-separated panels, three independent pane cards, or a
//! writing-focused hybrid — and, independently of that, with the note list
//! either in its own column or nested inside the navigation tree
//! ([`NavLayout`]). The status line always sits below the workspace, so
//! switching either axis changes no behavior and no note state.
//!
//! Each draw function receives the smallest sub-model it needs: the navigation
//! and note panels get [`NavState`], the editor pane gets [`EditorState`], and
//! only the frame and status bar — which span everything — see [`App`].
//!
//! Two rules the layout keeps, because breaking them is what made earlier
//! versions look accidental:
//!
//!   * the header is **one continuous band** across the whole workspace. It is
//!     painted as a background patch after everything else, so it also covers
//!     the cells the vertical rules occupy instead of leaving an unstyled gap at
//!     each one.
//!   * a vertical rule runs the full height of whatever contains it and **joins**
//!     the horizontal line it meets — `┴` into the rule above the status line,
//!     `┬`/`┴` into the shared frame's own borders. A bare `│` above a bare `─`
//!     leaves the top half of a cell empty, which reads as a gap between two
//!     lines that are meant to touch.

use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    symbols,
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Clear, List, ListItem, ListState, Padding, Paragraph, Wrap,
    },
    Frame,
};

use crate::{
    app::{App, EditorState, EditorView, NavMode, NavState, Pane, PromptKind},
    command::{NavLayout, UiStyle},
    model,
};

/// Accent for the focused pane, the active tab and the prompt.
const ACCENT: Color = Color::Cyan;
/// Everything the eye should skip: unfocused borders, hints, counts.
const MUTED: Color = Color::DarkGray;

/// The header band. One background for every panel, focused or not — the old
/// version gave the focused panel a blue of its own and then wrote the
/// accent-coloured label on top of it, which is exactly the pairing that could
/// not be read.
const HEADER_BG: Color = Color::Indexed(235);
/// An unfocused panel's name: light enough to read on [`HEADER_BG`], quiet
/// enough that the focused panel's accent still wins the eye.
const HEADER_FG: Color = Color::Indexed(250);
/// Header furniture — inactive tabs, separators, counts, save state.
const HEADER_META_FG: Color = Color::Indexed(243);

/// Narrowest editor worth keeping; the navigation columns give up width first.
const MIN_EDITOR_WIDTH: u16 = 24;

/// The navigation panel's share of the width once the notes are nested in it.
///
/// It carries note titles now, so it is a little wider than a folders-only
/// column — but only a little. Handing it both split shares added up to nearly
/// half the screen, which is a note list that has taken over rather than a
/// navigation rail.
const NESTED_NAV_PERCENT: u16 = 25;

/// Rows below the workspace rule that belong to the status line.
///
/// One line of text, one row of chrome. Padding it out only took height away
/// from the notes and the editor, which is what the screen is actually for.
const STATUS_LANE_HEIGHT: u16 = 1;

pub fn draw(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    // `UiStyle::Frame` closes its own container with a bottom border, so a rule
    // under it would be one horizontal line too many.
    let rule_height = u16::from(app.ui_style != UiStyle::Frame);
    let [workspace, rule, status] = Layout::vertical([
        Constraint::Min(3),
        Constraint::Length(rule_height),
        Constraint::Length(STATUS_LANE_HEIGHT),
    ])
    .areas(area);

    let joins = match app.ui_style {
        UiStyle::Frame => draw_frame_workspace(frame, app, workspace),
        UiStyle::Panes => draw_panes_workspace(frame, app, workspace),
        UiStyle::Focus => draw_focus_workspace(frame, app, workspace),
    };
    if rule.height > 0 {
        draw_status_rule(frame, rule, &joins);
    }
    draw_status(frame, app, status);
    if app
        .prompt
        .as_ref()
        .is_some_and(|prompt| prompt.kind == PromptKind::Palette)
    {
        draw_palette(frame, app, area);
    }
}

// ── Column geometry ────────────────────────────────────────────────────────

/// The columns every chrome mode lays out, whatever it then draws around them.
struct Columns {
    nav: Rect,
    /// `None` in [`NavLayout::Nested`], where the notes live inside `nav`.
    notes: Option<Rect>,
    editor: Rect,
    /// The gaps between the columns. Zero-width when the caller asked for no
    /// gutter, in which case there is nothing to draw in them.
    gutters: Vec<Rect>,
}

/// Split a workspace into navigation / notes / editor.
///
/// `nav_pct` and `notes_pct` are the split layout's width percentages. In
/// [`NavLayout::Nested`] the note list has no column of its own, and the panel
/// that absorbs it keeps a rail's width — [`NESTED_NAV_PERCENT`] — rather than
/// both shares added together.
fn split_columns(
    area: Rect,
    layout: NavLayout,
    nav_pct: u16,
    notes_pct: u16,
    gutter: u16,
) -> Columns {
    match layout {
        NavLayout::Split => {
            let [nav, first, notes, second, editor] = Layout::horizontal([
                Constraint::Percentage(nav_pct),
                Constraint::Length(gutter),
                Constraint::Percentage(notes_pct),
                Constraint::Length(gutter),
                Constraint::Min(MIN_EDITOR_WIDTH),
            ])
            .areas(area);
            Columns {
                nav,
                notes: Some(notes),
                editor,
                gutters: vec![first, second],
            }
        }
        NavLayout::Nested => {
            let [nav, gap, editor] = Layout::horizontal([
                Constraint::Percentage(NESTED_NAV_PERCENT),
                Constraint::Length(gutter),
                Constraint::Min(MIN_EDITOR_WIDTH),
            ])
            .areas(area);
            Columns {
                nav,
                notes: None,
                editor,
                gutters: vec![gap],
            }
        }
    }
}

/// The workspace's first row — the one every panel puts its header in.
fn header_row(area: Rect) -> Rect {
    Rect {
        height: area.height.min(1),
        ..area
    }
}

// ── Workspace: the three chrome experiments ────────────────────────────────
//
// Each returns the x positions where a full-height vertical rule reaches the
// bottom of the workspace, so the horizontal rule below can join them.

/// Experiment A: one parent container, with the panels themselves reduced to
/// titles, whitespace, and vertical rules.
fn draw_frame_workspace(frame: &mut Frame, app: &mut App, area: Rect) -> Vec<u16> {
    let shell = workspace_frame(app);
    let body = shell.inner(area);
    frame.render_widget(shell, area);
    if app.panels_hidden {
        draw_editor(frame, &mut app.ed, true, false, PaneChrome::Open, body);
        return Vec::new();
    }
    let columns = split_columns(body, app.nav.layout, 26, 27, 1);
    draw_nav(
        frame,
        &app.nav,
        app.focus == Pane::Folders,
        PaneChrome::Open,
        columns.nav,
    );
    if let Some(notes) = columns.notes {
        draw_notes(
            frame,
            &app.nav,
            app.focus == Pane::Notes,
            PaneChrome::Open,
            notes,
        );
    }
    draw_editor(
        frame,
        &mut app.ed,
        app.focus == Pane::Editor,
        app.focus == Pane::Notes,
        PaneChrome::Open,
        columns.editor,
    );
    // The rules span the container, borders included, rather than the body it
    // encloses: a rule that stopped at the body left a gap at the top and the
    // bottom, so the panels read as floating inside the frame instead of
    // dividing it.
    for gutter in &columns.gutters {
        draw_container_rule(frame, gutter.x, area);
    }
    square_bottom_corners(frame, area);
    // The frame closes itself, so the status line needs no junctions below.
    Vec::new()
}

/// Experiment B: no parent container. Each pane is its own card, with one cell
/// of breathing room between cards.
fn draw_panes_workspace(frame: &mut Frame, app: &mut App, area: Rect) -> Vec<u16> {
    if app.panels_hidden {
        draw_editor(frame, &mut app.ed, true, false, PaneChrome::Boxed, area);
        return Vec::new();
    }
    let columns = split_columns(area, app.nav.layout, 25, 27, 1);
    draw_nav(
        frame,
        &app.nav,
        app.focus == Pane::Folders,
        PaneChrome::Boxed,
        columns.nav,
    );
    if let Some(notes) = columns.notes {
        draw_notes(
            frame,
            &app.nav,
            app.focus == Pane::Notes,
            PaneChrome::Boxed,
            notes,
        );
    }
    draw_editor(
        frame,
        &mut app.ed,
        app.focus == Pane::Editor,
        app.focus == Pane::Notes,
        PaneChrome::Boxed,
        columns.editor,
    );
    // Cards close themselves; a `┴` under the gap between two of them would be
    // a junction with nothing above it.
    Vec::new()
}

/// Experiment C: navigation reads as light rails and the editor is a padded
/// writing surface. It is intentionally asymmetric rather than a third variation
/// on "which boxes have borders".
fn draw_focus_workspace(frame: &mut Frame, app: &mut App, area: Rect) -> Vec<u16> {
    if app.panels_hidden {
        draw_focus_editor(frame, &mut app.ed, true, false, area);
        paint_header_band(frame, header_row(area));
        return Vec::new();
    }
    let columns = split_columns(area, app.nav.layout, 21, 24, 1);
    draw_focus_nav(frame, &app.nav, app.focus == Pane::Folders, columns.nav);
    if let Some(notes) = columns.notes {
        draw_focus_notes(frame, &app.nav, app.focus == Pane::Notes, notes);
    }
    draw_focus_editor(
        frame,
        &mut app.ed,
        app.focus == Pane::Editor,
        app.focus == Pane::Notes,
        columns.editor,
    );

    for gutter in &columns.gutters {
        draw_vertical_rule(frame, *gutter);
    }
    // Last, and background-only, so the band also covers the rules' header cells.
    paint_header_band(frame, header_row(area));
    columns.gutters.iter().map(|gutter| gutter.x).collect()
}

// ── Shared helpers ─────────────────────────────────────────────────────────

fn dim() -> Style {
    Style::default().fg(MUTED)
}

fn accent() -> Style {
    Style::default().fg(ACCENT)
}

#[derive(Clone, Copy)]
enum PaneChrome {
    /// A rounded container of its own.
    Boxed,
    /// No container at all: a title row and the body, nothing around them.
    Open,
}

/// Build the same semantic pane with whichever chrome experiment is active.
/// Focus is always visible in the title and row highlight, even in modes that
/// intentionally have no focus-colored border.
fn pane_block(title: Line<'static>, focused: bool, chrome: PaneChrome) -> Block<'static> {
    let block = match chrome {
        PaneChrome::Boxed => Block::bordered().border_type(BorderType::Rounded),
        PaneChrome::Open => Block::new(),
    };
    block
        .border_style(if focused { accent() } else { dim() })
        .title_top(title)
        .padding(Padding::horizontal(1))
}

/// A panel's name, as a header row or as a block title.
fn pane_title(label: String, focused: bool) -> Line<'static> {
    Line::from(vec![
        Span::raw(" "),
        Span::styled(label, header_label_style(focused)),
        Span::raw(" "),
    ])
}

/// How a panel name is set. Focus is carried by colour and weight only, which
/// stays legible whatever the terminal theme does.
fn header_label_style(focused: bool) -> Style {
    if focused {
        Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
    } else {
        Style::default().fg(HEADER_FG)
    }
}

fn header_meta() -> Style {
    Style::default().fg(HEADER_META_FG)
}

/// Header/body split used by the writing layout. The header is a real row, not a
/// title embedded in a border, and the body has no enclosing block.
fn focus_pane_areas(area: Rect) -> [Rect; 2] {
    Layout::vertical([Constraint::Length(1), Constraint::Min(1)]).areas(area)
}

/// The header band: one background strip across the whole workspace.
///
/// Applied as a style patch rather than a widget so it keeps every symbol already
/// in those cells — including the vertical rules, which is the whole point. A
/// band drawn per panel leaves an unstyled column at each rule, and that gap is
/// what made the header look like it stopped short of its panel's edge.
fn paint_header_band(frame: &mut Frame, area: Rect) {
    frame
        .buffer_mut()
        .set_style(area, Style::new().bg(HEADER_BG));
}

fn draw_panel_header(
    frame: &mut Frame,
    area: Rect,
    left: Line<'static>,
    right: Option<Line<'static>>,
) {
    match right {
        Some(right) => {
            let right_width = (right.width() as u16).min(area.width);
            let [left_area, right_area] =
                Layout::horizontal([Constraint::Min(0), Constraint::Length(right_width)])
                    .areas(area);
            frame.render_widget(Paragraph::new(left), left_area);
            frame.render_widget(
                Paragraph::new(right).alignment(Alignment::Right),
                right_area,
            );
        }
        None => frame.render_widget(Paragraph::new(left), area),
    }
}

fn draw_vertical_rule(frame: &mut Frame, area: Rect) {
    frame.render_widget(
        Block::new().borders(Borders::LEFT).border_style(dim()),
        area,
    );
}

/// A rule down column `x` spanning a bordered container, `┬`/`┴` into its top and
/// bottom borders so the three lines meet.
///
/// The junctions are only written where that border cell is still plain `─`. The
/// frame puts its titles on the top border row, and overwriting a character of
/// the notes-root path with a junction would be a worse trade than a rule that
/// starts one row down.
fn draw_container_rule(frame: &mut Frame, x: u16, container: Rect) {
    let buffer = frame.buffer_mut();
    if !buffer.area.contains((x, container.y).into()) {
        return;
    }
    let bottom = container.y + container.height.saturating_sub(1);
    for y in container.y..=bottom {
        let cell = &mut buffer[(x, y)];
        let junction = y == container.y || y == bottom;
        if junction && cell.symbol() != symbols::line::HORIZONTAL {
            continue;
        }
        cell.set_symbol(if !junction {
            symbols::line::VERTICAL
        } else if y == container.y {
            symbols::line::HORIZONTAL_DOWN
        } else {
            symbols::line::HORIZONTAL_UP
        });
        cell.set_style(dim());
    }
}

/// Square off a container's bottom corners so the line that closes it reaches
/// both edges of the terminal.
///
/// `╰` and `╯` only ink half of their cell — the stroke turns upward at the
/// middle — so the container's closing line, which is also the line separating
/// the workspace from the status bar, stops one cell short at each end. `┴` inks
/// the full cell width and still meets the side borders coming down into it.
fn square_bottom_corners(frame: &mut Frame, container: Rect) {
    if container.width == 0 || container.height == 0 {
        return;
    }
    let y = container.y + container.height - 1;
    let right = container.x + container.width - 1;
    let buffer = frame.buffer_mut();
    for x in [container.x, right] {
        if buffer.area.contains((x, y).into()) {
            buffer[(x, y)].set_symbol(symbols::line::HORIZONTAL_UP);
        }
    }
}

fn focus_body(area: Rect, horizontal_padding: u16) -> Rect {
    Block::new()
        .padding(Padding::horizontal(horizontal_padding))
        .inner(area)
}

// ── Navigation panel ───────────────────────────────────────────────────────

/// The rows the navigation panel draws, for whichever layout and nav mode.
fn nav_items(nav: &NavState) -> Vec<ListItem<'static>> {
    match (nav.layout, nav.nav_mode) {
        (NavLayout::Nested, _) => nested_item_rows(&nav.nav_rows),
        (NavLayout::Split, NavMode::Folders) => folder_item_rows(&nav.folder_rows),
        (NavLayout::Split, NavMode::Feed) => feed_item_rows(&nav.feed_rows),
    }
}

fn nav_empty_label(nav: &NavState) -> &'static str {
    match nav.nav_mode {
        NavMode::Folders => "empty folder",
        NavMode::Feed => "no feed notes",
    }
}

fn draw_nav(frame: &mut Frame, nav: &NavState, focused: bool, chrome: PaneChrome, area: Rect) {
    let block = pane_block(nav_tabs(nav, focused), focused, chrome);
    let body = block.inner(area);
    frame.render_widget(block, area);
    draw_list(
        frame,
        nav_items(nav),
        nav_empty_label(nav),
        nav.folder_cursor,
        focused,
        body,
    );
}

fn draw_focus_nav(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let [header, body] = focus_pane_areas(area);
    draw_panel_header(frame, header, nav_tabs(nav, focused), None);
    draw_list(
        frame,
        nav_items(nav),
        nav_empty_label(nav),
        nav.folder_cursor,
        focused,
        focus_body(body, 1),
    );
}

/// The panel name doubles as the Feed / Folders tab strip — and shows only
/// `Folders` in a root that has no feed folder to switch to.
fn nav_tabs(nav: &NavState, focused: bool) -> Line<'static> {
    let mut spans = vec![Span::raw(" ")];
    if nav.feed_path.is_some() {
        spans.push(tab_span("Feed", nav.nav_mode == NavMode::Feed, focused));
        spans.push(Span::styled(" · ", header_meta()));
        spans.push(tab_span(
            "Folders",
            nav.nav_mode == NavMode::Folders,
            focused,
        ));
    } else {
        spans.push(tab_span("Folders", true, focused));
    }
    spans.push(Span::raw(" "));
    Line::from(spans)
}

fn tab_span(label: &'static str, active: bool, focused: bool) -> Span<'static> {
    if active {
        Span::styled(label, header_label_style(focused))
    } else {
        Span::styled(label, header_meta())
    }
}

/// `▾` / `▸` for a row that can be opened, two spaces for one that cannot — so
/// the labels stay aligned either way.
fn tree_marker(expandable: bool, expanded: bool) -> &'static str {
    match (expandable, expanded) {
        (true, true) => "▾ ",
        (true, false) => "▸ ",
        (false, _) => "  ",
    }
}

fn folder_item_rows(rows: &[model::FolderRow]) -> Vec<ListItem<'static>> {
    rows.iter()
        .map(|row| {
            ListItem::new(Line::from(vec![
                Span::raw("  ".repeat(row.depth)),
                Span::styled(tree_marker(row.has_children, row.expanded), dim()),
                Span::raw(row.name.clone()),
            ]))
        })
        .collect()
}

fn feed_item_rows(rows: &[model::FeedRow]) -> Vec<ListItem<'static>> {
    rows.iter()
        .map(|row| {
            let mut spans = vec![
                Span::raw("  ".repeat(row.depth)),
                Span::styled(tree_marker(row.has_children, row.expanded), dim()),
                Span::styled(
                    row.label.clone(),
                    bucket_label_style(matches!(row.kind, model::FeedKind::Special(_))),
                ),
            ];
            if row.count > 0 {
                spans.push(Span::styled(format!("  {}", row.count), dim()));
            }
            ListItem::new(Line::from(spans))
        })
        .collect()
}

/// The nested layout's rows: containers and the notes inside them, one list.
fn nested_item_rows(rows: &[model::NavRow]) -> Vec<ListItem<'static>> {
    rows.iter()
        .map(|row| {
            let mut spans = vec![Span::raw("  ".repeat(row.depth))];
            match &row.kind {
                model::NavRowKind::Container {
                    expanded,
                    expandable,
                    count,
                    emphasised,
                    ..
                } => {
                    spans.push(Span::styled(tree_marker(*expandable, *expanded), dim()));
                    spans.push(Span::styled(
                        row.label.clone(),
                        bucket_label_style(*emphasised),
                    ));
                    if *count > 0 {
                        spans.push(Span::styled(format!("  {count}"), dim()));
                    }
                }
                model::NavRowKind::Note { is_audio, .. } => {
                    spans.push(note_marker(*is_audio));
                    spans.push(Span::raw(row.label.clone()));
                }
            }
            ListItem::new(Line::from(spans))
        })
        .collect()
}

fn bucket_label_style(emphasised: bool) -> Style {
    if emphasised {
        Style::default().add_modifier(Modifier::BOLD)
    } else {
        Style::default()
    }
}

fn note_marker(is_audio: bool) -> Span<'static> {
    if is_audio {
        Span::styled("♪ ", Style::default().fg(Color::Magenta))
    } else {
        Span::styled("· ", dim())
    }
}

// ── Note list panel (split layout only) ────────────────────────────────────

fn draw_notes(frame: &mut Frame, nav: &NavState, focused: bool, chrome: PaneChrome, area: Rect) {
    let mut block = pane_block(pane_title(notes_title(nav), focused), focused, chrome);
    if let Some(count) = note_count(nav) {
        block = block.title_top(count.right_aligned());
    }
    let body = block.inner(area);
    frame.render_widget(block, area);
    draw_note_list(frame, nav, focused, body);
}

fn draw_focus_notes(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let [header, body] = focus_pane_areas(area);
    draw_panel_header(
        frame,
        header,
        pane_title(notes_title(nav), focused),
        note_count(nav),
    );
    draw_note_list(frame, nav, focused, focus_body(body, 1));
}

fn note_count(nav: &NavState) -> Option<Line<'static>> {
    (!nav.notes.is_empty()).then(|| {
        Line::from(Span::styled(
            format!(" {} ", nav.notes.len()),
            header_meta(),
        ))
    })
}

fn draw_note_list(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let items: Vec<ListItem> = nav
        .notes
        .iter()
        .map(|row| {
            let mut spans = Vec::new();
            if row.is_audio {
                spans.push(note_marker(true));
            }
            spans.push(Span::raw(row.title.clone()));
            ListItem::new(Line::from(spans))
        })
        .collect();

    draw_list(frame, items, "no notes", nav.note_cursor, focused, area);
}

fn notes_title(nav: &NavState) -> String {
    match nav.nav_mode {
        NavMode::Folders => match nav.open_folder.as_deref() {
            // The root row's path is empty — name it after the folder itself.
            Some(model::ROOT_PATH) => nav.root_name.clone(),
            Some(path) => path.to_string(),
            None => "—".into(),
        },
        NavMode::Feed => nav
            .active_feed_id
            .as_deref()
            .and_then(|id| {
                nav.feed_rows
                    .iter()
                    .find(|row| row.id == id)
                    .map(|row| row.label.clone())
            })
            .unwrap_or_else(|| "Feed".into()),
    }
}

fn empty_list(label: &'static str) -> List<'static> {
    List::new(vec![ListItem::new(Span::styled(label, dim()))])
}

fn selection_style(focused: bool) -> Style {
    if focused {
        Style::default()
            .bg(MUTED)
            .fg(Color::White)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().add_modifier(Modifier::BOLD)
    }
}

/// Draw a list with the shared selection treatment: a bar in the gutter marks
/// the cursor row even when the pane is unfocused and the highlight is faint.
fn draw_list(
    frame: &mut Frame,
    items: Vec<ListItem<'static>>,
    empty: &'static str,
    cursor: usize,
    focused: bool,
    area: Rect,
) {
    let is_empty = items.is_empty();
    let list = if is_empty {
        empty_list(empty)
    } else {
        List::new(items)
            .highlight_style(selection_style(focused))
            .highlight_symbol(if focused { "▌" } else { "▏" })
    };
    let mut state = ListState::default();
    if !is_empty {
        state.select(Some(cursor));
    }
    frame.render_stateful_widget(list, area, &mut state);
}

// ── Optional parent frame ──────────────────────────────────────────────────

fn workspace_frame(app: &App) -> Block<'static> {
    let mut right = Vec::new();
    if app.git_busy() {
        right.push(Span::styled(" ⟳ git ", Style::default().fg(Color::Yellow)));
    }
    right.push(Span::styled(
        format!(" {} ", display_root(&app.root_label)),
        dim(),
    ));

    Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(dim())
        .title_top(Line::from(vec![Span::styled(
            " type ",
            accent().add_modifier(Modifier::BOLD),
        )]))
        .title_top(Line::from(right).right_aligned())
        .padding(Padding::horizontal(1))
}

/// `$HOME/notes` reads better as `~/notes`, and a long path is cut from the
/// left so the part that identifies the folder survives.
fn display_root(path: &str) -> String {
    let shortened = match dirs::home_dir() {
        Some(home) => match path.strip_prefix(home.to_string_lossy().as_ref()) {
            Some(rest) => format!("~{rest}"),
            None => path.to_string(),
        },
        None => path.to_string(),
    };
    if shortened.chars().count() <= 48 {
        return shortened;
    }
    let tail: String = shortened
        .chars()
        .skip(shortened.chars().count() - 45)
        .collect();
    format!("…{tail}")
}

// ── Editor pane ────────────────────────────────────────────────────────────

fn draw_editor(
    frame: &mut Frame,
    ed: &mut EditorState,
    focused: bool,
    list_focused: bool,
    chrome: PaneChrome,
    area: Rect,
) {
    let mut block = pane_block(pane_title(editor_title(ed), focused), focused, chrome);
    if let Some(status) = editor_header_status(ed, focused, list_focused) {
        block = block.title_top(status.right_aligned());
    }
    let body = block.inner(area);
    frame.render_widget(block, area);

    draw_editor_body(frame, ed, focused, body);
}

fn draw_focus_editor(
    frame: &mut Frame,
    ed: &mut EditorState,
    focused: bool,
    list_focused: bool,
    area: Rect,
) {
    let [header, body] = focus_pane_areas(area);
    draw_panel_header(
        frame,
        header,
        pane_title(editor_title(ed), focused),
        editor_header_status(ed, focused, list_focused),
    );
    draw_editor_body(frame, ed, focused, focus_body(body, 1));
}

fn editor_title(ed: &EditorState) -> String {
    ed.editor
        .path
        .as_deref()
        .map(model::file_stem)
        .unwrap_or("—")
        .to_string()
}

/// The editor's right-hand header text.
///
/// Only what changes: whether the buffer is saved, and — because source is the
/// default — the view when it is *not* source. The status bar deliberately no
/// longer repeats any of it.
fn editor_header_status(
    ed: &EditorState,
    focused: bool,
    list_focused: bool,
) -> Option<Line<'static>> {
    ed.editor.path.as_ref()?;
    let mut spans = Vec::new();
    if ed.view == EditorView::Markdown {
        spans.push(Span::styled(
            format!("{} · ", ed.view.label()),
            header_meta(),
        ));
    }
    spans.push(if ed.editor.is_dirty() {
        Span::styled("● unsaved", Style::default().fg(Color::Yellow))
    } else if !focused && list_focused {
        Span::styled("⏎ edit", header_meta())
    } else {
        Span::styled("saved", header_meta())
    });
    spans.push(Span::raw(" "));
    Some(Line::from(spans))
}

fn draw_editor_body(frame: &mut Frame, ed: &mut EditorState, focused: bool, body: Rect) {
    if ed.editor.path.is_none() {
        frame.render_widget(
            Paragraph::new(Span::styled("Enter on a note to edit, or :new", dim())),
            body,
        );
        return;
    }

    if ed.view == EditorView::Markdown {
        let markdown = ed.editor.text();
        let rendered = tui_markdown::from_str(&markdown);
        let paragraph = Paragraph::new(rendered).wrap(Wrap { trim: false });
        let max_scroll = paragraph
            .line_count(body.width)
            .saturating_sub(body.height as usize)
            .min(u16::MAX as usize) as u16;
        ed.markdown_scroll = ed.markdown_scroll.min(max_scroll);
        frame.render_widget(paragraph.scroll((ed.markdown_scroll, 0)), body);
        return;
    }

    ed.editor.area.set_block(Block::default());
    ed.editor.area.set_cursor_style(if focused {
        Style::default().add_modifier(Modifier::REVERSED)
    } else {
        Style::default()
    });
    frame.render_widget(&ed.editor.area, body);
}

// ── Status lane ────────────────────────────────────────────────────────────

/// The rule between the workspace and the status line, full width.
///
/// Where a pane rule comes down to meet it the two are joined with `┴`: a bare
/// `│` above a bare `─` leaves the top half of the rule's cell empty, which
/// reads as a gap between two lines that are meant to touch.
fn draw_status_rule(frame: &mut Frame, area: Rect, joins: &[u16]) {
    let mut cells = vec!['─'; area.width as usize];
    for x in joins {
        if let Some(cell) = x
            .checked_sub(area.x)
            .and_then(|index| cells.get_mut(index as usize))
        {
            *cell = '┴';
        }
    }
    let rule: String = cells.into_iter().collect();
    frame.render_widget(Paragraph::new(Span::styled(rule, dim())), area);
}

/// The one row inside the status lane that carries text, centered in it.
fn status_line(lane: Rect) -> Rect {
    Rect {
        y: lane.y + lane.height / 2,
        height: lane.height.min(1),
        ..lane
    }
}

fn draw_status(frame: &mut Frame, app: &App, lane: Rect) {
    let area = status_line(lane);
    if let Some(prompt) = &app.prompt {
        if prompt.kind == PromptKind::Palette {
            // The popup already carries its own key hints; repeating them here
            // put two copies of the same sentence on screen at once.
            frame.render_widget(
                Paragraph::new(Line::from(Span::styled(
                    " COMMAND ",
                    accent().add_modifier(Modifier::BOLD),
                ))),
                area,
            );
            return;
        }
        let mut spans = vec![
            Span::styled(":", accent()),
            Span::raw(prompt.input.clone()),
            Span::styled("█", accent()),
        ];
        if !prompt.completions.is_empty() {
            spans.push(Span::styled(
                format!(
                    "   [{}/{}]",
                    prompt.completion_index + 1,
                    prompt.completions.len()
                ),
                dim(),
            ));
        }
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
        return;
    }

    frame.render_widget(
        Paragraph::new(Line::from(vec![
            mode_chip(app),
            Span::raw(" "),
            Span::raw(app.status.clone()),
        ])),
        area,
    );

    // Only live state goes on the right. Which chrome experiment is active,
    // which editor view is showing and whether the panels are hidden are all
    // visible on screen already, so naming them here was information the status
    // line did not need to carry.
    let mut right = Vec::new();
    let pending = app.ed.vim.pending_hint();
    if !pending.is_empty() {
        right.push(Span::styled(
            format!("{pending}  "),
            Style::default().fg(Color::Yellow),
        ));
    }
    if app.git_busy() {
        right.push(Span::styled("⟳ git  ", Style::default().fg(Color::Yellow)));
    }
    // The shared-frame layout already names the root in its top border.
    if app.ui_style != UiStyle::Frame {
        right.push(Span::styled(display_root(&app.root_label), dim()));
    }
    frame.render_widget(
        Paragraph::new(Line::from(right)).alignment(Alignment::Right),
        area,
    );
}

/// The vim-style mode indicator: which pane has the keys, and in the editor
/// which mode it is in.
fn mode_chip(app: &App) -> Span<'static> {
    let (label, colour) = match app.focus {
        Pane::Editor if app.ed.view == EditorView::Markdown => ("MARKDOWN", Color::Cyan),
        Pane::Editor => (app.ed.vim.mode.label(), Color::Green),
        Pane::Notes => ("NOTES", Color::Blue),
        Pane::Folders => ("NAV", Color::Magenta),
    };
    Span::styled(
        format!(" {label} "),
        Style::default()
            .bg(colour)
            .fg(Color::Black)
            .add_modifier(Modifier::BOLD),
    )
}

// ── Command palette ────────────────────────────────────────────────────────

/// Discoverable command surface shared by `/` and Cmd/Ctrl+K. It deliberately
/// floats over the panes: opening it never reshapes the workspace underneath.
fn draw_palette(frame: &mut Frame, app: &App, area: Rect) {
    let Some(prompt) = app.prompt.as_ref() else {
        return;
    };
    let group_count = prompt
        .suggestions
        .iter()
        .map(|row| row.group)
        .fold(Vec::new(), |mut groups, group| {
            if groups.last() != Some(&group) {
                groups.push(group);
            }
            groups
        })
        .len() as u16;
    let content_rows = prompt.suggestions.len() as u16 + group_count.saturating_mul(2);
    let popup_height = content_rows
        .saturating_add(4)
        .clamp(8, 24)
        .min(area.height.saturating_sub(2).max(1));
    let popup_width = area
        .width
        .saturating_mul(4)
        .saturating_div(5)
        .clamp(30, 78)
        .min(area.width);
    let popup = Rect {
        x: area.x + area.width.saturating_sub(popup_width) / 2,
        y: area.y + area.height.saturating_sub(popup_height) / 2,
        width: popup_width,
        height: popup_height,
    };

    frame.render_widget(Clear, popup);
    let block = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(accent())
        .title_top(Line::from(vec![
            Span::styled(" commands ", accent().add_modifier(Modifier::BOLD)),
            Span::styled(format!(" {} found ", prompt.suggestions.len()), dim()),
        ]))
        .padding(Padding::horizontal(1));
    let inner = block.inner(popup);
    frame.render_widget(block, popup);

    let [input_area, list_area, hint_area] = Layout::vertical([
        Constraint::Length(1),
        Constraint::Min(1),
        Constraint::Length(1),
    ])
    .areas(inner);
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(" / ", accent().add_modifier(Modifier::BOLD)),
            Span::raw(prompt.input.clone()),
            Span::styled("▏", accent()),
        ]))
        .style(Style::default().bg(HEADER_BG)),
        input_area,
    );

    let mut lines = Vec::new();
    let mut selected_line = 0usize;
    let mut previous_group = None;
    for (index, row) in prompt.suggestions.iter().enumerate() {
        if previous_group != Some(row.group) {
            if previous_group.is_some() {
                lines.push(Line::raw(""));
            }
            lines.push(Line::from(Span::styled(
                format!(" {}  {} ", row.group.icon(), row.group.label()),
                accent().add_modifier(Modifier::BOLD),
            )));
            previous_group = Some(row.group);
        }
        if index == prompt.suggestion_index {
            selected_line = lines.len();
        }
        let line = Line::from(vec![
            Span::raw(if index == prompt.suggestion_index {
                " › "
            } else {
                "   "
            }),
            Span::styled(format!("{}  ", row.icon), accent()),
            Span::raw(row.label.clone()),
            Span::styled(format!("   {}", row.detail), dim()),
        ]);
        lines.push(if index == prompt.suggestion_index {
            line.style(selection_style(true))
        } else {
            line
        });
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(" no matching commands", dim())));
    }
    let viewport = list_area.height as usize;
    let max_scroll = lines.len().saturating_sub(viewport);
    let scroll = if viewport == 0 {
        0
    } else {
        selected_line
            .saturating_add(1)
            .saturating_sub(viewport)
            .min(max_scroll) as u16
    };
    frame.render_widget(Paragraph::new(lines).scroll((scroll, 0)), list_area);
    frame.render_widget(
        Paragraph::new(Span::styled(
            "↑↓ choose · Tab complete · Enter run · Esc close",
            dim(),
        )),
        hint_area,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{app::App, test_support::Fixture};
    use ratatui::{backend::TestBackend, buffer::Buffer, Terminal};

    const WIDTH: u16 = 80;
    const HEIGHT: u16 = 16;

    fn render(app: &mut App) -> Buffer {
        let mut terminal = Terminal::new(TestBackend::new(WIDTH, HEIGHT)).expect("terminal");
        terminal.draw(|frame| draw(frame, app)).expect("draw");
        terminal.backend().buffer().clone()
    }

    fn row(buffer: &Buffer, y: u16) -> String {
        (0..buffer.area.width)
            .map(|x| buffer[(x, y)].symbol())
            .collect()
    }

    /// Where `draw` puts each band, for a terminal of [`HEIGHT`] rows:
    /// the workspace's last row, the rule row if the style draws one, and the
    /// status line.
    fn bands(style: UiStyle) -> (u16, Option<u16>, u16) {
        let rule = u16::from(style != UiStyle::Frame);
        let workspace_height = HEIGHT - rule - STATUS_LANE_HEIGHT;
        let rule_y = (rule == 1).then_some(workspace_height);
        (
            workspace_height - 1,
            rule_y,
            workspace_height + rule + STATUS_LANE_HEIGHT / 2,
        )
    }

    #[test]
    fn the_header_band_is_one_continuous_strip() {
        // The band used to be painted per panel, which left the vertical rules'
        // cells unstyled — a gap that read as the header not reaching the edge
        // of its panel.
        let fixture = Fixture::new();
        for mut app in [fixture.app(), fixture.nested_app()] {
            app.ui_style = UiStyle::Focus;
            let buffer = render(&mut app);
            let unbanded: Vec<u16> = (0..WIDTH)
                .filter(|&x| buffer[(x, 0)].bg != HEADER_BG)
                .collect();
            assert!(unbanded.is_empty(), "unbanded header columns: {unbanded:?}");
        }
    }

    #[test]
    fn pane_rules_run_to_the_bottom_and_join_the_status_rule() {
        let fixture = Fixture::new();
        let mut app = fixture.app();
        app.ui_style = UiStyle::Focus;
        let buffer = render(&mut app);
        let (last_workspace_row, rule_y, _) = bands(UiStyle::Focus);
        let rule_y = rule_y.expect("writing layout draws a rule");

        let joins: Vec<u16> = (0..WIDTH)
            .filter(|&x| buffer[(x, rule_y)].symbol() == "┴")
            .collect();
        assert_eq!(joins.len(), 2, "expected one junction per pane rule");
        for x in joins {
            assert_eq!(
                buffer[(x, last_workspace_row)].symbol(),
                "│",
                "junction at {x} has no rule above it"
            );
        }
    }

    #[test]
    fn the_status_rule_spans_the_full_width() {
        let fixture = Fixture::new();
        for style in [UiStyle::Focus, UiStyle::Panes] {
            let mut app = fixture.app();
            app.ui_style = style;
            let buffer = render(&mut app);
            let (_, rule_y, _) = bands(style);
            let rule = row(&buffer, rule_y.expect("rule"));
            assert_eq!(rule.chars().count(), WIDTH as usize);
            assert!(
                rule.chars().all(|cell| cell == '─' || cell == '┴'),
                "{style:?} rule is not full width: {rule:?}"
            );
        }
    }

    #[test]
    fn the_shared_frame_draws_no_second_rule_under_itself() {
        // The frame closes with its own bottom border; a rule below it would be
        // one horizontal line too many.
        let fixture = Fixture::new();
        let mut app = fixture.app();
        app.ui_style = UiStyle::Frame;
        let buffer = render(&mut app);
        let (frame_bottom, rule_y, _) = bands(UiStyle::Frame);
        assert!(rule_y.is_none(), "the frame layout reserves no rule row");
        let below = row(&buffer, frame_bottom + 1);
        assert!(
            below.contains("NAV") && !below.starts_with("──"),
            "expected the status line directly under the frame, got {below:?}"
        );
    }

    #[test]
    fn the_frame_closes_with_a_line_that_reaches_both_edges() {
        // `╰` and `╯` ink only half their cell, so the line that separates the
        // workspace from the status bar stopped one cell short at each end.
        let fixture = Fixture::new();
        let mut app = fixture.app();
        app.ui_style = UiStyle::Frame;
        let buffer = render(&mut app);
        let (frame_bottom, _, _) = bands(UiStyle::Frame);
        let closing = row(&buffer, frame_bottom);
        assert_eq!(closing.chars().count(), WIDTH as usize);
        assert!(
            closing.chars().all(|cell| cell == '─' || cell == '┴'),
            "the closing line has cells that do not ink the full width: {closing:?}"
        );
    }

    #[test]
    fn the_shared_frame_rules_span_it_from_border_to_border() {
        // Rules drawn inside the frame's *body* left a gap at the top and the
        // bottom, so the panels floated in the container instead of dividing it.
        let fixture = Fixture::new();
        let mut app = fixture.app();
        app.ui_style = UiStyle::Frame;
        let buffer = render(&mut app);
        let (frame_bottom, _, _) = bands(UiStyle::Frame);

        let tops: Vec<u16> = (0..WIDTH)
            .filter(|&x| buffer[(x, 0)].symbol() == "┬")
            .collect();
        assert_eq!(
            tops.len(),
            2,
            "expected a junction per rule in the top border"
        );
        for x in tops {
            assert_eq!(buffer[(x, frame_bottom)].symbol(), "┴");
            for y in 1..frame_bottom {
                assert_eq!(buffer[(x, y)].symbol(), "│", "rule breaks at row {y}");
            }
        }
    }

    #[test]
    fn the_status_line_is_a_single_row() {
        // One line of text, one row of chrome: padding it out only took height
        // away from the notes and the editor.
        assert_eq!(STATUS_LANE_HEIGHT, 1);
        let fixture = Fixture::new();
        let mut app = fixture.app();
        app.ui_style = UiStyle::Focus;
        let buffer = render(&mut app);
        let (_, _, status_y) = bands(UiStyle::Focus);
        assert_eq!(status_y, HEIGHT - 1, "the status line is the last row");
        assert!(row(&buffer, status_y).contains("NAV"));
    }

    #[test]
    fn nesting_keeps_the_navigation_panel_to_a_rail() {
        // Absorbing the note list must not hand it both split shares — that came
        // to nearly half the screen.
        let fixture = Fixture::new();
        let mut split = fixture.app();
        let mut nested = fixture.nested_app();
        for app in [&mut split, &mut nested] {
            app.ui_style = UiStyle::Focus;
        }
        let rule_x = |buffer: &Buffer, y: u16| (0..WIDTH).find(|&x| buffer[(x, y)].symbol() == "│");
        let (last_row, _, _) = bands(UiStyle::Focus);
        let split_nav = rule_x(&render(&mut split), last_row).expect("a rule");
        let nested_nav = rule_x(&render(&mut nested), last_row).expect("a rule");
        assert!(
            nested_nav > split_nav && nested_nav <= WIDTH / 3,
            "nested nav is {nested_nav} columns wide (split: {split_nav}, cap: {})",
            WIDTH / 3
        );
    }

    #[test]
    fn the_status_line_no_longer_repeats_what_the_panels_show() {
        let fixture = Fixture::new();
        let mut app = fixture.app();
        app.ui_style = UiStyle::Focus;
        let buffer = render(&mut app);
        let (_, _, status_y) = bands(UiStyle::Focus);
        let status = row(&buffer, status_y);
        for repeated in ["writing", "source"] {
            assert!(
                !status.contains(repeated),
                "{repeated:?} is already visible elsewhere: {status:?}"
            );
        }
    }

    #[test]
    fn the_editor_gutter_carries_vim_style_line_numbers() {
        let fixture = Fixture::new();
        let mut app = fixture.app();
        app.ui_style = UiStyle::Focus;
        app.ed.editor.open(
            "projects/beta/plan.md".to_string(),
            "beta plan\nsecond line\nthird line\n".to_string(),
        );
        let buffer = render(&mut app);
        let lines: Vec<String> = (0..HEIGHT).map(|y| row(&buffer, y)).collect();
        for (number, text) in [(1, "beta plan"), (2, "second line"), (3, "third line")] {
            let line = lines
                .iter()
                .find(|line| line.contains(text))
                .unwrap_or_else(|| panic!("{text:?} is not on screen"));
            assert!(
                line.contains(&format!("{number} {text}")),
                "line {number} has no number in the gutter: {line:?}"
            );
        }
    }

    #[test]
    fn the_nested_layout_draws_notes_inside_their_bucket() {
        let fixture = Fixture::new();
        let mut app = fixture.nested_app();
        app.ui_style = UiStyle::Focus;
        let buffer = render(&mut app);
        let bucket = (0..HEIGHT)
            .map(|y| row(&buffer, y))
            .position(|line| line.contains("Today"))
            .expect("a Today bucket") as u16;
        let note = row(&buffer, bucket + 1);
        assert!(
            note.contains("alpha note"),
            "expected a nested note: {note:?}"
        );
        // One column of navigation, so exactly one rule to the editor.
        let (_, rule_y, _) = bands(UiStyle::Focus);
        let joins = (0..WIDTH)
            .filter(|&x| buffer[(x, rule_y.expect("rule"))].symbol() == "┴")
            .count();
        assert_eq!(joins, 1);
    }
}
