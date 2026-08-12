//! Rendering. Pure presentation — every value drawn here already lives in `App`.

use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, ListState, Paragraph},
    Frame,
};

use crate::{
    app::{App, Pane, PromptKind},
    model,
};

/// Border colour of the focused pane. Everything else stays dim so focus is
/// readable at a glance — the whole point of `Ctrl+W` being cheap.
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
            Constraint::Percentage(22),
            Constraint::Percentage(28),
            Constraint::Min(20),
        ])
        .split(outer[0]);

    draw_folders(frame, app, panes[0]);
    draw_notes(frame, app, panes[1]);
    draw_editor(frame, app, panes[2]);
    draw_status(frame, app, outer[1]);
}

/// Border for a pane, highlighted when focused.
fn pane_block(title: String, focused: bool) -> Block<'static> {
    Block::default()
        .borders(Borders::ALL)
        .border_style(if focused {
            Style::default().fg(FOCUSED)
        } else {
            Style::default().fg(Color::DarkGray)
        })
        .title(title)
}

fn draw_folders(frame: &mut Frame, app: &App, area: Rect) {
    let focused = app.focus == Pane::Folders;
    // Title carries the notes root. Worth the space: the TUI opens the *dev*
    // root unless TYPE_TUI_APP_DATA_DIR says otherwise, and silently editing
    // the wrong folder is the one mistake that is expensive here.
    let title = format!("folders · {}", short_root(&app.root_label));
    let items: Vec<ListItem> = app
        .folder_rows
        .iter()
        .map(|row| {
            // Collapse marker only where there is something to collapse.
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
                Span::styled(marker, Style::default().fg(Color::DarkGray)),
                Span::raw(row.name.clone()),
            ]))
        })
        .collect();

    let list = List::new(items)
        .block(pane_block(title, focused))
        .highlight_style(selection_style(focused));

    // A fresh ListState each frame: ratatui derives the scroll offset from the
    // selected index, so the cursor stays visible without us tracking offsets.
    let mut state = ListState::default();
    if !app.folder_rows.is_empty() {
        state.select(Some(app.folder_cursor));
    }
    frame.render_stateful_widget(list, area, &mut state);
}

fn draw_notes(frame: &mut Frame, app: &App, area: Rect) {
    let focused = app.focus == Pane::Notes;
    let title = match &app.open_folder {
        Some(folder) => format!("notes · {folder}"),
        None => "notes".to_string(),
    };

    let items: Vec<ListItem> = app
        .note_rows()
        .iter()
        .map(|row| {
            let mut spans = Vec::new();
            // The audio badge. Front matter alone tells us this, which is why
            // the TUI needs none of the recordings machinery.
            if row.is_audio {
                spans.push(Span::styled("♪ ", Style::default().fg(Color::Magenta)));
            }
            spans.push(Span::raw(row.title.clone()));
            ListItem::new(Line::from(spans))
        })
        .collect();

    let list = if items.is_empty() {
        List::new(vec![ListItem::new(Span::styled(
            "  (empty)",
            Style::default().fg(Color::DarkGray),
        ))])
    } else {
        List::new(items)
    };

    let list = list
        .block(pane_block(title, focused))
        .highlight_style(selection_style(focused));

    let mut state = ListState::default();
    if !app.note_rows().is_empty() {
        state.select(Some(app.note_cursor));
    }
    frame.render_stateful_widget(list, area, &mut state);
}

fn draw_editor(frame: &mut Frame, app: &mut App, area: Rect) {
    let focused = app.focus == Pane::Editor;
    let title = match &app.editor.path {
        Some(path) => {
            let dirty = if app.editor.is_dirty() { " ●" } else { "" };
            format!("{}{}", model::file_stem(path), dirty)
        }
        None => "editor".to_string(),
    };

    if app.editor.path.is_none() {
        let hint = Paragraph::new(vec![
            Line::from(""),
            Line::from(Span::styled(
                "  Enter on a note to edit, or :new",
                Style::default().fg(Color::DarkGray),
            )),
        ])
        .block(pane_block(title, focused));
        frame.render_widget(hint, area);
        return;
    }

    app.editor.area.set_block(pane_block(title, focused));
    // Only the focused editor shows a cursor; otherwise two panes would look
    // like they both had one.
    app.editor.area.set_cursor_style(if focused {
        Style::default().add_modifier(Modifier::REVERSED)
    } else {
        Style::default()
    });
    frame.render_widget(&app.editor.area, area);
}

fn draw_status(frame: &mut Frame, app: &App, area: Rect) {
    // An open prompt takes over the line — it is where the user is looking.
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
        // Show how many completions Tab is cycling through.
        if !prompt.completions.is_empty() {
            spans.push(Span::styled(
                format!(
                    "   [{}/{}]",
                    prompt.completion_index + 1,
                    prompt.completions.len()
                ),
                Style::default().fg(Color::DarkGray),
            ));
        }
        frame.render_widget(Paragraph::new(Line::from(spans)), area);
        return;
    }

    let mode = app.vim.mode.label();
    let mode_colour = match app.focus {
        Pane::Editor => Color::Green,
        _ => Color::DarkGray,
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

    // Half-typed vim sequences (`d`, `12`) and a pending Ctrl+W are shown so
    // the terminal never feels like it swallowed a keystroke.
    let pending = app.vim.pending_hint();
    if !pending.is_empty() {
        spans.push(Span::styled(
            format!("  {pending}"),
            Style::default().fg(Color::Yellow),
        ));
    }
    if app.pending_window {
        spans.push(Span::styled(
            "  ^W",
            Style::default().fg(Color::Yellow),
        ));
    }

    frame.render_widget(Paragraph::new(Line::from(spans)), area);
}

/// Last two components of the notes-root path — enough to tell a dev root from
/// a real one without eating the whole pane title.
fn short_root(path: &str) -> String {
    let parts: Vec<&str> = path.rsplit('/').take(2).collect();
    parts.into_iter().rev().collect::<Vec<_>>().join("/")
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
