//! Lightweight SSH control plane for already-paired phones.
//!
//! This listener deliberately cannot serve Git: it has no git binary, no
//! repository handle, and never spawns a child process. A paired phone's normal
//! Git fetch reaches the saved remote, authenticates with its existing key, and
//! receives the approval marker that makes mobile wait for the desktop.

use std::path::PathBuf;
use std::sync::Arc;

use russh::keys::PublicKey;
use russh::server::{Auth, ChannelOpenHandle, Config, Handler, Msg, Server, Session};
use russh::{Channel, ChannelId};

use super::devices;
use super::ssh_server::{
    parse_git_command, path_matches, SyncAccessDecision, SyncAccessState, APPROVAL_DECLINED_MARKER,
    APPROVAL_REQUIRED_MARKER,
};

pub(super) struct RequestServerShared {
    pub served_name: String,
    pub repo_path: PathBuf,
    pub devices_path: PathBuf,
    pub access: Arc<SyncAccessState>,
}

pub(super) struct RequestServerHandle {
    runtime: tokio::runtime::Runtime,
}

impl RequestServerHandle {
    pub(super) fn stop(self) {
        self.runtime
            .shutdown_timeout(std::time::Duration::from_secs(1));
    }
}

pub(super) fn start_request_server(
    shared: Arc<RequestServerShared>,
    host_key_openssh: &str,
    port: u16,
) -> Result<RequestServerHandle, String> {
    let host_key = russh::keys::PrivateKey::from_openssh(host_key_openssh)
        .map_err(|error| format!("Failed to load the sync request host key: {error}"))?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .map_err(|error| format!("Failed to start the sync request listener: {error}"))?;
    let listener = runtime
        .block_on(tokio::net::TcpListener::bind(("0.0.0.0", port)))
        .map_err(|error| {
            format!(
                "Port {port} is unavailable ({error}). Stop the other program using it and try again."
            )
        })?;
    let config = Arc::new(Config {
        keys: vec![host_key],
        auth_rejection_time: std::time::Duration::from_millis(300),
        inactivity_timeout: Some(std::time::Duration::from_secs(60)),
        ..Default::default()
    });
    let mut server = SyncRequestServer { shared };
    runtime.spawn(async move {
        let _ = server.run_on_socket(config, &listener).await;
    });
    Ok(RequestServerHandle { runtime })
}

struct SyncRequestServer {
    shared: Arc<RequestServerShared>,
}

impl Server for SyncRequestServer {
    type Handler = RequestHandler;

    fn new_client(&mut self, _peer: Option<std::net::SocketAddr>) -> RequestHandler {
        RequestHandler {
            shared: self.shared.clone(),
            authenticated_device: None,
        }
    }
}

struct RequestHandler {
    shared: Arc<RequestServerShared>,
    authenticated_device: Option<String>,
}

fn reject() -> Auth {
    Auth::Reject {
        proceed_with_methods: None,
        partial_success: false,
    }
}

impl Handler for RequestHandler {
    type Error = russh::Error;

    async fn auth_publickey(&mut self, _user: &str, key: &PublicKey) -> Result<Auth, Self::Error> {
        let Some(key_line) = devices::public_key_line(key) else {
            return Ok(reject());
        };
        let Some(device_name) = devices::device_name_for_key(&self.shared.devices_path, &key_line)
        else {
            eprintln!("[local-sync:request] rejected an unpaired device key");
            return Ok(reject());
        };
        self.authenticated_device = Some(device_name);
        Ok(Auth::Accept)
    }

    async fn channel_open_session(
        &mut self,
        _channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        reply.accept().await;
        Ok(())
    }

    async fn exec_request(
        &mut self,
        channel: ChannelId,
        data: &[u8],
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        let raw = String::from_utf8_lossy(data);
        let Some((_, requested_path)) = parse_git_command(&raw) else {
            session.channel_failure(channel)?;
            return Ok(());
        };
        if !path_matches(
            &requested_path,
            &self.shared.served_name,
            &self.shared.repo_path,
        ) {
            session.channel_success(channel)?;
            fail_channel(session, channel, "Repository not found on this computer.");
            return Ok(());
        }

        let device_name = self
            .authenticated_device
            .as_deref()
            .unwrap_or("Paired phone");
        match self.shared.access.request(device_name) {
            SyncAccessDecision::ApprovalRequired { notify_desktop } => {
                session.channel_success(channel)?;
                fail_channel(
                    session,
                    channel,
                    &format!("{APPROVAL_REQUIRED_MARKER}: Waiting for approval on the desktop."),
                );
                if notify_desktop {
                    if let Some(request) = self.shared.access.snapshot().pending_request {
                        super::notify_local_sync_request(request);
                    }
                }
            }
            SyncAccessDecision::Declined => {
                session.channel_success(channel)?;
                fail_channel(
                    session,
                    channel,
                    &format!("{APPROVAL_DECLINED_MARKER}: Sync was declined on the desktop."),
                );
            }
            // Request listeners are always created with a closed access state.
            // Treat an accidental open state as another approval request rather
            // than ever exposing Git from this process.
            SyncAccessDecision::Allowed => {
                self.shared.access.close_window();
                session.channel_success(channel)?;
                fail_channel(
                    session,
                    channel,
                    &format!("{APPROVAL_REQUIRED_MARKER}: Waiting for the Git server to start."),
                );
            }
        }
        Ok(())
    }
}

fn fail_channel(session: &mut Session, channel: ChannelId, message: &str) {
    let handle = session.handle();
    let message = format!("{message}\n");
    tokio::spawn(async move {
        let _ = handle.extended_data(channel, 1, message.into_bytes()).await;
        let _ = handle.exit_status_request(channel, 128).await;
        let _ = handle.eof(channel).await;
        let _ = handle.close(channel).await;
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;
    use ssh_key::{Algorithm, LineEnding, PrivateKey};
    use std::fs;
    use std::time::Duration;

    #[test]
    fn paired_git_client_can_request_without_a_git_repository() {
        let base = std::env::temp_dir().join(format!(
            "type-request-server-{}",
            devices::generate_pairing_token()
        ));
        let advertised_repo_path = base.join("notes-not-initialized");
        fs::create_dir_all(&advertised_repo_path).unwrap();

        let host_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        let host_key_text = host_key.to_openssh(LineEnding::LF).unwrap().to_string();
        let mut phone_key = PrivateKey::random(&mut OsRng, Algorithm::Ed25519).unwrap();
        phone_key.set_comment("request-test-phone");
        let phone_key_path = base.join("phone_key");
        fs::write(
            &phone_key_path,
            phone_key.to_openssh(LineEnding::LF).unwrap().as_bytes(),
        )
        .unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&phone_key_path, fs::Permissions::from_mode(0o600)).unwrap();
        }

        let devices_path = base.join("devices.json");
        let phone_key_line =
            devices::normalize_key_line(&phone_key.public_key().to_openssh().unwrap()).unwrap();
        devices::register_device(&devices_path, &phone_key_line, "request-test-phone").unwrap();
        let access = Arc::new(SyncAccessState::new(Duration::from_secs(60), false));
        let port = {
            let probe = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
            probe.local_addr().unwrap().port()
        };
        let server = start_request_server(
            Arc::new(RequestServerShared {
                served_name: "notes-not-initialized".to_string(),
                repo_path: advertised_repo_path,
                devices_path,
                access: access.clone(),
            }),
            &host_key_text,
            port,
        )
        .unwrap();

        let phone_repo_path = base.join("phone-repo");
        fs::create_dir_all(&phone_repo_path).unwrap();
        let phone_repo = crate::ensure_git_repo(&phone_repo_path).unwrap();
        crate::ensure_origin_remote(
            &phone_repo,
            &format!("ssh://127.0.0.1:{port}/notes-not-initialized"),
        )
        .unwrap();
        let error = match crate::perform_fetch(
            &phone_repo,
            "main",
            None,
            None,
            Some(phone_key_path),
            None,
            None,
        ) {
            Ok(_) => panic!("request daemon must never serve Git"),
            Err(error) => error,
        };
        assert!(
            error.contains(APPROVAL_REQUIRED_MARKER),
            "request marker should survive libgit2: {error}"
        );
        assert_eq!(
            access.snapshot().pending_request.unwrap().device_name,
            "request-test-phone"
        );

        server.stop();
        let rebound = std::net::TcpListener::bind(("127.0.0.1", port))
            .expect("request daemon must release the Git port synchronously");
        drop(rebound);
        let _ = fs::remove_dir_all(base);
    }
}
