//! Rendering. Pure presentation.
//!
//! The same three data panes can be rendered with three chrome experiments:
//! one shared frame with rule-separated panels, three independent pane cards,
//! or a writing-focused hybrid. The status line always sits below the
//! workspace, so switching styles changes no behavior or note state.
//!
//! Each draw function receives the smallest sub-model it needs: the left and
//! middle panes get [`NavState`], the editor pane gets [`EditorState`], and
//! only the frame and status bar — which span everything — see [`App`].

use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{
        Block, BorderType, Borders, Clear, List, ListItem, ListState, Padding, Paragraph, Wrap,
    },
    Frame,
};

use crate::{
    app::{App, EditorState, EditorView, NavMode, NavState, Pane, PromptKind},
    command::UiStyle,
    model,
};

/// Accent for the focused pane, the active tab and the prompt.
const ACCENT: Color = Color::Cyan;
/// Everything the eye should skip: unfocused borders, hints, counts.
const MUTED: Color = Color::DarkGray;
/// A restrained header band: enough structure to name a panel without making
/// the whole panel read as a card or container.
const HEADER_BG: Color = Color::Indexed(236);
const FOCUSED_HEADER_BG: Color = Color::Indexed(24);

pub fn draw(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let [workspace, divider, status] = Layout::vertical([
        Constraint::Min(3),
        Constraint::Length(1),
        Constraint::Length(1),
    ])
    .areas(area);

    match app.ui_style {
        UiStyle::Frame => draw_frame_workspace(frame, app, workspace),
        UiStyle::Panes => draw_panes_workspace(frame, app, workspace),
        UiStyle::Focus => draw_focus_workspace(frame, app, workspace),
    }
    draw_status_divider(frame, divider);
    draw_status(frame, app, status);
    if app
        .prompt
        .as_ref()
        .is_some_and(|prompt| prompt.kind == PromptKind::Palette)
    {
        draw_palette(frame, app, area);
    }
}

/// Experiment A: one parent container, with the panels themselves reduced to
/// titles, whitespace, and two vertical rules.
fn draw_frame_workspace(frame: &mut Frame, app: &mut App, area: Rect) {
    let shell = workspace_frame(app);
    let body = shell.inner(area);
    frame.render_widget(shell, area);
    if app.panels_hidden {
        draw_editor(frame, &mut app.ed, true, false, PaneChrome::Open, body);
        return;
    }
    let [left, middle, right] = standard_columns(body);
    draw_left(
        frame,
        &app.nav,
        app.focus == Pane::Folders,
        PaneChrome::Divided,
        left,
    );
    draw_middle(
        frame,
        &app.nav,
        app.focus == Pane::Notes,
        PaneChrome::Divided,
        middle,
    );
    draw_editor(
        frame,
        &mut app.ed,
        app.focus == Pane::Editor,
        app.focus == Pane::Notes,
        PaneChrome::Open,
        right,
    );
}

/// Experiment B: no parent container. Each pane is its own card, with one cell
/// of breathing room between cards.
fn draw_panes_workspace(frame: &mut Frame, app: &mut App, area: Rect) {
    if app.panels_hidden {
        draw_editor(frame, &mut app.ed, true, false, PaneChrome::Boxed, area);
        return;
    }
    let [left, _, middle, _, right] = Layout::horizontal([
        Constraint::Percentage(25),
        Constraint::Length(1),
        Constraint::Percentage(27),
        Constraint::Length(1),
        Constraint::Min(24),
    ])
    .areas(area);
    draw_left(
        frame,
        &app.nav,
        app.focus == Pane::Folders,
        PaneChrome::Boxed,
        left,
    );
    draw_middle(
        frame,
        &app.nav,
        app.focus == Pane::Notes,
        PaneChrome::Boxed,
        middle,
    );
    draw_editor(
        frame,
        &mut app.ed,
        app.focus == Pane::Editor,
        app.focus == Pane::Notes,
        PaneChrome::Boxed,
        right,
    );
}

/// Experiment C: navigation reads as two light rails, while the editor is a
/// padded writing surface. It is intentionally asymmetric rather than a third
/// variation on "which boxes have borders".
fn draw_focus_workspace(frame: &mut Frame, app: &mut App, area: Rect) {
    if app.panels_hidden {
        draw_focus_editor(frame, &mut app.ed, true, false, area);
        return;
    }
    let [left, left_rule, middle, middle_rule, right] = Layout::horizontal([
        Constraint::Percentage(21),
        Constraint::Length(1),
        Constraint::Percentage(24),
        Constraint::Length(1),
        Constraint::Min(30),
    ])
    .areas(area);
    draw_focus_left(frame, &app.nav, app.focus == Pane::Folders, left);
    draw_vertical_divider(frame, left_rule);
    draw_focus_middle(frame, &app.nav, app.focus == Pane::Notes, middle);
    draw_vertical_divider(frame, middle_rule);
    draw_focus_editor(
        frame,
        &mut app.ed,
        app.focus == Pane::Editor,
        app.focus == Pane::Notes,
        right,
    );
}

fn standard_columns(area: Rect) -> [Rect; 3] {
    Layout::horizontal([
        Constraint::Percentage(26),
        Constraint::Percentage(27),
        Constraint::Min(24),
    ])
    .areas(area)
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
    Boxed,
    Divided,
    Open,
}

/// Build the same semantic pane with whichever chrome experiment is active.
/// Focus is always visible in the title and row highlight, even in modes that
/// intentionally have no focus-colored border.
fn pane_block(title: Line<'static>, focused: bool, chrome: PaneChrome) -> Block<'static> {
    let block = match chrome {
        PaneChrome::Boxed => Block::bordered().border_type(BorderType::Rounded),
        PaneChrome::Divided => Block::new().borders(Borders::RIGHT),
        PaneChrome::Open => Block::new(),
    };
    block
        .border_style(if focused { accent() } else { dim() })
        .title_top(title)
        .padding(Padding::horizontal(1))
}

fn pane_title(label: String, focused: bool) -> Line<'static> {
    Line::from(vec![
        Span::raw(" "),
        Span::styled(
            label,
            if focused {
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            },
        ),
        Span::raw(" "),
    ])
}

/// Header/body split used by the writing layout. The header is a real row,
/// not a title embedded in a border, and the body has no enclosing block.
fn focus_pane_areas(area: Rect) -> [Rect; 2] {
    Layout::vertical([Constraint::Length(1), Constraint::Min(1)]).areas(area)
}

fn draw_panel_header(
    frame: &mut Frame,
    area: Rect,
    left: Line<'static>,
    right: Option<Line<'static>>,
    focused: bool,
) {
    let style = Style::default()
        .bg(if focused {
            FOCUSED_HEADER_BG
        } else {
            HEADER_BG
        })
        .fg(if focused { Color::White } else { Color::Gray });
    frame.render_widget(Block::new().style(style), area);

    match right {
        Some(right) => {
            let right_width = (right.width() as u16).min(area.width);
            let [left_area, right_area] =
                Layout::horizontal([Constraint::Min(0), Constraint::Length(right_width)])
                    .areas(area);
            frame.render_widget(Paragraph::new(left).style(style), left_area);
            frame.render_widget(
                Paragraph::new(right)
                    .style(style)
                    .alignment(Alignment::Right),
                right_area,
            );
        }
        None => frame.render_widget(Paragraph::new(left).style(style), area),
    }
}

fn draw_vertical_divider(frame: &mut Frame, area: Rect) {
    frame.render_widget(
        Block::new().borders(Borders::LEFT).border_style(dim()),
        area,
    );
}

fn focus_body(area: Rect, horizontal_padding: u16) -> Rect {
    Block::new()
        .padding(Padding::horizontal(horizontal_padding))
        .inner(area)
}

fn draw_focus_left(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let [header, body] = focus_pane_areas(area);
    draw_panel_header(frame, header, nav_tabs(nav, focused), None, focused);
    let body = focus_body(body, 1);
    match nav.nav_mode {
        NavMode::Folders => draw_list(
            frame,
            folder_item_rows(&nav.folder_rows),
            "empty folder",
            nav.folder_cursor,
            focused,
            body,
        ),
        NavMode::Feed => draw_list(
            frame,
            feed_item_rows(&nav.feed_rows),
            "no feed notes",
            nav.folder_cursor,
            focused,
            body,
        ),
    }
}

fn draw_focus_middle(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let [header, body] = focus_pane_areas(area);
    let count = (!nav.notes.is_empty())
        .then(|| Line::from(Span::styled(format!(" {} ", nav.notes.len()), dim())));
    draw_panel_header(
        frame,
        header,
        pane_title(middle_title(nav), focused),
        count,
        focused,
    );
    draw_note_list(frame, nav, focused, focus_body(body, 1));
}

fn draw_focus_editor(
    frame: &mut Frame,
    ed: &mut EditorState,
    focused: bool,
    list_focused: bool,
    area: Rect,
) {
    let [header, body] = focus_pane_areas(area);
    let title = ed
        .editor
        .path
        .as_deref()
        .map(model::file_stem)
        .unwrap_or("—")
        .to_string();
    draw_panel_header(
        frame,
        header,
        pane_title(title, focused),
        editor_header_status(ed, focused, list_focused),
        focused,
    );
    draw_editor_body(frame, ed, focused, focus_body(body, 2));
}

fn editor_header_status(
    ed: &EditorState,
    focused: bool,
    list_focused: bool,
) -> Option<Line<'static>> {
    ed.editor.path.as_ref()?;
    let state = if ed.editor.is_dirty() {
        Span::styled("● unsaved", Style::default().fg(Color::Yellow))
    } else if !focused && list_focused {
        Span::styled("⏎ edit", dim())
    } else {
        Span::styled("saved", dim())
    };
    Some(Line::from(vec![
        Span::styled(
            format!(" {} · ", ed.view.label()),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        state,
        Span::raw(" "),
    ]))
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
    if app.panels_hidden {
        right.push(Span::styled(" panels hidden ", dim()));
    }
    if app.git_busy() {
        right.push(Span::styled(" ⟳ git… ", Style::default().fg(Color::Yellow)));
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

// ── Left pane: feed / folders ──────────────────────────────────────────────

fn draw_left(frame: &mut Frame, nav: &NavState, focused: bool, chrome: PaneChrome, area: Rect) {
    let block = pane_block(nav_tabs(nav, focused), focused, chrome);
    let body = block.inner(area);
    frame.render_widget(block, area);

    match nav.nav_mode {
        NavMode::Folders => draw_list(
            frame,
            folder_item_rows(&nav.folder_rows),
            "empty folder",
            nav.folder_cursor,
            focused,
            body,
        ),
        NavMode::Feed => draw_list(
            frame,
            feed_item_rows(&nav.feed_rows),
            "no feed notes",
            nav.folder_cursor,
            focused,
            body,
        ),
    }
}

/// The pane title doubles as the Feed / Folders tab strip — and shows only
/// `Folders` in a root that has no feed folder to switch to.
fn nav_tabs(nav: &NavState, focused: bool) -> Line<'static> {
    let mut spans = vec![Span::raw(" ")];
    if nav.feed_path.is_some() {
        spans.push(tab_span("Feed", nav.nav_mode == NavMode::Feed, focused));
        spans.push(Span::styled(" · ", dim()));
        spans.push(tab_span(
            "Folders",
            nav.nav_mode == NavMode::Folders,
            focused,
        ));
        spans.push(Span::styled(" ⇥ ", dim()));
    } else {
        spans.push(tab_span("Folders", true, focused));
        spans.push(Span::raw(" "));
    }
    Line::from(spans)
}

fn tab_span(label: &'static str, active: bool, focused: bool) -> Span<'static> {
    if active {
        Span::styled(
            label,
            if focused {
                accent().add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            },
        )
    } else {
        Span::styled(label, dim())
    }
}

fn folder_item_rows(rows: &[model::FolderRow]) -> Vec<ListItem<'static>> {
    rows.iter()
        .map(|row| {
            let marker = if row.has_children {
                if row.expanded {
                    "▾ "
                } else {
                    "▸ "
                }
            } else {
                "  "
            };
            let indent = "  ".repeat(row.depth);
            ListItem::new(Line::from(vec![
                Span::raw(indent),
                Span::styled(marker, dim()),
                Span::raw(row.name.clone()),
            ]))
        })
        .collect()
}

fn feed_item_rows(rows: &[model::FeedRow]) -> Vec<ListItem<'static>> {
    rows.iter()
        .map(|row| {
            let marker = if row.has_children {
                if row.expanded {
                    "▾ "
                } else {
                    "▸ "
                }
            } else {
                "· "
            };
            let indent = "  ".repeat(row.depth);
            let label_style = match row.kind {
                model::FeedKind::Special(_) => Style::default().add_modifier(Modifier::BOLD),
                _ => Style::default(),
            };
            let mut spans = vec![
                Span::raw(indent),
                Span::styled(marker, dim()),
                Span::styled(row.label.clone(), label_style),
            ];
            if row.count > 0 {
                spans.push(Span::styled(format!("  {}", row.count), dim()));
            }
            ListItem::new(Line::from(spans))
        })
        .collect()
}

// ── Middle pane: note list ─────────────────────────────────────────────────

fn draw_middle(frame: &mut Frame, nav: &NavState, focused: bool, chrome: PaneChrome, area: Rect) {
    let block = pane_block(pane_title(middle_title(nav), focused), focused, chrome).title_top(
        Line::from(vec![Span::styled(
            if nav.notes.is_empty() {
                String::new()
            } else {
                format!(" {} ", nav.notes.len())
            },
            dim(),
        )])
        .right_aligned(),
    );
    let body = block.inner(area);
    frame.render_widget(block, area);

    draw_note_list(frame, nav, focused, body);
}

fn draw_note_list(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let items: Vec<ListItem> = nav
        .notes
        .iter()
        .map(|row| {
            let mut spans = Vec::new();
            if row.is_audio {
                spans.push(Span::styled("♪ ", Style::default().fg(Color::Magenta)));
            }
            spans.push(Span::raw(row.title.clone()));
            ListItem::new(Line::from(spans))
        })
        .collect();

    draw_list(frame, items, "no notes", nav.note_cursor, focused, area);
}

fn middle_title(nav: &NavState) -> String {
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

// ── Right pane: editor ─────────────────────────────────────────────────────

fn draw_editor(
    frame: &mut Frame,
    ed: &mut EditorState,
    focused: bool,
    list_focused: bool,
    chrome: PaneChrome,
    area: Rect,
) {
    let title = match &ed.editor.path {
        Some(path) => model::file_stem(path).to_string(),
        None => "—".to_string(),
    };
    let mut block = pane_block(pane_title(title, focused), focused, chrome);
    if let Some(status) = editor_header_status(ed, focused, list_focused) {
        block = block.title_top(status.right_aligned());
    }
    let body = block.inner(area);
    frame.render_widget(block, area);

    draw_editor_body(frame, ed, focused, body);
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

// ── Status bar / prompt ────────────────────────────────────────────────────

fn draw_status_divider(frame: &mut Frame, area: Rect) {
    let rule = "─".repeat(area.width as usize);
    frame.render_widget(Paragraph::new(Span::styled(rule, dim())), area);
}

fn draw_status(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(prompt) = &app.prompt {
        if prompt.kind == PromptKind::Palette {
            frame.render_widget(
                Paragraph::new(Line::from(vec![
                    Span::styled(" COMMAND ", accent().add_modifier(Modifier::BOLD)),
                    Span::styled(" ↑↓ choose · Tab complete · Enter run · Esc close", dim()),
                ])),
                area,
            );
            return;
        }
        let sigil = match prompt.kind {
            PromptKind::Command => ':',
            PromptKind::Palette => unreachable!("palette renders as an overlay"),
        };
        let mut spans = vec![
            Span::styled(sigil.to_string(), accent()),
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

    let mode = if app.ed.view == EditorView::Markdown {
        "MARKDOWN"
    } else {
        app.ed.vim.mode.label()
    };
    let mode_colour = match app.focus {
        Pane::Editor => Color::Green,
        Pane::Notes => Color::Blue,
        Pane::Folders => Color::Magenta,
    };

    let spans = vec![
        Span::styled(
            format!(" {mode} "),
            Style::default()
                .bg(mode_colour)
                .fg(Color::Black)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw(" "),
        Span::raw(app.status.clone()),
    ];
    frame.render_widget(Paragraph::new(Line::from(spans)), area);

    // Context lives on the right in every chrome mode. This is where the
    // root remains visible in the no-parent `panes` and `focus` experiments.
    let pending = app.ed.vim.pending_hint();
    let mut right = Vec::new();
    if !pending.is_empty() {
        right.push(Span::styled(
            format!("{pending}  "),
            Style::default().fg(Color::Yellow),
        ));
    }
    if app.git_busy() {
        right.push(Span::styled("⟳ git  ", Style::default().fg(Color::Yellow)));
    }
    if app.panels_hidden {
        right.push(Span::styled("panels hidden  ", dim()));
    }
    right.push(Span::styled(
        format!("{}  ", app.ui_style.label()),
        accent(),
    ));
    if app.ed.editor.path.is_some() {
        right.push(Span::styled(format!("{}  ", app.ed.view.label()), dim()));
    }
    // The shared-frame layout already names the root in its top border. Not
    // repeating it here leaves enough room for the startup key reminder.
    if app.ui_style != UiStyle::Frame {
        right.push(Span::styled(display_root(&app.root_label), dim()));
    }
    frame.render_widget(
        Paragraph::new(Line::from(right)).alignment(Alignment::Right),
        area,
    );
}

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
        Block::new().style(Style::default().bg(HEADER_BG)),
        input_area,
    );
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
