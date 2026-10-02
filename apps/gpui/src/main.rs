mod commands;
mod cursor;
mod editor;
mod jobs;
mod settings;
mod ui;
mod updater;
mod workspace;
use std::{
    collections::{HashMap, HashSet},
    time::{Duration, Instant},
};
use type_core::{FolderNode, NotePreviewEntry, NotesProfilesSnapshot};
use type_gpui::{
    backend::Backend,
    document, keyboard,
    navigation::{self, Filter, View},
    preferences::{self, Preferences},
    vim,
};

use gpui_kit::{
    component::{
        ActiveTheme, Icon, IconName, Sizable, Theme, ThemeMode, TitleBar,
        button::{Button, ButtonVariants},
        command::{Command as CommandPalette, CommandGroup, CommandItem, CommandState},
        h_flex,
        input::{
            Editor, EditorState, Input, InputEvent, InputState, RangeDecoration,
            RangeDecorationCollection, RangeDecorationStyle, TabSize, TextDecoration,
            TextDecorationCollection,
        },
        list::ListItem,
        menu::{ContextMenuExt, DropdownMenu, PopupMenu, PopupMenuItem},
        resizable::{h_resizable, resizable_panel},
        tree::{TreeItem, TreeState, tree},
        v_flex,
    },
    prelude::*,
    *,
};

actions!(type_app, [Quit]);

struct Note {
    title: SharedString,
    saved_body: String,
    initial_body: String,
    dirty: bool,
    draft_folder: Option<String>,
    fills: Option<RangeDecorationCollection>,
    markers: Option<TextDecorationCollection>,
    editor: Option<Entity<EditorState>>,
}
struct TypeApp {
    updater: Option<updater::Updater>,
    backend: Backend,
    profiles: NotesProfilesSnapshot,
    prefs: Preferences,
    locked: bool,
    focus: FocusHandle,
    navigation_focus: FocusHandle,
    view: View,
    navigation_focused: bool,
    filter: Filter,
    folder_tree: Option<FolderNode>,
    previews: HashMap<String, NotePreviewEntry>,
    nav_items: Vec<navigation::Item>,
    selected: HashSet<SharedString>,
    saved_selection: HashMap<View, SharedString>,
    expanded_by_view: HashMap<View, HashSet<SharedString>>,
    settings: bool,
    settings_section: settings::Section,
    modal: Option<commands::Modal>,
    modal_subscription: Option<Subscription>,
    status: String,
    error: Option<String>,
    busy: bool,
    loading: bool,
    refreshing: bool,
    suppress_selection: bool,
    revision: usize,
    refresh_task: Option<Task<()>>,
    save_task: Option<Task<()>>,
    poll_task: Option<Task<()>>,
    job_task: Option<Task<()>>,
    recording: bool,
    capture: Option<jobs::Capture>,
    pending_recording: Option<std::sync::Arc<(Vec<u8>, String)>>,
    processing_status: String,
    local_server: Option<type_core::LocalSyncServerStatus>,
    job_status: String,
    vim: vim::Vim,
    roots: Vec<TreeItem>,
    tree: Entity<TreeState>,
    notes: HashMap<SharedString, Note>,
    active: SharedString,
    folder_ids: HashSet<SharedString>,
    drop_target: Option<(SharedString, tree_moves::Placement)>,
    drag_task: Option<Task<()>>,
    drag_pointer: Option<(SharedString, Point<Pixels>, Bounds<Pixels>)>,
    hover_since: Instant,
    tag_count: usize,
    tag_task: Option<Task<()>>,
    subscriptions: Vec<Subscription>,
}
mod tree_moves;
impl TypeApp {
    fn vim_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        use gpui_kit::component::input::{MoveDown, MoveUp, Redo, Search, Undo};
        if event.keystroke.key == "escape" && cx.has_active_drag() {
            cx.stop_active_drag(window);
            self.drop_target = None;
            self.drag_pointer = None;
            self.drag_task = None;
            window.prevent_default();
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if !self.prefs.vim {
            return;
        }
        let Some(note) = self.notes.get_mut(&self.active) else {
            return;
        };
        let Some(editor) = note.editor.as_ref().cloned() else {
            return;
        };
        if !editor.focus_handle(cx).is_focused(window) {
            return;
        }
        let stroke = &event.keystroke;
        if stroke.modifiers.platform || stroke.modifiers.alt {
            return;
        }
        let key = keyboard::modal_key(stroke);
        if stroke.modifiers.control
            && !matches!(key.as_str(), "ctrl-r" | "ctrl-[" | "ctrl-j" | "ctrl-k")
        {
            return;
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
            return;
        }
        let value = editor.read(cx).value();
        let cursor = editor.read(cx).cursor();
        let literal = stroke.key_char.as_deref().unwrap_or(&stroke.key);
        let Some(effects) = self.vim.key(&key, literal, &value, cursor) else {
            return;
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
                    if self.vim.visual() {
                        let head = self.vim.head;
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
        let id = self.active.clone();
        let view = cx.weak_entity();
        // Native actions are deferred by GPUI. Restore the gate after they run.
        window.defer(cx, move |_, cx| {
            let _ = view.update(cx, |this, cx| {
                if this.active != id {
                    return;
                }
                if native_motion {
                    let state = editor.read(cx);
                    let range = this.vim.finish_motion(&state.value(), state.cursor());
                    if this.vim.visual() {
                        editor.update(cx, |state, cx| state.set_selected_range(range, cx));
                    }
                }
                editor.update(cx, |state, cx| {
                    state.set_readonly(this.prefs.vim && this.vim.mode != vim::Mode::Insert, cx)
                });
                cx.notify();
            });
        });
        cx.notify();
    }

    fn toggle_vim(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.prefs.vim = !self.prefs.vim;
        self.vim.reset();
        if let Some(editor) = self
            .notes
            .get(&self.active)
            .and_then(|note| note.editor.as_ref())
        {
            editor.update(cx, |state, cx| {
                state.set_readonly(self.prefs.vim, cx);
                if !self.settings {
                    state.focus(window, cx);
                }
            });
        }
        self.persist_preferences();
        cx.notify();
    }

    fn schedule_tags(&mut self, cx: &mut Context<Self>) {
        let delay = cx.background_executor().timer(Duration::from_millis(120));
        self.tag_task = Some(cx.spawn(async move |view, cx| {
            delay.await;
            let _ = view.update(cx, |this, cx| this.refresh_tags(cx));
        }));
    }

    fn refresh_tags(&mut self, cx: &mut Context<Self>) {
        let Some(note) = self.notes.get(&self.active) else {
            return;
        };
        let text = note.editor.as_ref().unwrap().read(cx).value();
        let regions = document::tag_regions(&text);
        self.tag_count = regions.len();
        note.fills.as_ref().unwrap().set(
            regions
                .iter()
                .map(|region| {
                    RangeDecoration::new(region.range.clone())
                        .with_style(RangeDecorationStyle::Fill)
                        .with_color(tag_color(&region.tag).opacity(0.18))
                })
                .collect(),
            cx,
        );
        note.markers.as_ref().unwrap().set(
            regions
                .iter()
                .map(|region| {
                    TextDecoration::new(
                        region.marker.clone(),
                        HighlightStyle {
                            color: Some(tag_color(&region.tag)),
                            font_weight: Some(FontWeight::SEMIBOLD),
                            ..Default::default()
                        },
                    )
                })
                .collect(),
            cx,
        );
        cx.notify();
    }

    fn tag_selection(
        &mut self,
        tag: &str,
        block: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.locked || self.busy {
            return;
        }
        let Some(editor) = self.notes.get(&self.active).and_then(|n| n.editor.clone()) else {
            return;
        };
        editor.update(cx, |state, cx| {
            state.set_readonly(false, cx);
            let text = state.value();
            let range = document::whole_lines(&text, state.selected_range());
            let content = &text[range.clone()];
            let replacement = if block {
                // A longer outer fence avoids closing an existing nested scope.
                let size = content
                    .lines()
                    .map(|line| line.chars().take_while(|c| *c == ':').count())
                    .max()
                    .unwrap_or(0)
                    .max(2)
                    + 1;
                let fence = ":".repeat(size);
                format!("{fence} #{tag}\n{content}\n{fence}")
            } else {
                // Blank boundaries keep a line tag from swallowing adjacent soft lines.
                let before = if range.start > 0 && !text[..range.start].ends_with("\n\n") {
                    "\n"
                } else {
                    ""
                };
                let after = if range.end < text.len() && !text[range.end..].starts_with("\n\n") {
                    "\n"
                } else {
                    ""
                };
                format!("{before}#{tag} {content}{after}")
            };
            state.set_selected_range(range, cx);
            state.replace(replacement, window, cx);
            state.set_readonly(self.prefs.vim && self.vim.mode != vim::Mode::Insert, cx);
            state.focus(window, cx);
        });
        self.refresh_tags(cx);
    }

    // One hit test for the entire viewport. GPUI drag-move callbacks are global,
    // not row-hover callbacks; virtual rows must never compete to set the target.
    fn update_drag(&mut self, cx: &mut Context<Self>) {
        let Some((source, pointer, bounds)) = self.drag_pointer.clone() else {
            return;
        };
        if !cx.has_active_drag() || !bounds.contains(&pointer) {
            self.drop_target = None;
            cx.notify();
            return;
        }
        let scroll = self
            .tree
            .read(cx)
            .scroll_handle()
            .0
            .borrow()
            .base_handle
            .clone();
        let y = f32::from(pointer.y - bounds.origin.y);
        let height = f32::from(bounds.size.height);
        let velocity = if y < 40. {
            (40. - y) / 4.
        } else if y > height - 40. {
            -(y - height + 40.) / 4.
        } else {
            0.
        };
        if velocity != 0. {
            let offset = scroll.offset();
            scroll.set_offset(point(offset.x, offset.y + px(velocity)));
        }
        let content_y = y - f32::from(scroll.offset().y);
        let index = (content_y.max(0.) / 36.).floor() as usize;
        let candidate = self.tree.read(cx).entry(index).and_then(|entry| {
            let id = &entry.item().id;
            let fraction = (content_y % 36.) / 36.;
            let placement = tree_moves::placement_at(fraction, self.folder_ids.contains(id));
            (!id.starts_with("feed:") && tree_moves::can_move(&self.roots, &source, id))
                .then(|| (id.clone(), placement))
        });
        if candidate != self.drop_target {
            self.hover_since = Instant::now();
            self.drop_target = candidate;
        }
        if let Some((id, tree_moves::Placement::Inside)) = &self.drop_target {
            if self.hover_since.elapsed() >= Duration::from_millis(600) {
                if let Some(item) =
                    tree_moves::find(&self.roots, id).filter(|item| !item.is_expanded())
                {
                    item.clone().expanded(true);
                    let selected = self.tree.read(cx).selected_item().cloned();
                    self.tree.update(cx, |state, cx| {
                        state.set_items(self.roots.clone(), cx);
                        state.set_selected_item(selected.as_ref(), cx);
                    });
                }
            }
        }
        cx.notify();
    }

    fn track_drag(&mut self, event: &DragMoveEvent<DraggedRow>, cx: &mut Context<Self>) {
        self.drag_pointer = Some((
            event.drag(cx).id.clone(),
            event.event.position,
            event.bounds,
        ));
        self.update_drag(cx);
        if self.drag_task.is_none() {
            self.drag_task = Some(cx.spawn(async move |view, cx| {
                loop {
                    cx.background_executor()
                        .timer(Duration::from_millis(16))
                        .await;
                    let keep = view
                        .update(cx, |this, cx| {
                            if !cx.has_active_drag() {
                                this.drop_target = None;
                                this.drag_pointer = None;
                                this.drag_task = None;
                                cx.notify();
                                false
                            } else {
                                this.update_drag(cx);
                                true
                            }
                        })
                        .unwrap_or(false);
                    if !keep {
                        break;
                    }
                }
            }));
        }
    }

    fn render_tree(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.weak_entity();
        let folders = self.folder_ids.clone();
        let multi = self.selected.clone();
        let stream = self.view == View::Feed;
        let note_markers: HashMap<SharedString, (bool, bool)> = self
            .previews
            .iter()
            .map(|(path, preview)| {
                (
                    path.clone().into(),
                    (
                        preview.meta.archived_ms.is_some(),
                        preview.meta.reviewed_ms.is_some(),
                    ),
                )
            })
            .collect();
        let drop_target = cx
            .has_active_drag()
            .then(|| self.drop_target.clone())
            .flatten();
        fn count_notes(
            items: &[navigation::Item],
            counts: &mut HashMap<SharedString, usize>,
        ) -> usize {
            items
                .iter()
                .map(|item| {
                    if item.folder {
                        let count = count_notes(&item.children, counts);
                        counts.insert(item.id.clone().into(), count);
                        count
                    } else {
                        1
                    }
                })
                .sum()
        }
        let mut counts = HashMap::new();
        count_notes(&self.nav_items, &mut counts);
        let menu_view = view.clone();
        let menu_folders = folders.clone();
        tree(&self.tree, move |_, entry, selected, _, cx| {
            let id = entry.item().id.clone();
            let is_folder = folders.contains(&id);
            let is_section = stream && id.starts_with("feed:section:");
            let is_earlier = id == "feed:section:earlier";
            let (archived, reviewed) = note_markers.get(&id).copied().unwrap_or_default();
            let click_view = view.clone();
            let click_id = id.clone();
            let drop_view = view.clone();
            let drop_id = id.clone();
            let icon = if is_folder {
                if entry.is_expanded() {
                    IconName::FolderOpen
                } else {
                    IconName::Folder
                }
            } else {
                IconName::FileText
            };
            let placement = drop_target
                .as_ref()
                .filter(|(target, _)| *target == id)
                .map(|(_, position)| *position);
            ListItem::new(SharedString::from(format!("nav-row-{id}")))
                .selected(selected)
                .when(multi.contains(&id), |row| row.bg(cx.theme().accent))
                .h(px(if is_section { 29. } else { 32. }))
                .when(is_section, |row| row.text_xs())
                .when(!is_section, |row| row.text_sm())
                .px_2()
                .pl(px(12.
                    + 16.
                        * entry.depth().saturating_sub(usize::from(stream))
                            as f32))
                .when(placement == Some(tree_moves::Placement::Before), |row| {
                    row.border_t_2().border_color(cx.theme().primary)
                })
                .when(placement == Some(tree_moves::Placement::After), |row| {
                    row.border_b_2().border_color(cx.theme().primary)
                })
                .when(placement == Some(tree_moves::Placement::Inside), |row| {
                    row.bg(cx.theme().accent)
                })
                .child(
                    h_flex()
                        .w_full()
                        .gap_2()
                        .child(div().w(px(12.)).when(
                            is_folder && (!is_section || is_earlier),
                            |cell| {
                                cell.child(
                                    Icon::new(if entry.is_expanded() {
                                        IconName::ChevronDown
                                    } else {
                                        IconName::ChevronRight
                                    })
                                    .size(px(12.)),
                                )
                            },
                        ))
                        .when(!is_section, |row| {
                            row.child(
                                Icon::new(icon)
                                    .size(px(15.))
                                    .text_color(cx.theme().muted_foreground),
                            )
                        })
                        .child(
                            div()
                                .flex_1()
                                .overflow_hidden()
                                .text_ellipsis()
                                .child(entry.item().label.clone()),
                        )
                        .when(is_folder && !is_section, |row| {
                            row.child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(
                                        counts
                                            .get(&id)
                                            .filter(|n| **n > 0)
                                            .map(ToString::to_string)
                                            .unwrap_or_default(),
                                    ),
                            )
                        })
                        .when(archived || reviewed, |row| {
                            row.child(
                                div()
                                    .text_xs()
                                    .text_color(cx.theme().muted_foreground)
                                    .child(if archived { "Archived" } else { "Reviewed" }),
                            )
                        }),
                )
                .on_drag(
                    DraggedRow {
                        id: id.clone(),
                        label: entry.item().label.clone(),
                    },
                    |drag, _, _, cx| cx.new(|_| drag.clone()),
                )
                .on_drop(move |drag: &DraggedRow, window, cx| {
                    let _ = drop_view.update(cx, |this, cx| {
                        if let Some((target, position)) = this
                            .drop_target
                            .clone()
                            .filter(|(target, _)| *target == drop_id)
                        {
                            this.move_row(drag.id.clone(), Some(target), position, window, cx);
                        }
                    });
                })
                // The stock tree toggles on mouse-down, which collapses a folder
                // before its drag can start. Defer activation until a real click.
                .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_click(move |event, window, cx| {
                    let _ = click_view.update(cx, |this, cx| {
                        if is_section && !is_earlier {
                            this.tree.update(cx, |tree, cx| tree.focus(window, cx));
                            return;
                        }
                        this.click_row(
                            click_id.clone(),
                            is_folder,
                            event.modifiers().shift
                                || event.modifiers().platform
                                || event.modifiers().control,
                            window,
                            cx,
                        )
                    });
                })
                .text_color(if is_section {
                    cx.theme().muted_foreground
                } else {
                    cx.theme().foreground
                })
        })
        .context_menu(move |_, entry, menu, _, _| {
            Self::menu_for(
                menu_view.clone(),
                entry.item().id.clone(),
                menu_folders.contains(&entry.item().id),
                menu,
            )
        })
    }

    fn tag_menu(&self, block: bool, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.weak_entity();
        Button::new(if block { "tag-block" } else { "tag-line" })
            .ghost()
            .small()
            .label(if block { "Tag block" } else { "Tag line" })
            .dropdown_menu(move |mut menu, _, _| {
                for tag in ["todo", "idea", "work"] {
                    let view = view.clone();
                    menu = menu.item(PopupMenuItem::new(format!("#{tag}")).on_click(
                        move |_, window, cx| {
                            let _ = view
                                .update(cx, |this, cx| this.tag_selection(tag, block, window, cx));
                        },
                    ));
                }
                menu
            })
    }
}
#[derive(Clone)]
struct DraggedRow {
    id: SharedString,
    label: SharedString,
}
impl Render for DraggedRow {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .px_3()
            .py_2()
            .rounded_md()
            .bg(cx.theme().popover)
            .border_1()
            .border_color(cx.theme().border)
            .child(self.label.clone())
    }
}

fn tag_color(tag: &str) -> Hsla {
    let hash = tag.bytes().fold(0u32, |hash, byte| {
        hash.wrapping_mul(31).wrapping_add(byte as u32)
    });
    hsla((hash % 360) as f32 / 360., 0.7, 0.7, 1.)
}

fn parent_folder(items: &[TreeItem], target: &SharedString) -> Option<SharedString> {
    for item in items {
        if item.children.iter().any(|child| child.id == *target) {
            return Some(item.id.clone());
        }
        if let Some(parent) = parent_folder(&item.children, target) {
            return Some(parent);
        }
    }
    None
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let Some(data_home) = dirs::data_local_dir() else {
        eprintln!("No application-data directory.");
        return;
    };
    let env = match preferences::environment(&args, &data_home) {
        Ok(env) => env,
        Err(e) => {
            eprintln!("{e}");
            return;
        }
    };
    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(move |cx| {
            gpui_kit::init(cx);
            cx.bind_keys([KeyBinding::new("secondary-q", Quit, Some("Type"))]);
            cx.on_window_closed(|cx, _| {
                if cx.windows().is_empty() {
                    cx.quit();
                }
            })
            .detach();
            cx.activate(true);
            let bounds = Bounds::centered(None, size(px(1150.), px(780.)), cx);
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    window_min_size: Some(size(px(760.), px(480.))),
                    ..TitleBar::window_options()
                },
                cx,
                move |window, cx| cx.new(|cx| TypeApp::new(env, window, cx)),
            )
            .expect("Failed to open Type");
        });
}

#[cfg(test)]
mod tests;
