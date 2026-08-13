//! Rendering. Pure presentation — every value drawn here already lives in `App`.

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::{
    app::{App, NavMode, Pane, PromptKind},
    model,
};

/// Accent colour for the focused pane's divider and the mode label.
const FOCUSED: Color = Color::Cyan;

pub fn draw(frame: &mut Frame, app: &mut App) {
    // One line at the bottom for the status bar / prompt.
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(3), Constraint::Length(1)])
        .split(frame.area());

    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(24),
            Constraint::Percentage(26),
            Constraint::Min(20),
        ])
        .split(outer[0]);

    draw_left(frame, app, panes[0]);
    draw_middle(frame, app, panes[1]);
    draw_editor(frame, app, panes[2]);
    draw_status(frame, app, outer[1]);
}

/// Colour for the divider to the right of a pane, lit when that pane is active.
fn left_divider_color(app: &App) -> Color {
    if app.focus == Pane::Folders {
        FOCUSED
    } else {
        Color::DarkGray
    }
}

/// Colour for the divider between the note list and the editor. It separates
/// the "content" pair (notes + editor), so it lights up for either of them.
fn right_divider_color(app: &App) -> Color {
    if app.focus == Pane::Notes || app.focus == Pane::Editor {
        FOCUSED
    } else {
        Color::DarkGray
    }
}

fn dim() -> Style {
    Style::default().fg(Color::DarkGray)
}

fn header_style(focused: bool) -> Style {
    if focused {
        Style::default().add_modifier(Modifier::BOLD)
    } else {
        dim()
    }
}

fn selection_style(focused: bool) -> Style {
    if focused {
        Style::default()
            .bg(Color::DarkGray)
            .add_modifier(Modifier::BOLD)
    } else {
        Style::default().add_modifier(Modifier::DIM)
    }
}

/// Last two components of the notes-root path — enough to tell a dev root from
/// a real one without eating the whole header.
fn short_root(path: &str) -> String {
    let parts: Vec<&str> = path.rsplit('/').take(2).collect();
    parts.into_iter().rev().collect::<Vec<_>>().join("/")
}

/// Split an area into a one-line header and the remaining body.
fn header_body(area: Rect) -> (Rect, Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(area);
    (chunks[0], chunks[1])
}

// ── Left pane: feed / folders ──────────────────────────────────────────────

fn draw_left(frame: &mut Frame, app: &App, area: Rect) {
    let focused = app.focus == Pane::Folders;
    let (header, body) = header_body(area);

    let mode_label = match app.nav_mode {
        NavMode::Feed => "Feed",
        NavMode::Folders => "Folders",
    };
    let hint = "  Tab";
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(mode_label, header_style(focused)),
            Span::styled(hint, dim()),
            Span::styled(format!("  {}", short_root(&app.root_label)), dim()),
        ])),
        header,
    );

    let mut state = ListState::default();
    match app.nav_mode {
        NavMode::Folders => {
            let items = folder_item_rows(&app.folder_rows);
            let list = List::new(items).highlight_style(selection_style(focused));
            if !app.folder_rows.is_empty() {
                state.select(Some(app.folder_cursor));
            }
            frame.render_stateful_widget(list, body, &mut state);
        }
        NavMode::Feed => {
            let items = feed_item_rows(&app.feed_rows);
            let list = if app.feed_rows.is_empty() {
                empty_list("no feed notes")
            } else {
                List::new(items).highlight_style(selection_style(focused))
            };
            if !app.feed_rows.is_empty() {
                state.select(Some(app.folder_cursor));
            }
            frame.render_stateful_widget(list, body, &mut state);
        }
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
            // Relative buckets (Today / Yesterday / …) are the most relevant, so
            // they read first; older calendar buckets stay plain.
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

fn draw_middle(frame: &mut Frame, app: &App, area: Rect) {
    let focused = app.focus == Pane::Notes;
    // The divider is this pane's left border, full height.
    let block = Block::default()
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(left_divider_color(app)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let (header, body) = header_body(inner);
    frame.render_widget(
        Paragraph::new(Span::styled(middle_title(app), header_style(focused))),
        header,
    );

    let rows = app.note_rows();
    let items: Vec<ListItem> = rows
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

    let list = if rows.is_empty() {
        empty_list("no notes")
    } else {
        List::new(items).highlight_style(selection_style(focused))
    };

    let mut state = ListState::default();
    if !rows.is_empty() {
        state.select(Some(app.note_cursor));
    }
    frame.render_stateful_widget(list, body, &mut state);
}

/// What the middle pane is currently listing: a folder path, or a feed bucket.
fn middle_title(app: &App) -> String {
    match app.nav_mode {
        NavMode::Folders => app.open_folder.clone().unwrap_or_else(|| "—".into()),
        NavMode::Feed => app
            .active_feed_id
            .as_deref()
            .and_then(|id| {
                app.feed_rows
                    .iter()
                    .find(|row| row.id == id)
                    .map(|row| row.label.clone())
            })
            .unwrap_or_else(|| "Feed".into()),
    }
}

// ── Right pane: editor ─────────────────────────────────────────────────────

fn draw_editor(frame: &mut Frame, app: &mut App, area: Rect) {
    let focused = app.focus == Pane::Editor;
    let block = Block::default()
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(right_divider_color(app)));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let (header, body) = header_body(inner);

    let title = match &app.editor.path {
        Some(path) => {
            let dirty = if app.editor.is_dirty() { " ●" } else { "" };
            format!("{}{}", model::file_stem(path), dirty)
        }
        None => "—".to_string(),
    };
    let preview_hint = if app.editor.path.is_some() && !focused && app.focus == Pane::Notes {
        "  ⏎ to edit"
    } else {
        ""
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(title, header_style(focused)),
            Span::styled(preview_hint, dim()),
        ])),
        header,
    );

    if app.editor.path.is_none() {
        frame.render_widget(
            Paragraph::new(Span::styled(
                "Enter on a note to edit, or :new",
                dim(),
            )),
            body,
        );
        return;
    }

    // No block of its own: the section already drew the divider, and a block
    // would only push the cursor in by a column for no visual gain.
    app.editor.area.set_block(Block::default());
    app.editor.area.set_cursor_style(if focused {
        Style::default().add_modifier(Modifier::REVERSED)
    } else {
        Style::default()
    });
    frame.render_widget(&app.editor.area, body);
}

// ── Status bar / prompt ────────────────────────────────────────────────────

fn draw_status(frame: &mut Frame, app: &App, area: Rect) {
    if let Some(prompt) = &app.prompt {
        let sigil = match prompt.kind {
            PromptKind::Command => ':',
            PromptKind::Search => '/',
        };
        let mut spans = vec![
            Span::styled(sigil.to_string(), Style::default().fg(FOCUSED)),
            Span::raw(prompt.input.clone()),
            Span::styled("█", Style::default().fg(FOCUSED)),
        ];
        if !prompt.completions.is_empty() {
            spans.push(Span::styled(
                format!("   [{}/{}]", prompt.completion_index + 1, prompt.completions.len()),
                dim(),
            ));
        }
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
        return;
    }

    let mode = app.vim.mode.label();
    let mode_colour = match app.focus {
        Pane::Editor => Color::Green,
        Pane::Notes => Color::Blue,
        Pane::Folders => Color::Magenta,
    };

    let mut spans = vec![
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

    let pending = app.vim.pending_hint();
    if !pending.is_empty() {
        spans.push(Span::styled(format!("  {pending}"), Style::default().fg(Color::Yellow)));
    }
    if app.pending_window {
        spans.push(Span::styled("  ^W", Style::default().fg(Color::Yellow)));
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

fn empty_list(label: &'static str) -> List<'static> {
    List::new(vec![ListItem::new(Span::styled(label, dim()))])
}
