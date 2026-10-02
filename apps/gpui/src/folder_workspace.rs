use super::*;
use std::path::{Path, PathBuf};
use type_gpui::files::{Entry, Folder, TextFile};

struct FileBuffer {
    file: TextFile,
    editor: Entity<EditorState>,
    _subscriptions: Vec<Subscription>,
}

/// Session-only state for an ordinary folder. It never calls the notes backend.
pub(crate) struct FolderWorkspace {
    pub folder: Folder,
    pub prefs: Preferences,
    pane_state: Entity<ResizableState>,
    tree: Entity<TreeState>,
    navigation_focus: FocusHandle,
    roots: Vec<TreeItem>,
    entries: HashMap<SharedString, Entry>,
    ids: HashMap<PathBuf, SharedString>,
    loaded: HashSet<PathBuf>,
    expanded: HashSet<PathBuf>,
    pub active: Option<SharedString>,
    documents: HashMap<PathBuf, FileBuffer>,
    message: String,
    pub error: Option<String>,
    vim: vim::Vim,
    save_task: Option<Task<()>>,
    _subscriptions: Vec<Subscription>,
}

impl FolderWorkspace {
    pub fn new(
        folder: Folder,
        prefs: Preferences,
        pane_state: Entity<ResizableState>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let tree = cx.new(|cx| TreeState::new(cx));
        let mut workspace = Self {
            folder,
            prefs,
            pane_state,
            tree: tree.clone(),
            navigation_focus: cx.focus_handle(),
            roots: vec![],
            entries: HashMap::new(),
            ids: HashMap::new(),
            loaded: HashSet::new(),
            expanded: HashSet::new(),
            active: None,
            documents: HashMap::new(),
            message: "Select a file in the sidebar.".into(),
            error: None,
            vim: vim::Vim::default(),
            save_task: None,
            _subscriptions: vec![],
        };
        workspace.refresh(window, cx);
        workspace
            ._subscriptions
            .push(cx.observe_in(&tree, window, |this, tree, window, cx| {
                let id = tree.read(cx).selected_item().map(|item| item.id.clone());
                if let Some(id) = id.filter(|id| this.entries.get(id).is_some_and(|e| !e.directory))
                {
                    if this.active.as_ref() != Some(&id) {
                        this.open_file(id, false, window, cx);
                    }
                }
            }));
        workspace
    }

    pub fn label(&self) -> String {
        self.folder
            .root
            .file_name()
            .unwrap_or(self.folder.root.as_os_str())
            .to_string_lossy()
            .into_owned()
    }

    pub fn block_cursor(&self) -> bool {
        self.prefs.vim && self.vim.mode != vim::Mode::Insert
    }

    fn items(&mut self, parent: &Path) -> Result<Vec<TreeItem>, String> {
        let entries = self.folder.entries(parent)?;
        let mut items = vec![];
        for entry in entries {
            let next = self.ids.len();
            let id = self
                .ids
                .entry(entry.path.clone())
                .or_insert_with(|| format!("file-{next}").into())
                .clone();
            let mut item = TreeItem::new(id.clone(), entry.name.clone());
            if entry.directory {
                let children = if self.loaded.contains(&entry.path) {
                    self.items(&entry.path)?
                } else {
                    vec![]
                };
                item = item
                    .children(if children.is_empty() {
                        vec![
                            TreeItem::new(
                                format!("placeholder-{id}"),
                                if self.loaded.contains(&entry.path) {
                                    "Empty folder"
                                } else {
                                    "Loading…"
                                },
                            )
                            .disabled(true),
                        ]
                    } else {
                        children
                    })
                    .expanded(self.expanded.contains(&entry.path));
            }
            self.entries.insert(id, entry);
            items.push(item);
        }
        Ok(items)
    }

    pub fn refresh(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let selected = self.tree.read(cx).selected_item().cloned();
        match self.items(Path::new("")) {
            Ok(roots) => {
                self.roots = roots;
                self.tree.update(cx, |tree, cx| {
                    tree.set_items(self.roots.clone(), cx);
                    tree.set_selected_item(selected.as_ref(), cx);
                });
                // Clean buffers follow external edits; dirty drafts remain intact.
                for (path, buffer) in &mut self.documents {
                    if buffer.editor.read(cx).value().as_ref() == buffer.file.text {
                        if let Ok(file) = self.folder.read(path) {
                            if file.text != buffer.file.text {
                                buffer.editor.update(cx, |editor, cx| {
                                    editor.set_value(file.text.clone(), window, cx)
                                });
                            }
                            buffer.file = file;
                        }
                    }
                }
            }
            Err(error) => self.error = Some(error),
        }
        cx.notify();
    }

    pub(crate) fn toggle_directory(
        &mut self,
        id: &SharedString,
        expand: Option<bool>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(path) = self
            .entries
            .get(id)
            .filter(|e| e.directory)
            .map(|e| e.path.clone())
        else {
            return;
        };
        let expand = expand.unwrap_or(!self.expanded.contains(&path));
        if expand {
            self.loaded.insert(path.clone());
            self.expanded.insert(path);
        } else {
            self.expanded.remove(&path);
        }
        self.refresh(window, cx);
    }

    pub fn current_editor(&self) -> Option<Entity<EditorState>> {
        let entry = self.entries.get(self.active.as_ref()?)?;
        self.documents
            .get(&entry.path)
            .map(|buffer| buffer.editor.clone())
    }

    #[cfg(test)]
    pub(crate) fn entry_id(&self, path: &Path) -> SharedString {
        self.ids[path].clone()
    }

    pub fn refresh_from_disk(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush(cx).is_ok() {
            self.refresh(window, cx);
        } else {
            self.reload_file(window, cx);
        }
    }

    fn reload_file(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(path) = self
            .active
            .as_ref()
            .and_then(|id| self.entries.get(id))
            .map(|entry| entry.path.clone())
        else {
            return;
        };
        let Some(buffer) = self.documents.get(&path) else {
            return;
        };
        let dirty = buffer.editor.read(cx).value().as_ref() != buffer.file.text;
        if !dirty {
            self.apply_reload(&path, window, cx);
            return;
        }
        let answer = window.prompt(PromptLevel::Warning, "Reload this file from disk?",
            Some("Unsaved edits in this file will be discarded. Copy your draft first if you want to keep it."), &["Cancel", "Reload"], cx);
        cx.spawn_in(window, async move |view, cx| {
            if answer.await == Ok(1) {
                let _ = view.update_in(cx, |this, window, cx| this.apply_reload(&path, window, cx));
            }
        })
        .detach();
    }

    fn apply_reload(&mut self, path: &Path, window: &mut Window, cx: &mut Context<Self>) {
        match self.folder.read(path) {
            Ok(file) => {
                if let Some(buffer) = self.documents.get_mut(path) {
                    buffer.editor.update(cx, |editor, cx| {
                        editor.set_value(file.text.clone(), window, cx)
                    });
                    buffer.file = file;
                }
                self.error = None;
                self.vim.reset();
                self.refresh(window, cx);
            }
            Err(error) => self.error = Some(error),
        }
        cx.notify();
    }

    pub fn focus(&self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(editor) = self.current_editor() {
            editor.update(cx, |editor, cx| {
                editor.set_readonly(self.prefs.vim && self.vim.mode != vim::Mode::Insert, cx);
                editor.focus(window, cx);
            });
        } else {
            self.tree.update(cx, |tree, cx| tree.focus(window, cx));
        }
    }

    pub fn open_file(
        &mut self,
        id: SharedString,
        focus: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(entry) = self.entries.get(&id).cloned() else {
            return;
        };
        if entry.directory || self.flush(cx).is_err() {
            return;
        }
        self.active = Some(id);
        self.error = None;
        self.vim.reset();
        if !self.documents.contains_key(&entry.path) {
            let file = match self.folder.read(&entry.path) {
                Ok(file) if !entry.symlink => file,
                Ok(_) => {
                    self.message = "Symbolic links are not supported.".into();
                    cx.notify();
                    return;
                }
                Err(message) => {
                    self.message = message;
                    cx.notify();
                    return;
                }
            };
            let editor = cx.new(|cx| {
                let state = EditorState::new(window, cx)
                    .auto_close(false)
                    .smart_indent(false)
                    .line_number(false)
                    .soft_wrap(true)
                    .tab_size(TabSize {
                        tab_size: 2,
                        hard_tabs: false,
                    })
                    .default_value(file.text.clone());
                if entry
                    .path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
                {
                    state
                        .language("markdown")
                        .folding(self.prefs.heading_folding)
                } else if entry
                    .path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
                {
                    state.language("json")
                } else {
                    state
                }
            });
            let subscriptions = vec![
                cx.observe(&editor, |_, _, cx| cx.notify()),
                cx.subscribe(&editor, |this, _, event: &InputEvent, cx| {
                    if matches!(event, InputEvent::Change) {
                        this.schedule_save(cx);
                        cx.notify();
                    }
                }),
            ];
            self.documents.insert(
                entry.path,
                FileBuffer {
                    file,
                    editor,
                    _subscriptions: subscriptions,
                },
            );
        }
        if let Some(editor) = self.current_editor() {
            editor.update(cx, |editor, cx| editor.set_readonly(self.prefs.vim, cx));
            if focus {
                self.focus(window, cx);
            }
        }
        cx.notify();
    }

    fn schedule_save(&mut self, cx: &mut Context<Self>) {
        let delay = cx.background_executor().timer(Duration::from_millis(400));
        self.save_task = Some(cx.spawn(async move |view, cx| {
            delay.await;
            let _ = view.update(cx, |this, cx| {
                let _ = this.flush(cx);
            });
        }));
    }

    pub fn flush(&mut self, cx: &mut Context<Self>) -> Result<(), String> {
        for (path, buffer) in &mut self.documents {
            let text = buffer.editor.read(cx).value().to_string();
            if let Err(error) = self.folder.save(path, &mut buffer.file, &text) {
                let error = format!("{}: {error}", path.display());
                self.error = Some(error.clone());
                cx.notify();
                return Err(error);
            }
        }
        self.error = None;
        cx.notify();
        Ok(())
    }

    pub fn recover(&self, directory: &Path, encrypted: bool, cx: &App) {
        for (index, (path, buffer)) in self.documents.iter().enumerate() {
            let text = buffer.editor.read(cx).value();
            if text.as_ref() != buffer.file.text {
                let _ = std::fs::create_dir_all(directory);
                let text = if encrypted {
                    match type_core::encrypt_note_body_for_write(&text) {
                        Ok(text) => text,
                        Err(_) => continue,
                    }
                } else {
                    text.to_string()
                };
                let _ = std::fs::write(
                    directory.join(format!(
                        "folder-{}-{index}.txt",
                        type_core::now_ms().unwrap_or(0)
                    )),
                    text.as_bytes(),
                );
                eprintln!(
                    "Recovered unsaved file from {}",
                    self.folder.root.join(path).display()
                );
            }
        }
    }

    pub fn key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let editor_focused = self
            .current_editor()
            .is_some_and(|e| e.focus_handle(cx).is_focused(window));
        if let Some(command) = keyboard::command(event, cfg!(target_os = "macos"), editor_focused) {
            window.prevent_default();
            cx.stop_propagation();
            match command {
                keyboard::Command::Save => {
                    let _ = self.flush(cx);
                }
                keyboard::Command::Refresh => self.refresh_from_disk(window, cx),
                keyboard::Command::Focus | keyboard::Command::Cycle => {
                    if editor_focused {
                        self.prefs.sidebar = true;
                        self.tree.update(cx, |tree, cx| tree.focus(window, cx));
                    } else {
                        self.focus(window, cx);
                    }
                }
                keyboard::Command::Sidebar => {
                    self.prefs.sidebar = !self.prefs.sidebar;
                    if !self.prefs.sidebar {
                        self.focus(window, cx);
                    }
                }
                keyboard::Command::FontUp => {
                    self.prefs.font_size = (self.prefs.font_size + 1.).min(40.)
                }
                keyboard::Command::FontDown => {
                    self.prefs.font_size = (self.prefs.font_size - 1.).max(10.)
                }
                keyboard::Command::FontReset => self.prefs.font_size = 17.,
                // Profile CRUD and sync commands never act on an ordinary folder.
                _ => {}
            }
            cx.notify();
            return;
        }
        if self.navigation_focus.contains_focused(window, cx) {
            let key = event.keystroke.key.as_str();
            if event.keystroke.modifiers.control
                || event.keystroke.modifiers.platform
                || event.keystroke.modifiers.alt
            {
                return;
            }
            let index = self.tree.read(cx).selected_index().unwrap_or(0);
            let id = self
                .tree
                .read(cx)
                .selected_item()
                .map(|item| item.id.clone());
            match key {
                "j" | "down" | "k" | "up" => {
                    let next = if key == "j" || key == "down" {
                        if self.tree.read(cx).entry(index + 1).is_some() {
                            index + 1
                        } else {
                            index
                        }
                    } else {
                        index.saturating_sub(1)
                    };
                    self.tree.update(cx, |tree, cx| {
                        tree.set_selected_index(Some(next), cx);
                        tree.scroll_to_item(next, ScrollStrategy::Nearest);
                    });
                }
                "h" | "left" | "l" | "right" => {
                    if let Some(id) = id {
                        let folder = if self.entries.get(&id).is_some_and(|e| e.directory) {
                            Some(id)
                        } else {
                            parent_folder(&self.roots, &id)
                        };
                        if let Some(id) = folder {
                            self.toggle_directory(
                                &id,
                                Some(key == "l" || key == "right"),
                                window,
                                cx,
                            );
                        }
                    }
                }
                "enter" => {
                    if let Some(id) = id {
                        if self.entries.get(&id).is_some_and(|e| e.directory) {
                            self.toggle_directory(&id, None, window, cx);
                        } else {
                            self.open_file(id, true, window, cx);
                        }
                    }
                }
                _ => return,
            }
            window.prevent_default();
            cx.stop_propagation();
            cx.notify();
        } else {
            self.vim_key(event, window, cx);
        }
    }

    fn vim_key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if !self.prefs.vim {
            return;
        }
        let Some(editor) = self.current_editor() else {
            return;
        };
        let Some(native_motion) = modal_editor::key(&mut self.vim, &editor, event, window, cx)
        else {
            return;
        };
        let id = self.active.clone();
        let view = cx.weak_entity();
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

    fn render_tree(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.weak_entity();
        let entries = self.entries.clone();
        tree(&self.tree, move |ix, row, selected, _, _cx| {
            let id = row.item().id.clone();
            let directory = entries.get(&id).is_some_and(|e| e.directory);
            let view = view.clone();
            ListItem::new(ix)
                .selected(selected)
                .h(px(32.))
                .text_sm()
                .pl(px(12. + 16. * row.depth() as f32))
                .pr_2()
                .child(
                    h_flex()
                        .w_full()
                        .min_w_0()
                        .gap_2()
                        .child(div().w(px(12.)).flex_none().when(directory, |cell| {
                            cell.child(
                                Icon::new(if row.is_expanded() {
                                    IconName::ChevronDown
                                } else {
                                    IconName::ChevronRight
                                })
                                .size(px(12.)),
                            )
                        }))
                        .child(
                            Icon::new(if directory {
                                if row.is_expanded() {
                                    IconName::FolderOpen
                                } else {
                                    IconName::Folder
                                }
                            } else {
                                IconName::FileText
                            })
                            .size(px(15.))
                            .flex_none(),
                        )
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .child(row.item().label.clone()),
                        ),
                )
                .on_click(move |_, window, cx| {
                    let _ = view.update(cx, |this, cx| {
                        if !this.entries.contains_key(&id) {
                            return;
                        }
                        if directory {
                            this.tree.update(cx, |tree, cx| tree.focus(window, cx));
                            this.toggle_directory(&id, None, window, cx);
                        } else {
                            this.open_file(id.clone(), true, window, cx);
                        }
                        this.tree.update(cx, |tree, cx| {
                            tree.set_selected_item(Some(&TreeItem::new(id.clone(), "")), cx)
                        });
                    });
                })
        })
    }
}

impl Render for FolderWorkspace {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let editor = self.current_editor();
        let has_editor = editor.is_some();
        let dirty = self
            .active
            .as_ref()
            .and_then(|id| self.entries.get(id))
            .and_then(|entry| self.documents.get(&entry.path))
            .is_some_and(|buffer| buffer.editor.read(cx).value().as_ref() != buffer.file.text);
        let content = div()
            .relative()
            .size_full()
            .min_w_0()
            .min_h_0()
            .pt(px(64.))
            .when_some(editor, |pane, editor| {
                pane.child(
                    editor::EditorAppearance {
                        prefs: &self.prefs,
                        vim: &self.vim,
                    }
                    .render(&editor, false, cx),
                )
            })
            .when(!has_editor, |pane| {
                pane.child(
                    div()
                        .p_6()
                        .text_color(cx.theme().muted_foreground)
                        .child(self.message.clone()),
                )
            })
            .when(has_editor, |pane| {
                pane.child(
                    div()
                        .id("folder-save-state")
                        .test_support()
                        .absolute()
                        .bottom(px(8.))
                        .right(px(12.))
                        .text_size(px(11.))
                        .text_color(cx.theme().muted_foreground.opacity(0.55))
                        .child(if dirty { "Unsaved" } else { "Saved" }),
                )
            });
        let mut body = div()
            .id("folder-workspace")
            .test_support()
            .relative()
            .size_full()
            .min_h_0();
        if self.prefs.sidebar {
            body = body.child(
                h_resizable("folder-panes")
                    .with_state(&self.pane_state)
                    .child(
                        resizable_panel()
                            .size(px(330.))
                            .size_range(px(240.)..px(600.))
                            .child(
                                v_flex()
                                    .id("folder-sidebar")
                                    .test_support()
                                    .size_full()
                                    .pt(px(64.))
                                    .track_focus(&self.navigation_focus)
                                    .child(
                                        h_flex()
                                            .id("folder-sidebar-header")
                                            .test_support()
                                            .h(px(40.))
                                            .px_3()
                                            .gap_2()
                                            .flex_none()
                                            .text_sm()
                                            .child(
                                                div()
                                                    .flex_1()
                                                    .truncate()
                                                    .font_weight(FontWeight::SEMIBOLD)
                                                    .child(self.label()),
                                            )
                                            .child(
                                                Button::new("folder-refresh")
                                                    .ghost()
                                                    .small()
                                                    .icon(IconName::RefreshCw)
                                                    .tooltip("Refresh folder and open files")
                                                    .on_click(cx.listener(
                                                        |this, _, window, cx| {
                                                            this.refresh_from_disk(window, cx);
                                                        },
                                                    )),
                                            ),
                                    )
                                    .child(div().flex_1().min_h_0().child(self.render_tree(cx))),
                            ),
                    )
                    .child(
                        resizable_panel().size_range(px(380.)..Pixels::MAX).child(
                            div()
                                .id("folder-content-pane")
                                .test_support()
                                .size_full()
                                .child(content),
                        ),
                    ),
            );
        } else {
            body = body.child(content);
        }
        body.when_some(self.error.clone(), |body, error| {
            body.child(
                div()
                    .absolute()
                    .bottom(px(44.))
                    .right(px(18.))
                    .max_w(px(520.))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .bg(cx.theme().popover)
                    .text_sm()
                    .text_color(cx.theme().danger)
                    .child(error),
            )
        })
    }
}
