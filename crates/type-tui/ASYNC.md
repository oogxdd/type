# Non-blocking git sync: a tokio walkthrough

This document explains, on this crate's actual code, how the TUI runs git
operations on a background thread so a slow remote never freezes the UI. It is
written for someone who knows Rust basics but has not used async Rust.

## The problem

Everything the app does — reading notes, walking the folder tree — is a local
file read that returns in microseconds, so the event loop in `main.rs` can
afford to do it synchronously:

```rust
loop {
    terminal.draw(...)?;            // paint the screen
    if event::poll(50ms)? {         // wait for a key (at most 50ms)
        app.on_key(key);            // update state
    }
    app.tick();                     // debounced autosave
}
```

Git is different. `:sync` talks to a remote over SSH: on a bad network that is
seconds, and the UI above cannot even redraw while `pull()` runs, because the
call sits right there inside `on_key`. The screen freezes, keys queue up, and
the user cannot tell the difference between "syncing" and "dead".

The fix has three parts: run the git work **on another thread**, get the result
back **through a channel**, and keep the UI loop **free to redraw** while all
this happens.

## Why a thread, and why tokio at all

libgit2 (via `type-core`'s git adapter) is a blocking C library. There is no
`async fn pull()` to await — calling it occupies its thread until git is done.
So the job is fundamentally "run blocking code somewhere else", which is a
thread, not async I/O.

Tokio earns its place anyway, by giving us two things we would otherwise hand-roll:

* `spawn_blocking` — a thread pool for blocking jobs, with a `Send + 'static`
  contract that makes the "what am I allowed to move into the thread?" question
  a compile-time check.
* `mpsc` — a multi-producer, single-consumer channel whose receive side has
  `try_recv()` (non-blocking), which is exactly what a redraw loop wants.

We do **not** write `async fn` anywhere. The runtime is used as a thread pool
plus a channel library. That is a legitimate and common tokio use.

## The pieces, in order of the data flow

### 1. App queues intent — `app.rs`

`App` knows nothing about tokio. When a command like `:sync` runs, the handler
does two things synchronously and then records *intent*:

```rust
fn git_sync(&mut self) {
    self.flush_editor();                     // (a) buffer must be on disk first
    self.status = "syncing…".to_string();    // (b) instant UI feedback
    self.pending_git = Some(GitTask::Sync);  // (c) the intent
}
```

Why (a) matters: the background pull will rewrite files underneath us. If the
editor buffer has unsaved keystrokes, they exist only in memory; flushing them
*before* the pull starts means buffer and disk agree when git merges. Doing it
"later, when the task starts" would race the user's next keystroke.

`GitTask` is a small owned enum (`Pull`, `Push`, `Sync`, `Connect(String)`).
Owned data is what lets the event loop later *move* it into the worker thread.

### 2. The event loop drains the queue and spawns — `main.rs`

Once per loop iteration, right after key handling:

```rust
if let Some(task) = app.take_git_task() {
    let core = app.core.clone();          // two PathBufs — cheap
    let tx = tx.clone();                  // channel senders clone cheaply
    runtime.spawn_blocking(move || {      // runs on a pool thread
        let outcome = run_git_task(&core, task);
        let _ = tx.blocking_send(outcome); // blocking: we are NOT in async code
    });
}
```

Two Rust concepts doing heavy lifting here:

**The `move` closure.** `spawn_blocking` demands a closure that owns
everything it touches (`Send + 'static`), because the pool thread may outlive
this stack frame. `move ||` takes ownership of `core`, `task`, and `tx` — the
compiler then verifies each captured value can cross a thread boundary
(`Send`). `Core` qualifies because it is just an `AppEnv` (two `PathBuf`s).
Had we accidentally captured `&app`, the borrow checker would reject it: the
UI thread mutates `app` on every keystroke, so sharing a reference across
threads would be a data race. This is the async-Rust lesson worth internalizing:
*don't share state between the UI and the worker — send copies, receive
results.*

**`spawn_blocking` vs `spawn`.** Regular `tokio::spawn` is for `async`
tasks that await; putting blocking libgit2 calls there would starve the
runtime's workers. `spawn_blocking` exists precisely for "this is a plain
blocking function, give me an OS thread."

### 3. The worker runs plain Rust — `app.rs`, `run_git_task`

On the pool thread there is nothing async-looking at all:

```rust
pub fn run_git_task(core: &Core, task: GitTask) -> AsyncOutcome {
    match task {
        GitTask::Pull => match do_pull(core) {
            Ok(msg)  => AsyncOutcome::pulled(msg),
            Err(err) => AsyncOutcome::error(format!("pull: {err}")),
        },
        // …
    }
}
```

`AsyncOutcome` is the *message back*: a status-line string plus flags for the
side effects the UI must perform afterwards (`refresh` the tree, `reload` the
open note). Note what it deliberately does **not** contain: references into
`App`. The worker cannot touch UI state — it can only describe what happened.

### 4. The result comes home — `main.rs` + `apply_async`

The loop's next piece, every iteration:

```rust
while let Ok(outcome) = rx.try_recv() {
    app.apply_async(outcome);
}
```

`try_recv` returns immediately, empty or not — the loop never blocks on the
channel. With `POLL_INTERVAL` at 50ms, a finished sync is applied within one
loop tick. `apply_async` is plain UI-thread code: set the status line, then

```rust
if outcome.refresh      { self.refresh_current(); }
if outcome.reload_note  { self.reload_open_note(); }
```

One guard inside `reload_open_note` is worth reading twice: if the user typed
*during* the pull, the buffer is dirty again, and silently reloading it from
disk would throw those keystrokes away. We keep the buffer and say so in the
status line. Races between the user and the background are the tax of going
async; every one needs a policy.

## Concurrency rules the app enforces

* **One git task at a time.** `take_git_task` refuses (`git_in_flight > 0`)
  rather than queueing: two concurrent pulls on one repo can interleave badly.
* **`:q` waits, `:q!` forces.** Quitting normally is blocked while a task runs.
  This is not bureaucracy — dropping the tokio runtime is what actually joins
  blocking threads, and killing a pull mid-write is how repositories get hurt.
  `:q!` skips the guard and pays with a wait at process exit: `Runtime`'s
  destructor does not abandon blocking tasks, it waits for them.
* **Status line is the progress UI.** "syncing…" when queued, `⟳ git…` in the
  status bar while in flight, the result string when applied.

## Map of the flow

```
key ':' "sync"
 └─ App::git_sync            (UI thread)
     flush_editor, status = "syncing…"
     pending_git = Some(GitTask::Sync)
          │
event loop, next iteration  (UI thread)
 └─ app.take_git_task() -> Some(task)
     runtime.spawn_blocking(move || {         ─────────┐
         run_git_task(&core, task)                    │ pool thread
             pull() … push() …  (seconds pass)        │ UI stays live:
         tx.blocking_send(outcome)                    │ draws, keys, autosave
     })  ─────────────────────────────────────────────┘
          │
event loop, some iteration later
 └─ rx.try_recv() -> Ok(outcome)
     app.apply_async(outcome)
         status = "pulled · behind 0 · pushed …"
         refresh_current()      // tree + feed + note list
         reload_open_note()     // unless buffer is dirty
```

## Reading list in this repo

| What | Where |
|---|---|
| Intent types (`GitTask`, `AsyncOutcome`) | `src/app.rs` |
| Command handlers that queue tasks | `src/app.rs`, `git_*` methods |
| Worker-side execution | `src/app.rs`, `run_git_task` + `do_pull`/`do_push`/`do_connect` |
| Runtime + channel creation | `src/main.rs`, `run()` |
| Spawn and drain sites | `src/main.rs`, `event_loop()` |
| Apply-back logic | `src/app.rs`, `apply_async`, `reload_open_note` |
