//! Serialize worktree mutations, independently of network transfers.
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub fn with_workspace_write<T>(
    root: &Path,
    run: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    static LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();
    let key = root.canonicalize().map_err(|error| error.to_string())?;
    let lock = {
        let mut locks = LOCKS
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| "Workspace registry lock poisoned.")?;
        locks.retain(|_, value| value.strong_count() > 0);
        if let Some(lock) = locks.get(&key).and_then(Weak::upgrade) {
            lock
        } else {
            let lock = Arc::new(Mutex::new(()));
            locks.insert(key, Arc::downgrade(&lock));
            lock
        }
    };
    let _guard = lock.lock().map_err(|_| "Workspace write lock poisoned.")?;
    run()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn canonical_roots_serialize_concurrent_mutations() {
        let root =
            std::env::temp_dir().join(format!("type-workspace-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let active = Arc::new(AtomicUsize::new(0));
        let writers: Vec<_> = (0..8)
            .map(|index| {
                let root = if index % 2 == 0 {
                    root.clone()
                } else {
                    root.join(".")
                };
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
        for writer in writers {
            writer.join().unwrap();
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
