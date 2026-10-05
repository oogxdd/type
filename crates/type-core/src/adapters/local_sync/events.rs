//! Window-scoped subscriptions; callbacks only enqueue work. No UI on server
//! threads, and callbacks run without holding the subscriber registry lock.
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
    time::Duration,
};
use tokio::sync::oneshot;

pub enum LocalSyncEvent {
    Prepare {
        root: PathBuf,
        reply: oneshot::Sender<Result<(), String>>,
    },
    Push {
        root: PathBuf,
    },
}
type Listener = dyn Fn(LocalSyncEvent) + Send + Sync;
fn registry() -> &'static Mutex<Vec<Weak<Listener>>> {
    static LISTENERS: OnceLock<Mutex<Vec<Weak<Listener>>>> = OnceLock::new();
    LISTENERS.get_or_init(|| Mutex::new(Vec::new()))
}
pub struct LocalSyncSubscription {
    _listener: Arc<Listener>,
}
pub fn subscribe_local_sync_events(
    listener: impl Fn(LocalSyncEvent) + Send + Sync + 'static,
) -> LocalSyncSubscription {
    let listener: Arc<Listener> = Arc::new(listener);
    {
        let mut registry = registry().lock().unwrap();
        registry.retain(|listener| listener.strong_count() > 0);
        registry.push(Arc::downgrade(&listener));
    }
    LocalSyncSubscription {
        _listener: listener,
    }
}
fn listeners() -> Vec<Arc<Listener>> {
    let mut registry = registry().lock().unwrap();
    let live = registry.iter().filter_map(Weak::upgrade).collect();
    registry.retain(|listener| listener.strong_count() > 0);
    live
}
pub(super) async fn prepare(root: &Path) -> Result<(), String> {
    let replies: Vec<_> = listeners()
        .into_iter()
        .map(|listener| {
            let (reply, receive) = oneshot::channel();
            listener(LocalSyncEvent::Prepare {
                root: root.into(),
                reply,
            });
            receive
        })
        .collect();
    for reply in replies {
        tokio::time::timeout(Duration::from_secs(10), reply)
            .await
            .map_err(|_| "The desktop editor did not finish saving. Retry sync.".to_string())?
            .map_err(|_| "The desktop window closed before saving. Retry sync.".to_string())??;
    }
    Ok(())
}
pub(super) fn pushed(root: &Path) {
    for listener in listeners() {
        listener(LocalSyncEvent::Push { root: root.into() });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn subscriptions_fan_out_without_registry_lock_and_drop_detaches() {
        let root = PathBuf::from(format!("/synthetic-events-{}", crate::now_ms().unwrap()));
        let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let listen = || {
            let root = root.clone();
            let count = count.clone();
            subscribe_local_sync_events(move |event| match event {
                LocalSyncEvent::Push { root: event_root } if root == event_root => {
                    // Reentrant registration would deadlock if called under lock.
                    let _nested = subscribe_local_sync_events(|event| {
                        if let LocalSyncEvent::Prepare { reply, .. } = event {
                            let _ = reply.send(Ok(()));
                        }
                    });
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                }
                LocalSyncEvent::Prepare { reply, .. } => {
                    let _ = reply.send(Ok(()));
                }
                _ => {}
            })
        };
        let first = listen();
        let second = listen();
        pushed(&root);
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 2);
        drop(first);
        pushed(&root);
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 3);
        drop(second);
        pushed(&root);
        assert_eq!(count.load(std::sync::atomic::Ordering::SeqCst), 3);
    }
}
