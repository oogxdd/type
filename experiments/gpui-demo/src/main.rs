mod document;
mod sample_data;
mod tree_moves;

use std::{
    collections::{HashMap, HashSet},
    time::Duration,
};

use gpui_kit::{
    component::{
        ActiveTheme, IconName, Sizable, Theme, ThemeMode,
        button::{Button, ButtonVariants},
        h_flex,
        input::{
            Editor, EditorState, InputEvent, RangeDecoration, RangeDecorationCollection,
            RangeDecorationStyle, TabSize, TextDecoration, TextDecorationCollection,
        },
        list::ListItem,
        menu::{DropdownMenu, PopupMenu, PopupMenuItem},
        resizable::{h_resizable, resizable_panel},
        tree::{TreeItem, TreeState, tree},
        v_flex,
    },
    prelude::*,
    *,
};

struct Note {
    title: SharedString,
    frontmatter: String,
    initial_body: String,
    fills: Option<RangeDecorationCollection>,
    markers: Option<TextDecorationCollection>,
    editor: Option<Entity<EditorState>>,
}

struct Demo {
    roots: Vec<TreeItem>,
    tree: Entity<TreeState>,
    notes: HashMap<SharedString, Note>,
    active: SharedString,
    folder_ids: HashSet<SharedString>,
    drop_target: Option<(SharedString, tree_moves::Placement)>,
    tag_count: usize,
    next_id: usize,
    tag_task: Option<Task<()>>,
    subscriptions: Vec<Subscription>,
}

impl Demo {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let (roots, samples) = sample_data::samples();
        let tree = cx.new(|cx| TreeState::new(cx).items(roots.clone()));
        tree.update(cx, |state, cx| state.set_selected_index(Some(0), cx));
        let notes = samples
            .into_iter()
            .map(|sample| {
                let (frontmatter, body) = document::split_frontmatter(&sample.body);
                (
                    sample.id.into(),
                    Note {
                        title: sample.title.into(),
                        frontmatter,
                        initial_body: body,
                        fills: None,
                        markers: None,
                        editor: None,
                    },
                )
            })
            .collect();
        let mut demo = Self {
            folder_ids: collect_folders(&roots),
            roots,
            tree: tree.clone(),
            notes,
            active: "welcome".into(),
            drop_target: None,
            tag_count: 0,
            next_id: 1,
            tag_task: None,
            subscriptions: Vec::new(),
        };
        demo.subscriptions
            .push(cx.observe_in(&tree, window, |this, state, window, cx| {
                let id = state.read(cx).selected_item().map(|item| item.id.clone());
                if let Some(id) = id.filter(|id| this.notes.contains_key(id) && *id != this.active)
                {
                    // Arrow navigation keeps focus in the tree; clicking a note focuses its editor.
                    this.open_note(id, false, window, cx);
                }
            }));
        demo.open_note("welcome".into(), true, window, cx);
        demo
    }

    fn ensure_editor(
        &mut self,
        id: &SharedString,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<EditorState> {
        if let Some(editor) = self.notes[id].editor.as_ref() {
            return editor.clone();
        }
        let body = self.notes[id].initial_body.clone();
        let editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .language("plaintext")
                .line_number(false)
                .soft_wrap(true)
                .tab_size(TabSize {
                    tab_size: 2,
                    hard_tabs: false,
                })
                .default_value(body)
        });
        let note_id = id.clone();
        self.subscriptions.push(
            cx.subscribe(&editor, move |this, _, event: &InputEvent, cx| {
                if matches!(event, InputEvent::Change) && this.active == note_id {
                    this.schedule_tags(cx);
                }
            }),
        );
        let (fills, markers) = editor.update(cx, |state, cx| {
            (
                state.create_range_decorations_collection(Vec::new(), cx),
                state.create_decorations_collection(Vec::new(), cx),
            )
        });
        let note = self.notes.get_mut(id).unwrap();
        note.editor = Some(editor.clone());
        note.fills = Some(fills);
        note.markers = Some(markers);
        editor
    }

    fn open_note(
        &mut self,
        id: SharedString,
        focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.notes.contains_key(&id) {
            return;
        }
        self.tag_task = None;
        let editor = self.ensure_editor(&id, window, cx);
        self.active = id;
        self.refresh_tags(cx);
        if focus {
            let handle = editor.focus_handle(cx);
            window.defer(cx, move |window, cx| handle.focus(window, cx));
        }
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
        let note = &self.notes[&self.active];
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
        let editor = self.notes[&self.active].editor.as_ref().unwrap().clone();
        editor.update(cx, |state, cx| {
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
            state.focus(window, cx);
        });
        self.refresh_tags(cx);
    }

    fn move_row(
        &mut self,
        source: SharedString,
        target: Option<SharedString>,
        placement: tree_moves::Placement,
        cx: &mut Context<Self>,
    ) {
        if placement == tree_moves::Placement::Inside
            && !target
                .as_ref()
                .is_some_and(|id| self.folder_ids.contains(id))
        {
            return;
        }
        if tree_moves::move_item(&mut self.roots, &source, target.as_ref(), placement) {
            self.drop_target = None;
            self.rebuild_tree(&source, cx);
            cx.notify();
        }
    }

    fn rebuild_tree(&mut self, selected: &SharedString, cx: &mut Context<Self>) {
        let roots = self.roots.clone();
        let item = TreeItem::new(selected.clone(), "");
        self.tree.update(cx, |state, cx| {
            state.set_items(roots, cx);
            state.set_selected_item(Some(&item), cx);
            state.reveal_item(selected, ScrollStrategy::Center, cx);
        });
    }

    fn add_note(
        &mut self,
        folder: SharedString,
        source: Option<SharedString>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let id: SharedString = format!("new-{}", self.next_id).into();
        self.next_id += 1;
        let (title, body) = if let Some(source) = source {
            let note = &self.notes[&source];
            let body = note
                .editor
                .as_ref()
                .map(|editor| editor.read(cx).value().to_string())
                .unwrap_or_else(|| note.initial_body.clone());
            (format!("{} copy", note.title), body)
        } else {
            (
                format!("New note {}", self.next_id - 1),
                "Start typing here.\n".into(),
            )
        };
        let item = TreeItem::new(id.clone(), title.clone());
        if !append_to_folder(&mut self.roots, &folder, item.clone()) {
            self.roots.push(item);
        }
        self.notes.insert(
            id.clone(),
            Note {
                title: title.into(),
                frontmatter: format!("---\nid: demo-{id}\ncreated: 2026-09-30T12:00:00Z\n---\n"),
                initial_body: body,
                fills: None,
                markers: None,
                editor: None,
            },
        );
        self.rebuild_tree(&id, cx);
        self.open_note(id, true, window, cx);
    }

    fn menu_for(
        view: WeakEntity<Self>,
        id: SharedString,
        is_folder: bool,
        menu: PopupMenu,
    ) -> PopupMenu {
        if is_folder {
            return menu.label("Sample folder").item(
                PopupMenuItem::new("New note here")
                    .icon(IconName::Plus)
                    .on_click(move |_, window, cx| {
                        let _ =
                            view.update(cx, |this, cx| this.add_note(id.clone(), None, window, cx));
                    }),
            );
        }
        let open_view = view.clone();
        let open_id = id.clone();
        let duplicate_view = view.clone();
        let duplicate_id = id.clone();
        let copy_view = view.clone();
        let copy_id = id.clone();
        menu.label("Sample note")
            .item(PopupMenuItem::new("Open").on_click(move |_, window, cx| {
                let _ = open_view.update(cx, |this, cx| {
                    this.rebuild_tree(&open_id, cx);
                    this.open_note(open_id.clone(), true, window, cx);
                });
            }))
            .item(
                PopupMenuItem::new("Duplicate")
                    .icon(IconName::Copy)
                    .on_click(move |_, window, cx| {
                        let _ = duplicate_view.update(cx, |this, cx| {
                            let folder = parent_folder(&this.roots, &duplicate_id)
                                .unwrap_or_else(|| "playground".into());
                            this.add_note(folder, Some(duplicate_id.clone()), window, cx);
                        });
                    }),
            )
            .item(
                PopupMenuItem::new("Copy .md with frontmatter").on_click(move |_, _, cx| {
                    let _ = copy_view.update(cx, |this, cx| {
                        let note = &this.notes[&copy_id];
                        let text = note
                            .editor
                            .as_ref()
                            .map(|editor| editor.read(cx).value().to_string())
                            .unwrap_or_else(|| note.initial_body.clone());
                        cx.write_to_clipboard(ClipboardItem::new_string(format!(
                            "{}{text}",
                            note.frontmatter
                        )));
                    });
                }),
            )
            .separator()
            .item(
                PopupMenuItem::new("Restore sample").on_click(move |_, window, cx| {
                    let _ = view.update(cx, |this, cx| {
                        let editor = this.ensure_editor(&id, window, cx);
                        let body = this.notes[&id].initial_body.clone();
                        editor.update(cx, |state, cx| state.set_value(body, window, cx));
                        if this.active == id {
                            this.open_note(id.clone(), true, window, cx);
                        }
                    });
                }),
            )
    }

    fn render_tree(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.weak_entity();
        let folders = self.folder_ids.clone();
        let drop_target = cx
            .has_active_drag()
            .then(|| self.drop_target.clone())
            .flatten();
        tree(&self.tree, move |ix, entry, selected, _, cx| {
            let id = entry.item().id.clone();
            let is_folder = folders.contains(&id);
            let click_view = view.clone();
            let click_id = id.clone();
            let menu_view = view.clone();
            let menu_id = id.clone();
            let hover_view = view.clone();
            let hover_id = id.clone();
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
            ListItem::new(ix)
                .selected(selected)
                .h(px(36.))
                .px_2()
                .pl(px(12. + 16. * entry.depth() as f32))
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
                        .child(icon)
                        .child(
                            div()
                                .flex_1()
                                .overflow_hidden()
                                .text_ellipsis()
                                .child(entry.item().label.clone()),
                        )
                        .child(
                            Button::new(SharedString::from(format!("menu-{id}")))
                                .ghost()
                                .xsmall()
                                .icon(IconName::Ellipsis)
                                .tooltip("Actions")
                                .dropdown_menu(move |menu, _, _| {
                                    Self::menu_for(
                                        menu_view.clone(),
                                        menu_id.clone(),
                                        is_folder,
                                        menu,
                                    )
                                }),
                        ),
                )
                .on_drag(
                    DraggedRow {
                        id: id.clone(),
                        label: entry.item().label.clone(),
                    },
                    |drag, _, _, cx| cx.new(|_| drag.clone()),
                )
                .on_drag_move(move |event: &DragMoveEvent<DraggedRow>, _, cx| {
                    let dragged = event.drag(cx).id.clone();
                    let y =
                        (event.event.position.y - event.bounds.origin.y) / event.bounds.size.height;
                    let position = if is_folder && (0.25..0.75).contains(&y) {
                        tree_moves::Placement::Inside
                    } else if y < 0.5 {
                        tree_moves::Placement::Before
                    } else {
                        tree_moves::Placement::After
                    };
                    let _ = hover_view.update(cx, |this, cx| {
                        let candidate = tree_moves::can_move(&this.roots, &dragged, &hover_id)
                            .then(|| (hover_id.clone(), position));
                        if this.drop_target != candidate {
                            this.drop_target = candidate;
                            cx.notify();
                        }
                    });
                })
                .on_drop(move |drag: &DraggedRow, _, cx| {
                    let _ = drop_view.update(cx, |this, cx| {
                        if let Some((target, position)) = this
                            .drop_target
                            .clone()
                            .filter(|(target, _)| *target == drop_id)
                        {
                            this.move_row(drag.id.clone(), Some(target), position, cx);
                        }
                    });
                })
                .on_click(move |_, window, cx| {
                    if !is_folder {
                        let _ = click_view.update(cx, |this, cx| {
                            this.open_note(click_id.clone(), true, window, cx)
                        });
                    }
                })
                .text_color(cx.theme().foreground)
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

impl Render for Demo {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let note = &self.notes[&self.active];
        let editor = note.editor.as_ref().unwrap();
        v_flex().size_full().bg(cx.theme().background).text_color(cx.theme().foreground)
            .child(h_flex().h(px(60.)).flex_none().px_5().gap_3().border_b_1().border_color(cx.theme().border)
                .child(div().font_weight(FontWeight::SEMIBOLD).child("Type"))
                .child(div().text_sm().text_color(cx.theme().muted_foreground).child("GPUI playground")))
            .child(div().flex_1().min_h_0().child(h_resizable("main-panes")
                .child(resizable_panel().size(px(300.)).size_range(px(220.)..px(600.))
                    .child(v_flex().size_full()
                        .child(div().px_4().py_3().text_xs().font_weight(FontWeight::SEMIBOLD).text_color(cx.theme().muted_foreground).child("SAMPLE NOTES"))
                        .child(div().flex_1().min_h_0().child(self.render_tree(cx)))
                        .child(div().id("root-drop").px_4().py_3().border_t_1().border_color(cx.theme().border)
                            .text_sm().text_color(cx.theme().muted_foreground).child("Drop here to move to root")
                            .drag_over::<DraggedRow>(|style, _, _, cx| style.bg(cx.theme().accent))
                            .on_drop(cx.listener(|this, drag: &DraggedRow, _, cx| this.move_row(drag.id.clone(), None, tree_moves::Placement::Root, cx))))))
                .child(resizable_panel().size(px(850.)).size_range(px(420.)..px(1800.))
                    .child(v_flex().size_full()
                        .child(h_flex().px_6().py_4().gap_3().flex_none()
                            .child(div().flex_1().text_lg().font_weight(FontWeight::SEMIBOLD).child(note.title.clone()))
                            .child(self.tag_menu(false, cx)).child(self.tag_menu(true, cx)))
                        .child(div().px_6().pb_3().flex_none().text_xs().text_color(cx.theme().muted_foreground)
                            .child("Type text · #tag for a paragraph · ::: #tag for a block · edit tag names directly"))
                        .child(div().flex_1().min_h_0().px_5().pb_4().child(Editor::new(editor).bordered(false).h(relative(1.))
                            .text_size(px(17.)).font_family(cx.theme().font_family.clone())))))))
            .child(h_flex().h(px(30.)).flex_none().px_4().gap_3().border_t_1().border_color(cx.theme().border)
                .text_xs().text_color(cx.theme().muted_foreground)
                .child("Sample data · in memory").child(div().flex_1())
                .child(format!("{} tagged regions · frontmatter hidden", self.tag_count)))
    }
}

fn tag_color(tag: &str) -> Hsla {
    let hash = tag.bytes().fold(0u32, |hash, byte| {
        hash.wrapping_mul(31).wrapping_add(byte as u32)
    });
    hsla((hash % 360) as f32 / 360., 0.7, 0.7, 1.)
}

fn collect_folders(items: &[TreeItem]) -> HashSet<SharedString> {
    let mut folders = HashSet::new();
    for item in items {
        if item.is_folder() {
            folders.insert(item.id.clone());
            folders.extend(collect_folders(&item.children));
        }
    }
    folders
}

fn append_to_folder(items: &mut [TreeItem], folder: &SharedString, child: TreeItem) -> bool {
    for item in items {
        if item.id == *folder {
            item.children.push(child);
            return true;
        }
        if append_to_folder(&mut item.children, folder, child.clone()) {
            return true;
        }
    }
    false
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
    gpui_kit::application()
        .with_assets(gpui_kit::assets::Assets)
        .run(|cx| {
            gpui_kit::init(cx);
            Theme::change(ThemeMode::Dark, None, cx);
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
                    titlebar: Some(TitlebarOptions {
                        title: Some("Type GPUI Demo".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                cx,
                |window, cx| cx.new(|cx| Demo::new(window, cx)),
            )
            .expect("Failed to open the demo window");
        });
}
