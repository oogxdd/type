use super::{Backend, TypeApp, View, vim};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AnyWindowHandle, AppContext, Bounds, Entity, Focusable, TestAppContext, VisualTestContext,
    WindowBounds, WindowOptions, point, px, size,
};
use type_core::{AppEnv, STREAM_FOLDER};

struct Fixture(Backend);
impl Fixture {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!(
            "type-gpui-ui-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        Self(Backend::new(AppEnv::new(dir)).unwrap())
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0.env.app_data_dir);
    }
}
fn launch(f: &Fixture, cx: &mut TestAppContext) -> (AnyWindowHandle, Entity<TypeApp>) {
    launch_sized(f, cx, size(px(1150.), px(780.)))
}

fn launch_sized(
    f: &Fixture,
    cx: &mut TestAppContext,
    window_size: gpui_kit::Size<gpui_kit::Pixels>,
) -> (AnyWindowHandle, Entity<TypeApp>) {
    cx.update(gpui_kit::init);
    let env = f.0.env.clone();
    let result = cx.update(|cx| {
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    point(px(0.), px(0.)),
                    window_size,
                ))),
                ..super::TitleBar::window_options()
            },
            cx,
            |window, cx| cx.new(|cx| TypeApp::new(env, window, cx)),
        )
        .unwrap()
    });
    cx.run_until_parked();
    cx.update_window(result.0, |_, window, cx| window.render_frame(cx))
        .unwrap();
    result
}

fn press(cx: &mut TestAppContext, window: AnyWindowHandle, keys: &str) {
    for key in keys.split(' ') {
        cx.update_window(window, |_, window, cx| window.press(key, cx))
            .unwrap();
        cx.run_until_parked();
    }
}

#[gpui_kit::test]
fn phone_sync_restore_respects_preference_and_lock_and_reports_failure(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    let preference = f.0.env.app_data_dir.join("direct-sync-enabled");
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.restore_phone_sync(window, cx);
            assert!(app.sync_start_task.is_none());
            assert!(!app.busy);
            std::fs::write(&preference, "enabled\n").unwrap();
            app.locked = true;
            app.restore_phone_sync(window, cx);
            assert!(app.sync_start_task.is_none());
            app.locked = false;
            // An unavailable synthetic root fails before binding any network port.
            std::fs::remove_dir_all(&f.0.root).unwrap();
            std::fs::write(&f.0.root, "unavailable folder").unwrap();
            app.restore_phone_sync(window, cx);
            assert!(app.sync_start_task.is_some());
            assert!(app.busy);
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert!(app.sync_start_task.is_none());
        assert!(!app.busy);
        assert!(
            app.error
                .as_ref()
                .unwrap()
                .starts_with("Phone sync could not start:")
        );
        assert!(type_core::local_sync_auto_start_enabled(&f.0.env));
    })
    .unwrap();
}

#[gpui_kit::test]
fn quitting_preserves_phone_sync_auto_start(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    std::fs::write(
        f.0.env.app_data_dir.join("direct-sync-enabled"),
        "enabled\n",
    )
    .unwrap();
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.on_quit(&super::Quit, window, cx));
    })
    .unwrap();
    cx.run_until_parked();
    assert!(type_core::local_sync_auto_start_enabled(&f.0.env));
}

#[gpui_kit::test]
fn updates_flush_unicode_drafts_and_block_operations_and_conflicts(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let path = f.0.create(STREAM_FOLDER, "baseline".into(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert!(
                app.updater.is_none(),
                "headless/dev builds never start Sparkle"
            );
            app.open_note(path.clone().into(), true, window, cx);
            let editor = app.notes[&app.active].editor.clone().unwrap();
            editor.update(cx, |editor, cx| {
                editor.set_value("черновик β😀", window, cx)
            });
            app.notes.get_mut(&app.active).unwrap().dirty = true;
            assert!(app.prepare_update(cx));
            assert_eq!(
                f.0.notes().unwrap().read_note(&path).unwrap(),
                "черновик β😀"
            );
            assert!(!app.notes[&app.active].dirty);
            app.busy = true;
            assert!(!app.prepare_update(cx));
            app.busy = false;
            app.recording = true;
            assert!(!app.prepare_update(cx));
            app.recording = false;
            app.pending_recording = Some(std::sync::Arc::new((vec![1, 2], "fixture".into())));
            assert!(!app.prepare_update(cx));
            app.pending_recording = None;
            editor.update(cx, |editor, cx| {
                editor.set_value("unsaved local draft", window, cx)
            });
            app.notes.get_mut(&app.active).unwrap().dirty = true;
            f.0.notes()
                .unwrap()
                .write_note(&path, "external change")
                .unwrap();
            assert!(!app.prepare_update(cx));
            assert_eq!(
                f.0.notes().unwrap().read_note(&path).unwrap(),
                "external change"
            );
            assert!(app.notes[&app.active].dirty);
            assert_eq!(editor.read(cx).value().as_ref(), "unsaved local draft");
            assert!(app.error.as_ref().unwrap().contains("changed outside"));
            app.settings = true;
            app.settings_section = super::settings::Section::Updates;
        });
        window.render_frame(cx);
        assert!(window.find("check-updates").bounds().size.width > px(0.));
    })
    .unwrap();
}

#[gpui_kit::test]
fn stream_and_folders_keep_their_own_expansion(cx: &mut TestAppContext) {
    let f = Fixture::new();
    f.0.create("Work", "# Nested note".into(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.click_row("Work".into(), true, false, window, cx);
            assert!(
                app.roots
                    .iter()
                    .any(|row| row.id.as_ref() == "Work" && row.is_expanded())
            );
            app.set_view(View::Feed, window, cx);
            app.set_view(View::Folders, window, cx);
            assert!(
                app.roots
                    .iter()
                    .any(|row| row.id.as_ref() == "Work" && row.is_expanded())
            );
        })
    })
    .unwrap();
}

#[gpui_kit::test]
fn earlier_stream_section_expands_on_click(cx: &mut TestAppContext) {
    let f = Fixture::new();
    f.0.create(STREAM_FOLDER, "# Old note".into(), Some(1_609_459_200_000))
        .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        let earlier = app
            .roots
            .iter()
            .find(|row| row.id.as_ref() == "feed:section:earlier")
            .unwrap();
        assert!(!earlier.is_expanded());
        let month = earlier.children.first().unwrap();
        assert_eq!(month.label.as_ref(), "December 2020");
        assert!(app.tree.read(cx).index_of(&month.id).is_none());
    })
    .unwrap();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click("nav-row-feed:section:earlier", cx);
    })
    .unwrap();
    let mut visual = VisualTestContext::from_window(window, cx);
    visual.run_until_parked();
    visual.update(|_, cx| {
        let app = app.read(cx);
        let earlier = app
            .roots
            .iter()
            .find(|row| row.id.as_ref() == "feed:section:earlier")
            .unwrap();
        assert!(earlier.is_expanded());
        assert!(
            app.tree
                .read(cx)
                .index_of(&earlier.children[0].id)
                .is_some()
        );
    });
}

#[gpui_kit::test]
fn vim_history_round_trips_unicode_edits(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let original = "alpha βeta\nsecond line\n";
    let path = f.0.create(STREAM_FOLDER, original.into(), None).unwrap();
    let (window, app) = launch(&f, cx);
    let assert_body = |cx: &mut TestAppContext, expected: &str| {
        cx.update_window(window, |_, _, cx| {
            let app = app.read(cx);
            let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
            assert_eq!(state.value().as_ref(), expected);
            assert_eq!(app.vim.mode, vim::Mode::Normal);
            assert!(!state.is_editable());
            assert!(state.selected_range().is_empty());
            assert_eq!(app.vim.head, state.cursor());
        })
        .unwrap();
    };
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.open_note(path.clone().into(), true, window, cx)
        });
    })
    .unwrap();
    cx.run_until_parked();
    press(cx, window, "i");
    cx.simulate_input(window, "Привет 🦀 ");
    press(cx, window, "escape u");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
        assert_eq!(state.value().as_ref(), original);
        assert_eq!(app.vim.mode, vim::Mode::Normal);
    })
    .unwrap();
    press(cx, window, "ctrl-r");
    let inserted = format!("Привет 🦀 {original}");
    assert_body(cx, &inserted);
    cx.update_window(window, |_, window, cx| {
        use gpui_kit::EntityInputHandler;
        let app = app.read(cx);
        let editor = app.notes[&app.active].editor.as_ref().unwrap().clone();
        editor.update(cx, |state, cx| {
            state.replace_text_in_range(None, "blocked IME", window, cx)
        });
    })
    .unwrap();
    cx.update(|cx| {
        cx.write_to_clipboard(gpui_kit::ClipboardItem::new_string("blocked paste".into()))
    });
    press(cx, window, "cmd-v");
    assert_body(cx, &inserted);
    press(cx, window, "g g d d");
    assert_body(cx, "second line\n");
    press(cx, window, "u");
    assert_body(cx, &inserted);
    press(cx, window, "ctrl-r 2 u");
    assert_body(cx, original);
    press(cx, window, "2 ctrl-r");
    assert_body(cx, "second line\n");
    press(cx, window, "u x ctrl-r");
    assert_body(cx, &inserted["П".len()..]);
    press(cx, window, "cmd-s");
    assert_eq!(
        f.0.notes().unwrap().read_note(&path).unwrap(),
        inserted["П".len()..]
    );
    press(cx, window, "u");
    assert_body(cx, &inserted);
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert!(
            app.notes[&app.active].dirty,
            "undo after saving must schedule another save"
        );
    })
    .unwrap();
    press(cx, window, "v u");
    assert_body(cx, original);
    press(cx, window, "ctrl-r");
    assert_body(cx, &inserted);
}

#[gpui_kit::test]
fn vim_half_page_uses_viewport_rows_and_preserves_visual_head(cx: &mut TestAppContext) {
    use gpui_kit::base::input::RopeExt;
    let f = Fixture::new();
    let body = (0..140)
        .map(|row| format!("row {row:03} Привет 🦀"))
        .collect::<Vec<_>>()
        .join("\n");
    let path = f.0.create(STREAM_FOLDER, body.clone(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_note(path.into(), true, window, cx));
    })
    .unwrap();
    cx.run_until_parked();
    let (rows, height) = cx
        .update_window(window, |_, _, cx| {
            let app = app.read(cx);
            let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
            let height = state.line_height().unwrap();
            (
                (state.input_bounds().size.height / height / 2.)
                    .floor()
                    .max(1.) as usize,
                height,
            )
        })
        .unwrap();
    let assert_row = |cx: &mut TestAppContext, row: usize, visual: bool| {
        cx.update_window(window, |_, _, cx| {
            let app = app.read(cx);
            let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
            assert_eq!(
                state.text().offset_to_position(app.vim.head).line as usize,
                row
            );
            assert_eq!(state.value().as_ref(), body);
            assert_eq!(app.vim.visual(), visual);
            assert!(!state.is_editable());
            assert_eq!(state.selected_range().is_empty(), !visual);
            assert!(state.value().is_char_boundary(app.vim.head));
            let cell = state
                .range_to_bounds(&(app.vim.head..app.vim.head))
                .unwrap();
            assert!(cell.bottom() > state.input_bounds().top());
            assert!(cell.top() < state.input_bounds().bottom());
            if visual {
                assert!(app.vim.head < state.selected_range().end);
            }
        })
        .unwrap();
    };
    press(cx, window, "ctrl-d");
    assert_row(cx, rows, false);
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
        assert_eq!(state.scroll_offset().y, -height * rows as f32);
    })
    .unwrap();
    press(cx, window, "ctrl-u");
    assert_row(cx, 0, false);
    press(cx, window, "3 ctrl-d");
    assert_row(cx, 3, false);
    press(cx, window, "3 ctrl-u v ctrl-d");
    assert_row(cx, rows, true);
    press(cx, window, "ctrl-u escape ctrl-u");
    assert_row(cx, 0, false);
    press(cx, window, "shift-g ctrl-d");
    assert_row(cx, 139, false);
    for _ in 0..5 {
        press(cx, window, "ctrl-d");
        assert_row(cx, 139, false);
    }
    press(cx, window, "g g i");
    cx.simulate_input(window, "u");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert!(
            app.notes[&app.active]
                .editor
                .as_ref()
                .unwrap()
                .read(cx)
                .value()
                .starts_with('u')
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn vim_half_page_moves_through_wrapped_unicode_rows(cx: &mut TestAppContext) {
    use gpui_kit::base::input::RopeExt;
    let f = Fixture::new();
    let body = format!("{}\ntail", "абв 🦀 ".repeat(1000));
    let path = f.0.create(STREAM_FOLDER, body.clone(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_note(path.into(), true, window, cx));
    })
    .unwrap();
    cx.run_until_parked();
    press(cx, window, "v ctrl-d");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
        assert!(app.vim.head > 0);
        assert_eq!(state.text().offset_to_position(app.vim.head).line, 0);
        assert!(state.scroll_offset().y < px(0.));
        assert!(body.is_char_boundary(app.vim.head));
        assert!(app.vim.head < state.selected_range().end);
        assert_eq!(state.value().as_ref(), body);
    })
    .unwrap();
    press(cx, window, "ctrl-u escape");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
        assert_eq!(state.cursor(), 0);
        assert_eq!(state.scroll_offset().y, px(0.));
        assert_eq!(state.value().as_ref(), body);
    })
    .unwrap();
}

#[gpui_kit::test]
fn keyboard_focus_tabs_vim_and_persistence(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let path =
        f.0.create(STREAM_FOLDER, "alpha βeta\nsecond line\n".into(), None)
            .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.open_note(path.clone().into(), true, window, cx);
        })
    })
    .unwrap();
    cx.run_until_parked();
    press(cx, window, "ctrl-w tab");
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        let app = app.read(cx);
        assert!(app.navigation_focus.contains_focused(window, cx));
        assert_eq!(app.view, View::Folders);
    })
    .unwrap();
    press(cx, window, "tab ctrl-w i");
    cx.run_until_parked();
    cx.simulate_input(window, "Привет ");
    press(cx, window, "cmd-s escape");
    cx.run_until_parked();
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert_eq!(app.view, View::Feed);
        assert_eq!(app.vim.mode, vim::Mode::Normal);
        assert!(
            app.notes[&app.active]
                .editor
                .as_ref()
                .unwrap()
                .read(cx)
                .value()
                .starts_with("Привет ")
        );
    })
    .unwrap();
    assert!(
        f.0.notes()
            .unwrap()
            .read_note(&path)
            .unwrap()
            .starts_with("Привет ")
    );
    press(cx, window, "v l");
    cx.run_until_parked();
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        let state = app.notes[&app.active].editor.as_ref().unwrap().read(cx);
        assert_eq!(app.vim.mode, vim::Mode::Visual);
        let range = state.selected_range();
        assert!(range.end > range.start);
        assert!(
            state.value().is_char_boundary(range.start)
                && state.value().is_char_boundary(range.end)
        );
        assert!(app.vim.head < range.end);
    })
    .unwrap();
    press(cx, window, "escape i ctrl-w ctrl-w");
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        let app = app.read(cx);
        assert_eq!(
            app.vim.mode,
            vim::Mode::Insert,
            "pane switching preserves editing mode"
        );
        assert!(
            app.notes[&app.active]
                .editor
                .as_ref()
                .unwrap()
                .focus_handle(cx)
                .is_focused(window)
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn editor_fills_pane_and_gutter_tracks_wrapping_folding_and_preferences(cx: &mut TestAppContext) {
    use super::settings::Section;
    let f = Fixture::new();
    let body = format!(
        "# Heading\n{}\n\nlast line\n",
        "Unicode β😀 word ".repeat(60)
    );
    let path = f.0.create(STREAM_FOLDER, body.clone(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_note(path.into(), true, window, cx));
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let pane = window.find("content-pane").bounds();
        let editor = app.read(cx).notes[&app.read(cx).active]
            .editor
            .clone()
            .unwrap();
        let input = editor.read(cx).input_bounds();
        assert!(input.size.width > pane.size.width - px(50.));
        assert!(input.size.height > pane.size.height - px(50.));
        assert_eq!(pane.top(), px(0.));
        assert_eq!(pane.size.height, px(780.));
        window.render_frame(cx);
        let height = editor
            .read(cx)
            .line_height()
            .unwrap()
            .scale(window.scale_factor());
        let accent: gpui_kit::Background = super::Theme::global(cx).accent.into();
        let has_highlight = |window: &gpui_kit::Window| {
            window.painted_quads().iter().any(|quad| {
                quad.background == accent
                    && quad.bounds.size.height == height
                    && quad.bounds.size.width > px(500.).scale(window.scale_factor())
            })
        };
        assert!(
            has_highlight(window),
            "focused editor paints current-line highlight"
        );
        let labels = super::editor::visible_line_numbers(&editor, cx);
        assert_eq!(
            labels.iter().map(|l| l.0).collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5]
        );
        assert!(labels[2].1 - labels[1].1 > labels[1].2 * 2.);
        window.click(("fold-icon", 0usize), cx);
        window.render_frame(cx);
        let labels = super::editor::visible_line_numbers(&editor, cx);
        assert!(
            labels.len() < 5,
            "folding must hide section lines: {labels:?}"
        );
        app.update(cx, |app, cx| {
            app.settings = true;
            app.settings_section = Section::Appearance;
            cx.notify();
        });
        window.render_frame(cx);
        window.click("heading-folding", cx);
        window.render_frame(cx);
        window.click("current-line-highlight", cx);
        window.render_frame(cx);
        assert!(!app.read(cx).prefs.current_line_highlight);
        window.click("line-numbers", cx);
        window.render_frame(cx);
        app.update(cx, |app, cx| app.leave_settings(window, cx));
        window.render_frame(cx);
        window.render_frame(cx);
        assert!(
            !has_highlight(window),
            "highlight preference removes the fill"
        );
        assert!(window.try_find(("fold-icon", 0usize)).is_none());
        let labels = super::editor::visible_line_numbers(&editor, cx);
        assert_eq!(
            labels.iter().map(|l| l.0).collect::<Vec<_>>(),
            vec![1, 2, 3, 4, 5]
        );
        app.update(cx, |app, cx| {
            app.prefs.current_line_highlight = true;
            cx.notify();
        });
        window.render_frame(cx);
        window.render_frame(cx);
        assert!(
            has_highlight(window),
            "highlight works with line numbers disabled"
        );
        app.read(cx).navigation_focus.clone().focus(window, cx);
        window.render_frame(cx);
        assert!(
            !has_highlight(window),
            "unfocused editor has no current-line fill"
        );
        assert_eq!(editor.read(cx).value().as_ref(), body);
    })
    .unwrap();
}

#[gpui_kit::test]
fn current_line_highlight_survives_each_typing_frame(cx: &mut TestAppContext) {
    use gpui_kit::base::input::RopeExt;
    let f = Fixture::new();
    let path = f.0.create(STREAM_FOLDER, "".into(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.open_note(path.into(), true, window, cx);
            app.prefs.vim = true;
            app.vim.mode = vim::Mode::Insert;
            app.prefs.current_line_highlight = true;
            app.notes[&app.active].editor.clone().unwrap()
                .update(cx, |state, cx| state.set_readonly(false, cx));
            cx.notify();
        });
        window.render_frame(cx);
        window.render_frame(cx);
        let editor = app.read(cx).notes[&app.read(cx).active].editor.clone().unwrap();
        editor.focus_handle(cx).focus(window, cx);
        window.render_frame(cx);
        for numbers in [true, false] {
            app.update(cx, |app, cx| {
                app.prefs.line_numbers = numbers;
                cx.notify();
            });
            for ch in format!("\naβ😀{}{}", " word".repeat(35), "\nnext line β😀".repeat(35)).chars() {
                if ch == '\n' {
                    let before = editor.read(cx).text().lines_len();
                    window.press("enter", cx);
                    assert_eq!(editor.read(cx).text().lines_len(), before + 1, "Enter inserts a line in Insert mode");
                } else {
                    window.input(&ch.to_string(), cx);
                }
                let height = editor.read(cx).line_height().unwrap().scale(window.scale_factor());
                let accent: gpui_kit::Background = super::Theme::global(cx).accent.into();
                assert!(window.painted_quads().iter().any(|quad| {
                    quad.background == accent
                        && quad.bounds.size.height == height
                        && quad.bounds.size.width > px(500.).scale(window.scale_factor())
                }), "highlight disappeared in the first frame after typing {ch:?}, numbers={numbers}");
                let state = editor.read(cx);
                let cell = state.range_to_bounds(&(state.cursor()..state.cursor())).unwrap();
                let expected_y = cell.top().scale(window.scale_factor());
                let quad = window.painted_quads().into_iter().find(|quad| {
                    quad.background == accent && quad.bounds.size.width > px(500.).scale(window.scale_factor())
                }).unwrap();
                assert!((quad.bounds.top() - expected_y).0.abs() <= px(1.).scale(window.scale_factor()).0,
                    "highlight trails the cursor after {ch:?}: {:?} vs {:?}, numbers={numbers}", quad.bounds.top(), expected_y);
                if let Some((caret, _)) = state.cursor_layout() {
                    let caret = Bounds::new(caret.origin + state.scroll_offset(), caret.size).scale(window.scale_factor());
                    if let Some(cursor) = window.painted_quads().into_iter().find(|q| {
                        q.bounds.size.width <= px(3.).scale(window.scale_factor())
                            && (q.bounds.left() - caret.left()).0.abs() <= 1.
                            && (q.bounds.top() - caret.top()).0.abs() <= 1.
                            && (q.bounds.size.height - caret.size.height).0.abs() <= 1.
                    }) {
                        assert!(quad.order < cursor.order, "highlight must stay behind the native caret");
                    }
                }


            }
        }
    }).unwrap();
}

#[gpui_kit::test]
fn editor_gutter_scrolls_and_large_windows_use_the_full_pane(cx: &mut TestAppContext) {
    use gpui_kit::base::input::RopeExt;
    let f = Fixture::new();
    let body = "Unicode β😀 line\n".repeat(120);
    let path = f.0.create(STREAM_FOLDER, body, None).unwrap();
    let (window, app) = launch_sized(&f, cx, size(px(3000.), px(900.)));
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_note(path.into(), true, window, cx));
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let editor = app.read(cx).notes[&app.read(cx).active]
            .editor
            .clone()
            .unwrap();
        let pane = window.find("content-pane").bounds();
        assert!(pane.size.width > px(1800.));
        let gutter = app.read(cx).line_number_width(&editor, cx);
        assert!(
            editor.read(cx).input_bounds().size.width >= pane.size.width - gutter - px(32.),
            "only the number/folding gutters and native padding may reduce text width"
        );
        editor.update(cx, |state, cx| {
            state.set_scroll_offset(point(px(0.), -state.line_height().unwrap() * 40.), cx);
        });
        window.render_frame(cx);
        window.render_frame(cx);
        let labels = super::editor::visible_line_numbers(&editor, cx);
        assert!(!labels.is_empty());
        assert!(labels[0].0 > 1, "scroll must advance gutter: {labels:?}");
        let state = editor.read(cx);
        for (number, y, _) in &labels {
            let start = state.text().line_start_offset(number - 1);
            assert_eq!(*y, state.range_to_bounds(&(start..start)).unwrap().top());
        }
        assert!(labels.windows(2).all(|pair| pair[1].0 == pair[0].0 + 1));
        let with_numbers = state.input_bounds().size.width;
        app.update(cx, |app, cx| {
            app.prefs.line_numbers = false;
            cx.notify();
        });
        window.render_frame(cx);
        assert!(editor.read(cx).input_bounds().size.width > with_numbers);
        assert!(app.read(cx).prefs.current_line_highlight);
        app.update(cx, |app, cx| {
            app.prefs.sidebar = false;
            cx.notify();
        });
        window.render_frame(cx);
        let input = editor.read(cx).input_bounds();
        assert!(input.left() >= px(330. * 0.75) && input.left() < px(330.));
        assert!(input.right() <= px(3000.) && input.right() > px(2950.));
        assert!(input.size.height > px(850.));
    })
    .unwrap();
}

#[gpui_kit::test]
fn palette_groups_confirm_the_right_action_and_backdrop_consumes_the_click(
    cx: &mut TestAppContext,
) {
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    press(cx, window, "cmd-k");
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let before = app.read(cx).active.clone();
        // This is the New note location in the underlying sidebar. The first
        // click belongs entirely to the modal backdrop.
        window.click("new", cx);
        assert!(app.read(cx).modal.is_none());
        assert_eq!(app.read(cx).active, before);
    })
    .unwrap();
    press(cx, window, "cmd-k");
    cx.run_until_parked();
    cx.simulate_input(window, "Open Folders");
    cx.run_until_parked();
    press(cx, window, "enter");
    cx.run_until_parked();
    cx.update_window(window, |_, _, cx| {
        assert!(app.read(cx).modal.is_none());
        assert_eq!(app.read(cx).view, View::Folders);
    })
    .unwrap();
    cx.update_window(window, |_, _, cx| {
        let groups = app.read(cx).palette_groups("", cx);
        let headings: Vec<_> = groups.iter().map(|g| g.0).collect();
        assert_eq!(&headings[..4], &["Selection", "Create", "Navigate", "View"]);
    })
    .unwrap();
}

#[gpui_kit::test]
fn settings_sections_focus_and_controls_persist(cx: &mut TestAppContext) {
    use super::settings::Section;
    let f = Fixture::new();
    let path =
        f.0.create(STREAM_FOLDER, "unchanged draft".into(), None)
            .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.open_note(path.clone().into(), true, window, cx)
        });
    })
    .unwrap();
    press(cx, window, "cmd-,");
    cx.update_window(window, |_, window, cx| {
        assert!(app.read(cx).settings);
        assert!(app.read(cx).navigation_focus.contains_focused(window, cx));
    })
    .unwrap();
    press(cx, window, "k j j ctrl-w");
    cx.update_window(window, |_, window, cx| {
        assert_eq!(app.read(cx).settings_section, Section::Appearance);
        assert!(!app.read(cx).navigation_focus.contains_focused(window, cx));
        window.render_frame(cx);
        window.click("font-larger", cx);
        window.click("theme", cx);
        window.render_frame(cx);
        window.click("line-numbers", cx);
        window.render_frame(cx);
        window.click("heading-folding", cx);
        window.render_frame(cx);
        window.click("current-line-highlight", cx);
    })
    .unwrap();
    cx.run_until_parked();
    let saved = super::Preferences::load(&f.0.env);
    assert_eq!(saved.font_size, 18.);
    assert!(!saved.dark);
    assert!(!saved.line_numbers);
    assert!(!saved.heading_folding);
    assert!(!saved.current_line_highlight);
    press(cx, window, "ctrl-w");
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click("settings-Transcription", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click("transcription_provider-assemblyai", cx);
        window.click("transcription_mode-off", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click("assemblyai_api_key", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.simulate_input(window, "synthetic-secret");
    press(cx, window, "enter");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert!(app.modal.is_none());
        assert_eq!(app.setting_value("transcription_mode"), "off");
        assert_eq!(
            app.profiles.app_config.assemblyai_api_key,
            "synthetic-secret"
        );
        assert!(app.error.is_none(), "{:?}", app.error);
    })
    .unwrap();
    let snapshot = f.0.profiles().list().unwrap();
    assert_eq!(snapshot.app_config.transcription_provider, "assemblyai");
    assert_eq!(snapshot.app_config.assemblyai_api_key, "synthetic-secret");
    let root = &snapshot
        .profiles
        .iter()
        .find(|p| p.id == snapshot.active_profile_id)
        .unwrap()
        .notes_root;
    let synced =
        std::fs::read_to_string(std::path::Path::new(root).join(".type/settings.json")).unwrap();
    assert!(!synced.contains("synthetic-secret"));
    press(cx, window, "escape");
    cx.update_window(window, |_, window, cx| {
        let app = app.read(cx);
        assert!(!app.settings);
        assert_eq!(app.active.as_str(), path);
        assert!(
            app.notes[&app.active]
                .editor
                .as_ref()
                .unwrap()
                .focus_handle(cx)
                .is_focused(window)
        );
    })
    .unwrap();
    assert_eq!(
        f.0.notes().unwrap().read_note(&path).unwrap(),
        "unchanged draft"
    );
}

#[gpui_kit::test]
fn settings_rename_and_invalid_provider_keep_other_config(cx: &mut TestAppContext) {
    use super::commands::Choice;
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.execute(Choice::Settings, window, cx);
            app.execute(Choice::Vim, window, cx);
            assert!(!super::Preferences::load(&f.0.env).vim);
            app.execute(Choice::Config("profile_name"), window, cx);
            assert_eq!(
                app.modal.as_ref().unwrap().input.read(cx).value(),
                app.active_profile().unwrap().name
            );
            app.save_setting("openai_model", "fixture-model".into())
                .unwrap();
            assert!(
                app.save_setting("handwriting_ocr_provider", "invalid".into())
                    .is_err()
            );
            assert_eq!(app.profiles.app_config.handwriting_ocr_provider, "local");
            app.close_modal(window, cx);
            app.show_modal(
                super::commands::ModalKind::Config("profile_name"),
                "Renamed fixture",
                window,
                cx,
            );
        });
    })
    .unwrap();
    cx.run_until_parked();
    press(cx, window, "enter");
    cx.update_window(window, |_, window, cx| {
        let app = app.read(cx);
        assert!(app.settings);
        assert!(app.modal.is_none());
        assert!(app.navigation_focus.contains_focused(window, cx));
        assert_eq!(app.active_profile().unwrap().name, "Renamed fixture");
        assert_eq!(app.profiles.app_config.openai_model, "fixture-model");
    })
    .unwrap();
    let snapshot = f.0.profiles().list().unwrap();
    assert!(
        snapshot
            .profiles
            .iter()
            .any(|p| p.name == "Renamed fixture")
    );
    assert_eq!(snapshot.app_config.openai_model, "fixture-model");
}

#[gpui_kit::test]
fn profile_path_opens_in_place_flushes_draft_and_forgets_without_deleting(cx: &mut TestAppContext) {
    use super::commands::{Choice, ModalKind};
    let f = Fixture::new();
    let path = f.0.create(STREAM_FOLDER, "original".into(), None).unwrap();
    let folder =
        f.0.env
            .app_data_dir
            .canonicalize()
            .unwrap()
            .join("selected-folder");
    std::fs::create_dir_all(folder.join(".git")).unwrap();
    std::fs::write(folder.join("existing.md"), "existing note").unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.open_note(path.clone().into(), true, window, cx);
            let editor = app.notes[&app.active].editor.clone().unwrap();
            editor.update(cx, |editor, cx| {
                editor.set_value("saved before switch", window, cx)
            });
            app.notes.get_mut(&app.active).unwrap().dirty = true;
            app.show_modal(
                ModalKind::CreateProfile,
                folder.to_str().unwrap(),
                window,
                cx,
            );
        });
    })
    .unwrap();
    press(cx, window, "enter");
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert!(app.error.is_none(), "{:?}", app.error);
            assert!(app.modal.is_none());
            assert_eq!(app.backend.root, folder);
            assert_eq!(
                app.backend
                    .notes()
                    .unwrap()
                    .read_note("existing.md")
                    .unwrap(),
                "existing note"
            );
            assert_eq!(
                f.0.notes().unwrap().read_note(&path).unwrap(),
                "saved before switch"
            );
            assert!(folder.join(".git").is_dir());
            app.execute(Choice::RemoveProfile, window, cx);
            assert!(app.error.is_none(), "{:?}", app.error);
            assert_eq!(app.backend.root, f.0.root);
            assert_eq!(app.profiles.profiles.len(), 1);
            assert!(folder.join("existing.md").exists());
            assert!(folder.join(".type/profile.json").exists());
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn new_note_stays_selected_through_typing_saves_and_refresh(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let old = f.0.create("Work", "Old note".into(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.open_note(old.clone().into(), true, window, cx);
            // A background read is already in flight when Cmd+N arrives.
            app.refresh(window, cx);
        });
    })
    .unwrap();
    press(cx, window, "cmd-n");
    let first = app.read_with(cx, |app, _| app.active.clone());
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert_eq!(app.view, View::Feed);
            assert!(first.starts_with(STREAM_FOLDER));
            assert_eq!(f.0.notes().unwrap().read_note(&first).unwrap(), "");
            assert_eq!(app.notes[&first].title.as_ref(), "New note");
            assert_eq!(app.tree.read(cx).selected_item().unwrap().id, first);
            let today: gpui_kit::SharedString = format!(
                "feed:this-week:day:{}",
                chrono::Local::now().format("%Y-%m-%d")
            )
            .into();
            assert!(
                super::tree_moves::find(&app.roots, &today)
                    .unwrap()
                    .is_expanded()
            );
            let editor = app.notes[&first].editor.clone().unwrap();
            assert!(editor.focus_handle(cx).is_focused(window));
            assert_eq!(app.vim.mode, vim::Mode::Insert);
        });
    })
    .unwrap();
    cx.simulate_input(window, "#work\n\nOne two three four five six");
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert_eq!(app.active, first);
            assert_eq!(app.notes[&first].title.as_ref(), "One two three four five");
            assert_eq!(
                super::tree_moves::find(&app.roots, &first)
                    .unwrap()
                    .label
                    .as_ref(),
                "One two three four five"
            );
            app.flush(false, cx).unwrap();
            app.refresh(window, cx);
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert_eq!(app.active, first);
            assert_eq!(app.tree.read(cx).selected_item().unwrap().id, first);
            assert!(
                app.notes[&first]
                    .editor
                    .as_ref()
                    .unwrap()
                    .focus_handle(cx)
                    .is_focused(window)
            );
            assert_eq!(app.vim.mode, vim::Mode::Insert);
            assert_eq!(
                f.0.notes().unwrap().read_note(&first).unwrap(),
                "#work\n\nOne two three four five six"
            );
        });
    })
    .unwrap();
    press(cx, window, "cmd-n cmd-n");
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert_ne!(app.active, first);
            let latest = app.active.clone();
            assert!(latest.starts_with(STREAM_FOLDER));
            assert_eq!(app.tree.read(cx).selected_item().unwrap().id, latest);
            assert_eq!(app.notes[&latest].title.as_ref(), "New note");
            assert!(
                app.notes[&latest]
                    .editor
                    .as_ref()
                    .unwrap()
                    .focus_handle(cx)
                    .is_focused(window)
            );
            app.refresh(window, cx);
        });
    })
    .unwrap();
    cx.run_until_parked();
    app.read_with(cx, |app, cx| {
        assert_ne!(app.active.as_ref(), old);
        assert_eq!(app.tree.read(cx).selected_item().unwrap().id, app.active);
    });
}

#[gpui_kit::test]
fn line_number_gutter_reserves_two_digits(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.prefs.line_numbers = true;
            let editor = app.notes[&app.active].editor.clone().unwrap();
            let width = app.line_number_width(&editor, cx);
            for count in [9, 10, 99, 100, 1000] {
                editor.update(cx, |editor, cx| {
                    editor.set_value(vec!["line"; count].join("\n"), window, cx)
                });
                let next = app.line_number_width(&editor, cx);
                if count < 100 {
                    assert_eq!(next, width);
                } else {
                    assert!(next > width);
                }
            }
        });
    })
    .unwrap();
}

#[gpui_kit::test]
fn background_refresh_preserves_manual_navigation_scroll(cx: &mut TestAppContext) {
    let f = Fixture::new();
    for i in 0..80 {
        f.0.create(&format!("Folder {i:02}"), "Fixture note".into(), None)
            .unwrap();
    }
    let (window, app) = launch(&f, cx);
    let selected: gpui_kit::SharedString = "Folder 79".into();
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.click_row(selected.clone(), true, false, window, cx);
        });
        window.render_frame(cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let scroll = app.read(cx).tree.read(cx).scroll_handle().clone();
        assert!(scroll.0.borrow().base_handle.offset().y < px(0.));
        // Scroll back to the first row while keeping the far-away folder selected.
        scroll.scroll_to_item_strict(0, gpui_kit::ScrollStrategy::Top);
        window.render_frame(cx);
        assert_eq!(scroll.0.borrow().base_handle.offset().y, px(0.));
    })
    .unwrap();
    for _ in 0..3 {
        cx.update_window(window, |_, window, cx| {
            app.update(cx, |app, cx| app.refresh(window, cx));
        })
        .unwrap();
        cx.run_until_parked();
        cx.update_window(window, |_, window, cx| {
            window.render_frame(cx);
            let app = app.read(cx);
            let tree = app.tree.read(cx);
            assert_eq!(tree.selected_item().unwrap().id, selected);
            assert_eq!(
                tree.scroll_handle().0.borrow().base_handle.offset().y,
                px(0.),
                "background reconciliation must not scroll to the selected folder"
            );
        })
        .unwrap();
    }
    // An explicit navigation request still reveals the selected row.
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.select_row(&selected, cx));
        window.render_frame(cx);
        assert!(
            app.read(cx)
                .tree
                .read(cx)
                .scroll_handle()
                .0
                .borrow()
                .base_handle
                .offset()
                .y
                < px(0.)
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn folder_creation_move_palette_and_daily_review(cx: &mut TestAppContext) {
    use super::commands::{Choice, ModalKind};
    use chrono::TimeZone;
    let f = Fixture::new();
    let day = chrono::Local::now().date_naive();
    let ms = chrono::Local
        .from_local_datetime(&day.and_hms_opt(12, 0, 0).unwrap())
        .single()
        .unwrap()
        .timestamp_millis();
    let first =
        f.0.create(STREAM_FOLDER, "first review".into(), Some(ms + 2000))
            .unwrap();
    let second =
        f.0.create(STREAM_FOLDER, "second review".into(), Some(ms + 1000))
            .unwrap();
    let third =
        f.0.create(STREAM_FOLDER, "third review".into(), Some(ms))
            .unwrap();
    let older =
        f.0.create(STREAM_FOLDER, "yesterday".into(), Some(ms - 86400000))
            .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.execute(Choice::NewFolder("".into()), window, cx);
            app.modal
                .as_ref()
                .unwrap()
                .input
                .update(cx, |input, cx| input.set_value("Projects", window, cx));
            app.submit_modal(window, cx);
            app.execute(Choice::NewFolder("Projects".into()), window, cx);
            app.modal
                .as_ref()
                .unwrap()
                .input
                .update(cx, |input, cx| input.set_value("Demo", window, cx));
            app.submit_modal(window, cx);
            assert!(f.0.root.join("Projects/Demo").is_dir());
            assert!(f.0.create_folder("Projects/Demo").is_err());
            assert!(f.0.create_folder("_system/me").is_err());
            assert!(f.0.create_folder("../escape").is_err());
            app.show_modal(ModalKind::StreamDate, &day.to_string(), window, cx);
            app.submit_modal(window, cx);
            assert!(!super::navigation::contains(&app.nav_items, &older));
            app.open_note(first.clone().into(), true, window, cx);
            app.select_row(&first.clone().into(), cx);
            // A stale navigation multiselection must never override the focused editor.
            app.selected.insert(older.clone().into());
            assert_eq!(app.targets(cx), vec![first.clone()]);
        });
    })
    .unwrap();
    cx.run_until_parked();
    press(cx, window, "cmd-k");
    cx.simulate_input(window, "Archive / unarchive");
    cx.run_until_parked();
    press(cx, window, "enter");
    cx.update_window(window, |_, window, cx| {
        assert_eq!(app.read(cx).active.as_str(), second);
        assert!(
            app.read(cx).notes[&app.read(cx).active]
                .editor
                .as_ref()
                .unwrap()
                .focus_handle(cx)
                .is_focused(window)
        );
        assert!(!super::navigation::contains(
            &app.read(cx).nav_items,
            &first
        ));
        assert!(
            f.0.notes()
                .unwrap()
                .get_note_meta(&first)
                .unwrap()
                .archived_ms
                .is_some()
        );
    })
    .unwrap();
    press(cx, window, "cmd-k");
    cx.simulate_input(window, "mv Projects/De");
    cx.run_until_parked();
    press(cx, window, "tab");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert_eq!(
            app.modal
                .as_ref()
                .unwrap()
                .palette
                .as_ref()
                .unwrap()
                .read(cx)
                .query(cx),
            "mv Projects/Demo/"
        );
        assert!(
            app.entries("mv Projects/Demo/", cx)
                .iter()
                .any(|e| matches!(&e.choice, Choice::Move(p) if p == "Projects/Demo"))
        );
    })
    .unwrap();
    press(cx, window, "enter");
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert_eq!(app.active.as_str(), third);
            let moved = format!("Projects/Demo/{}", second.rsplit('/').next().unwrap());
            assert_eq!(
                f.0.notes().unwrap().read_note(&moved).unwrap(),
                "second review"
            );
            assert!(!f.0.root.join(&second).exists());
            app.execute(Choice::Filter(super::Filter::Unreviewed), window, cx);
            app.open_note(third.clone().into(), true, window, cx);
            app.execute(Choice::Reviewed, window, cx);
            assert!(app.active.is_empty());
            assert!(
                f.0.notes()
                    .unwrap()
                    .get_note_meta(&third)
                    .unwrap()
                    .reviewed_ms
                    .is_some()
            );
            assert_eq!(super::Preferences::load(&f.0.env).stream_day, Some(day));
            assert!(
                app.entries("", cx)
                    .iter()
                    .all(|e| !matches!(e.choice, Choice::MoveNote(_)))
            );
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, _, cx| {
        assert!(app.read(cx).active.is_empty());
    })
    .unwrap();
}

#[gpui_kit::test]
fn folders_right_click_creates_root_and_child_without_blocking_rows(cx: &mut TestAppContext) {
    use super::commands::ModalKind;
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.set_view(View::Folders, window, cx));
        window.render_frame(cx);
        assert!(
            window.find("root-drop").bounds().size.height > px(300.),
            "the entire unused Folders area must open the root context menu"
        );
        window.right_click("root-drop", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            window.within("popup-menu").find(0usize).label(),
            Some("New folder at root…")
        );
        window.within("popup-menu").click(0usize, cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert!(matches!(&app.modal.as_ref().unwrap().kind, ModalKind::CreateFolder(parent) if parent.is_empty()));
            app.modal.as_ref().unwrap().input.update(cx, |input, cx| input.set_value("Root folder", window, cx));
            app.submit_modal(window, cx);
        });
        window.render_frame(cx);
        let row = window.find("nav-row-Root folder").bounds();
        let blank = window.find("root-drop").bounds();
        assert!(blank.size.height > px(300.));
        assert!((blank.top() - row.bottom()).abs() <= px(1.));
        window.right_click("nav-row-Root folder", cx);
    }).unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        // The first row is a label, then New note and New folder.
        assert_eq!(
            window.within("popup-menu").find(2usize).label(),
            Some("New folder here…")
        );
        window.within("popup-menu").click(2usize, cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert!(matches!(&app.modal.as_ref().unwrap().kind, ModalKind::CreateFolder(parent) if parent == "Root folder"));
            app.modal.as_ref().unwrap().input.update(cx, |input, cx| input.set_value("Child", window, cx));
            app.submit_modal(window, cx);
        });
    }).unwrap();
    assert!(f.0.root.join("Root folder/Child").is_dir());
}

#[gpui_kit::test]
fn navigation_folder_range_create_and_move(cx: &mut TestAppContext) {
    let f = Fixture::new();
    for folder in ["Alpha", "Beta", "Gamma"] {
        f.0.create_folder(folder).unwrap();
        f.0.create(folder, format!("{folder} body"), None).unwrap();
    }
    f.0.create(STREAM_FOLDER, "Unrelated open note".into(), None)
        .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.select_row(&"Alpha".into(), cx);
            app.click_row("Beta".into(), true, true, window, cx);
            assert_eq!(app.targets(cx), ["Alpha", "Beta"]);
            assert!(
                !super::tree_moves::find(&app.roots, &"Beta".into())
                    .unwrap()
                    .is_expanded()
            );
            app.selected.clear();
            app.select_row(&"Alpha".into(), cx);
        });
    })
    .unwrap();
    press(cx, window, "shift-j shift-j");
    cx.update_window(window, |_, _, cx| {
        assert_eq!(app.read(cx).targets(cx), ["Alpha", "Beta", "Gamma"]);
    })
    .unwrap();
    press(cx, window, "shift-k");
    cx.update_window(window, |_, _, cx| {
        assert_eq!(app.read(cx).targets(cx), ["Alpha", "Beta"]);
    })
    .unwrap();
    press(cx, window, "shift-j shift-n");
    cx.simulate_input(window, "Projects");
    press(cx, window, "enter");
    cx.update_window(window, |_, _, cx| {
        assert!(f.0.root.join("Projects").is_dir());
        assert_eq!(app.read(cx).targets(cx), ["Alpha", "Beta", "Gamma"]);
        assert_eq!(
            app.read(cx)
                .tree
                .read(cx)
                .selected_item()
                .unwrap()
                .id
                .as_str(),
            "Gamma"
        );
    })
    .unwrap();
    press(cx, window, "m");
    cx.simulate_input(window, "mv");
    press(cx, window, "tab");
    cx.simulate_input(window, "Projects");
    press(cx, window, "enter");
    cx.update_window(window, |_, _, cx| {
        assert!(app.read(cx).error.is_none(), "{:?}", app.read(cx).error);
        for folder in ["Alpha", "Beta", "Gamma"] {
            assert!(!f.0.root.join(folder).exists());
            let path = std::fs::read_dir(f.0.root.join(format!("Projects/{folder}")))
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| path.extension().is_some_and(|e| e == "md"))
                .unwrap();
            assert!(
                std::fs::read_to_string(path)
                    .unwrap()
                    .contains(&format!("{folder} body"))
            );
        }
    })
    .unwrap();
    // Selecting both a folder and its child must carry the subtree just once.
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.select_row(&"Projects/Alpha".into(), cx);
            app.tree.update(cx, |tree, cx| tree.focus(window, cx));
        });
    })
    .unwrap();
    press(cx, window, "l shift-j");
    cx.update_window(window, |_, _, cx| {
        assert_eq!(app.read(cx).selected.len(), 2);
        assert_eq!(app.read(cx).targets(cx), ["Projects/Alpha"]);
    })
    .unwrap();
    press(cx, window, "m");
    cx.simulate_input(window, "mv");
    press(cx, window, "tab");
    cx.simulate_input(window, "Collected");
    press(cx, window, "enter");
    assert!(f.0.root.join("Collected/Alpha").is_dir());
    assert!(!f.0.root.join("Projects/Alpha").exists());
}

#[gpui_kit::test]
fn navigation_stream_selection_create_move_and_trash(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let timestamp = type_core::now_ms().unwrap();
    let first =
        f.0.create(STREAM_FOLDER, "one".into(), Some(timestamp + 3))
            .unwrap();
    let second =
        f.0.create(STREAM_FOLDER, "two".into(), Some(timestamp + 2))
            .unwrap();
    let third =
        f.0.create(STREAM_FOLDER, "three".into(), Some(timestamp + 1))
            .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.select_row(&first.clone().into(), cx);
            app.tree.update(cx, |tree, cx| tree.focus(window, cx));
        });
    })
    .unwrap();
    press(cx, window, "shift-j shift-k");
    cx.update_window(window, |_, _, cx| {
        assert_eq!(app.read(cx).targets(cx), [first.clone()]);
        assert!(
            app.read(cx)
                .selected
                .iter()
                .all(|id| !id.starts_with("feed:"))
        );
    })
    .unwrap();
    press(cx, window, "escape");
    // Space marks remain while moving through unselected rows.
    press(cx, window, "space j j space");
    cx.update_window(window, |_, _, cx| {
        let targets = app.read(cx).targets(cx);
        assert_eq!(targets.len(), 2);
        assert!(targets.contains(&first));
        assert!(targets.contains(&third));
        assert!(!targets.contains(&second));
    })
    .unwrap();
    press(cx, window, "n");
    cx.simulate_input(window, "Reading");
    press(cx, window, "enter m");
    cx.simulate_input(window, "mv");
    press(cx, window, "tab");
    cx.simulate_input(window, "Reading");
    press(cx, window, "enter");
    for path in [&first, &third] {
        assert!(!f.0.root.join(path).exists());
        assert!(
            f.0.root
                .join("Reading")
                .join(path.rsplit('/').next().unwrap())
                .is_file()
        );
    }
    assert!(f.0.root.join(&second).is_file());
    // Refocus navigation after Stream advances to the remaining note's editor.
    press(cx, window, "ctrl-w space cmd-backspace");
    assert!(!f.0.root.join(&second).exists());
    assert!(
        f.0.root
            .join(type_core::ARCHIVE_FOLDER)
            .join(second.rsplit('/').next().unwrap())
            .is_file()
    );
}

#[gpui_kit::test]
fn palette_creation_and_actions_describe_the_focused_filesystem_targets(cx: &mut TestAppContext) {
    use super::commands::{Choice, ModalKind};
    let f = Fixture::new();
    f.0.create_folder("Projects").unwrap();
    f.0.create_folder("Other").unwrap();
    let editor_note =
        f.0.create(STREAM_FOLDER, "Unrelated editor note".into(), None)
            .unwrap();
    let root_note = f.0.create("", "Root note".into(), None).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.select_row(&"Projects".into(), cx);
        });
    })
    .unwrap();
    press(cx, window, "cmd-k");
    cx.simulate_input(window, "new folder");
    cx.update_window(window, |_, _, cx| {
        let entries = app.read(cx).entries("new folder", cx);
        assert_eq!(entries[0].label, "New folder inside “Projects”…");
        assert!(matches!(&entries[0].choice, Choice::NewFolder(parent) if parent == "Projects"));
        assert!(
            entries
                .iter()
                .any(|e| matches!(&e.choice, Choice::NewFolder(parent) if parent.is_empty()))
        );
    })
    .unwrap();
    press(cx, window, "enter");
    cx.simulate_input(window, "Ideas");
    press(cx, window, "enter");
    assert!(f.0.root.join("Projects/Ideas").is_dir());
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.select_row(&"Projects".into(), cx);
            app.selected.extend(["Projects".into(), "Other".into()]);
            assert_eq!(app.palette_target_label(cx), "2 folders");
            app.selected.remove("Other");
            app.selected.insert(root_note.clone().into());
            assert_eq!(app.palette_target_label(cx), "1 folder and 1 note");
            app.selected.clear();
            app.tree.update(cx, |tree, cx| tree.focus(window, cx));
        });
    })
    .unwrap();
    press(cx, window, "cmd-k");
    cx.simulate_input(window, "to folder");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert_eq!(app.targets(cx), ["Projects"]);
        assert_eq!(
            app.entries("to folder", cx)[0].label,
            "Move folder “Projects” to folder… (mv)"
        );
    })
    .unwrap();
    press(cx, window, "enter");
    cx.update_window(window, |_, _, cx| {
        assert!(matches!(
            app.read(cx).modal.as_ref().unwrap().kind,
            ModalKind::Palette
        ));
        assert_eq!(app.read(cx).targets(cx), ["Projects"]);
    })
    .unwrap();
    cx.simulate_input(window, "Elsewhere");
    press(cx, window, "enter");
    assert!(f.0.root.join("Elsewhere/Projects/Ideas").is_dir());
    assert!(!f.0.root.join("Projects").exists());
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.selected.insert("Other".into());
            app.open_note(editor_note.clone().into(), true, window, cx);
            app.notes[&app.active]
                .editor
                .as_ref()
                .unwrap()
                .update(cx, |editor, cx| {
                    editor.set_selected_range(0..9, cx);
                });
        });
    })
    .unwrap();
    press(cx, window, "cmd-k");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert_eq!(app.targets(cx), [editor_note.clone()]);
        assert_eq!(app.palette_target_label(cx), "note “Unrelated editor note”");
        assert!(
            app.entries("new folder", cx)
                .iter()
                .all(|e| !e.label.contains("inside"))
        );
        assert_eq!(
            app.entries("to folder", cx)[0].label,
            "Move note “Unrelated editor note” to folder… (mv)"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn folders_full_list_keeps_blank_root_context_space(cx: &mut TestAppContext) {
    let f = Fixture::new();
    for index in 0..80 {
        f.0.create_folder(&format!("Folder {index:02}")).unwrap();
    }
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.select_row(&"Folder 79".into(), cx);
        });
        window.render_frame(cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let blank = window.find("root-drop").bounds();
        assert!(blank.size.height >= px(24.));
        assert!(
            blank.size.height <= px(25.),
            "a long tree should use all remaining height"
        );
        assert!(window.find("nav-row-Folder 79").bounds().bottom() <= blank.top() + px(1.));
        window.right_click("root-drop", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            window.within("popup-menu").find(0usize).label(),
            Some("New folder at root…")
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn rename_updates_tree_and_previews_before_background_refresh(cx: &mut TestAppContext) {
    use super::commands::Choice;
    let f = Fixture::new();
    let note =
        f.0.create("Work/Child", "Title stays visible".into(), None)
            .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.open_note(note.clone().into(), false, window, cx);
            let editor_id = app.notes[&app.active].editor.as_ref().unwrap().entity_id();
            app.set_view(View::Folders, window, cx);
            app.select_row(&note.clone().into(), cx);
            app.select_row(&"Work".into(), cx);
            app.execute(Choice::Rename, window, cx);
            app.modal
                .as_ref()
                .unwrap()
                .input
                .update(cx, |input, cx| input.set_value("Renamed", window, cx));
            // Keep refresh unavailable: assertions must pass synchronously, with no polling.
            app.refreshing = true;
            app.submit_modal(window, cx);
            let renamed_note = note.replacen("Work/", "Renamed/", 1);
            assert!(app.error.is_none(), "{:?}", app.error);
            assert!(!super::navigation::contains(&app.nav_items, "Work"));
            assert!(super::navigation::contains(&app.nav_items, &renamed_note));
            assert_eq!(
                app.tree.read(cx).selected_item().unwrap().id.as_str(),
                "Renamed"
            );
            assert!(
                super::tree_moves::find(&app.roots, &"Renamed".into())
                    .unwrap()
                    .is_expanded()
            );
            assert!(
                super::tree_moves::find(&app.roots, &"Renamed/Child".into())
                    .unwrap()
                    .is_expanded()
            );
            assert_eq!(app.active.as_str(), renamed_note);
            assert_eq!(
                app.notes[&app.active].editor.as_ref().unwrap().entity_id(),
                editor_id
            );
            assert_eq!(app.previews[&renamed_note].content, "Title stays visible");
            app.select_row(&renamed_note.clone().into(), cx);
            app.execute(Choice::Rename, window, cx);
            app.modal
                .as_ref()
                .unwrap()
                .input
                .update(cx, |input, cx| input.set_value("new-name", window, cx));
            app.submit_modal(window, cx);
            let new_note = "Renamed/Child/new-name.md";
            assert!(!super::navigation::contains(&app.nav_items, &renamed_note));
            assert!(super::navigation::contains(&app.nav_items, new_note));
            assert_eq!(
                app.tree.read(cx).selected_item().unwrap().label.as_str(),
                "Title stays visible"
            );
            assert_eq!(app.active.as_str(), new_note);
            assert_eq!(app.previews[new_note].path, new_note);
            assert!(!f.0.root.join(renamed_note).exists());
            assert!(f.0.root.join(new_note).is_file());
            app.refreshing = false;
        });
        window.render_frame(cx);
    })
    .unwrap();
}

#[gpui_kit::test]
fn navigation_m_opens_empty_palette_and_mv_tab_starts_at_root(cx: &mut TestAppContext) {
    use super::commands::Choice;
    let f = Fixture::new();
    for folder in ["Source", "Destination/Nested"] {
        f.0.create_folder(folder).unwrap();
    }
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.select_row(&"Source".into(), cx);
        });
    })
    .unwrap();
    press(cx, window, "m");
    cx.update_window(window, |_, _, cx| {
        assert_eq!(
            app.read(cx)
                .modal
                .as_ref()
                .unwrap()
                .palette
                .as_ref()
                .unwrap()
                .read(cx)
                .query(cx),
            ""
        );
    })
    .unwrap();
    cx.simulate_input(window, "mv");
    press(cx, window, "tab");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        assert_eq!(
            app.modal
                .as_ref()
                .unwrap()
                .palette
                .as_ref()
                .unwrap()
                .read(cx)
                .query(cx),
            "mv "
        );
        let entries = app.entries("mv ", cx);
        assert!(
            entries
                .iter()
                .any(|e| matches!(&e.choice, Choice::Move(path) if path.is_empty()))
        );
        assert!(
            entries
                .iter()
                .any(|e| matches!(&e.choice, Choice::Move(path) if path == "Destination"))
        );
        assert!(entries.iter().all(
            |e| !matches!(&e.choice, Choice::Move(path) if path == "Source" || path.contains('/'))
        ));
    })
    .unwrap();
    cx.simulate_input(window, "Destination");
    press(cx, window, "tab");
    cx.update_window(window, |_, _, cx| {
        let app = app.read(cx);
        let query = app
            .modal
            .as_ref()
            .unwrap()
            .palette
            .as_ref()
            .unwrap()
            .read(cx)
            .query(cx);
        assert_eq!(query, "mv Destination/");
        assert!(
            app.entries(&query, cx)
                .iter()
                .any(|e| matches!(&e.choice, Choice::Move(path) if path == "Destination/Nested"))
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn deletion_skips_empty_folders_and_confirms_contents_with_cancel_focused(cx: &mut TestAppContext) {
    use super::commands::{Choice, ModalKind};
    let f = Fixture::new();
    for folder in ["Empty", "Ordered empty", "Hidden content", "Also empty"] {
        f.0.create_folder(folder).unwrap();
    }
    std::fs::write(f.0.root.join("Ordered empty/.notes-order.json"), "{}").unwrap();
    std::fs::write(
        f.0.root.join("Hidden content/attachment.bin"),
        b"not a Markdown note",
    )
    .unwrap();
    let note =
        f.0.create("Full/Child", "Preserve on cancel".into(), None)
            .unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.set_view(View::Folders, window, cx);
            app.select_row(&"Empty".into(), cx);
            app.execute(Choice::Delete, window, cx);
            assert!(app.modal.is_none());
            assert!(!f.0.root.join("Empty").exists());
            assert!(!super::navigation::contains(&app.nav_items, "Empty"));
            app.selected
                .extend(["Ordered empty".into(), "Also empty".into()]);
            app.execute(Choice::Delete, window, cx);
            assert!(app.modal.is_none());
            assert!(!f.0.root.join("Ordered empty").exists());
            assert!(!f.0.root.join("Also empty").exists());
            app.select_row(&"Full".into(), cx);
        });
    })
    .unwrap();
    press(cx, window, "cmd-shift-backspace");
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        let modal = app.read(cx).modal.as_ref().unwrap();
        assert!(matches!(modal.kind, ModalKind::Delete(_)));
        assert!(modal.delete_focus.as_ref().unwrap()[0].is_focused(window));
        assert_eq!(window.find("delete-cancel").label(), Some("Cancel"));
        assert_eq!(window.find("delete-confirm").label(), Some("OK"));
        assert!(f.0.root.join(&note).is_file());
    })
    .unwrap();
    press(cx, window, "enter");
    assert!(f.0.root.join(&note).is_file());
    cx.update_window(window, |_, _, cx| assert!(app.read(cx).modal.is_none()))
        .unwrap();
    press(cx, window, "cmd-shift-backspace tab shift-tab enter");
    assert!(f.0.root.join(&note).is_file());
    press(cx, window, "cmd-shift-backspace tab enter");
    assert!(!f.0.root.join("Full").exists());
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            assert!(app.error.is_none(), "{:?}", app.error);
            assert!(!super::navigation::contains(&app.nav_items, "Full"));
            app.select_row(&"Hidden content".into(), cx);
            app.tree.update(cx, |tree, cx| tree.focus(window, cx));
            app.execute(Choice::Delete, window, cx);
            assert!(app.modal.is_some(), "unrecognized content still needs confirmation");
            assert_eq!(app.view, View::Folders);
            assert!(matches!(&app.modal.as_ref().unwrap().kind, ModalKind::Delete(paths) if paths == &["Hidden content"]));
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        window.click("delete-confirm", cx);
    })
    .unwrap();
    cx.run_until_parked();
    assert!(!f.0.root.join("Hidden content").exists());
}

#[gpui_kit::test]
fn sidebar_actions_and_filter_menu_keep_their_behavior(cx: &mut TestAppContext) {
    use super::{Filter, commands::Choice};
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    let original = cx.read(|cx| app.read(cx).active.clone());
    cx.update_window(window, |_, window, cx| {
        let new = window.find("new").bounds();
        let settings = window.find("settings").bounds();
        let stream = window.find("nav-stream").bounds();
        assert_eq!(new.left(), stream.left());
        assert_eq!(settings.left(), stream.left());
        assert_eq!(new.size.height, px(32.));
        assert_eq!(settings.size.height, px(32.));
        assert_eq!(window.viewport_size().height - settings.bottom(), px(8.));
        assert_eq!(window.viewport_size().height - settings.center().y, px(24.));
        assert!(new.size.width > px(280.));
        assert!(settings.size.width > px(240.));
        window.right_click("new", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            window.within("popup-menu").find(0usize).label(),
            Some("Start a voice note")
        );
        window.within("popup-menu").click(0usize, cx);
        assert_eq!(app.read(cx).active, original);
        assert!(!app.read(cx).recording);
        assert!(app.read(cx).capture.is_none());
        assert!(!app.read(cx).busy);
        app.update(cx, |app, cx| {
            app.execute(Choice::Filter(Filter::All), window, cx)
        });
        window.render_frame(cx);
        let filter = window.find("nav-filter").bounds();
        assert_eq!(filter.size.width, filter.size.height);
        assert_eq!(filter.size.height, px(24.));
        let icon = window.find("nav-filter-icon").bounds();
        assert_eq!(icon.size, size(px(14.), px(14.)));
        assert!(filter.contains(&icon.origin) && filter.contains(&icon.bottom_right()));
        window.click("nav-filter", cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(
            window.within("popup-menu").find(3usize).label(),
            Some("Unreviewed")
        );
        window.within("popup-menu").click(3usize, cx);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert_eq!(app.read(cx).filter, Filter::Unreviewed);
        let filter = window.find("nav-filter").bounds();
        assert!(filter.size.width > filter.size.height && filter.size.width < px(100.));
        assert_eq!(filter.size.height, px(24.));
        let icon = window.find("nav-filter-icon").bounds();
        assert_eq!(icon.size, size(px(14.), px(14.)));
        assert!(filter.contains(&icon.origin) && filter.contains(&icon.bottom_right()));
        let before = app.read(cx).active.clone();
        window.click_at("new", point(px(270.), px(20.)), cx);
        assert_ne!(app.read(cx).active, before);
        window.click("settings", cx);
        assert!(app.read(cx).settings);
    })
    .unwrap();
    assert_eq!(
        super::Preferences::load(&f.0.env).stream_filter,
        Filter::Active
    );
}

#[gpui_kit::test]
fn sidebar_sync_hover_and_stop_keep_notes_open(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    // Publish a synthetic running status through the same completion path as Start.
    // No server is bound and no phone or real profile is used.
    let mut running = type_core::local_sync_server_status(&f.0.env).unwrap();
    running.running = true;
    running.ssh_url = Some("ssh://type@127.0.0.1:1234/notes".into());
    running.iroh_ticket = Some("synthetic-ticket".into());
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.run_job("Synthetic start", window, cx, move |_| {
                let mut result = super::jobs::ResultData::message("Started");
                result.server = Some(running);
                Ok(result)
            });
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        assert!(!app.read(cx).settings);
        // Polling correctly reads the actual inactive daemon. Supply the pairing
        // fixture again solely for the hover and stop-click behavior.
        app.update(cx, |app, cx| {
            let status = app.local_server.as_mut().unwrap();
            status.running = true;
            status.ssh_url = Some("ssh://type@127.0.0.1:1234/notes".into());
            cx.notify();
        });
        window.render_frame(cx);
        window.hover("status", cx);
    })
    .unwrap();
    cx.background_executor
        .advance_clock(std::time::Duration::from_millis(600));
    cx.run_until_parked();
    cx.update_window(window, |_, window, cx| {
        window.render_frame(cx);
        assert!(window.find("phone-pairing-code").bounds().size.width >= px(220.));
        window.click("status", cx);
        assert!(!app.read(cx).settings);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, _, cx| {
        assert!(!app.read(cx).busy);
        assert!(!app.read(cx).settings);
        assert!(!app.read(cx).local_server.as_ref().unwrap().running);
        assert_eq!(app.read(cx).status, "Phone sync server stopped");
    })
    .unwrap();
    assert!(!type_core::local_sync_auto_start_enabled(&f.0.env));
}

#[gpui_kit::test]
fn sidebar_sync_start_failure_does_not_open_settings(cx: &mut TestAppContext) {
    let f = Fixture::new();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        // Fail before Git setup or socket binding, using only the fixture root.
        std::fs::remove_dir_all(&f.0.root).unwrap();
        std::fs::write(&f.0.root, "unavailable folder").unwrap();
        window.click("status", cx);
        assert!(app.read(cx).busy);
        assert!(!app.read(cx).settings);
    })
    .unwrap();
    cx.run_until_parked();
    cx.update_window(window, |_, _, cx| {
        assert!(!app.read(cx).busy);
        assert!(!app.read(cx).settings);
        assert!(app.read(cx).error.is_some());
    })
    .unwrap();
}

#[test]
fn application_assets_render_sidebar_icons_with_visible_pixels() {
    use gpui_kit::{AssetSource, SvgRenderer, assets::IconName};
    let renderer = SvgRenderer::new(std::sync::Arc::new(super::AppAssets));
    for icon in [IconName::ListFilter, IconName::Mic] {
        let path = icon.path();
        let bytes = super::AppAssets
            .load(&path)
            .unwrap_or_else(|error| panic!("Missing application icon {path}: {error}"))
            .unwrap_or_else(|| panic!("Missing application icon {path}"));
        let parsed = renderer.parse_svg(&bytes).unwrap();
        let requested = size(gpui_kit::DevicePixels(14), gpui_kit::DevicePixels(14));
        let image = renderer
            .render_parsed(&parsed, gpui_kit::SvgSize::ExactSize(requested))
            .unwrap();
        assert_eq!(image.size(0), requested);
        assert!(
            image
                .as_bytes(0)
                .unwrap()
                .chunks_exact(4)
                .any(|pixel| pixel[3] > 0),
            "Icon {path} must paint visible pixels"
        );
    }
}

#[gpui_kit::test]
fn folder_chrome_and_refresh_use_the_home_editor(cx: &mut TestAppContext) {
    use std::{fs, path::Path};
    let f = Fixture::new();
    let body = "same text β😀\nsecond line\n";
    let note = f.0.create(STREAM_FOLDER, body.into(), None).unwrap();
    let folder = f.0.env.app_data_dir.join("chrome-fixture");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("file.md"), body).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.prefs.line_numbers = true;
            app.open_note(note.into(), true, window, cx);
        });
        window.render_frame(cx);
        window.render_frame(cx);
        let main = app.read(cx).notes[&app.read(cx).active]
            .editor
            .clone()
            .unwrap();
        let main_gutter =
            main.read(cx).input_bounds().left() - window.find("editor-pane").bounds().left();
        app.update(cx, |app, cx| app.open_folder_path(&folder, window, cx));
        let tab = app.read(cx).current_folder().unwrap();
        tab.update(cx, |tab, cx| {
            let id = tab.entry_id(Path::new("file.md"));
            tab.open_file(id, true, window, cx);
        });
        window.render_frame(cx);
        window.render_frame(cx);
        let editor = tab.read(cx).current_editor().unwrap();
        assert_eq!(
            editor.read(cx).input_bounds().left() - window.find("editor-pane").bounds().left(),
            main_gutter
        );
        let sidebar = window.find("folder-sidebar").bounds();
        let content = window.find("folder-content-pane").bounds();
        assert_eq!(sidebar.top(), px(0.));
        assert_eq!(content.top(), px(0.));
        let tabs = window.find("workspace-tabs").bounds();
        assert_eq!(tabs.top(), px(28.));
        assert_eq!(tabs.size.height, px(36.));
        assert_eq!(tabs.left(), px(0.));
        for y in [px(14.), px(46.)] {
            let probe = point(content.left(), y).scale(window.scale_factor());
            let top = window
                .painted_quads()
                .into_iter()
                .filter(|quad| quad.bounds.contains(&probe))
                .filter(|quad| {
                    quad.background
                        .as_solid()
                        .is_some_and(|color| color.a == 1.)
                })
                .max_by_key(|quad| quad.order)
                .unwrap();
            assert_eq!(
                top.background,
                super::Theme::global(cx).background.into(),
                "the pane divider must not show through either top row"
            );
        }
        assert_eq!(
            window.find("folder-sidebar-header").bounds().top(),
            tabs.bottom()
        );
        assert!(window.try_find("folder-editor-footer").is_none());
        assert!(window.try_find("folder-sidebar-footer").is_none());
        let saved = window.find("folder-save-state").bounds();
        assert!(saved.bottom() <= content.bottom());
        assert!(saved.top() > content.bottom() - px(40.));
        assert!(saved.left() > content.right() - px(100.));
        fs::write(folder.join("file.md"), "updated from disk β😀").unwrap();
        fs::write(folder.join("new-config.json"), "{}").unwrap();
        window.click("folder-refresh", cx);
        assert_eq!(editor.read(cx).value().as_ref(), "updated from disk β😀");
        assert_eq!(
            tab.read(cx).current_editor().unwrap().entity_id(),
            editor.entity_id()
        );
        assert!(
            !tab.read(cx)
                .entry_id(Path::new("new-config.json"))
                .is_empty()
        );
        window.render_frame(cx);
        let folder_tab_id = format!("workspace-tab-{:?}", tab.entity_id());
        let tab_before_resize = window.find(folder_tab_id.clone()).bounds();
        let main_tab = window.find("workspace-main").bounds();
        assert!(tab_before_resize.left() >= main_tab.right());
        assert!(
            tab_before_resize.left() - main_tab.right() < px(12.),
            "folder tabs sit directly beside Type"
        );
        let panes = app.read(cx).pane_state.clone();
        panes.update(cx, |panes, cx| panes.resize_panel(0, px(410.), window, cx));
        window.render_frame(cx);
        window.render_frame(cx);
        let content = window.find("folder-content-pane").bounds();
        assert_eq!(
            window.find(folder_tab_id.clone()).bounds(),
            tab_before_resize,
            "resizing the sidebar must not move workspace tabs"
        );
        window.click("workspace-main", cx);
        assert!(
            app.read(cx).active_folder.is_none(),
            "native tab click returns Home"
        );
        window.render_frame(cx);
        window.render_frame(cx);
        let main_pane = window.find("content-pane").bounds();
        assert_eq!(main_pane.top(), px(0.));
        assert_eq!(
            main_pane.left(),
            content.left(),
            "pane widths survive workspace switching"
        );
        assert_eq!(window.find(folder_tab_id).bounds(), tab_before_resize);
        window.click(format!("workspace-close-{:?}", tab.entity_id()), cx);
        assert!(app.read(cx).folder_tabs.is_empty());
        assert!(
            app.read(cx).active_folder.is_none(),
            "close does not select its folder tab"
        );
        window.render_frame(cx);
        assert!(window.try_find("workspace-tabs").is_none());
    })
    .unwrap();
}

#[gpui_kit::test]
fn ordinary_folder_tabs_preserve_main_and_save_real_files_without_profile_setup(
    cx: &mut TestAppContext,
) {
    use std::{fs, path::Path};
    let f = Fixture::new();
    let main_path =
        f.0.create(STREAM_FOLDER, "# Main note".into(), None)
            .unwrap();
    let folder = f.0.env.app_data_dir.join("ordinary-folder");
    fs::create_dir_all(folder.join("nested")).unwrap();
    fs::write(
        folder.join("note.md"),
        "---\nid: untouched\n---\n# Original\n",
    )
    .unwrap();
    fs::write(folder.join("nested/plain.txt"), "Привет 😀").unwrap();
    fs::write(folder.join("image.png"), [0, 1, 2]).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| {
            app.open_note(main_path.clone().into(), true, window, cx);
        });
        window.render_frame(cx);
        assert!(window.try_find("workspace-tabs").is_none());
        let profile_id = app.read(cx).profiles.active_profile_id.clone();
        app.update(cx, |app, cx| app.open_folder_path(&folder, window, cx));
        window.render_frame(cx);
        assert!(window.find("workspace-tabs").visible());
        let tab = app.read(cx).current_folder().unwrap();
        tab.update(cx, |tab, cx| {
            let id = tab.entry_id(Path::new("note.md"));
            tab.open_file(id, true, window, cx);
            let editor = tab.current_editor().unwrap();
            assert_eq!(
                editor.read(cx).value().as_ref(),
                "---\nid: untouched\n---\n# Original\n"
            );
            editor.update(cx, |editor, cx| {
                editor.set_value("---\nid: untouched\n---\n# Edited β😀\n", window, cx)
            });
        });
        app.update(cx, |app, cx| app.switch_workspace(None, window, cx));
        assert_eq!(app.read(cx).active.as_ref(), main_path);
        assert_eq!(app.read(cx).profiles.active_profile_id, profile_id);
        assert_eq!(
            fs::read_to_string(folder.join("note.md")).unwrap(),
            "---\nid: untouched\n---\n# Edited β😀\n"
        );
        app.update(cx, |app, cx| {
            app.open_folder_path(&folder.join("."), window, cx)
        });
        assert_eq!(
            app.read(cx).folder_tabs.len(),
            1,
            "same canonical folder reuses its tab"
        );
        tab.update(cx, |tab, cx| {
            let nested = tab.entry_id(Path::new("nested"));
            tab.toggle_directory(&nested, Some(true), window, cx);
            let text = tab.entry_id(Path::new("nested/plain.txt"));
            tab.open_file(text, true, window, cx);
            tab.current_editor()
                .unwrap()
                .update(cx, |editor, cx| editor.set_value("", window, cx));
            let unsupported = tab.entry_id(Path::new("image.png"));
            tab.open_file(unsupported, true, window, cx);
            assert!(tab.current_editor().is_none());
        });
        assert!(
            folder.join("nested/plain.txt").is_file(),
            "empty ordinary files are not deleted"
        );
        assert_eq!(
            fs::read_to_string(folder.join("nested/plain.txt")).unwrap(),
            ""
        );
        assert!(!folder.join("_system").exists());
        assert!(!folder.join(".type").exists());
        assert!(!folder.join(".git").exists());
        app.update(cx, |app, cx| app.close_folder(tab.entity_id(), window, cx));
        window.render_frame(cx);
        assert!(window.try_find("workspace-tabs").is_none());
        assert!(app.read(cx).current_folder().is_none());
    })
    .unwrap();
}

#[gpui_kit::test]
fn folder_conflicts_keep_the_tab_and_draft_and_block_quit_and_updates(cx: &mut TestAppContext) {
    use std::{fs, path::Path};
    let f = Fixture::new();
    let folder = f.0.env.app_data_dir.join("ordinary-folder");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("note.txt"), "original").unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_folder_path(&folder, window, cx));
        let tab = app.read(cx).current_folder().unwrap();
        tab.update(cx, |tab, cx| {
            tab.open_file(tab.entry_id(Path::new("note.txt")), true, window, cx);
            tab.current_editor()
                .unwrap()
                .update(cx, |editor, cx| editor.set_value("local draft", window, cx));
        });
        fs::write(folder.join("note.txt"), "external change").unwrap();
        app.update(cx, |app, cx| {
            app.close_folder(tab.entity_id(), window, cx);
            assert_eq!(app.folder_tabs.len(), 1);
            assert_eq!(app.active_folder, Some(tab.entity_id()));
            assert!(app.flush(false, cx).is_err());
            assert!(!app.prepare_update(cx));
        });
        assert_eq!(
            tab.read(cx)
                .current_editor()
                .unwrap()
                .read(cx)
                .value()
                .as_ref(),
            "local draft"
        );
        assert_eq!(
            fs::read_to_string(folder.join("note.txt")).unwrap(),
            "external change"
        );
    })
    .unwrap();
}

#[gpui_kit::test]
fn external_folder_shortcuts_cannot_create_or_delete_profile_notes(cx: &mut TestAppContext) {
    use std::{fs, path::Path};
    let f = Fixture::new();
    let main_path =
        f.0.create(STREAM_FOLDER, "# Main note".into(), None)
            .unwrap();
    let folder = f.0.env.app_data_dir.join("ordinary-folder");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("plain.txt"), "hello").unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_folder_path(&folder, window, cx));
        let tab = app.read(cx).current_folder().unwrap();
        tab.update(cx, |tab, cx| {
            tab.open_file(tab.entry_id(Path::new("plain.txt")), true, window, cx)
        });
    })
    .unwrap();
    press(cx, window, "cmd-n cmd-backspace cmd-shift-backspace cmd-k");
    assert_eq!(
        f.0.notes().unwrap().read_note(&main_path).unwrap(),
        "# Main note"
    );
    assert_eq!(
        fs::read_to_string(folder.join("plain.txt")).unwrap(),
        "hello"
    );
    cx.update_window(window, |_, _, cx| {
        assert!(app.read(cx).modal.is_none());
    })
    .unwrap();
}

#[gpui_kit::test]
fn arbitrary_text_files_accept_native_input_and_vim_and_autosave(cx: &mut TestAppContext) {
    use std::{fs, path::Path};
    let f = Fixture::new();
    let folder = f.0.env.app_data_dir.join("ordinary-folder");
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("mcp.json"), "hello").unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_folder_path(&folder, window, cx));
        let tab = app.read(cx).current_folder().unwrap();
        tab.update(cx, |tab, cx| {
            tab.open_file(tab.entry_id(Path::new("mcp.json")), true, window, cx)
        });
        window.render_frame(cx);
    })
    .unwrap();
    press(cx, window, "i");
    cx.update_window(window, |_, window, cx| window.input("Привет 😀 ", cx))
        .unwrap();
    cx.run_until_parked();
    press(cx, window, "escape cmd-s");
    assert_eq!(
        fs::read_to_string(folder.join("mcp.json")).unwrap(),
        "Привет 😀 hello"
    );
    cx.update_window(window, |_, window, cx| {
        let tab = app.read(cx).current_folder().unwrap();
        tab.update(cx, |tab, cx| {
            let editor = tab.current_editor().unwrap();
            editor.update(cx, |editor, cx| editor.set_value("autosaved", window, cx));
        });
    })
    .unwrap();
    cx.run_until_parked();
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(500));
    cx.run_until_parked();
    assert_eq!(
        fs::read_to_string(folder.join("mcp.json")).unwrap(),
        "autosaved"
    );
}

#[gpui_kit::test]
fn ordinary_folder_preserves_vim_history_and_half_page_movement(cx: &mut TestAppContext) {
    use std::{fs, path::Path};
    let f = Fixture::new();
    let folder = f.0.env.app_data_dir.join("folder-vim-release-fixture");
    fs::create_dir_all(&folder).unwrap();
    let original = (0..80)
        .map(|n| format!("line {n} β😀\n"))
        .collect::<String>();
    fs::write(folder.join("note.txt"), &original).unwrap();
    let (window, app) = launch(&f, cx);
    cx.update_window(window, |_, window, cx| {
        app.update(cx, |app, cx| app.open_folder_path(&folder, window, cx));
        let tab = app.read(cx).current_folder().unwrap();
        tab.update(cx, |tab, cx| {
            tab.open_file(tab.entry_id(Path::new("note.txt")), true, window, cx)
        });
    })
    .unwrap();
    cx.run_until_parked();
    press(cx, window, "i");
    cx.simulate_input(window, "Привет 🦀 ");
    press(cx, window, "escape u");
    cx.update_window(window, |_, _, cx| {
        let tab = app.read(cx).current_folder().unwrap();
        let editor = tab.read(cx).current_editor().unwrap();
        assert_eq!(editor.read(cx).value().as_ref(), original);
        assert!(!editor.read(cx).is_editable());
    })
    .unwrap();
    press(cx, window, "ctrl-r cmd-s");
    assert_eq!(
        fs::read_to_string(folder.join("note.txt")).unwrap(),
        format!("Привет 🦀 {original}")
    );
    press(cx, window, "g g 3 ctrl-d");
    cx.update_window(window, |_, _, cx| {
        use gpui_kit::base::input::RopeExt;
        let tab = app.read(cx).current_folder().unwrap();
        let editor = tab.read(cx).current_editor().unwrap();
        let state = editor.read(cx);
        assert_eq!(state.text().offset_to_position(state.cursor()).line, 3);
        assert!(!state.is_editable());
    })
    .unwrap();
}
