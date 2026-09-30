use super::{Backend, TypeApp, View, vim};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{
    AnyWindowHandle, AppContext, Bounds, Entity, Focusable, TestAppContext, WindowBounds,
    WindowOptions, point, px, size,
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
    cx.update(gpui_kit::init);
    let env = f.0.env.clone();
    let result = cx.update(|cx| {
        gpui_kit::open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                    point(px(0.), px(0.)),
                    size(px(1150.), px(780.)),
                ))),
                ..Default::default()
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
