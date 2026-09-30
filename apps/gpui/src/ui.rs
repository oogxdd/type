use super::*;
use commands::{Choice, ModalKind};

impl TypeApp {
    fn command_button(
        &self,
        id: &'static str,
        label: &'static str,
        choice: Choice,
        cx: &mut Context<Self>,
    ) -> Button {
        Button::new(id).ghost().small().label(label).on_click(
            cx.listener(move |this, _, window, cx| this.execute(choice.clone(), window, cx)),
        )
    }

    pub fn render_settings(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let profile = self.active_profile();
        let mut settings = v_flex()
            .gap_4()
            .p_6()
            .w_full()
            .child(
                div()
                    .text_xl()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child("Settings"),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(cx.theme().muted_foreground)
                    .child(format!(
                        "Working folder: {}\n{}",
                        profile.map(|p| p.name.as_str()).unwrap_or(""),
                        self.backend.root.display()
                    )),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(self.command_button(
                        "new-profile",
                        "New working folder",
                        Choice::NewProfile,
                        cx,
                    ))
                    .child(self.command_button(
                        "choose-root",
                        "Move notes root…",
                        Choice::Root,
                        cx,
                    )),
            );
        for p in &self.profiles.profiles {
            let id = p.id.clone();
            settings = settings.child(
                Button::new(SharedString::from(format!("profile-{}", p.id)))
                    .ghost()
                    .label(p.name.clone())
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.execute(Choice::Profile(id.clone()), window, cx)
                    })),
            );
        }
        settings = settings
            .child(div().text_lg().child("Appearance"))
            .child(
                h_flex()
                    .gap_2()
                    .child(self.command_button("theme", "Light / dark", Choice::Theme, cx))
                    .child(self.command_button("vim", "Toggle Vim", Choice::Vim, cx)),
            )
            .child(div().text_lg().child("Git sync"))
            .child(
                div().text_sm().child(
                    profile
                        .map(|p| {
                            format!("{} · {}", p.settings.git_remote_url, p.settings.git_branch)
                        })
                        .unwrap_or_default(),
                ),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(self.command_button("remote", "Connect…", Choice::Remote, cx))
                    .child(self.command_button("pull", "Pull", Choice::Pull, cx))
                    .child(self.command_button("push", "Commit + push", Choice::Push, cx))
                    .child(self.command_button("commit", "Checkpoint", Choice::Commit, cx)),
            )
            .child(
                h_flex()
                    .gap_2()
                    .child(self.command_button("ssh", "Copy SSH key", Choice::Ssh, cx))
                    .child(self.command_button("history", "History", Choice::History, cx)),
            );
        for field in [
            "git_branch",
            "git_username",
            "git_password",
            "git_commit_message",
        ] {
            settings = settings.child(self.setting_button(field, cx));
        }
        settings = settings.child(div().text_lg().child("Phone sync")).child(
            h_flex()
                .gap_2()
                .child(self.command_button("server-start", "Start server", Choice::Server, cx))
                .child(self.command_button("server-stop", "Stop server", Choice::StopServer, cx)),
        );
        if let Some(status) = &self.local_server {
            if status.running {
                if let Some(link) = jobs::pairing_link(
                    status,
                    profile.map(|p| p.name.as_str()).unwrap_or("Type"),
                    &self.backend.env,
                ) {
                    if let Ok(code) = qrcode::QrCode::new(link.as_bytes()) {
                        let width = code.width();
                        let cells = code.to_colors();
                        settings = settings.child(
                            div().size(px(240.)).child(
                                canvas(
                                    move |_, _, _| (),
                                    move |bounds, _, window, _| {
                                        let scale =
                                            f32::from(bounds.size.width) / (width + 8) as f32;
                                        window.paint_quad(fill(bounds, rgb(0xffffff)));
                                        for y in 0..width {
                                            for x in 0..width {
                                                if cells[y * width + x] == qrcode::Color::Dark {
                                                    window.paint_quad(fill(
                                                        Bounds::new(
                                                            point(
                                                                bounds.origin.x
                                                                    + px((x + 4) as f32 * scale),
                                                                bounds.origin.y
                                                                    + px((y + 4) as f32 * scale),
                                                            ),
                                                            size(px(scale + 0.1), px(scale + 0.1)),
                                                        ),
                                                        rgb(0x000000),
                                                    ));
                                                }
                                            }
                                        }
                                    },
                                )
                                .size_full(),
                            ),
                        );
                    }
                    settings = settings.child(
                        Button::new("pairing-copy")
                            .ghost()
                            .label("Copy phone pairing link")
                            .on_click(move |_, _, cx| {
                                cx.write_to_clipboard(ClipboardItem::new_string(link.clone()))
                            }),
                    );
                }
                settings = settings.child(
                    div()
                        .text_sm()
                        .child(format!("{} paired devices", status.paired_devices.len())),
                );
            }
            if let Some(error) = &status.error {
                settings = settings.child(
                    div()
                        .text_sm()
                        .text_color(cx.theme().danger)
                        .child(error.clone()),
                );
            }
        }
        settings = settings
            .child(div().text_lg().child("Recording and handwriting"))
            .child(
                h_flex()
                    .gap_2()
                    .child(self.command_button("recording", "Record / stop", Choice::Record, cx))
                    .child(self.command_button(
                        "handwriting",
                        "Import image",
                        Choice::Handwriting,
                        cx,
                    ))
                    .child(self.command_button("queue", "Queue processing", Choice::Queue, cx)),
            );
        for field in [
            "transcription_provider",
            "whisper_model",
            "assemblyai_api_key",
            "transcription_mode",
            "handwriting_ocr_provider",
            "local_ocr_model_path",
            "openai_api_key",
            "openai_model",
            "huggingface_api_key",
            "huggingface_model",
            "note_file_name_format",
        ] {
            settings = settings.child(self.setting_button(field, cx));
        }
        settings = settings.child(div().text_lg().child("Import and backup"))
            .child(h_flex().gap_2().child(self.command_button("import", "Import Apple Notes", Choice::Import, cx)).child(self.command_button("backup", "Backup ZIP", Choice::Backup, cx)).child(self.command_button("export", "Export", Choice::Export, cx)))
            .child(div().text_lg().child("Security"))
            .child(h_flex().gap_2().child(self.command_button("enable-security", "Enable encryption…", Choice::Enable, cx)).child(self.command_button("lock", "Lock", Choice::Lock, cx)))
            .child(div().text_lg().child("Keyboard"))
            .child(div().text_sm().whitespace_normal().child("⌘/Ctrl K: palette · N: new · W: navigation/content (also Ctrl W on macOS) · T: navigation · B: rail\n⌘/Ctrl Backspace: Trash · Shift Backspace: permanent delete · S: save\n⌘/Ctrl +/−/0: font size · ,: settings · Shift L: lock\nNavigation: j/k or arrows · h/l: collapse/expand parent · Enter: open · Tab: Stream/Folders\nVim: i/a/I/A, o/O, v/V, motions, dd/cc/yy, p/P, u, Ctrl R, / search"));
        if !self.processing_status.is_empty() {
            settings = settings.child(
                div()
                    .text_sm()
                    .whitespace_normal()
                    .child(self.processing_status.clone()),
            );
        }
        if !self.job_status.is_empty() {
            settings = settings.child(
                div()
                    .text_sm()
                    .whitespace_normal()
                    .child(self.job_status.clone()),
            );
        }
        div()
            .id("settings-scroll")
            .size_full()
            .overflow_y_scroll()
            .child(settings)
    }

    fn setting_button(&self, field: &'static str, cx: &mut Context<Self>) -> Button {
        Button::new(field)
            .ghost()
            .label(format!("Edit {}", field.replace('_', " ")))
            .on_click(cx.listener(move |this, _, window, cx| {
                this.execute(Choice::Config(field), window, cx)
            }))
    }

    fn render_modal(&self, cx: &mut Context<Self>) -> AnyElement {
        let Some(modal) = &self.modal else {
            return div().into_any_element();
        };
        if let Some(palette) = &modal.palette {
            let query = palette.read(cx).query(cx);
            let groups = self.palette_groups(&query, cx);
            let choices: Vec<Vec<_>> = groups
                .iter()
                .map(|(_, entries)| entries.iter().map(|e| e.choice.clone()).collect())
                .collect();
            let view = cx.weak_entity();
            let query_view = view.clone();
            let cancel_view = view.clone();
            let mut command = CommandPalette::new(palette).filterable(false);
            for (section, entries) in groups {
                command = command.group(
                    CommandGroup::new().label(section).items(
                        entries
                            .into_iter()
                            .map(|e| CommandItem::new().label(e.label)),
                    ),
                );
            }
            return div().absolute().inset_0().occlude().flex().items_start().justify_center().pt(px(90.))
                .child(div().id("palette-backdrop").absolute().inset_0().occlude().bg(rgba(0x00000066))
                    .on_mouse_down(MouseButton::Left, |_, window, cx| { window.prevent_default(); cx.stop_propagation(); })
                    .on_mouse_down(MouseButton::Right, |_, window, cx| { window.prevent_default(); cx.stop_propagation(); })
                    .on_click(cx.listener(|this, _, window, cx| { window.prevent_default(); cx.stop_propagation(); this.close_modal(window, cx); })))
                .child(div().id("palette-panel").occlude().child(command
                    .placeholder("Search commands and notes · mv to file")
                    .on_query(move |_, _, cx| { let _ = query_view.update(cx, |_, cx| cx.notify()); })
                    .on_confirm(move |index, window, cx| {
                        if let Some(choice) = choices.get(index.section).and_then(|items| items.get(index.row)).cloned() {
                            let _ = view.update(cx, |this, cx| { this.close_modal(window, cx); this.execute(choice, window, cx); });
                        }
                    })
                    .on_cancel(move |window, cx| { let _ = cancel_view.update(cx, |this, cx| this.close_modal(window, cx)); })
                    .footer(|_, _, cx| div().px_3().py_2().text_xs().text_color(cx.theme().muted_foreground).child("↑/↓ select · Enter run · Tab/→ drill into mv folder · Esc clear / close"))
                    .max_h(px(440.)).w(px(560.))))
                .into_any_element();
        }
        let title = match &modal.kind {
            ModalKind::Palette => "Commands · type mv to file notes".into(),
            ModalKind::Rename(_) => "Rename".into(),
            ModalKind::CreateProfile => "New working folder".into(),
            ModalKind::Remote => "Git remote URL".into(),
            ModalKind::Unlock => "Unlock Type".into(),
            ModalKind::Delete(paths) => {
                format!("Permanently delete {} items · type delete", paths.len())
            }
            ModalKind::Config(field) => format!("Edit {}", field.replace('_', " ")),
            ModalKind::EnablePassword => "Encryption password (at least 8 characters)".into(),
            ModalKind::EnablePanic(_) => {
                "Panic password · entering it on unlock wipes local data".into()
            }
        };
        let mut panel = v_flex()
            .gap_3()
            .p_4()
            .w(px(560.))
            .max_h(px(600.))
            .bg(cx.theme().popover)
            .border_1()
            .border_color(cx.theme().border)
            .rounded_lg()
            .shadow_lg()
            .child(
                div()
                    .text_sm()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(title),
            )
            .child(Input::new(&modal.input));
        if matches!(modal.kind, ModalKind::Palette) {
            let entries = self.entries(&modal.input.read(cx).value(), cx);
            let start = modal.selected.saturating_sub(5);
            let mut list = v_flex().gap_1();
            for (ix, entry) in entries.into_iter().enumerate().skip(start).take(10) {
                let choice = entry.choice;
                list = list.child(
                    Button::new(SharedString::from(format!("choice-{ix}")))
                        .ghost()
                        .label(entry.label)
                        .when(ix == modal.selected, |b| b.bg(cx.theme().accent))
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.close_modal(window, cx);
                            this.execute(choice.clone(), window, cx);
                        })),
                );
            }
            panel = panel.child(list).child(
                div()
                    .text_xs()
                    .text_color(cx.theme().muted_foreground)
                    .child("↑/↓ select · Enter run · Tab/→ drill into mv folder · Esc close"),
            );
        } else {
            panel = panel.child(
                h_flex()
                    .gap_2()
                    .child(
                        Button::new("submit")
                            .primary()
                            .label(if self.locked { "Unlock" } else { "Apply" })
                            .on_click(
                                cx.listener(|this, _, window, cx| this.submit_modal(window, cx)),
                            ),
                    )
                    .when(!self.locked, |r| {
                        r.child(Button::new("cancel").ghost().label("Cancel").on_click(
                            cx.listener(|this, _, window, cx| this.close_modal(window, cx)),
                        ))
                    }),
            );
        }
        if let Some(error) = &self.error {
            panel = panel.child(
                div()
                    .text_sm()
                    .whitespace_normal()
                    .text_color(cx.theme().danger)
                    .child(error.clone()),
            );
        }
        div()
            .absolute()
            .inset_0()
            .occlude()
            .flex()
            .items_start()
            .justify_center()
            .pt(px(90.))
            .bg(rgba(0x00000088))
            .child(panel)
            .into_any_element()
    }
}

impl TypeApp {
    pub fn apply_theme(dark: bool, window: &mut Window, cx: &mut App) {
        Theme::change(
            if dark {
                ThemeMode::Dark
            } else {
                ThemeMode::Light
            },
            Some(window),
            cx,
        );
        let theme = Theme::global_mut(cx);
        let background = if dark { rgb(0x0d0c0b) } else { rgb(0xfaf9f6) };
        let foreground = if dark { rgb(0xd4d4d4) } else { rgb(0x282725) };
        let accent = if dark { rgb(0x2b2a29) } else { rgb(0xe6e4e0) };
        let border = if dark { rgb(0x242321) } else { rgb(0xe1dfda) };
        theme.colors.background = background.into();
        theme.colors.foreground = foreground.into();
        theme.colors.sidebar = background.into();
        theme.colors.sidebar_foreground = foreground.into();
        theme.colors.accent = accent.into();
        theme.colors.accent_foreground = foreground.into();
        theme.colors.list = background.into();
        theme.colors.list_active = accent.into();
        theme.colors.list_active_border = accent.into();
        theme.colors.list_hover = if dark {
            rgb(0x1a1918).into()
        } else {
            rgb(0xefede9).into()
        };
        theme.colors.border = border.into();
        theme.colors.sidebar_border = border.into();
        theme.colors.muted_foreground = if dark {
            rgb(0x85888b).into()
        } else {
            rgb(0x767471).into()
        };
        theme.colors.selection = rgba(0x3b82f64d).into();
    }

    fn render_navigation(&self, cx: &mut Context<Self>) -> impl IntoElement {
        use gpui_kit::assets::IconName as Icons;
        let view = cx.weak_entity();
        let status = if let Some(error) = &self.error {
            error.clone()
        } else if let Some(capture) = &self.capture {
            format!("Recording · {}s", capture.started.elapsed().as_secs())
        } else if self.busy {
            self.status.clone()
        } else if !self.processing_status.is_empty() {
            self.processing_status.clone()
        } else {
            self.status.clone()
        };
        v_flex()
            .size_full()
            .track_focus(&self.navigation_focus)
            .border_r_1()
            .border_color(cx.theme().border)
            .when(self.prefs.rail, |panel| {
                panel.child(
                    h_flex()
                        .h(px(70.))
                        .px_3()
                        .gap_2()
                        .flex_none()
                        .child(
                            self.command_button("new", "New note", Choice::New, cx)
                                .icon(Icons::CirclePlus),
                        )
                        .child(div().flex_1())
                        .child(
                            self.command_button("record", "", Choice::Record, cx)
                                .icon(Icons::Mic)
                                .tooltip(if self.recording {
                                    "Stop recording"
                                } else {
                                    "Record audio"
                                })
                                .when(self.recording, |b| b.text_color(cx.theme().danger)),
                        )
                        .child(
                            self.command_button("handwriting", "", Choice::Handwriting, cx)
                                .icon(Icons::FilePenLine)
                                .tooltip("Import handwriting"),
                        ),
                )
            })
            .child(
                h_flex()
                    .h(px(44.))
                    .px_3()
                    .gap_1()
                    .flex_none()
                    .child(
                        self.command_button("nav-stream", "Stream", Choice::Feed, cx)
                            .text_color(if self.view == View::Feed {
                                cx.theme().foreground
                            } else {
                                cx.theme().muted_foreground
                            })
                            .when(self.view == View::Feed, |b| {
                                b.font_weight(FontWeight::SEMIBOLD)
                            }),
                    )
                    .child(
                        self.command_button("nav-folders", "Folders", Choice::Folders, cx)
                            .text_color(if self.view == View::Folders {
                                cx.theme().foreground
                            } else {
                                cx.theme().muted_foreground
                            })
                            .when(self.view == View::Folders, |b| {
                                b.font_weight(FontWeight::SEMIBOLD)
                            }),
                    )
                    .child(div().flex_1())
                    .child(
                        Button::new("nav-filter")
                            .ghost()
                            .small()
                            .icon(Icons::ListFilter)
                            .tooltip("Filter notes")
                            .dropdown_menu(move |mut menu, _, _| {
                                for filter in Filter::ALL {
                                    let view = view.clone();
                                    menu = menu.item(PopupMenuItem::new(filter.label()).on_click(
                                        move |_, window, cx| {
                                            let _ = view.update(cx, |this, cx| {
                                                if this.flush(true, cx).is_ok() {
                                                    this.filter = filter;
                                                    this.set_view(View::Feed, window, cx);
                                                }
                                            });
                                        },
                                    ));
                                }
                                menu
                            }),
                    ),
            )
            .when(self.view == View::Trash, |panel| {
                panel.child(
                    div()
                        .px_5()
                        .py_2()
                        .text_sm()
                        .text_color(cx.theme().muted_foreground)
                        .child("Trash"),
                )
            })
            .child(
                div()
                    .id("tree-viewport")
                    .flex_1()
                    .min_h_0()
                    .on_drag_move(
                        cx.listener(|this, event: &DragMoveEvent<DraggedRow>, _, cx| {
                            this.track_drag(event, cx)
                        }),
                    )
                    .child(self.render_tree(cx)),
            )
            .when(self.view == View::Folders, |panel| {
                panel.child(
                    div()
                        .id("root-drop")
                        .h(px(18.))
                        .w_full()
                        .drag_over::<DraggedRow>(|style, _, _, cx| style.bg(cx.theme().accent))
                        .on_drop(cx.listener(|this, drag: &DraggedRow, window, cx| {
                            this.move_row(
                                drag.id.clone(),
                                None,
                                tree_moves::Placement::Root,
                                window,
                                cx,
                            )
                        })),
                )
            })
            .when(self.prefs.rail, |panel| {
                panel.child(
                    h_flex()
                        .h(px(48.))
                        .px_3()
                        .gap_2()
                        .flex_none()
                        .child(
                            self.command_button("settings", "Settings", Choice::Settings, cx)
                                .icon(Icons::SlidersHorizontal),
                        )
                        .child(div().flex_1())
                        .child(
                            Button::new("status")
                                .ghost()
                                .xsmall()
                                .tooltip(status)
                                .child(div().size(px(9.)).rounded_full().bg(
                                    if self.error.is_some() {
                                        cx.theme().danger
                                    } else if self.recording || self.busy {
                                        rgb(0xe6ac45).into()
                                    } else {
                                        rgb(0x00b88b).into()
                                    },
                                ))
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.execute(Choice::Settings, window, cx)
                                })),
                        ),
                )
            })
    }
}

impl Render for TypeApp {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.modal.is_none() {
            self.navigation_focused = self.navigation_focus.contains_focused(window, cx);
        }
        // The native editor owns the blinking Insert caret. Normal and Visual
        // use our glyph-sized overlay; inputs in a modal keep their normal caret.
        let block_cursor =
            self.prefs.vim && self.vim.mode != vim::Mode::Insert && self.modal.is_none();
        let theme = Theme::global_mut(cx);
        theme.colors.caret = if block_cursor {
            theme.colors.background
        } else {
            theme.colors.foreground
        };
        let mut body = v_flex()
            .relative()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .track_focus(&self.focus)
            .key_context("Type")
            .on_action(cx.listener(Self::on_quit));
        // Keep the native traffic lights in a small drag region, without a title
        // or an application toolbar stretching across the editor.
        body = body.child(
            div()
                .id("window-drag-region")
                .h(px(28.))
                .w_full()
                .flex_none()
                .window_control_area(WindowControlArea::Drag),
        );
        let content = if self.locked {
            div().flex_1().into_any_element()
        } else if self.settings {
            self.render_settings(cx).into_any_element()
        } else if let Some(note) = self.notes.get(&self.active).filter(|n| n.editor.is_some()) {
            let editor = note.editor.as_ref().unwrap();
            div()
                .size_full()
                .px(px(40.))
                .pt(px(30.))
                .pb(px(24.))
                .child(
                    div()
                        .relative()
                        .size_full()
                        .child(
                            Editor::new(editor)
                                .bordered(false)
                                .appearance(false)
                                .readonly(
                                    self.busy
                                        || (self.prefs.vim && self.vim.mode != vim::Mode::Insert),
                                )
                                .h(relative(1.))
                                .text_size(px(self.prefs.font_size))
                                .font_family(cx.theme().font_family.clone()),
                        )
                        .when(block_cursor, |pane| {
                            pane.child(self.render_cursor(editor.clone(), cx))
                        }),
                )
                .into_any_element()
        } else {
            div()
                .p_6()
                .text_color(cx.theme().muted_foreground)
                .child(if self.loading {
                    "Loading notes…"
                } else {
                    "Create a note with ⌘/Ctrl N"
                })
                .into_any_element()
        };
        if self.prefs.sidebar && !self.locked {
            body = body.child(
                div().flex_1().min_h_0().child(
                    h_resizable("main-panes")
                        .child(
                            resizable_panel()
                                .size(px(330.))
                                .size_range(px(240.)..px(600.))
                                .child(self.render_navigation(cx)),
                        )
                        .child(
                            resizable_panel()
                                .size(px(820.))
                                .size_range(px(380.)..px(1800.))
                                .child(content),
                        ),
                ),
            );
        } else {
            body = body.child(div().flex_1().min_h_0().child(content));
        }
        body.when_some(
            self.error.clone().filter(|_| self.modal.is_none()),
            |body, error| {
                body.child(
                    div()
                        .absolute()
                        .bottom(px(12.))
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
            },
        )
        .when(self.modal.is_some(), |body| {
            body.child(self.render_modal(cx))
        })
    }
}
