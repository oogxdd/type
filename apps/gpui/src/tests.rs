use super::{Backend, TypeApp, View, vim};
use chrono::Datelike;
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
    let elapsed_days = chrono::Local::now().weekday().num_days_from_monday() + 1;
    let earlier_y = 28. + 70. + 44. + 29. + elapsed_days as f32 * 32. + 14.;
    let mut visual = VisualTestContext::from_window(window, cx);
    visual.simulate_click(point(px(80.), px(earlier_y)), Modifiers::default());
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
