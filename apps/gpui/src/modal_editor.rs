//! Shared modal editing path for notes and ordinary text files.
use super::*;

pub fn key(
    vim: &mut vim::Vim,
    editor: &Entity<EditorState>,
    event: &KeyDownEvent,
    window: &mut Window,
    cx: &mut App,
) -> Option<bool> {
    use gpui_kit::component::input::{MoveDown, MoveUp, Redo, Search, Undo};
    if !editor.focus_handle(cx).is_focused(window) {
        return None;
    }
    let stroke = &event.keystroke;
    if stroke.modifiers.platform || stroke.modifiers.alt {
        return None;
    }
    let key = keyboard::modal_key(stroke);
    if stroke.modifiers.control
        && !matches!(key.as_str(), "ctrl-r" | "ctrl-[" | "ctrl-j" | "ctrl-k")
    {
        return None;
    }
    if key == "ctrl-j" || key == "ctrl-k" {
        for _ in 0..5 {
            window.dispatch_action(
                if key == "ctrl-j" {
                    Box::new(MoveDown)
                } else {
                    Box::new(MoveUp)
                },
                cx,
            );
        }
        window.prevent_default();
        cx.stop_propagation();
        return Some(false);
    }
    let value = editor.read(cx).value();
    let cursor = editor.read(cx).cursor();
    let literal = stroke.key_char.as_deref().unwrap_or(&stroke.key);
    let Some(effects) = vim.key(&key, literal, &value, cursor) else {
        return None;
    };
    window.prevent_default();
    cx.stop_propagation();
    // Read-only Normal/Visual modes also reject IME commits and native paste.
    // Modal edit effects temporarily enter the engine's editable path.
    editor.update(cx, |state, cx| state.set_readonly(false, cx));
    let mut native_motion = false;
    for effect in effects {
        match effect {
            vim::Effect::Select(range) => {
                editor.update(cx, |state, cx| state.set_selected_range(range, cx))
            }
            vim::Effect::Replace(range, text, cursor) => editor.update(cx, |state, cx| {
                state.set_selected_range(range, cx);
                state.replace(text, window, cx);
                state.set_selected_range(cursor..cursor, cx);
            }),
            vim::Effect::Vertical(down, count) => {
                if vim.visual() {
                    let head = vim.head;
                    editor.update(cx, |state, cx| state.set_selected_range(head..head, cx));
                }
                for _ in 0..count {
                    window.dispatch_action(
                        if down {
                            Box::new(MoveDown)
                        } else {
                            Box::new(MoveUp)
                        },
                        cx,
                    );
                }
                native_motion = true;
            }
            vim::Effect::Undo => window.dispatch_action(Box::new(Undo), cx),
            vim::Effect::Redo => window.dispatch_action(Box::new(Redo), cx),
            vim::Effect::Search => window.dispatch_action(Box::new(Search), cx),
        }
    }
    Some(native_motion)
}
