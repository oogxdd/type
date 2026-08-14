//! Rendering. Pure presentation.
//!
//! Each draw function receives the smallest sub-model it needs: the left and
//! middle panes get [`NavState`], the editor pane gets [`EditorState`], and
//! only the status bar — which spans everything — sees [`App`].

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, BorderType, Borders, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::{
    app::{App, EditorState, NavMode, NavState, Pane, PromptKind},
    model,
};

/// Accent colour for the focused pane's divider and the mode label.
const FOCUSED: Color = Color::Cyan;

pub fn draw(frame: &mut Frame, app: &mut App) {
    let outer = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(3), Constraint::Length(1)])
        .split(frame.area());

    // One frame around everything. The dividers inside stay thin — the outer
    // border is what gives the layout its shape, the dividers only separate.
    let title = Line::from(vec![
        Span::styled(" type ", Style::default().fg(FOCUSED).add_modifier(Modifier::BOLD)),
        Span::styled(format!("· {} ", short_root(&app.root_label)), dim()),
    ]);
    let container = Block::bordered()
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(Color::DarkGray))
        .title(title);
    frame.render_widget(&container, outer[0]);
    let inner = container.inner(outer[0]);

    let show_left = !app.left_hidden;
    let constraints: &[Constraint] = if show_left {
        &[Constraint::Percentage(24), Constraint::Percentage(26), Constraint::Min(20)]
    } else {
        &[Constraint::Percentage(38), Constraint::Min(20)]
    };
    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints(constraints)
        .split(inner);

    let focus = app.focus;
    if show_left {
        draw_left(frame, &app.nav, focus == Pane::Folders, panes[0]);
    }
    let middle = if show_left { panes[1] } else { panes[0] };
    let editor = panes[panes.len() - 1];
    draw_middle(frame, &app.nav, focus == Pane::Notes, middle, show_left);
    draw_editor(frame, &mut app.ed, focus == Pane::Editor, focus == Pane::Notes, editor);
    draw_status(frame, app, outer[1]);
}

// ── Shared helpers ─────────────────────────────────────────────────────────

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

fn short_root(path: &str) -> String {
    let parts: Vec<&str> = path.rsplit('/').take(2).collect();
    parts.into_iter().rev().collect::<Vec<_>>().join("/")
}

fn header_body(area: Rect) -> (Rect, Rect) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(1)])
        .split(area);
    (chunks[0], chunks[1])
}

fn empty_list(label: &'static str) -> List<'static> {
    List::new(vec![ListItem::new(Span::styled(label, dim()))])
}

// ── Left pane: feed / folders ──────────────────────────────────────────────

fn draw_left(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect) {
    let (header, body) = header_body(area);

    let mode_label = match nav.nav_mode {
        NavMode::Feed => "Feed",
        NavMode::Folders => "Folders",
    };
    frame.render_widget(
        Paragraph::new(Line::from(vec![
            Span::styled(mode_label, header_style(focused)),
            Span::styled("  Tab", dim()),
        ])),
        header,
    );

    let mut state = ListState::default();
    match nav.nav_mode {
        NavMode::Folders => {
            let items = folder_item_rows(&nav.folder_rows);
            let list = List::new(items).highlight_style(selection_style(focused));
            if !nav.folder_rows.is_empty() {
                state.select(Some(nav.folder_cursor));
            }
            frame.render_stateful_widget(list, body, &mut state);
        }
        NavMode::Feed => {
            let items = feed_item_rows(&nav.feed_rows);
            let list = if nav.feed_rows.is_empty() {
                empty_list("no feed notes")
            } else {
                List::new(items).highlight_style(selection_style(focused))
            };
            if !nav.feed_rows.is_empty() {
                state.select(Some(nav.folder_cursor));
            }
            frame.render_stateful_widget(list, body, &mut state);
        }
    }
}

fn folder_item_rows(rows: &[model::FolderRow]) -> Vec<ListItem<'static>> {
    rows.iter()
        .map(|row| {
            let marker = if row.has_children {
                if row.expanded { "▾ " } else { "▸ " }
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
                if row.expanded { "▾ " } else { "▸ " }
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

fn draw_middle(frame: &mut Frame, nav: &NavState, focused: bool, area: Rect, show_divider: bool) {
    // When the navigation is hidden there is nothing to the left of this pane
    // except the container border — a divider there would read as a double line.
    let block = if show_divider {
        let color = if focused { FOCUSED } else { Color::DarkGray };
        Block::default()
            .borders(Borders::LEFT)
            .border_style(Style::default().fg(color))
    } else {
        Block::default()
    };
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let (header, body) = header_body(inner);
    frame.render_widget(
        Paragraph::new(Span::styled(middle_title(nav), header_style(focused))),
        header,
    );

    let items: Vec<ListItem> = nav.notes
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

    let list = if nav.notes.is_empty() {
        empty_list("no notes")
    } else {
        List::new(items).highlight_style(selection_style(focused))
    };

    let mut state = ListState::default();
    if !nav.notes.is_empty() {
        state.select(Some(nav.note_cursor));
    }
    frame.render_stateful_widget(list, body, &mut state);
}

fn middle_title(nav: &NavState) -> String {
    match nav.nav_mode {
        NavMode::Folders => nav.open_folder.clone().unwrap_or_else(|| "—".into()),
        NavMode::Feed => nav
            .active_feed_id
            .as_deref()
            .and_then(|id| {
                nav.feed_rows.iter().find(|row| row.id == id).map(|row| row.label.clone())
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
    let divider_color = if focused || list_focused {
        FOCUSED
    } else {
        Color::DarkGray
    };
    let block = Block::default()
        .borders(Borders::LEFT)
        .border_style(Style::default().fg(divider_color));
    let inner = block.inner(area);
    frame.render_widget(block, area);

    let (header, body) = header_body(inner);

    let title = match &ed.editor.path {
        Some(path) => {
            let dirty = if ed.editor.is_dirty() { " ●" } else { "" };
            format!("{}{}", model::file_stem(path), dirty)
        }
        None => "—".to_string(),
    };
    let preview_hint = if ed.editor.path.is_some() && !focused && list_focused {
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

    let mode = app.ed.vim.mode.label();
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

    let pending = app.ed.vim.pending_hint();
    if !pending.is_empty() {
        spans.push(Span::styled(format!("  {pending}"), Style::default().fg(Color::Yellow)));
    }
    if app.git_busy() {
        spans.push(Span::styled("  ⟳ git…", Style::default().fg(Color::Yellow)));
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}
