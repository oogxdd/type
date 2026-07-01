//! Managed Python environment for local Whisper transcription.
//!
//! The app does **not** rely on a system `python3` plus a manually
//! `pip install`ed faster-whisper. Instead it provisions and owns an isolated
//! environment with [`uv`](https://docs.astral.sh/uv/): a pinned CPython and
//! faster-whisper, living under the app-data directory. `uv` itself is located
//! on `PATH` / common install locations, or downloaded on first use (Unix) via
//! the official installer. The end result: the user installs nothing.

use crate::AppEnv;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};

use crate::app_data_dir;

/// Python version pinned for the managed env. We deliberately avoid bleeding-edge
/// releases (e.g. 3.14) that often lack prebuilt wheels for faster-whisper's
/// compiled dependencies (ctranslate2, onnxruntime, av).
const MANAGED_PYTHON_VERSION: &str = "3.12";

/// URL of the official `uv` installer script (Unix).
const UV_INSTALL_SCRIPT_URL: &str = "https://astral.sh/uv/install.sh";

/// Serializes environment provisioning so concurrent callers (e.g. the Verify
/// button and the transcription worker) don't race on creating the venv or
/// installing packages.
static ENV_SETUP_LOCK: Mutex<()> = Mutex::new(());

// ── Paths ────────────────────────────────────────────────────────────────────

/// Root directory holding everything we manage for local transcription.
fn managed_root(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join("whisper"))
}

/// The virtualenv directory (`uv venv` target).
fn venv_dir(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(managed_root(app)?.join("env"))
}

/// Sentinel written once faster-whisper is installed, so readiness checks are
/// instant and don't require launching Python.
fn ready_marker(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(managed_root(app)?.join(".ready"))
}

/// Directory where we drop a self-downloaded `uv` binary when none is found.
fn managed_uv_dir(app: &AppEnv) -> Result<PathBuf, String> {
    Ok(managed_root(app)?.join("bin"))
}

/// Whether the managed env is already provisioned (interpreter present and
/// faster-whisper installed). Cheap — a couple of filesystem checks, no
/// subprocess and no network — so it is safe to call on UI mount / while polling.
pub fn whisper_env_ready(app: &AppEnv) -> bool {
    let Ok(python) = managed_python(app) else {
        return false;
    };
    let Ok(marker) = ready_marker(app) else {
        return false;
    };
    python.exists() && marker.exists()
}

/// Path to the Python interpreter inside the managed venv.
pub fn managed_python(app: &AppEnv) -> Result<PathBuf, String> {
    let dir = venv_dir(app)?;
    #[cfg(windows)]
    {
        Ok(dir.join("Scripts").join("python.exe"))
    }
    #[cfg(not(windows))]
    {
        Ok(dir.join("bin").join("python3"))
    }
}

fn uv_exe_name() -> &'static str {
    if cfg!(windows) {
        "uv.exe"
    } else {
        "uv"
    }
}

// ── uv resolution ────────────────────────────────────────────────────────────

/// Common locations where `uv` lands when installed outside `PATH`'s reach
/// (notably for GUI apps launched from Finder/Dock, which get a minimal `PATH`).
fn uv_candidate_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        paths.push(home.join(".local").join("bin").join(uv_exe_name()));
        paths.push(home.join(".cargo").join("bin").join(uv_exe_name()));
    }
    paths.push(PathBuf::from("/opt/homebrew/bin").join(uv_exe_name()));
    paths.push(PathBuf::from("/usr/local/bin").join(uv_exe_name()));
    paths
}

/// Returns true if the given uv binary actually runs.
fn uv_works(uv: &Path) -> bool {
    Command::new(uv)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Locate a usable `uv`, downloading one if necessary.
fn ensure_uv(app: &AppEnv) -> Result<PathBuf, String> {
    // Prefer our own managed copy for determinism.
    let managed = managed_uv_dir(app)?.join(uv_exe_name());
    if managed.exists() && uv_works(&managed) {
        return Ok(managed);
    }

    // `uv` on PATH.
    if uv_works(Path::new("uv")) {
        return Ok(PathBuf::from("uv"));
    }

    // Well-known install locations.
    for candidate in uv_candidate_paths() {
        if candidate.exists() && uv_works(&candidate) {
            return Ok(candidate);
        }
    }

    // Last resort: download it.
    download_uv(app)
}

/// Download `uv` via the official installer into our managed bin dir (Unix only).
fn download_uv(app: &AppEnv) -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let _ = app;
        return Err(
            "uv was not found. Please install it from https://docs.astral.sh/uv/ and retry."
                .to_string(),
        );
    }

    #[cfg(not(windows))]
    {
        let bin_dir = managed_uv_dir(app)?;
        fs::create_dir_all(&bin_dir).map_err(|e| e.to_string())?;

        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(60))
            .build()
            .map_err(|e| e.to_string())?;
        let script = client
            .get(UV_INSTALL_SCRIPT_URL)
            .send()
            .map_err(|e| format!("Failed to fetch uv installer: {e}"))?
            .error_for_status()
            .map_err(|e| format!("uv installer download failed: {e}"))?
            .text()
            .map_err(|e| format!("Failed to read uv installer: {e}"))?;

        let script_path = managed_root(app)?.join("install-uv.sh");
        fs::write(&script_path, script).map_err(|e| e.to_string())?;

        // `UV_INSTALL_DIR` controls where the binary lands; the no-modify-path
        // flags keep the installer from touching the user's shell profile.
        let output = Command::new("sh")
            .arg(&script_path)
            .env("UV_INSTALL_DIR", &bin_dir)
            .env("UV_NO_MODIFY_PATH", "1")
            .env("INSTALLER_NO_MODIFY_PATH", "1")
            .output()
            .map_err(|e| format!("Failed to run uv installer: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("uv installation failed: {}", stderr.trim()));
        }

        let uv = bin_dir.join(uv_exe_name());
        if !uv.exists() || !uv_works(&uv) {
            return Err("uv installer finished but uv is not usable.".to_string());
        }
        Ok(uv)
    }
}

// ── Environment provisioning ─────────────────────────────────────────────────

/// Run a command, mapping a non-zero exit into a readable error.
fn run(label: &str, cmd: &mut Command) -> Result<(), String> {
    let output = cmd
        .output()
        .map_err(|e| format!("{label} failed to start: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{label} failed: {}", stderr.trim()));
    }
    Ok(())
}

/// Ensure the managed env exists and has faster-whisper, provisioning it on
/// first use. Idempotent and cheap once ready (a single marker-file check).
/// Returns the path to the managed Python interpreter.
pub fn ensure_whisper_env(app: &AppEnv) -> Result<PathBuf, String> {
    let _guard = ENV_SETUP_LOCK
        .lock()
        .map_err(|_| "whisper env setup lock poisoned".to_string())?;

    let python = managed_python(app)?;
    let marker = ready_marker(app)?;
    if python.exists() && marker.exists() {
        return Ok(python);
    }

    let uv = ensure_uv(app)?;

    // Create the venv on a pinned Python; uv downloads CPython if absent.
    if !python.exists() {
        let venv = venv_dir(app)?;
        if let Some(parent) = venv.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        run(
            "Creating Python environment",
            Command::new(&uv)
                .arg("venv")
                .arg("--python")
                .arg(MANAGED_PYTHON_VERSION)
                .arg(&venv),
        )?;
    }

    // Install faster-whisper into the venv.
    run(
        "Installing faster-whisper",
        Command::new(&uv)
            .arg("pip")
            .arg("install")
            .arg("--python")
            .arg(&python)
            .arg("faster-whisper"),
    )?;

    fs::write(&marker, MANAGED_PYTHON_VERSION).map_err(|e| e.to_string())?;
    Ok(python)
}
