//! Short, reentrant worktree write transactions. Network transfers never hold
//! this lock. Canonical roots share it across windows and core services.
use std::{
    cell::RefCell,
    collections::HashMap,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, AtomicUsize, Ordering},
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub const WORKSPACE_BUSY: &str = "Sync is applying changes. Your draft is kept; saving will retry.";
#[derive(Default)]
pub struct WorkspaceState {
    write: Mutex<()>,
    revision: AtomicU64,
    services: AtomicUsize,
}
thread_local! { static HELD: RefCell<Vec<PathBuf>> = const { RefCell::new(Vec::new()) }; }
fn workspace_lock(root: &Path) -> Result<(PathBuf, Arc<WorkspaceState>), String> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<WorkspaceState>>>> = OnceLock::new();
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    // Resolve nested note/folder writers consistently even before hosting
    // starts and registers a strong root lease.
    let key = canonical
        .ancestors()
        .find(|path| path.join(".git").exists() || path.join(".type/profile.json").is_file())
        .unwrap_or(&canonical)
        .to_path_buf();
    let mut locks = LOCKS
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|_| "Workspace registry lock poisoned.")?;
    locks.retain(|_, value| value.strong_count() > 0);
    // Ordinary folder tabs can edit a subfolder of a hosted notes root.
    if let Some((path, state)) = locks
        .iter()
        .filter(|(path, _)| key.starts_with(path))
        .max_by_key(|(path, _)| path.components().count())
        .and_then(|(path, state)| state.upgrade().map(|state| (path.clone(), state)))
    {
        return Ok((path, state));
    }
    let state = Arc::new(WorkspaceState::default());
    locks.insert(key.clone(), Arc::downgrade(&state));
    Ok((key, state))
}
pub fn workspace_state(root: &Path) -> Result<Arc<WorkspaceState>, String> {
    workspace_lock(root).map(|(_, state)| state)
}
struct Held(PathBuf);
impl Drop for Held {
    fn drop(&mut self) {
        HELD.with(|held| {
            let popped = held.borrow_mut().pop();
            debug_assert_eq!(popped.as_ref(), Some(&self.0));
        });
    }
}
fn transaction<T>(
    root: &Path,
    wait: bool,
    run: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let (key, state) = workspace_lock(root)?;
    if HELD.with(|held| held.borrow().contains(&key)) {
        return run();
    }
    let _guard = if wait {
        state
            .write
            .lock()
            .map_err(|_| "Workspace write lock poisoned.")?
    } else {
        state.write.try_lock().map_err(|_| WORKSPACE_BUSY)?
    };
    HELD.with(|held| held.borrow_mut().push(key.clone()));
    let _held = Held(key);
    let result = run();
    // Failed compound operations may have written files too.
    state.revision.fetch_add(1, Ordering::SeqCst);
    result
}
pub fn with_workspace_write<T>(
    root: &Path,
    run: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    transaction(root, true, run)
}
pub fn try_workspace_write<T>(
    root: &Path,
    run: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    transaction(root, false, run)
}
impl WorkspaceState {
    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::SeqCst)
    }
    pub fn git_active(&self) -> bool {
        self.services.load(Ordering::SeqCst) != 0
    }
    /// Call inside a write transaction, before pre-commit. Receipt publication
    /// checks this counter under the same lock; readers/writers remain free
    /// during the network phase.
    pub fn begin_git(self: &Arc<Self>) -> GitService {
        self.services.fetch_add(1, Ordering::SeqCst);
        GitService(self.clone())
    }
}
pub struct GitService(Arc<WorkspaceState>);
impl Drop for GitService {
    fn drop(&mut self) {
        self.0.services.fetch_sub(1, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn writers_share_canonical_roots_and_nested_tabs_and_try_never_waits() {
        let root = std::env::temp_dir().join(format!("type-writes-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(root.join("child")).unwrap();
        std::fs::create_dir(root.join(".git")).unwrap();
        let nested_first = workspace_state(&root.join("child")).unwrap();
        let state = workspace_state(&root).unwrap();
        assert!(Arc::ptr_eq(&nested_first, &state));
        let (entered, receive) = std::sync::mpsc::channel();
        let (release, wait) = std::sync::mpsc::channel();
        let writer_root = root.clone();
        let writer = std::thread::spawn(move || {
            with_workspace_write(&writer_root, || {
                with_workspace_write(&writer_root.join("child"), || Ok(())).unwrap();
                entered.send(()).unwrap();
                wait.recv().unwrap();
                Ok(())
            })
            .unwrap()
        });
        receive.recv().unwrap();
        assert_eq!(
            try_workspace_write(&root.join("."), || Ok(())).unwrap_err(),
            WORKSPACE_BUSY
        );
        assert_eq!(
            try_workspace_write(&root.join("child"), || Ok(())).unwrap_err(),
            WORKSPACE_BUSY
        );
        release.send(()).unwrap();
        writer.join().unwrap();
        assert_eq!(state.revision(), 1);
        let active = Arc::new(AtomicUsize::new(0));
        let threads: Vec<_> = (0..8)
            .map(|_| {
                let root = root.clone();
                let active = active.clone();
                std::thread::spawn(move || {
                    for _ in 0..50 {
                        with_workspace_write(&root, || {
                            assert_eq!(active.fetch_add(1, Ordering::SeqCst), 0);
                            std::thread::yield_now();
                            assert_eq!(active.fetch_sub(1, Ordering::SeqCst), 1);
                            Ok(())
                        })
                        .unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
