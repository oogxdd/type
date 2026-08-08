//! A stub AssemblyAI server for the recording tests.
//!
//! The cloud path is the one transcription backend with no local fallback: on a
//! phone it is the *only* backend, so "did the key work, did the transcript come
//! back, did it land in the note" has to be answerable without a Mac, a device,
//! or a real API key. This speaks just enough HTTP/1.1 for `reqwest` to drive
//! the real `assembly.rs` code against it — upload, create transcript, poll —
//! so the tests exercise the shipping request shapes rather than a mock of them.

use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Default)]
struct StubState {
    requests: Vec<String>,
    uploaded: Vec<u8>,
    transcript_request_body: String,
    transcript_text: String,
    reject_keys: bool,
    transcription_error: Option<String>,
    /// Statuses handed out by successive polls; the last one repeats. Empty
    /// means "completed on the first poll".
    poll_statuses: VecDeque<String>,
}

pub struct StubAssemblyServer {
    port: u16,
    state: Arc<Mutex<StubState>>,
    shutdown: Arc<AtomicBool>,
}

impl StubAssemblyServer {
    pub const TRANSCRIPT_ID: &'static str = "stub-transcript-1";

    pub fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind stub server");
        let port = listener.local_addr().expect("stub server addr").port();
        let state = Arc::new(Mutex::new(StubState {
            transcript_text: "stub transcript".to_string(),
            ..StubState::default()
        }));
        let shutdown = Arc::new(AtomicBool::new(false));

        let thread_state = Arc::clone(&state);
        let thread_shutdown = Arc::clone(&shutdown);
        thread::spawn(move || {
            for stream in listener.incoming() {
                if thread_shutdown.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(mut stream) = stream else { continue };
                handle(&mut stream, &thread_state, port);
                let _ = stream.shutdown(Shutdown::Both);
            }
        });

        Self {
            port,
            state,
            shutdown,
        }
    }

    /// The value production code would get from `ASSEMBLY_API_BASE`.
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}/v2", self.port)
    }

    /// Answer every request with 401, as AssemblyAI does for a bad key.
    pub fn rejecting_keys(self) -> Self {
        self.state.lock().unwrap().reject_keys = true;
        self
    }

    pub fn with_transcript(self, text: &str) -> Self {
        self.state.lock().unwrap().transcript_text = text.to_string();
        self
    }

    /// Complete the job with AssemblyAI's `status: "error"` payload instead of
    /// a transcript — the API accepted the audio but could not transcribe it.
    pub fn failing_transcription(self, error: &str) -> Self {
        self.state.lock().unwrap().transcription_error = Some(error.to_string());
        self
    }

    /// Report these statuses on successive polls before completing, so a test
    /// can observe the note while the job is genuinely in flight.
    pub fn polling_through(self, statuses: &[&str]) -> Self {
        self.state.lock().unwrap().poll_statuses =
            statuses.iter().map(|s| (*s).to_string()).collect();
        self
    }

    /// `["POST /v2/upload", …]`, in the order the server saw them.
    pub fn requests(&self) -> Vec<String> {
        self.state.lock().unwrap().requests.clone()
    }

    pub fn uploaded_bytes(&self) -> Vec<u8> {
        self.state.lock().unwrap().uploaded.clone()
    }

    pub fn transcript_request_body(&self) -> String {
        self.state.lock().unwrap().transcript_request_body.clone()
    }
}

impl Drop for StubAssemblyServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // Unblock the accept() the listener thread is parked on.
        let _ = TcpStream::connect(("127.0.0.1", self.port));
    }
}

fn handle(stream: &mut TcpStream, state: &Arc<Mutex<StubState>>, port: u16) {
    let Some((head, body)) = read_request(stream) else {
        return;
    };
    let request_line = head.lines().next().unwrap_or_default().to_string();
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let target = parts.next().unwrap_or_default().to_string();

    let mut guard = state.lock().unwrap();
    guard.requests.push(format!("{method} {target}"));

    if guard.reject_keys {
        drop(guard);
        respond(
            stream,
            401,
            r#"{"error":"Authentication error, API token missing/invalid"}"#,
        );
        return;
    }

    let response = if method == "POST" && target.ends_with("/upload") {
        guard.uploaded = body;
        format!(r#"{{"upload_url":"http://127.0.0.1:{port}/v2/upload/blob-1"}}"#)
    } else if method == "POST" && target.ends_with("/transcript") {
        guard.transcript_request_body = String::from_utf8_lossy(&body).into_owned();
        format!(
            r#"{{"id":"{}","status":"queued","text":null,"error":null}}"#,
            StubAssemblyServer::TRANSCRIPT_ID
        )
    } else if method == "GET" && target.contains("/transcript?") {
        // The key check: list one transcript. Never returns audio work.
        r#"{"transcripts":[],"page_details":{"limit":1}}"#.to_string()
    } else if method == "GET" && target.contains("/transcript/") {
        if let Some(status) = guard.poll_statuses.pop_front() {
            format!(
                r#"{{"id":"{}","status":"{status}","text":null,"error":null}}"#,
                StubAssemblyServer::TRANSCRIPT_ID
            )
        } else if let Some(error) = guard.transcription_error.clone() {
            format!(
                r#"{{"id":"{}","status":"error","text":null,"error":{}}}"#,
                StubAssemblyServer::TRANSCRIPT_ID,
                json_string(&error)
            )
        } else {
            format!(
                r#"{{"id":"{}","status":"completed","text":{},"error":null}}"#,
                StubAssemblyServer::TRANSCRIPT_ID,
                json_string(&guard.transcript_text)
            )
        }
    } else {
        drop(guard);
        respond(stream, 404, r#"{"error":"not found"}"#);
        return;
    };

    drop(guard);
    respond(stream, 200, &response);
}

fn json_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

/// Returns the request head (status line + headers) and the body bytes.
fn read_request(stream: &mut TcpStream) -> Option<(String, Vec<u8>)> {
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end = loop {
        if let Some(index) = find(&buffer, b"\r\n\r\n") {
            break index;
        }
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let head = String::from_utf8_lossy(&buffer[..head_end]).into_owned();
    let content_length = head
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())?
        })
        .unwrap_or(0);

    let mut body = buffer[head_end + 4..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);
    Some((head, body))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn respond(stream: &mut TcpStream, status: u16, body: &str) {
    let reason = match status {
        200 => "OK",
        401 => "Unauthorized",
        _ => "Not Found",
    };
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}
