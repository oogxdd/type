//! Terminal shell for the Type notes app.
//!
//! Three panes in one frame (navigation / note list / editor), a left panel that
//! toggles between the Feed's date-grouped tree and the folder tree, live
//! auto-preview as you scroll, vim-like keys, `:` commands, and git sync — all
//! driven through the same `type-core` services the desktop app and the mobile
//! app use. Nothing about the note format lives here.
//!
//! Run it with `cargo run -p type-tui`. By default it opens the **dev** notes
//! root; see `core::DEV_APP_IDENTIFIER` for how to point it at a real one.
//! Pass a folder — `cargo run -p type-tui -- ~/wiki` — to browse any directory
//! of markdown instead, with no Feed and nothing written into it uninvited.
//!
//! Git operations run on a background thread through the tokio runtime created
//! here — see `ASYNC.md` for how a `:sync` flows through this file.

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
use tokio::runtime::Runtime;

use crate::{
    app::{run_git_task, App, AsyncOutcome},
    core::Core,
};

/// How long we block waiting for a key before looping.
///
/// This doubles as the debounce timer's resolution: the loop needs to wake up
/// on its own to notice that the editor has been idle long enough to save, and
/// 50ms is well under the 400ms debounce while costing nothing when idle. It
/// is also what bounds the latency of applying a finished git result — the
/// channel is drained once per loop.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

const USAGE: &str = "\
type-tui — terminal shell for the Type notes app

usage:
    type-tui [FOLDER]

    FOLDER   browse this folder instead of the notes root. Any directory
             works: with no `Feed` inside it the left pane is simply the
             folder tree, and nothing is created in it uninvited.
             `:open <path>` does the same from inside the app, and `:open`
             with no path returns to the notes root.

options:
    -h, --help   show this

environment:
    TYPE_TUI_APP_DATA_DIR   which app-data directory (and therefore which
                            profile's notes root) to open. Defaults to the
                            dev identifier, never your real notes.
";

fn main() {
    if let Err(err) = run() {
        eprintln!("type-tui: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut core = Core::new()?;
    match parse_args(std::env::args().skip(1))? {
        Args::Help => {
            print!("{USAGE}");
            return Ok(());
        }
        Args::Open(Some(folder)) => core.open_folder(&folder)?,
        Args::Open(None) => {}
    }
    let mut app = App::new(core)?;

    // The runtime that executes background git work. One async worker is
    // plenty — nothing here is async; the runtime exists so we can use its
    // thread pool (`spawn_blocking`) and its channel (`mpsc`). Dropping it at
    // the end of `run` waits for any in-flight git operation to finish, which
    // is exactly the safety we want on the way out.
    let runtime = Runtime::new().map_err(|err| err.to_string())?;
    // Results flow worker -> event loop through this channel. Capacity 8 is
    // arbitrary headroom; the app only ever allows one git task at a time.
    let (tx, rx) = tokio::sync::mpsc::channel::<AsyncOutcome>(8);

    let mut terminal = setup_terminal().map_err(|err| err.to_string())?;
    let result = event_loop(&mut terminal, &mut app, &runtime, tx, rx);
    // Restore the terminal even if the loop failed — leaving a user in raw mode
    // with no cursor is a far worse outcome than the original error.
    restore_terminal(&mut terminal).map_err(|err| err.to_string())?;
    result
}

/// What the command line asked for.
enum Args {
    Help,
    /// A folder to browse, or `None` for the profile's notes root.
    Open(Option<String>),
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut folder = None;
    for arg in args {
        match arg.as_str() {
            "-h" | "--help" => return Ok(Args::Help),
            other if other.starts_with('-') => {
                return Err(format!("unknown option: {other}\n\n{USAGE}"))
            }
            other if folder.is_none() => folder = Some(other.to_string()),
            other => return Err(format!("unexpected argument: {other}\n\n{USAGE}")),
        }
    }
    Ok(Args::Open(folder))
}

fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    app: &mut App,
    runtime: &Runtime,
    tx: tokio::sync::mpsc::Sender<AsyncOutcome>,
    mut rx: tokio::sync::mpsc::Receiver<AsyncOutcome>,
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

        // A command queued git work — hand it to the runtime. `Core` is a
        // cheap clone (two PathBufs) and `GitTask` is owned data, so the
        // closure satisfies the `'static + Send` that `spawn_blocking`
        // requires. Inside the worker we are in plain blocking code, hence
        // `blocking_send` rather than `.send().await`.
        if let Some(task) = app.take_git_task() {
            let core = app.core.clone();
            let tx = tx.clone();
            runtime.spawn_blocking(move || {
                let outcome = run_git_task(&core, task);
                let _ = tx.blocking_send(outcome);
            });
        }

        // Apply finished background work. `try_recv` never blocks: keys keep
        // flowing while a git operation is still running.
        while let Ok(outcome) = rx.try_recv() {
            app.apply_async(outcome);
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
