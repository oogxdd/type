//! A minimal but real vim layer over `TextArea`.
//!
//! Implemented as an explicit state machine rather than a key map, because vim's
//! grammar is stateful: a keystroke means different things depending on the
//! mode, on a pending operator (`d`, `y`, `g`), and on a numeric count (`5j`).
//!
//! Deliberately *not* implemented: registers, marks, macros, text objects
//! (`ciw`), `.` repeat. Those need a real parser and are not what this app is
//! for. What is here is the subset you actually use to edit a note.

use ratatui::crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use tui_textarea::{CursorMove, TextArea};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Normal,
    Insert,
    Visual,
}

impl Mode {
    /// Short label for the status bar.
    pub fn label(self) -> &'static str {
        match self {
            Mode::Normal => "NORMAL",
            Mode::Insert => "INSERT",
            Mode::Visual => "VISUAL",
        }
    }
}

/// What the caller must do after a key was handled.
///
/// The editor pane does not own the note lifecycle, so anything with a
/// side effect outside the buffer is reported back up rather than done here.
pub enum VimAction {
    /// The buffer changed — mark the editor dirty so the debounce starts.
    Edited,
    /// Only the cursor or selection moved.
    Moved,
    /// The key was not bound; the caller may handle it (e.g. pane switching).
    Ignored,
    /// `:` — open the command line.
    EnterCommand,
    /// `/` — open the command palette (intercepted globally by App).
    EnterSearch,
    /// `n` / `N` — jump to the next/previous search hit.
    SearchNext(bool),
}

pub struct Vim {
    pub mode: Mode,
    /// First key of a pending two-key sequence (`d`, `y`, `g`).
    pending: Option<char>,
    /// Numeric count prefix, e.g. the `5` in `5j`.
    count: Option<usize>,
}

impl Vim {
    pub fn new() -> Self {
        Self {
            mode: Mode::Normal,
            pending: None,
            count: None,
        }
    }

    /// Pending keys shown in the status bar, so a half-typed `d` or `12` is
    /// visible rather than silently swallowed.
    pub fn pending_hint(&self) -> String {
        let mut hint = String::new();
        if let Some(count) = self.count {
            hint.push_str(&count.to_string());
        }
        if let Some(pending) = self.pending {
            hint.push(pending);
        }
        hint
    }

    /// Take and clear the count, defaulting to 1.
    fn take_count(&mut self) -> usize {
        self.count.take().unwrap_or(1).max(1)
    }

    pub fn handle(&mut self, area: &mut TextArea<'static>, key: KeyEvent) -> VimAction {
        match self.mode {
            Mode::Insert => self.handle_insert(area, key),
            Mode::Normal | Mode::Visual => self.handle_normal(area, key),
        }
    }

    // ── Insert mode ────────────────────────────────────────────────────────

    fn handle_insert(&mut self, area: &mut TextArea<'static>, key: KeyEvent) -> VimAction {
        if key.code == KeyCode::Esc {
            self.mode = Mode::Normal;
            // vim nudges the cursor left when leaving insert; matching that
            // keeps `A`-then-`Esc`-then-`a` behaving the way muscle memory says.
            area.move_cursor(CursorMove::Back);
            return VimAction::Moved;
        }
        // Everything else is literal text. `input` returns whether the buffer
        // actually changed, which is exactly our dirty signal.
        if area.input(key) {
            VimAction::Edited
        } else {
            VimAction::Moved
        }
    }

    // ── Normal and visual mode ─────────────────────────────────────────────

    fn handle_normal(&mut self, area: &mut TextArea<'static>, key: KeyEvent) -> VimAction {
        let ctrl = key.modifiers.contains(KeyModifiers::CONTROL);

        // Ctrl chords first — they never participate in counts or operators.
        if ctrl {
            return match key.code {
                KeyCode::Char('r') => {
                    if area.redo() {
                        VimAction::Edited
                    } else {
                        VimAction::Moved
                    }
                }
                KeyCode::Char('d') => {
                    for _ in 0..15 {
                        area.move_cursor(CursorMove::Down);
                    }
                    VimAction::Moved
                }
                KeyCode::Char('u') => {
                    for _ in 0..15 {
                        area.move_cursor(CursorMove::Up);
                    }
                    VimAction::Moved
                }
                // Ctrl+W (pane switching) and anything else belong to the app.
                _ => VimAction::Ignored,
            };
        }

        let KeyCode::Char(ch) = key.code else {
            // Arrows and friends still move, so the editor stays usable for
            // anyone who has not internalised hjkl.
            return match key.code {
                KeyCode::Left => self.motion(area, CursorMove::Back),
                KeyCode::Right => self.motion(area, CursorMove::Forward),
                KeyCode::Up => self.motion(area, CursorMove::Up),
                KeyCode::Down => self.motion(area, CursorMove::Down),
                KeyCode::Esc => {
                    self.reset_pending();
                    if self.mode == Mode::Visual {
                        self.mode = Mode::Normal;
                        area.cancel_selection();
                    }
                    VimAction::Moved
                }
                _ => VimAction::Ignored,
            };
        };

        // Count prefix. A leading `0` is the "line head" motion, not a count,
        // which is why the digit check excludes it unless a count is building.
        if ch.is_ascii_digit() && (ch != '0' || self.count.is_some()) {
            let digit = ch as usize - '0' as usize;
            self.count = Some(self.count.unwrap_or(0) * 10 + digit);
            return VimAction::Moved;
        }

        // Second key of a pending operator.
        if let Some(pending) = self.pending.take() {
            return self.finish_operator(area, pending, ch);
        }

        match ch {
            // ── Motions ────────────────────────────────────────────────────
            'h' => self.motion(area, CursorMove::Back),
            'l' => self.motion(area, CursorMove::Forward),
            'j' => self.motion(area, CursorMove::Down),
            'k' => self.motion(area, CursorMove::Up),
            'w' => self.motion(area, CursorMove::WordForward),
            'b' => self.motion(area, CursorMove::WordBack),
            'e' => self.motion(area, CursorMove::WordEnd),
            '0' => self.motion(area, CursorMove::Head),
            '$' => self.motion(area, CursorMove::End),
            '{' => self.motion(area, CursorMove::ParagraphBack),
            '}' => self.motion(area, CursorMove::ParagraphForward),
            'G' => {
                self.count = None;
                area.move_cursor(CursorMove::Bottom);
                VimAction::Moved
            }

            // ── Pending operators ──────────────────────────────────────────
            'd' | 'y' | 'g' => {
                self.pending = Some(ch);
                VimAction::Moved
            }

            // ── Entering insert mode ───────────────────────────────────────
            'i' => self.enter_insert(area, None),
            'a' => self.enter_insert(area, Some(CursorMove::Forward)),
            'I' => self.enter_insert(area, Some(CursorMove::Head)),
            'A' => self.enter_insert(area, Some(CursorMove::End)),
            'o' => {
                area.move_cursor(CursorMove::End);
                area.insert_newline();
                self.mode = Mode::Insert;
                VimAction::Edited
            }
            'O' => {
                area.move_cursor(CursorMove::Head);
                area.insert_newline();
                area.move_cursor(CursorMove::Up);
                self.mode = Mode::Insert;
                VimAction::Edited
            }

            // ── Edits ──────────────────────────────────────────────────────
            'x' => {
                let count = self.take_count();
                let mut changed = false;
                for _ in 0..count {
                    changed |= area.delete_next_char();
                }
                self.after_edit(area, changed)
            }
            'D' => {
                let changed = area.delete_line_by_end();
                self.after_edit(area, changed)
            }
            'C' => {
                let changed = area.delete_line_by_end();
                self.mode = Mode::Insert;
                let _ = changed;
                VimAction::Edited
            }
            'p' => {
                let changed = area.paste();
                self.after_edit(area, changed)
            }
            'u' => {
                let changed = area.undo();
                self.after_edit(area, changed)
            }

            // ── Visual mode ────────────────────────────────────────────────
            'v' => {
                if self.mode == Mode::Visual {
                    self.mode = Mode::Normal;
                    area.cancel_selection();
                } else {
                    self.mode = Mode::Visual;
                    area.start_selection();
                }
                VimAction::Moved
            }

            // ── Prompts, handled by the app ────────────────────────────────
            ':' => VimAction::EnterCommand,
            '/' => VimAction::EnterSearch,
            'n' => VimAction::SearchNext(true),
            'N' => VimAction::SearchNext(false),

            _ => VimAction::Ignored,
        }
    }

    /// Apply a motion `count` times, extending the selection in visual mode.
    ///
    /// `TextArea` keeps the selection anchored once `start_selection` is called,
    /// so visual mode needs no special handling beyond not cancelling it.
    fn motion(&mut self, area: &mut TextArea<'static>, movement: CursorMove) -> VimAction {
        let count = self.take_count();
        for _ in 0..count {
            area.move_cursor(movement);
        }
        VimAction::Moved
    }

    fn enter_insert(
        &mut self,
        area: &mut TextArea<'static>,
        pre_move: Option<CursorMove>,
    ) -> VimAction {
        if let Some(movement) = pre_move {
            area.move_cursor(movement);
        }
        self.mode = Mode::Insert;
        area.cancel_selection();
        VimAction::Moved
    }

    /// Resolve a two-key sequence such as `dd`, `dw`, `yy` or `gg`.
    fn finish_operator(
        &mut self,
        area: &mut TextArea<'static>,
        operator: char,
        second: char,
    ) -> VimAction {
        let count = self.take_count();
        match (operator, second) {
            // `gg` — jump to the top of the buffer.
            ('g', 'g') => {
                area.move_cursor(CursorMove::Top);
                VimAction::Moved
            }
            // `dd` — delete whole lines. Deleting to end-of-line then removing
            // the newline is what collapses the line into the previous one.
            ('d', 'd') => {
                let mut changed = false;
                for _ in 0..count {
                    area.move_cursor(CursorMove::Head);
                    changed |= area.delete_line_by_end();
                    changed |= area.delete_next_char();
                }
                self.after_edit(area, changed)
            }
            // `dw` — delete forward by word.
            ('d', 'w') => {
                let mut changed = false;
                for _ in 0..count {
                    changed |= area.delete_next_word();
                }
                self.after_edit(area, changed)
            }
            ('d', 'b') => {
                let mut changed = false;
                for _ in 0..count {
                    changed |= area.delete_word();
                }
                self.after_edit(area, changed)
            }
            ('d', '$') => {
                let changed = area.delete_line_by_end();
                self.after_edit(area, changed)
            }
            ('d', '0') => {
                let changed = area.delete_line_by_head();
                self.after_edit(area, changed)
            }
            // `yy` — yank the current line into the widget's paste buffer.
            ('y', 'y') => {
                area.move_cursor(CursorMove::Head);
                area.start_selection();
                area.move_cursor(CursorMove::End);
                area.copy();
                area.cancel_selection();
                VimAction::Moved
            }
            ('y', 'w') => {
                area.start_selection();
                for _ in 0..count {
                    area.move_cursor(CursorMove::WordForward);
                }
                area.copy();
                area.cancel_selection();
                VimAction::Moved
            }
            _ => VimAction::Ignored,
        }
    }

    /// Shared tail for editing commands: leave visual mode and report whether
    /// the buffer actually changed, so clean no-ops do not start the debounce.
    fn after_edit(&mut self, area: &mut TextArea<'static>, changed: bool) -> VimAction {
        if self.mode == Mode::Visual {
            self.mode = Mode::Normal;
            area.cancel_selection();
        }
        if changed {
            VimAction::Edited
        } else {
            VimAction::Moved
        }
    }

    fn reset_pending(&mut self) {
        self.pending = None;
        self.count = None;
    }
}
