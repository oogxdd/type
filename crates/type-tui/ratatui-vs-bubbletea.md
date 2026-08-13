# ratatui vs Go/bubbletea, for this app specifically

Exploratory notes, not a decision record. Written while poking at this crate to
answer "what would a Go rewrite of this shell look like, and could it still be
the same core?"

## Architecture: immediate-mode vs Elm

ratatui is immediate-mode: you own the event loop, and every frame you rebuild
the widget tree from scratch. `main.rs` here is a plain `loop { draw; poll;
mutate }`; the debounced-save tick rides the same 50ms poll interval as key
input (see `POLL_INTERVAL` in `main.rs`) rather than being its own event.

bubbletea is Elm-architecture: the runtime owns the loop. Your `Model` just
implements `Update(tea.Msg) (tea.Model, tea.Cmd)` and `View() string`; a timer
tick is its own `tea.Msg` produced by a `tea.Tick` command instead of a shared
poll interval. Less control over exactly when you wake up, more structure for
free.

### Side by side (folders pane + status bar, simplified from `app.rs`/`ui.rs`)

**ratatui** — state mutation and rendering are separate passes, both hand-written:

```rust
// app.rs — state, mutated in place by key events
struct App {
    focus: Pane,
    folder_rows: Vec<FolderRow>,
    root_label: String,
    status: String,
}

impl App {
    fn on_key(&mut self, key: KeyEvent) {
        match key.code {
            KeyCode::Char('j') => self.move_down(),
            KeyCode::Char('l') => self.expand_or_open(),
            KeyCode::Char(':') => self.focus = Pane::Prompt,
            _ => {}
        }
    }
}

// main.rs — the loop is yours: poll, mutate, draw
loop {
    terminal.draw(|f| ui::draw(f, &mut app))?;
    if event::poll(POLL_INTERVAL)? {
        if let Event::Key(key) = event::read()? {
            app.on_key(key);
        }
    }
    app.maybe_flush_debounced_save(); // ticks on its own, no dedicated event
}

// ui.rs — pure function, rebuilds widgets every frame
fn draw_folders(frame: &mut Frame, app: &App, area: Rect) {
    let title = format!("folders · {}", app.root_label);
    let items: Vec<ListItem> = app.folder_rows.iter()
        .map(|r| ListItem::new(format!("{} {}", marker(r), r.name)))
        .collect();
    frame.render_widget(
        List::new(items).block(Block::bordered().title(title)),
        area,
    );
}
```

**bubbletea + lipgloss** — same state, but `Update` returns a new model/command
instead of mutating in place:

```go
// model.go
type model struct {
    focus     pane
    folders   []folderRow
    rootLabel string
    status    string
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        switch msg.String() {
        case "j":
            m.moveDown()
        case "l":
            m.expandOrOpen()
        case ":":
            m.focus = paneCmd
        }
    case saveTickMsg:
        // debounce is its own message from a timer, not a shared poll loop
        return m, m.maybeFlushSave()
    }
    return m, nil
}

func (m model) View() string {
    return lipgloss.JoinHorizontal(lipgloss.Top,
        m.foldersPane(), m.notesPane(), m.editorPane(),
    ) + "\n" + m.statusBar()
}

func (m model) foldersPane() string {
    title := fmt.Sprintf("folders · %s", m.rootLabel)
    var rows []string
    for _, r := range m.folders {
        rows = append(rows, fmt.Sprintf("%s %s", marker(r), r.name))
    }
    style := paneStyle
    if m.focus == paneFolders {
        style = style.BorderForeground(lipgloss.Color("6")) // cyan, like FOCUSED
    }
    return style.Border(lipgloss.RoundedBorder()).
        Render(title + "\n" + strings.Join(rows, "\n"))
}

func main() {
    tea.NewProgram(initialModel(), tea.WithAltScreen()).Run()
}
```

### Practical differences for an app shaped like this one

- **Event loop / debounce.** ratatui: hand-rolled `poll(50ms)`, the same poll
  interval doubles as the debounce clock (see the comment on `POLL_INTERVAL`).
  bubbletea: `tea.Tick` sends a `Msg`, no manual poll loop, but less direct
  control over "wake up in exactly 50ms for the debounce specifically."
- **Widgets.** ratatui is low-level (`List`, `Paragraph`, manual layout
  constraints). bubbletea's ecosystem (`bubbles/list`, `bubbles/textarea`,
  `bubbles/viewport`) gives ready components with their own cursor/scroll
  state, each wired in as a sub-model with its own `Update`/`View` — but the
  vim-like modal editing this crate hand-writes in `vim.rs`/`editor.rs` has no
  ready-made bubbletea equivalent either; that part gets written by hand in
  both worlds.
- **Testability.** This crate unit-tests the pure logic (`command.rs` — `:mv`
  parsing, folder completion, auto-slug) with no event loop involved, plus
  `smoke.sh`/`smoke-sync.sh` drive the real binary through a pty for the
  event-loop-shaped bugs unit tests can't reach (see their headers for why —
  the `created_here` bug was invisible to `cargo test`). The same split works
  for bubbletea, arguably with less ceremony: `Update` is a pure function of
  `Msg`, testable without spinning up a real terminal at all.

## Could a Go rewrite still share `type-core` via uniffi?

Yes, but not for free — it's a different tradeoff than the trivial one ratatui
gets.

**How it would work:** uniffi's Go bindings call into Rust over cgo (C ABI).
For a single binary instead of a binary + a loose `.so`/`.dylib`:

1. Build the uniffi-exporting crate (parallel to `crates/type-ffi`) as a
   `staticlib`:
   ```toml
   [lib]
   crate-type = ["staticlib"]  # not cdylib — produces a .a, not a shared lib
   ```
2. Statically link that `.a` from Go via cgo:
   ```go
   /*
   #cgo LDFLAGS: -L${SRCDIR}/../target/release -ltype_core
   */
   import "C"
   ```
3. `go build` with `CGO_ENABLED=1` — one executable, Rust code linked in.

**The cost:**

- **Cross-compilation stops being trivial.** Go's usual party trick —
  `GOOS=linux GOARCH=arm64 go build` from any machine, no toolchain needed —
  goes away. cgo needs a C compiler for the target, *and* a Rust staticlib
  built for that same target triple (`cargo build --target
  aarch64-unknown-linux-gnu`), i.e. the same per-target build matrix this repo
  already carries for the mobile ubrn pipeline (needs a Mac, regenerate after
  every `type-ffi` change — see `docs/architecture/09-adding-features-and-codegen.md`).
- **uniffi's Go bindings are a community project**, not as battle-tested here
  as the Kotlin/Swift/JS ones this repo already generates and ships. More
  surface for generator bugs.
- **Per-call cgo overhead** — irrelevant for a TUI (calls aren't in a hot
  loop), just noting it exists.

**Contrast:** the ratatui shell in this branch gets a single binary *for free*
— `type-core` is an ordinary Rust dependency in `crates/type-tui/Cargo.toml`,
no FFI, no cgo, `cargo build` and done. That's why AGENTS.md can describe this
as "the third shell over the same core" without caveats; a Go+uniffi version
would be a genuinely separate architecture branch with its own build pain, not
a drop-in language swap.
