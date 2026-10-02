use super::*;
use std::path::Path;
use type_gpui::files::Folder;

impl TypeApp {
    pub(crate) fn current_folder(&self) -> Option<Entity<folder_workspace::FolderWorkspace>> {
        self.folder_tabs
            .iter()
            .find(|tab| Some(tab.entity_id()) == self.active_folder)
            .cloned()
    }

    pub(crate) fn flush_folders(&mut self, cx: &mut Context<Self>) -> Result<(), String> {
        for tab in &self.folder_tabs {
            tab.update(cx, |tab, cx| tab.flush(cx))?;
        }
        Ok(())
    }

    pub(crate) fn on_open_folder(
        &mut self,
        _: &OpenFolder,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.locked || self.busy || self.modal.is_some() {
            return;
        }
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Open Folder".into()),
        });
        cx.spawn_in(window, async move |view, cx| match picker.await {
            Ok(Ok(Some(paths))) => {
                if let Some(path) = paths.first() {
                    let _ = view.update_in(cx, |this, window, cx| {
                        this.open_folder_path(path, window, cx)
                    });
                }
            }
            Ok(Err(error)) => {
                let _ = view.update(cx, |this, cx| {
                    this.error = Some(error.to_string());
                    cx.notify();
                });
            }
            _ => {}
        })
        .detach();
    }

    pub(crate) fn open_folder_path(
        &mut self,
        path: &Path,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.locked || self.busy || self.modal.is_some() {
            return;
        }
        let folder = match Folder::open(path) {
            Ok(folder) => folder,
            Err(error) => {
                self.error = Some(error);
                cx.notify();
                return;
            }
        };
        if let Some(tab) = self
            .folder_tabs
            .iter()
            .find(|tab| tab.read(cx).folder.root == folder.root)
        {
            self.switch_workspace(Some(tab.entity_id()), window, cx);
            return;
        }
        if self.flush(true, cx).is_err() {
            return;
        }
        let prefs = self.prefs.clone();
        let panes = self.pane_state.clone();
        let tab =
            cx.new(|cx| folder_workspace::FolderWorkspace::new(folder, prefs, panes, window, cx));
        let subscription = cx.observe(&tab, |this, tab, cx| {
            if this.active_folder == Some(tab.entity_id()) && this.prefs != tab.read(cx).prefs {
                this.prefs = tab.read(cx).prefs.clone();
                this.persist_preferences();
            }
            cx.notify();
        });
        self.folder_subscriptions
            .insert(tab.entity_id(), subscription);
        self.folder_tabs.push(tab.clone());
        self.switch_workspace(Some(tab.entity_id()), window, cx);
    }

    pub(crate) fn switch_workspace(
        &mut self,
        id: Option<EntityId>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.locked || self.busy || self.modal.is_some() || self.active_folder == id {
            return;
        }
        if id.is_some_and(|id| !self.folder_tabs.iter().any(|tab| tab.entity_id() == id)) {
            return;
        }
        if self.flush(true, cx).is_err() {
            return;
        }
        self.refresh_task = None;
        self.refreshing = false;
        self.revision += 1;
        self.active_folder = id;
        self.error = None;
        if let Some(tab) = self.current_folder() {
            tab.update(cx, |tab, cx| {
                tab.prefs = self.prefs.clone();
                tab.focus(window, cx);
            });
        } else {
            self.refresh(window, cx);
            if self.settings {
                self.focus.focus(window, cx);
            } else {
                self.focus_editor(window, cx);
            }
        }
        cx.notify();
    }

    pub(crate) fn close_folder(
        &mut self,
        id: EntityId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.locked || self.busy || self.modal.is_some() {
            return;
        }
        let Some(index) = self
            .folder_tabs
            .iter()
            .position(|tab| tab.entity_id() == id)
        else {
            return;
        };
        if let Err(error) = self.folder_tabs[index].update(cx, |tab, cx| tab.flush(cx)) {
            self.error = Some(error);
            cx.notify();
            return;
        }
        if self.active_folder == Some(id) {
            self.switch_workspace(None, window, cx);
            if self.active_folder.is_some() {
                return;
            }
        }
        self.folder_tabs.remove(index);
        self.folder_subscriptions.remove(&id);
        cx.notify();
    }

    pub(crate) fn on_close_folder(
        &mut self,
        _: &CloseFolder,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let Some(id) = self.active_folder {
            self.close_folder(id, window, cx);
        }
    }

    pub(crate) fn on_save_file(&mut self, _: &SaveFile, _: &mut Window, cx: &mut Context<Self>) {
        if !self.locked {
            let _ = self.flush(false, cx);
        }
    }

    pub(crate) fn render_workspace_tabs(&self, cx: &mut Context<Self>) -> impl IntoElement {
        h_flex()
            .id("workspace-tabs")
            .test_support()
            .absolute()
            .top(px(28.))
            .left_0()
            .w_full()
            .h(px(36.))
            .overflow_x_scroll()
            .bg(cx.theme().background)
            .border_b_1()
            .border_color(cx.theme().border)
            .gap_1()
            .px_2()
            .child(
                Button::new("workspace-main")
                    .ghost()
                    .small()
                    .label("Type")
                    .when(self.active_folder.is_none(), |button| {
                        button.bg(cx.theme().accent)
                    })
                    .on_click(
                        cx.listener(|this, _, window, cx| this.switch_workspace(None, window, cx)),
                    ),
            )
            .children(self.folder_tabs.iter().map(|tab| {
                let id = tab.entity_id();
                h_flex()
                    .id(SharedString::from(format!("workspace-tab-{id:?}")))
                    .test_support()
                    .flex_none()
                    .gap_1()
                    .rounded_md()
                    .when(self.active_folder == Some(id), |tab| {
                        tab.bg(cx.theme().accent)
                    })
                    .child(
                        Button::new(SharedString::from(format!("workspace-select-{id:?}")))
                            .ghost()
                            .small()
                            .label(tab.read(cx).label())
                            .tooltip(tab.read(cx).folder.root.display().to_string())
                            .on_click(cx.listener(move |this, _, window, cx| {
                                this.switch_workspace(Some(id), window, cx)
                            })),
                    )
                    .child(
                        Button::new(SharedString::from(format!("workspace-close-{id:?}")))
                            .ghost()
                            .small()
                            .label("×")
                            .tooltip("Close folder")
                            .on_click(cx.listener(move |this, _, window, cx| {
                                cx.stop_propagation();
                                this.close_folder(id, window, cx)
                            })),
                    )
            }))
    }
}
