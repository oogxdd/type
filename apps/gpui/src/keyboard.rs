//! One owner for application chords. Plain keys are dispatched only in the
//! focused pane, and Ctrl editing keys stay with Vim on macOS.
use gpui_kit::{KeyDownEvent, Keystroke};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command { Palette, Rail, Sidebar, Focus, Cycle, New, Trash, Delete, FontUp, FontDown, FontReset, Lock, Save, Settings, Refresh }
pub const SHORTCUTS: &[(&str, Command)] = &[
    ("k", Command::Palette), ("b", Command::Rail), ("t", Command::Sidebar),
    ("w", Command::Focus), ("j", Command::Cycle), ("n", Command::New),
    ("backspace", Command::Trash), ("shift-backspace", Command::Delete),
    ("=", Command::FontUp), ("+", Command::FontUp), ("-", Command::FontDown), ("0", Command::FontReset),
    ("shift-l", Command::Lock), ("s", Command::Save), (",", Command::Settings), ("r", Command::Refresh),
];

pub fn command(event: &KeyDownEvent, mac: bool, editor_focused: bool) -> Option<Command> {
    let stroke = &event.keystroke;
    let m = stroke.modifiers;
    let primary = if mac { m.platform && !m.control } else { m.control && !m.platform };
    if event.is_held || event.prefer_character_input || !primary || m.alt { return None; }
    // Control-J inside a non-mac editor belongs to editing. Focus still has Ctrl-W.
    if !mac && editor_focused && stroke.key == "j" { return None; }
    let key = if m.shift {
        if matches!(stroke.key.as_str(), "=" | "+") { "+".into() } else { format!("shift-{}", stroke.key) }
    } else { stroke.key.clone() };
    SHORTCUTS.iter().find(|(k, _)| *k == key).map(|(_, c)| *c)
}

/// GPUI gives an ASCII-equivalent key for non-Latin layouts; key_char stays
/// untouched for f/t/r literal targets and Insert mode IME input.
pub fn modal_key(stroke: &Keystroke) -> String {
    let key = &stroke.key;
    if stroke.modifiers.control { format!("ctrl-{key}") }
    else if stroke.modifiers.shift && key.len() == 1 {
        if key.chars().all(|c| c.is_ascii_alphabetic()) { key.to_uppercase() }
        else { stroke.key_char.clone().unwrap_or_else(|| key.clone()) }
    } else { key.clone() }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn event(keys: &str) -> KeyDownEvent { KeyDownEvent { keystroke: Keystroke::parse(keys).unwrap(), is_held: false, prefer_character_input: false } }
    #[test]
    fn global_chords_work_in_every_editor_mode_without_duplicate_owners() {
        let mut keys = std::collections::HashSet::new();
        for (key, action) in SHORTCUTS {
            assert!(keys.insert(key));
            assert_eq!(command(&event(&format!("cmd-{key}")), true, true), Some(*action));
            if *action != Command::Cycle { assert_eq!(command(&event(&format!("ctrl-{key}")), false, false), Some(*action)); }
        }
        assert_eq!(command(&event("ctrl-j"), false, true), None);
        assert_eq!(command(&event("ctrl-k"), true, true), None);
        assert_eq!(command(&event("cmd-alt-k"), true, true), None);
        let mut held = event("cmd-n"); held.is_held = true; assert_eq!(command(&held, true, false), None);
    }
    #[test]
    fn cyrillic_literal_is_kept_while_modal_command_uses_ascii_key() {
        let mut stroke = Keystroke::parse("d").unwrap(); stroke.key_char = Some("в".into());
        assert_eq!(modal_key(&stroke), "d"); assert_eq!(stroke.key_char.as_deref(), Some("в"));
    }
}
