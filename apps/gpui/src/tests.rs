use super::{Backend, TypeApp, View, vim};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AnyWindowHandle, AppContext, Bounds, Entity, Focusable, Modifiers, TestAppContext,
    VisualTestContext, WindowBounds, WindowOptions, point, px, size,
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
