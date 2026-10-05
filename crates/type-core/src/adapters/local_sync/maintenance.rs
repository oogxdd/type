//! One coalescing maintenance worker per host lifetime. Hashing never holds
//! the worktree lock; manifest publication waits for Git services to finish.
use crate::{
    adapters::attachment_retention::{
        prepare_desktop_audio_receipts, publish_desktop_audio_receipts, DesktopReceiptCache,
    },
    application::workspace::{try_workspace_write, workspace_state},
};
use std::{
    path::PathBuf,
    sync::{Arc, Condvar, Mutex, OnceLock, Weak},
    time::Duration,
};
#[derive(Default)]
struct State {
    pending: bool,
    stopped: bool,
}
#[derive(Clone)]
pub(super) struct Maintenance {
    state: Arc<(Mutex<State>, Condvar)>,
    _lifetime: Arc<StopOnDrop>,
}
struct StopOnDrop(Weak<(Mutex<State>, Condvar)>);
impl Drop for StopOnDrop {
    fn drop(&mut self) {
        if let Some(state) = self.0.upgrade() {
            state.0.lock().unwrap().stopped = true;
            state.1.notify_all();
        }
    }
}
fn registry() -> &'static Mutex<Vec<(PathBuf, Weak<(Mutex<State>, Condvar)>)>> {
    static WORKERS: OnceLock<Mutex<Vec<(PathBuf, Weak<(Mutex<State>, Condvar)>)>>> =
        OnceLock::new();
    WORKERS.get_or_init(|| Mutex::new(Vec::new()))
}
pub(super) fn request(root: &std::path::Path) {
    let root = root.canonicalize().unwrap_or_else(|_| root.into());
    let live: Vec<_> = {
        let mut workers = registry().lock().unwrap();
        workers.retain(|(_, worker)| worker.strong_count() > 0);
        workers
            .iter()
            .filter(|(path, _)| path == &root)
            .filter_map(|(_, worker)| worker.upgrade())
            .collect()
    };
    for worker in live {
        let mut state = worker.0.lock().unwrap();
        if !state.stopped {
            state.pending = true;
            worker.1.notify_one();
        }
    }
}
impl Maintenance {
    pub fn new(root: PathBuf) -> Result<Self, String> {
        Self::spawn(root, || {})
    }
    #[cfg(test)]
    pub(super) fn with_scan_probe(
        root: PathBuf,
        probe: impl FnMut() + Send + 'static,
    ) -> Result<Self, String> {
        Self::spawn(root, probe)
    }
    fn spawn(
        root: PathBuf,
        mut before_scan: impl FnMut() + Send + 'static,
    ) -> Result<Self, String> {
        let workspace = workspace_state(&root)?;
        let state = Arc::new((Mutex::new(State::default()), Condvar::new()));
        registry().lock().unwrap().push((
            root.canonicalize().map_err(|e| e.to_string())?,
            Arc::downgrade(&state),
        ));
        let lifetime = Arc::new(StopOnDrop(Arc::downgrade(&state)));
        let worker = state.clone();
        std::thread::spawn(move || {
            let mut cache = DesktopReceiptCache::default();
            loop {
                let (lock, changed) = &*worker;
                let mut state = lock.lock().unwrap();
                while !state.pending && !state.stopped {
                    state = changed.wait(state).unwrap();
                }
                if state.stopped {
                    break;
                }
                state.pending = false;
                drop(state);
                before_scan();
                let started = std::time::Instant::now();
                let hashes = cache.hash_reads;
                let notes = cache.note_reads;
                let result = prepare_desktop_audio_receipts(&root, &workspace, &mut cache)
                    .and_then(|plan| {
                        try_workspace_write(&root, || {
                            if worker.0.lock().unwrap().stopped {
                                return Ok(Some(None));
                            }
                            publish_desktop_audio_receipts(&root, &workspace, plan)
                                .map(|result| result.map(Some))
                        })
                    });
                match result {
                    Ok(Some(Some(result))) => eprintln!("[attachments] background receipts scanned={} issued={} revoked={} unchanged={} hash_reads={} note_reads={} elapsed_ms={}", result.scanned, result.issued, result.revoked, result.unchanged, cache.hash_reads - hashes, cache.note_reads - notes, started.elapsed().as_millis()),
                    Ok(Some(None)) => break,
                    // Coalesce changes during a scan or a busy apply. Back off
                    // without blocking startup, Git, UI or the async executor.
                    Ok(None) => {
                        let mut state = lock.lock().unwrap();
                        if state.stopped { break; }
                        state.pending = true;
                        let _ = changed.wait_timeout(state, Duration::from_secs(2)).unwrap();
                    }
                    Err(error) => {
                        let busy = error == crate::application::workspace::WORKSPACE_BUSY;
                        if !busy { eprintln!("[attachments] background receipts deferred: {error}"); }
                        let mut state = lock.lock().unwrap();
                        if state.stopped { break; }
                        state.pending = true;
                        let _ = changed.wait_timeout(state, Duration::from_secs(if busy { 2 } else { 30 })).unwrap();
                    }
                }
            }
        });
        Ok(Self {
            state,
            _lifetime: lifetime,
        })
    }
    pub fn request(&self) {
        let mut state = self.state.0.lock().unwrap();
        if !state.stopped {
            state.pending = true;
            self.state.1.notify_one();
        }
    }
    pub fn stop(&self) {
        self.state.0.lock().unwrap().stopped = true;
        self.state.1.notify_all();
    }
}
