use super::*;
use commands::{Choice, ModalKind};

impl TypeApp {
    pub(crate) fn command_button(
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

    fn render_modal(&self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
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
                    .placeholder(if query.starts_with("mv ") {
                        format!("Move {} · destination folder path", self.palette_target_label(cx))
                    } else {
                        format!("Commands for {} · mv to folder", self.palette_target_label(cx))
                    })
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
            ModalKind::CreateFolder(parent) => format!(
                "New folder in {}",
                if parent.is_empty() {
                    "Folders root"
                } else {
                    parent
                }
            ),
            ModalKind::StreamDate => "Review a day · YYYY-MM-DD (local time)".into(),
            ModalKind::Rename(_) => "Rename".into(),
            ModalKind::CreateProfile => "Add profile · absolute folder path or ~/…".into(),
            ModalKind::Remote => "Git remote URL".into(),
            ModalKind::Unlock => "Unlock Type".into(),
            ModalKind::Delete(paths) => {
                if paths.len() == 1 {
                    format!("Permanently delete “{}” and its contents?", paths[0])
                } else {
                    format!(
                        "Permanently delete {} items and their contents?",
                        paths.len()
                    )
                }
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
            .when(modal.delete_focus.is_none(), |panel| {
                panel.child(Input::new(&modal.input))
            });
        if matches!(modal.kind, ModalKind::CreateProfile) {
            panel = panel.child(div().text_sm().whitespace_normal()
                .child("Choose the folder containing your Markdown notes. A new path creates a folder; an existing path opens it in place."))
                .child(self.command_button("profile-picker", "Choose folder…", Choice::PickProfile, cx));
        }
        if let Some(handles) = &modal.delete_focus {
            panel =
                panel.child(
                    h_flex()
                        .gap_2()
                        .child(
                            div().track_focus(&handles[0]).child(
                                Button::new("delete-cancel")
                                    .ghost()
                                    .label("Cancel")
                                    .tab_stop(false)
                                    .when(handles[0].is_focused(window), |button| {
                                        button.border_color(cx.theme().primary)
                                    })
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.close_modal(window, cx)
                                    })),
                            ),
                        )
                        .child(
                            div().track_focus(&handles[1]).child(
                                Button::new("delete-confirm")
                                    .primary()
                                    .label("OK")
                                    .tab_stop(false)
                                    .when(handles[1].is_focused(window), |button| {
                                        button.border_color(cx.theme().primary)
                                    })
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.submit_modal(window, cx)
                                    })),
                            ),
                        ),
                );
        } else if matches!(modal.kind, ModalKind::Palette) {
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
        let root_menu_view = view.clone();
        let mut folder_rows = 0;
        if self.view == View::Folders {
            while self.tree.read(cx).entry(folder_rows).is_some() {
                folder_rows += 1;
            }
        }
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
                            .label(self.filter.label())
                            .tooltip("Stream view · status and date")
                            .dropdown_menu(move |mut menu, _, _| {
                                for filter in Filter::ALL {
                                    let view = view.clone();
                                    menu = menu.item(PopupMenuItem::new(filter.label()).on_click(
                                        move |_, window, cx| {
                                            let _ = view.update(cx, |this, cx| {
                                                this.execute(Choice::Filter(filter), window, cx);
                                            });
                                        },
                                    ));
                                }
                                let view_date = view.clone();
                                menu = menu.separator().item(
                                    PopupMenuItem::new("Review a day…").on_click(
                                        move |_, window, cx| {
                                            let _ = view_date.update(cx, |this, cx| {
                                                this.execute(Choice::StreamDate, window, cx)
                                            });
                                        },
                                    ),
                                );
                                let view_all = view.clone();
                                menu.item(PopupMenuItem::new("All dates").on_click(
                                    move |_, window, cx| {
                                        let _ = view_all.update(cx, |this, cx| {
                                            this.execute(Choice::ClearDate, window, cx)
                                        });
                                    },
                                ))
                            }),
                    ),
            )
            .when(
                self.view == View::Feed && self.prefs.stream_day.is_some(),
                |panel| {
                    panel.child(
                        div()
                            .px_5()
                            .py_2()
                            .text_sm()
                            .text_color(cx.theme().muted_foreground)
                            .child(format!("Reviewing {}", self.prefs.stream_day.unwrap())),
                    )
                },
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
                v_flex()
                    .id("tree-viewport")
                    .flex_1()
                    .min_h_0()
                    .on_drag_move(
                        cx.listener(|this, event: &DragMoveEvent<DraggedRow>, _, cx| {
                            this.track_drag(event, cx)
                        }),
                    )
                    .child(
                        self.render_tree(cx)
                            .when(self.view == View::Folders, |tree| {
                                // Let the tree shrink when scrolling is needed, but use its
                                // content height for short lists. The rest is a root target.
                                tree.h(px(folder_rows as f32 * 32.)).min_h_0()
                            }),
                    )
                    .when(self.view == View::Folders, |panel| {
                        panel.child(
                            div()
                                .id("root-drop")
                                .map(|element| {
                                    #[cfg(test)]
                                    {
                                        use gpui_kit::test::TestSupportExt;
                                        element.test_support()
                                    }
                                    #[cfg(not(test))]
                                    {
                                        element
                                    }
                                })
                                .flex_1()
                                .flex_shrink_0()
                                .min_h(px(24.))
                                .w_full()
                                .drag_over::<DraggedRow>(|style, _, _, cx| {
                                    style.bg(cx.theme().accent)
                                })
                                .on_drop(cx.listener(|this, drag: &DraggedRow, window, cx| {
                                    this.move_row(
                                        drag.id.clone(),
                                        None,
                                        tree_moves::Placement::Root,
                                        window,
                                        cx,
                                    )
                                }))
                                .context_menu(move |menu, _, _| {
                                    let view = root_menu_view.clone();
                                    menu.item(PopupMenuItem::new("New folder at root…").on_click(
                                        move |_, window, cx| {
                                            let _ = view.update(cx, |this, cx| {
                                                if this.view == View::Folders {
                                                    this.tree.update(cx, |tree, cx| {
                                                        tree.focus(window, cx)
                                                    });
                                                    this.execute(
                                                        Choice::NewFolder(String::new()),
                                                        window,
                                                        cx,
                                                    );
                                                }
                                            });
                                        },
                                    ))
                                }),
                        )
                    }),
            )
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
                                    // Match Tauri: the dot indicates phone sync hosting,
                                    // independently of saves, recording, jobs or errors.
                                    if self.local_server.as_ref().is_some_and(|s| s.running) {
                                        rgb(0x00b88b).into()
                                    } else {
                                        cx.theme().muted_foreground.opacity(0.45)
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
        // Kit's active-line fill depends on native line numbers. Paint ours
        // independently so the two appearance preferences stay independent.
        std::sync::Arc::make_mut(&mut theme.highlight_theme)
            .style
            .editor_active_line = None;
        let mut body = v_flex()
            .relative()
            .size_full()
            .bg(cx.theme().background)
            .text_color(cx.theme().foreground)
            .track_focus(&self.focus)
            .key_context("Type")
            .on_action(cx.listener(Self::on_quit));
        let content = if self.locked {
            div().flex_1().into_any_element()
        } else if self.settings {
            self.render_settings(cx).into_any_element()
        } else if let Some(note) = self.notes.get(&self.active).filter(|n| n.editor.is_some()) {
            let editor = note.editor.as_ref().unwrap();
            div()
                .id("editor-pane")
                .relative()
                .size_full()
                .min_w_0()
                .min_h_0()
                .pl(if self.prefs.line_numbers {
                    self.line_number_width(editor, cx)
                } else {
                    px(12.)
                })
                .child(editor::PaintLayer::new(
                    div()
                        .relative()
                        .size_full()
                        .child(editor::PaintLayer::new(
                            Editor::new(editor)
                                .bordered(false)
                                .appearance(false)
                                .readonly(
                                    self.busy
                                        || (self.prefs.vim
                                            && self.vim.mode != vim::Mode::Insert
                                            && !self.replaying_vim_history),
                                )
                                .h(relative(1.))
                                .text_size(px(self.prefs.font_size))
                                .font_family(cx.theme().font_family.clone()),
                        ))
                        .when(self.prefs.current_line_highlight, |pane| {
                            pane.child(self.render_current_line(editor.clone()))
                        })
                        .when(block_cursor, |pane| {
                            pane.child(editor::PaintLayer::new(
                                self.render_cursor(editor.clone(), cx),
                            ))
                        }),
                ))
                .when(self.prefs.line_numbers, |pane| {
                    pane.child(self.render_line_numbers(editor.clone(), cx))
                })
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
        if (self.prefs.sidebar || self.settings) && !self.locked {
            body = body.child(
                div().size_full().min_h_0().child(
                    h_resizable("main-panes")
                        .child(
                            resizable_panel()
                                .size(px(330.))
                                .size_range(px(240.)..px(600.))
                                .child(div().size_full().pt(px(28.)).child(if self.settings {
                                    self.render_settings_navigation(cx).into_any_element()
                                } else {
                                    self.render_navigation(cx).into_any_element()
                                })),
                        )
                        .child(
                            resizable_panel().size_range(px(380.)..Pixels::MAX).child(
                                div()
                                    .id("content-pane")
                                    .size_full()
                                    .min_w_0()
                                    .min_h_0()
                                    .pt(px(28.))
                                    .child(content)
                                    .test_support(),
                            ),
                        ),
                ),
            );
        } else {
            body = body.child(
                div()
                    .size_full()
                    .min_h_0()
                    .pt(px(28.))
                    .pl(px(250.))
                    .child(content),
            );
        }
        // Overlay the titlebar so pane dividers continue through the top strip.
        // Kit owns dragging and macOS's configured double-click action.
        body = body.child(
            div().absolute().top_0().left_0().w_full().h(px(28.)).child(
                TitleBar::new()
                    .h(px(28.))
                    .w_full()
                    .border_0()
                    .bg(transparent_black()),
            ),
        );
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
            body.child(self.render_modal(window, cx))
        })
    }
}
