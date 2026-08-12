//! Terminal shell for the Type notes app.
//!
//! Three panes (folders / notes / editor), vim-like keys, `:` commands, and git
//! sync — all driven through the same `type-core` services the desktop app and
//! the mobile app use. Nothing about the note format lives here.
//!
//! Run it with `cargo run -p type-tui`. By default it opens the **dev** notes
//! root; see `core::DEV_APP_IDENTIFIER` for how to point it at a real one.

mod app;
mod command;
mod core;
mod editor;
mod model;
mod ui;
mod vim;

use std::{io, time::Duration};

use ratatui::crossterm::{
    event::{self, Event, KeyEventKind},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{backend::CrosstermBackend, Terminal};

use crate::{app::App, core::Core};

/// How long we block waiting for a key before looping.
///
/// This doubles as the debounce timer's resolution: the loop needs to wake up
/// on its own to notice that the editor has been idle long enough to save, and
/// 50ms is well under the 400ms debounce while costing nothing when idle.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

fn main() {
    if let Err(err) = run() {
        eprintln!("type-tui: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let core = Core::new()?;
    let mut app = App::new(core)?;

    let mut terminal = setup_terminal().map_err(|err| err.to_string())?;
    let result = event_loop(&mut terminal, &mut app);
    // Restore the terminal even if the loop failed — leaving a user in raw mode
    // with no cursor is a far worse outcome than the original error.
    restore_terminal(&mut terminal).map_err(|err| err.to_string())?;
    result
}

fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
) -> Result<(), String> {
    loop {
        terminal
            .draw(|frame| ui::draw(frame, app))
            .map_err(|err| err.to_string())?;

        if event::poll(POLL_INTERVAL).map_err(|err| err.to_string())? {
            match event::read().map_err(|err| err.to_string())? {
                // Windows sends both Press and Release; only act on Press or
                // every keystroke would register twice.
                Event::Key(key) if key.kind == KeyEventKind::Press => app.on_key(key),
                _ => {}
            }
        }

        // Fires the debounced write once the buffer has gone quiet.
        app.tick();

        if app.should_quit {
            // Last chance to persist: `:q` already flushed, but a quit through
            // any other path must not lose the buffer.
            app.flush_editor();
            return Ok(());
        }
    }
}

fn setup_terminal() -> io::Result<Terminal<CrosstermBackend<io::Stdout>>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen)?;
    Terminal::new(CrosstermBackend::new(stdout))
}

fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<io::Stdout>>) -> io::Result<()> {
    disable_raw_mode()?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen)?;
    terminal.show_cursor()
}
