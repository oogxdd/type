//! Bridge Git's push-to-checkout hook into a short in-process transaction.
//! The child transfers packs freely. Only checkout + the following ref update
//! hold the worktree lock. Existing hooks are forwarded from a per-child directory;
//! no persisted hook or core.hooksPath configuration is replaced.
use crate::application::workspace::with_workspace_write;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};

pub(super) struct CheckoutBridge {
    pub hooks: PathBuf,
    finished: Arc<(Mutex<bool>, Condvar)>,
}
impl Drop for CheckoutBridge {
    fn drop(&mut self) {
        let (lock, ready) = &*self.finished;
        *lock.lock().unwrap() = true;
        ready.notify_all();
    }
}
impl CheckoutBridge {
    pub fn start(root: &Path, git: &Path, cycle: u64) -> Result<Self, String> {
        let repo = git2::Repository::open(root).map_err(|e| e.to_string())?;
        let source = repo
            .config()
            .ok()
            .and_then(|config| config.get_path("core.hooksPath").ok())
            .map(|path| {
                if path.is_absolute() {
                    path
                } else {
                    root.join(path)
                }
            })
            .unwrap_or_else(|| repo.path().join("hooks"));
        let hooks = repo.path().join(format!(
            "type-sync-hooks-{}",
            super::devices::generate_pairing_token()
        ));
        fs::create_dir(&hooks).map_err(|e| e.to_string())?;
        // Preserve custom pre-receive/update/post-receive hooks. A custom
        // push-to-checkout is called by the bridge inside the transaction.
        let setup = (|| {
            if source.is_dir() {
                for entry in fs::read_dir(&source).map_err(|e| e.to_string())? {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entry.file_name() != "push-to-checkout"
                        && entry.file_name() != "post-receive"
                        && entry.path().is_file()
                    {
                        let path = entry.path();
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            if fs::metadata(&path)
                                .map_err(|e| e.to_string())?
                                .permissions()
                                .mode()
                                & 0o111
                                == 0
                            {
                                continue;
                            }
                        }
                        let quoted = shell_quote(&path);
                        let wrapper = hooks.join(entry.file_name());
                        fs::write(&wrapper, format!("#!/bin/sh\nexec {quoted} \"$@\"\n"))
                            .map_err(|e| e.to_string())?;
                        #[cfg(unix)]
                        {
                            use std::os::unix::fs::PermissionsExt;
                            fs::set_permissions(wrapper, fs::Permissions::from_mode(0o700))
                                .map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
            let original_post = source.join("post-receive");
            let post = if executable(&original_post) {
                format!("exec {} \"$@\"\n", shell_quote(&original_post))
            } else {
                "while IFS= read -r update; do :; done\n".into()
            };
            // Post-receive runs after the ref transaction. Release the write
            // lease before custom post hooks or Git auto-maintenance run.
            fs::write(
                hooks.join("post-receive"),
                format!(
                    "#!/bin/sh\n: > {}\n{post}",
                    shell_quote(&hooks.join("apply-finished"))
                ),
            )
            .map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(
                    hooks.join("post-receive"),
                    fs::Permissions::from_mode(0o700),
                )
                .map_err(|e| e.to_string())?;
            }
            let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
            listener.set_nonblocking(true).map_err(|e| e.to_string())?;
            let port = listener.local_addr().map_err(|e| e.to_string())?.port();
            let nonce = super::devices::generate_pairing_token();
            let script = format!("#!/bin/bash\nexec 3<>/dev/tcp/127.0.0.1/{port} || exit 1\nprintf '%s\\n%s\\n' '{nonce}' \"$1\" >&3\nIFS= read -r reply <&3 || exit 1\nif [[ \"$reply\" != ok ]]; then printf '%s\\n' \"$reply\" >&2; exit 1; fi\n");
            fs::write(hooks.join("push-to-checkout"), script).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(
                    hooks.join("push-to-checkout"),
                    fs::Permissions::from_mode(0o700),
                )
                .map_err(|e| e.to_string())?;
            }
            Ok::<_, String>((listener, nonce))
        })();
        let (listener, nonce) = match setup {
            Ok(value) => value,
            Err(error) => {
                let _ = fs::remove_dir_all(&hooks);
                return Err(error);
            }
        };
        let finished = Arc::new((Mutex::new(false), Condvar::new()));
        let done = finished.clone();
        let root = root.to_path_buf();
        let git = git.to_path_buf();
        let cleanup = hooks.clone();
        std::thread::spawn(move || {
            while !*done.0.lock().unwrap() {
                let (mut stream, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(10));
                        continue;
                    }
                    Err(_) => break,
                };
                let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
                let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
                let mut reader = BufReader::new(&stream);
                let mut key = String::new();
                let mut oid = String::new();
                use std::io::Read;
                // Bounded control message, never note content or a client path.
                let valid = reader.by_ref().take(128).read_line(&mut key).is_ok()
                    && key.trim() == nonce
                    && reader.by_ref().take(128).read_line(&mut oid).is_ok()
                    && git2::Oid::from_str(oid.trim()).is_ok();
                drop(reader);
                if !valid {
                    continue;
                }
                let started = std::time::Instant::now();
                let _ = with_workspace_write(&root, || {
                    let result =
                        checkout(&root, &git, oid.trim(), &source.join("push-to-checkout"));
                    let reply = if result.is_ok() {
                        "ok\n"
                    } else {
                        "Desktop files changed while syncing. Pull and retry; local edits are preserved.\n"
                    };
                    let _ = stream.write_all(reply.as_bytes());
                    if result.is_ok() {
                        // Git changes the branch ref after its hook returns.
                        // Keep that tiny tail in the same transaction.
                        let (lock, ready) = &*done;
                        let mut ended = lock.lock().unwrap();
                        while !*ended && !cleanup.join("apply-finished").exists() {
                            ended = ready
                                .wait_timeout(ended, Duration::from_millis(10))
                                .unwrap()
                                .0;
                        }
                    }
                    result
                });
                eprintln!(
                    "[local-sync] cycle={cycle} incoming apply transaction elapsed_ms={}",
                    started.elapsed().as_millis()
                );
                break;
            }
            // Retain forwarded post-update hooks until the Git child finishes.
            let (lock, ready) = &*done;
            let mut ended = lock.lock().unwrap();
            while !*ended {
                ended = ready.wait(ended).unwrap();
            }
            drop(ended);
            let _ = fs::remove_dir_all(cleanup);
        });
        Ok(Self { hooks, finished })
    }
}
fn checkout(root: &Path, git: &Path, oid: &str, custom: &Path) -> Result<(), String> {
    let run = |args: &[&str]| -> Result<(), String> {
        let status = Command::new(git)
            .args(args)
            .current_dir(root)
            .env_remove("GIT_DIR")
            .env_remove("GIT_WORK_TREE")
            .env_remove("GIT_INDEX_FILE")
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("Worktree checkout rejected.".into())
        }
    };
    run(&["update-index", "-q", "--refresh"])?;
    run(&["diff-files", "--quiet", "--"])?;
    run(&["diff-index", "--quiet", "--cached", "HEAD", "--"])?;
    if executable(custom) {
        let status = Command::new(custom)
            .arg(oid)
            .current_dir(root)
            .env(
                "GIT_DIR",
                git2::Repository::open(root)
                    .map_err(|e| e.to_string())?
                    .path(),
            )
            .env("GIT_WORK_TREE", root)
            .status()
            .map_err(|e| e.to_string())?;
        if status.success() {
            return Ok(());
        }
        return Err("Custom checkout hook rejected the push.".into());
    }
    run(&["read-tree", "-u", "-m", "HEAD", oid])
}

fn executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path)
            .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}
pub(super) fn shell_quote(path: &Path) -> String {
    format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"))
}
