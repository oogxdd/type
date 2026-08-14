//! Rendering. Pure presentation.
//!
//! The whole app lives inside one rounded frame: a title bar naming the open
//! root, three bordered panes (navigation / notes / editor), and a status line
//! along the bottom. The focused pane is the one with the accent border, which
//! is the only chrome that changes as you move around — everything else stays
//! put, so the layout never shifts under you.
//!
//! Each draw function receives the smallest sub-model it needs: the left and
//! middle panes get [`NavState`], the editor pane gets [`EditorState`], and
//! only the frame and status bar — which span everything — see [`App`].

use ratatui::{
    layout::{Alignment, Constraint, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, List, ListItem, ListState, Padding, Paragraph},
    Frame,
};

use crate::{
    app::{App, EditorState, NavMode, NavState, Pane, PromptKind},
    model,
};

/// Accent for the focused pane, the active tab and the prompt.
const ACCENT: Color = Color::Cyan;
/// Everything the eye should skip: unfocused borders, hints, counts.
const MUTED: Color = Color::DarkGray;

pub fn draw(frame: &mut Frame, app: &mut App) {
    let area = frame.area();
    let shell = shell_block(app);
    let inner = shell.inner(area);
    frame.render_widget(shell, area);

    let [body, status] =
        Layout::vertical([Constraint::Min(3), Constraint::Length(1)]).areas(inner);

    let focus = app.focus;
    if app.panels_hidden {
        // Ctrl+T: the editor gets the whole frame.
        draw_editor(frame, &mut app.ed, focus == Pane::Editor, false, body);
    } else {
        let [left, middle, right] = Layout::horizontal([
            Constraint::Percentage(26),
            Constraint::Percentage(27),
            Constraint::Min(24),
        ])
        .areas(body);
        draw_left(frame, &app.nav, focus == Pane::Folders, left);
        draw_middle(frame, &app.nav, focus == Pane::Notes, middle);
        draw_editor(
            frame,
            &mut app.ed,
            focus == Pane::Editor,
            focus == Pane::Notes,
            right,
        );
    }
    draw_status(frame, app, status);
}

// ── Shared helpers ─────────────────────────────────────────────────────────

fn dim() -> Style {
    Style::default().fg(MUTED)
}

fn accent() -> Style {
    Style::default().fg(ACCENT)
}

/// The pane frame. Its border is the focus indicator, so every pane is drawn
/// the same way and only the colour differs.
fn pane_block(title: Line<'static>, focused: bool) -> Block<'static> {
    Block::bordered()
        .border_type(BorderType::Rounded)
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
                Style::default()
                    .fg(ACCENT)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default().add_modifier(Modifier::BOLD)
            },
        ),
        Span::raw(" "),
    ])
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

// ── The frame around everything ────────────────────────────────────────────

fn shell_block(app: &App) -> Block<'static> {
    let mut right = Vec::new();
    if app.panels_hidden {
        right.push(Span::styled(" panels hidden ", dim()));
    }
    if app.git_busy() {
        right.push(Span::styled(
            " ⟳ git… ",
            Style::default().fg(Color::Yellow),
        ));
    }
    right.push(Span::styled(
        format!(" {} ", display_root(&app.root_label)),
        dim(),
    ));

    Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(dim())
        .title_top(Line::from(vec![
            Span::styled(" type ", accent().add_modifier(Modifier::BOLD)),
        ]))
        .title_top(Line::from(right).right_aligned())
        .title_bottom(
            Line::from(vec![Span::styled(
                " ^w pane · ^t panels · : commands ",
                dim(),
            )])
            .right_aligned(),
        )
        .padding(Padding::new(1, 1, 0, 0))
}

// ── Left pane: feed / folders ──────────────────────────────────────────────

fn draw_left(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let block = pane_block(nav_tabs(nav, focused), focused);
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

fn draw_middle(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let block = pane_block(pane_title(middle_title(nav), focused), focused).title_top(
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

    draw_list(frame, items, "no notes", nav.note_cursor, focused, body);
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
    area: Rect,
) {
    let title = match &ed.editor.path {
        Some(path) => model::file_stem(path).to_string(),
        None => "—".to_string(),
    };
    let mut block = pane_block(pane_title(title, focused), focused);
    if ed.editor.path.is_some() {
        let marker = if ed.editor.is_dirty() {
            Span::styled(" ● unsaved ", Style::default().fg(Color::Yellow))
        } else if !focused && list_focused {
            Span::styled(" ⏎ to edit ", dim())
        } else {
            Span::styled(" saved ", dim())
        };
        block = block.title_top(Line::from(vec![marker]).right_aligned());
    }
    let body = block.inner(area);
    frame.render_widget(block, area);

    if ed.editor.path.is_none() {
        frame.render_widget(
            Paragraph::new(Span::styled("Enter on a note to edit, or :new", dim())),
            body,
        );
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

fn draw_status(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(prompt) = &app.prompt {
        let sigil = match prompt.kind {
            PromptKind::Command => ':',
            PromptKind::Search => '/',
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

    let mode = app.ed.vim.mode.label();
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

    // Half-typed vim sequences sit on the right so a pending `d` or `12` is
    // visible without pushing the status message around.
    let pending = app.ed.vim.pending_hint();
    if !pending.is_empty() {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                pending,
                Style::default().fg(Color::Yellow),
            )))
            .alignment(Alignment::Right),
            area,
        );
    }
}
