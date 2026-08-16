//! Fixtures for the tests that need a real [`App`] over a real folder.
//!
//! The parts of this crate worth testing — the nested navigation rows and the
//! chrome geometry — only exist once the core has a root to read, so these tests
//! drive the actual app against a throwaway directory instead of mocking the
//! core. They open it the way `type-tui <path>` does, which keeps them off the
//! profile's notes root entirely: `without_system_folders` scaffolds nothing, and
//! no app-data directory is written.

use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};

use crate::{app::App, command::NavLayout, core::Core};

/// Tests run in parallel, so each fixture needs a directory of its own.
static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

/// A throwaway folder shaped like a notes root: a `Feed` holding three dated
/// notes, plus a nested `projects/beta` with one.
pub struct Fixture {
    pub root: PathBuf,
}

impl Fixture {
    pub fn new() -> Self {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("type-tui-test-{}-{id}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("Feed")).expect("create Feed");
        fs::create_dir_all(root.join("projects/beta")).expect("create projects/beta");

        // Today's notes, a second apart, so they land in one relative bucket in
        // a known newest-first order.
        let now = chrono::Local::now().timestamp_millis();
        for (index, name) in ["alpha", "beta", "gamma"].iter().enumerate() {
            let created = now - index as i64 * 1_000;
            fs::write(
                root.join("Feed").join(format!("{name}.md")),
                format!("---\ncreated_ms: {created}\n---\n\n{name} note\n"),
            )
            .expect("seed feed note");
        }
        // More than one line, so the editor's line-number gutter has something
        // to count.
        fs::write(
            root.join("projects/beta/plan.md"),
            "beta plan\nsecond line\nthird line\n",
        )
        .expect("seed folder note");
        Self { root }
    }

    pub fn app(&self) -> App {
        let mut core = Core::new().expect("core");
        core.open_folder(self.root.to_str().expect("utf-8 root"))
            .expect("open fixture folder");
        App::new(core).expect("app")
    }

    pub fn nested_app(&self) -> App {
        let mut app = self.app();
        app.set_nav_layout(NavLayout::Nested);
        app
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}
