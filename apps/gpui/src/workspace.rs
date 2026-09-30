use super::*;
use type_core::{AppEnv, SetOrderArgs, STREAM_FOLDER};

impl TypeApp {
    pub fn new(env: AppEnv, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let backend = Backend::new(env).expect("Initialize core");
        let profiles = backend.profiles().list().expect("Load working folders");
        let locked = backend.security().state().map(|s| s.locked).unwrap_or(true);
        let prefs = Preferences::load(&backend.env);
        Theme::change(if prefs.dark { ThemeMode::Dark } else { ThemeMode::Light }, Some(window), cx);
        let tree = cx.new(|cx| TreeState::new(cx));
        let mut app = Self {
            backend, profiles, prefs, locked, focus: cx.focus_handle(), navigation_focus: cx.focus_handle(), view: View::Feed, navigation_focused: false, filter: Filter::Active,
            folder_tree: None, previews: HashMap::new(), nav_items: vec![], selected: HashSet::new(), saved_selection: HashMap::new(),
            settings: false, modal: None, modal_subscription: None, status: "Ready".into(), error: None, busy: false,
            loading: !locked, refreshing: false, suppress_selection: false, revision: 0,
            refresh_task: None, save_task: None, poll_task: None, job_task: None,
            recording: false, capture: None, local_server: None, job_status: String::new(),
            vim: vim::Vim::default(), roots: vec![], tree: tree.clone(), notes: HashMap::new(), active: "".into(),
            folder_ids: HashSet::new(), drop_target: None, drag_task: None, drag_pointer: None,
            hover_since: Instant::now(), tag_count: 0, next_id: 1, tag_task: None, subscriptions: vec![],
        };
        app.subscriptions.push(cx.observe_in(&tree, window, |this, state, window, cx| {
            if this.suppress_selection || this.locked || this.modal.is_some() { return; }
            let id = state.read(cx).selected_item().map(|item| item.id.clone());
            if let Some(id) = id {
                this.saved_selection.insert(this.view, id.clone());
                if this.selected.len() <= 1 { this.selected.clear(); }
                if !this.folder_ids.contains(&id) && id != this.active {
                    this.open_note(id, false, window, cx);
                }
            }
        }));
        app.subscriptions.push(cx.observe_window_activation(window, |this, window, cx| {
            if !window.is_window_active() && !this.locked {
                if this.flush(false, cx).is_err() { return; }
                if this.backend.security().state().is_ok_and(|s| s.encryption_enabled && s.auto_lock_on_background) {
                    this.lock(window, cx);
                }
            } else if !this.locked { this.refresh(window, cx); }
        }));
        let weak = cx.weak_entity();
        window.on_window_should_close(cx, move |_, cx| weak.update(cx, |this, cx| {
            if this.recording || this.busy { this.error = Some("Finish the current operation before closing.".into()); cx.notify(); return false; }
            if this.flush(true, cx).is_err() { return false; }
            let _ = type_core::stop_local_sync_server_impl(&this.backend.env);
            this.persist_preferences();
            true
        }).unwrap_or(true));
        app.subscriptions.push(cx.on_app_quit(|this, cx| {
            if let Err(error) = this.flush(false, cx) {
                // Quit cannot be cancelled by GPUI. A recovery body stays local
                // to app data, never enters a sync root or a preview cache.
                this.recover_drafts(cx);
                eprintln!("Save failed on quit: {error}");
            }
            let _ = type_core::stop_local_sync_server_impl(&this.backend.env);
            async {}
        }));
        if locked { app.show_modal(commands::ModalKind::Unlock, "", window, cx); }
        else { app.refresh(window, cx); }
        app.poll_task = Some(cx.spawn_in(window, async move |view, cx| {
            loop {
                cx.background_executor().timer(Duration::from_secs(3)).await;
                if view.update_in(cx, |this, window, cx| {
                    if !this.locked && !this.busy && !this.recording { this.refresh(window, cx); }
                }).is_err() { break; }
            }
        }));
        app
    }

    pub fn persist_preferences(&self) {
        if let Err(e) = self.prefs.save(&self.backend.env) { eprintln!("Appearance save: {e}"); }
    }

    pub fn recover_drafts(&self, cx: &App) {
        // Encryption users must never get plaintext recovery files.
        let encrypted = self.backend.security().state().is_ok_and(|s| s.encryption_enabled);
        let dir = self.backend.env.app_data_dir.join("gpui-recovery");
        let _ = std::fs::create_dir_all(&dir);
        for (index, (path, note)) in self.notes.iter().filter(|(_, n)| n.dirty).enumerate() {
            let body = note.editor.as_ref().map(|e| e.read(cx).value().to_string()).unwrap_or_else(|| note.initial_body.clone());
            let body = if encrypted { match type_core::encrypt_note_body_for_write(&body) { Ok(body) => body, Err(_) => continue } } else { body };
            let file = dir.join(format!("{}-{index}.md", type_core::now_ms().unwrap_or(0)));
            let _ = std::fs::write(file, format!("<!-- Recovery for {path} -->\n{body}"));
        }
    }

    pub fn refresh(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.locked || self.refreshing || self.busy { return; }
        self.refreshing = true;
        let backend = self.backend.clone();
        let revision = self.revision;
        let versions: HashMap<_, _> = self.previews.iter().map(|(p, n)| (p.clone(), n.version.clone())).collect();
        let task = cx.background_executor().spawn(async move {
            let notes = backend.notes()?;
            let root = notes.get_tree()?;
            fn changed(root: &FolderNode, versions: &HashMap<String, Option<String>>, paths: &mut Vec<String>) {
                for n in &root.notes { if !versions.contains_key(&n.path) || versions[&n.path] != n.version { paths.push(n.path.clone()); } }
                for child in &root.children { changed(child, versions, paths); }
            }
            let mut paths = vec![]; changed(&root, &versions, &mut paths);
            let previews = notes.list_note_previews(paths)?;
            Ok::<_, String>((root, previews))
        });
        self.refresh_task = Some(cx.spawn_in(window, async move |view, cx| {
            let result = task.await;
            let _ = view.update_in(cx, |this, window, cx| {
                this.refreshing = false;
                if revision != this.revision || this.locked { return; }
                match result {
                    Ok((root, previews)) => {
                        let paths: HashSet<_> = navigation::note_paths(&root).into_iter().collect();
                        this.previews.retain(|p, _| paths.contains(p));
                        for preview in previews {
                            let id: SharedString = preview.path.clone().into();
                            if let Some(note) = this.notes.get_mut(&id) {
                                if !note.dirty && note.saved_body != preview.content {
                                    note.saved_body = preview.content.clone();
                                    note.initial_body = preview.content.clone();
                                    if let Some(editor) = &note.editor {
                                        editor.update(cx, |s, cx| s.set_value(preview.content.clone(), window, cx));
                                    }
                                }
                                if !note.dirty { note.title = navigation::title(&preview.content).into(); }
                            }
                            this.previews.insert(preview.path.clone(), preview);
                        }
                        this.notes.retain(|p, n| n.dirty || n.draft_folder.is_some() || paths.contains(p.as_str()));
                        this.folder_tree = Some(root);
                        this.rebuild_navigation(cx);
                        this.loading = false;
                        if !this.notes.contains_key(&this.active) {
                            this.active = "".into();
                            if let Some(id) = this.first_note(cx) { this.open_note(id, false, window, cx); }
                            else { this.new_note(window, cx); }
                        }
                        if let Some(id) = this.saved_selection.get(&this.view).cloned() { this.select_row(&id, cx); }
                        this.refresh_tags(cx);
                    }
                    Err(error) => { this.error = Some(error); this.loading = false; }
                }
                cx.notify();
            });
        }));
    }

    pub fn rebuild_navigation(&mut self, cx: &mut Context<Self>) {
        let Some(root) = &self.folder_tree else { return; };
        self.nav_items = match self.view {
            View::Folders => navigation::folders(root, &self.previews),
            View::Feed | View::Trash => navigation::feed(&self.previews, self.filter, chrono::Local::now().date_naive(), self.view == View::Trash),
        };
        let mut expanded = HashSet::new();
        fn expansion(items: &[TreeItem], out: &mut HashSet<SharedString>) {
            for i in items { if i.is_expanded() { out.insert(i.id.clone()); } expansion(&i.children, out); }
        }
        expansion(&self.roots, &mut expanded);
        fn convert(items: &[navigation::Item], expanded: &HashSet<SharedString>) -> Vec<TreeItem> {
            items.iter().map(|i| TreeItem::new(i.id.clone(), i.label.clone()).children(convert(&i.children, expanded))
                .expanded(expanded.contains(i.id.as_str()) || i.id == "feed:9-today" || i.id == "feed:8-yesterday")).collect()
        }
        self.roots = convert(&self.nav_items, &expanded);
        self.folder_ids.clear();
        fn collect(items: &[navigation::Item], folders: &mut HashSet<SharedString>) {
            for i in items { if i.folder { folders.insert(i.id.clone().into()); } collect(&i.children, folders); }
        }
        collect(&self.nav_items, &mut self.folder_ids);
        let selected = self.tree.read(cx).selected_index().unwrap_or(0);
        let id = self.tree.read(cx).selected_item().map(|i| i.id.clone());
        self.tree.update(cx, |tree, cx| {
            tree.set_items(self.roots.clone(), cx);
            if let Some(id) = id.filter(|id| tree.index_of(id).is_some()) {
                tree.set_selected_item(Some(&TreeItem::new(id, "")), cx);
            } else {
                let mut last = 0;
                while tree.entry(last + 1).is_some() { last += 1; }
                tree.set_selected_index(tree.entry(0).map(|_| selected.min(last)), cx);
            }
        });
        self.selected.retain(|id| self.tree.read(cx).index_of(id).is_some());
    }

    pub fn first_note(&self, cx: &App) -> Option<SharedString> {
        let mut index = 0;
        while let Some(entry) = self.tree.read(cx).entry(index) {
            if !self.folder_ids.contains(&entry.item().id) { return Some(entry.item().id.clone()); }
            index += 1;
        }
        None
    }

    pub fn select_row(&mut self, id: &SharedString, cx: &mut Context<Self>) {
        self.tree.update(cx, |state, cx| {
            state.reveal_item(id, ScrollStrategy::Nearest, cx);
            state.set_selected_item(Some(&TreeItem::new(id.clone(), "")), cx);
        });
    }

    pub fn ensure_editor(&mut self, id: &SharedString, window: &mut Window, cx: &mut Context<Self>) -> Option<Entity<EditorState>> {
        if let Some(editor) = self.notes.get(id).and_then(|n| n.editor.clone()) { return Some(editor); }
        if !self.notes.contains_key(id) {
            let body = match self.backend.notes().and_then(|n| n.read_note(id)) {
                Ok(body) => body, Err(e) => { self.error = Some(e); cx.notify(); return None; }
            };
            self.notes.insert(id.clone(), Note { title: navigation::title(&body).into(), saved_body: body.clone(), initial_body: body,
                dirty: false, draft_folder: None, fills: None, markers: None, editor: None });
        }
        let body = self.notes[id].initial_body.clone();
        let editor = cx.new(|cx| EditorState::new(window, cx).language("markdown").auto_close(false).smart_indent(false)
            .line_number(false).soft_wrap(true).tab_size(TabSize { tab_size: 2, hard_tabs: false }).default_value(body));
        self.subscriptions.push(cx.subscribe(&editor, |this, engine, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                if let Some(note) = this.notes.values_mut().find(|n| n.editor.as_ref().is_some_and(|e| e.entity_id() == engine.entity_id())) {
                    note.dirty = engine.read(cx).value().as_ref() != note.saved_body;
                    note.title = navigation::title(&engine.read(cx).value()).into();
                }
                this.schedule_save(cx);
                this.schedule_tags(cx);
            }
        }));
        let (fills, markers) = editor.update(cx, |s, cx| (s.create_range_decorations_collection(vec![], cx), s.create_decorations_collection(vec![], cx)));
        let note = self.notes.get_mut(id).unwrap(); note.editor = Some(editor.clone()); note.fills = Some(fills); note.markers = Some(markers);
        Some(editor)
    }

    pub fn open_note(&mut self, id: SharedString, focus: bool, window: &mut Window, cx: &mut Context<Self>) {
        if self.locked || self.busy { return; }
        if id != self.active && self.flush(true, cx).is_err() { return; }
        let Some(editor) = self.ensure_editor(&id, window, cx) else { return; };
        self.active = id;
        self.settings = false;
        self.vim.reset();
        self.tag_task = None;
        editor.update(cx, |s, cx| s.set_readonly(self.prefs.vim, cx));
        self.refresh_tags(cx);
        if focus { let handle = editor.focus_handle(cx); window.defer(cx, move |window, cx| handle.focus(window, cx)); }
        cx.notify();
    }

    pub fn schedule_save(&mut self, cx: &mut Context<Self>) {
        let delay = cx.background_executor().timer(Duration::from_millis(400));
        self.save_task = Some(cx.spawn(async move |view, cx| {
            delay.await;
            let _ = view.update(cx, |this, cx| { let _ = this.flush(false, cx); });
        }));
    }

    pub fn flush(&mut self, leaving: bool, cx: &mut Context<Self>) -> Result<(), String> {
        let result = self.try_flush(leaving, cx);
        if let Err(error) = &result { self.error = Some(error.clone()); cx.notify(); }
        result
    }

    fn try_flush(&mut self, leaving: bool, cx: &mut Context<Self>) -> Result<(), String> {
        let ids: Vec<_> = self.notes.iter().filter(|(_, n)| n.dirty).map(|(id, _)| id.clone()).collect();
        for id in ids {
            let note = &self.notes[&id];
            let body = note.editor.as_ref().map(|e| e.read(cx).value().to_string()).unwrap_or_else(|| note.initial_body.clone());
            let folder = note.draft_folder.clone();
            let result = if body.trim().is_empty() && leaving {
                if folder.is_none() {
                    if self.backend.notes()?.read_note(&id)? != note.saved_body { return Err("This note changed outside the editor. Reload or copy your draft before deleting.".into()); }
                    self.backend.notes()?.delete_items(vec![id.to_string()])?;
                }
                self.notes.remove(&id); self.previews.remove(id.as_str()); self.revision += 1; continue;
            } else if body.trim().is_empty() && folder.is_some() { continue; }
            else if let Some(folder) = folder { self.backend.create(&folder, body.clone(), None) }
            else { self.backend.save(&id, &note.saved_body, &body).map(|_| id.to_string()) };
            match result {
                Ok(path) => {
                    let new_id: SharedString = path.clone().into();
                    let mut note = self.notes.remove(&id).unwrap();
                    note.saved_body = body.clone(); note.initial_body = body; note.dirty = false; note.draft_folder = None;
                    self.notes.insert(new_id.clone(), note);
                    if id != new_id && self.active == id { self.active = new_id.clone(); self.saved_selection.insert(self.view, new_id); }
                    self.revision += 1;
                    if let Ok(mut entries) = self.backend.notes()?.list_note_previews(vec![path]) {
                        if let Some(preview) = entries.pop() { self.previews.insert(preview.path.clone(), preview); }
                    }
                    self.status = "Saved".into(); self.error = None;
                }
                Err(error) => { self.error = Some(error.clone()); cx.notify(); return Err(error); }
            }
        }
        cx.notify();
        Ok(())
    }

    pub fn new_note(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.locked || self.busy || self.flush(true, cx).is_err() { return; }
        let folder = if self.view == View::Folders {
            self.tree.read(cx).selected_item().map(|i| if self.folder_ids.contains(&i.id) { i.id.to_string() } else { type_core::note_parent_folder_path(&i.id) }).unwrap_or_default()
        } else { STREAM_FOLDER.into() };
        let id: SharedString = format!("draft:{}", self.next_id).into(); self.next_id += 1;
        self.notes.retain(|_, n| n.draft_folder.is_none() || n.dirty);
        self.notes.insert(id.clone(), Note { title: "Untitled".into(), saved_body: "".into(), initial_body: "".into(),
            dirty: false, draft_folder: Some(folder), fills: None, markers: None, editor: None });
        self.open_note(id, true, window, cx);
        self.vim.mode = vim::Mode::Insert;
        if let Some(editor) = self.notes[&self.active].editor.as_ref() { editor.update(cx, |s, cx| s.set_readonly(false, cx)); }
    }

    pub fn set_view(&mut self, view: View, window: &mut Window, cx: &mut Context<Self>) {
        if self.locked || self.busy || self.flush(true, cx).is_err() { return; }
        self.view = view; self.settings = false; self.selected.clear();
        self.roots.clear(); self.rebuild_navigation(cx);
        if let Some(id) = self.saved_selection.get(&view).cloned() { self.select_row(&id, cx); }
        self.tree.update(cx, |t, cx| t.focus(window, cx)); cx.notify();
    }

    pub fn click_row(&mut self, id: SharedString, folder: bool, multiple: bool, window: &mut Window, cx: &mut Context<Self>) {
        if multiple && !folder {
            if !self.selected.remove(&id) { self.selected.insert(id.clone()); }
            if !self.active.is_empty() && self.active != id { self.selected.insert(self.active.clone()); }
            self.tree.update(cx, |s, cx| s.focus(window, cx));
        } else {
            self.selected.clear(); self.select_row(&id, cx);
            if folder {
                if let Some(item) = tree_moves::find(&self.roots, &id) { item.clone().expanded(!item.is_expanded()); }
                self.tree.update(cx, |s, cx| { s.set_items(self.roots.clone(), cx); s.set_selected_item(Some(&TreeItem::new(id, "")), cx); s.focus(window, cx); });
            } else { self.open_note(id, true, window, cx); }
        }
        cx.notify();
    }

    pub fn targets(&self, cx: &App) -> Vec<String> {
        if !self.selected.is_empty() { return self.selected.iter().filter(|p| !p.starts_with("draft:")).map(ToString::to_string).collect(); }
        let editor = self.notes.get(&self.active).and_then(|n| n.editor.as_ref());
        if editor.is_some() && !self.navigation_focused && !self.active.starts_with("draft:") { return vec![self.active.to_string()]; }
        self.tree.read(cx).selected_item().filter(|i| !i.id.starts_with("feed:") && !i.id.starts_with("draft:")).map(|i| vec![i.id.to_string()]).unwrap_or_default()
    }

    pub fn remap(&mut self, old: &str, new: &str) {
        fn map(path: &str, old: &str, new: &str) -> String {
            if path == old { new.into() } else if let Some(tail) = path.strip_prefix(&format!("{old}/")) { format!("{new}/{tail}") } else { path.into() }
        }
        self.notes = self.notes.drain().map(|(p, n)| (map(&p, old, new).into(), n)).collect();
        self.active = map(&self.active, old, new).into();
        self.previews.clear(); self.selected.clear(); self.saved_selection.insert(self.view, self.active.clone()); self.revision += 1;
    }

    pub fn move_row(&mut self, source: SharedString, target: Option<SharedString>, placement: tree_moves::Placement, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush(false, cx).is_err() || source.starts_with("feed:") { return; }
        if target.as_ref().is_some_and(|t| t.starts_with("feed:")) { self.error = Some("Date groups are not move destinations. Use mv in the palette.".into()); return; }
        let destination = if placement == tree_moves::Placement::Inside { target.as_ref().map(ToString::to_string).unwrap_or_default() }
            else { target.as_ref().map(|t| type_core::note_parent_folder_path(t)).unwrap_or_default() };
        let paths = if self.selected.contains(&source) && self.selected.len() > 1 { self.targets(cx) } else { vec![source.to_string()] };
        match self.backend.move_items(paths.clone(), &destination, false) {
            Ok(()) => {
                let mut reordered = self.roots.clone();
                if self.view == View::Folders { tree_moves::move_item(&mut reordered, &source, target.as_ref(), placement); }
                for path in paths {
                    let name = path.rsplit('/').next().unwrap_or(&path);
                    let next = if destination.is_empty() { name.into() } else { format!("{destination}/{name}") };
                    self.remap(&path, &next);
                }
                if self.view == View::Folders {
                    let siblings = if destination.is_empty() { Some(&reordered) } else { tree_moves::find(&reordered, &SharedString::from(destination.clone())).map(|t| &t.children) };
                    if let Some(siblings) = siblings {
                        let folders: Vec<_> = siblings.iter().filter(|i| self.folder_ids.contains(&i.id)).map(|i| i.id.rsplit('/').next().unwrap().into()).collect();
                        let notes: Vec<_> = siblings.iter().filter(|i| !self.folder_ids.contains(&i.id)).map(|i| i.id.rsplit('/').next().unwrap().into()).collect();
                        if let Err(e) = self.backend.notes().and_then(|n| n.set_order(SetOrderArgs { parent: destination, folder_order: folders, note_order: notes })) { self.error = Some(e); }
                    }
                }
                self.status = "Moved".into();
            }
            Err(e) => self.error = Some(e),
        }
        self.drop_target = None; self.drag_task = None; self.drag_pointer = None; self.refresh(window, cx); cx.notify();
    }

    pub fn add_note(&mut self, folder: SharedString, source: Option<SharedString>, window: &mut Window, cx: &mut Context<Self>) {
        if self.flush(false, cx).is_err() { return; }
        if let Some(source) = source {
            if let Ok(body) = self.backend.notes().and_then(|n| n.read_note(&source)) {
                match self.backend.create(&folder, body, None) {
                    Ok(path) => { self.previews.clear(); self.revision += 1; self.open_note(path.into(), true, window, cx); self.refresh(window, cx); }
                    Err(e) => self.error = Some(e),
                }
            }
        } else {
            self.new_note(window, cx);
            if let Some(note) = self.notes.get_mut(&self.active).filter(|n| n.draft_folder.is_some()) { note.draft_folder = Some(folder.to_string()); }
        }
    }
}
