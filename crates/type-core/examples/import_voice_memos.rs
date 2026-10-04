//! Import a Finder-exported Voice Memos folder into the active Type profile.
//!
//! This intentionally lives beside the Rust core so the utility uses the same
//! recording-note writer as the desktop app. See docs/VOICE_MEMOS_IMPORT.md.

use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    env,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process, thread,
    time::Duration,
};
use type_core::{
    ensured_notes_root, load_app_config, AppEnv, ImportAudioFilesArgs, NoteFileNameFormat,
    RecordingsAdapter, RECORDINGS_STORAGE_FOLDER,
};

struct CliArgs {
    source: PathBuf,
    app_data_dir: PathBuf,
    dry_run: bool,
}

#[derive(Default)]
struct ScanResult {
    import_paths: Vec<String>,
    already_imported: Vec<PathBuf>,
    empty: Vec<PathBuf>,
    duplicate_sources: Vec<PathBuf>,
}

fn usage() -> &'static str {
    "Usage:\n  npm run voice-memos:import -- --source <export-folder> [--app-data-dir <dir>] [--dry-run]"
}

fn default_app_data_dir() -> Result<PathBuf, String> {
    let home = env::var_os("HOME").ok_or_else(|| {
        "Cannot determine the home directory; pass --app-data-dir explicitly.".to_string()
    })?;
    Ok(PathBuf::from(home)
        .join("Library")
        .join("Application Support")
        .join("com.digital.type2"))
}

fn parse_args() -> Result<CliArgs, String> {
    let mut source = None;
    let mut app_data_dir = None;
    let mut dry_run = false;
    let mut args = env::args().skip(1);

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--source" => {
                source =
                    Some(PathBuf::from(args.next().ok_or_else(|| {
                        "--source requires a folder path.".to_string()
                    })?));
            }
            "--app-data-dir" => {
                app_data_dir =
                    Some(PathBuf::from(args.next().ok_or_else(|| {
                        "--app-data-dir requires a folder path.".to_string()
                    })?));
            }
            "--dry-run" => dry_run = true,
            "--help" | "-h" => return Err(usage().to_string()),
            _ => return Err(format!("Unknown argument: {arg}\n\n{}", usage())),
        }
    }

    let source = source.ok_or_else(|| format!("Missing --source.\n\n{}", usage()))?;
    if !source.is_dir() {
        return Err(format!(
            "Source folder does not exist: {}",
            source.display()
        ));
    }

    Ok(CliArgs {
        source,
        app_data_dir: app_data_dir.unwrap_or(default_app_data_dir()?),
        dry_run,
    })
}

fn is_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("m4a" | "mp3" | "wav" | "ogg" | "flac" | "aac" | "webm" | "mp4")
    )
}

fn sha256(path: &Path) -> Result<[u8; 32], String> {
    let mut file =
        File::open(path).map_err(|error| format!("Cannot open {}: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Cannot read {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest.finalize().into())
}

fn existing_audio_hashes(notes_root: &Path) -> Result<HashSet<[u8; 32]>, String> {
    let storage = notes_root.join(RECORDINGS_STORAGE_FOLDER);
    let mut hashes = HashSet::new();
    if !storage.is_dir() {
        return Ok(hashes);
    }
    for entry in fs::read_dir(&storage).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_file() && is_audio_file(&path) {
            hashes.insert(sha256(&path)?);
        }
    }
    Ok(hashes)
}

fn scan_source(source: &Path, existing: &HashSet<[u8; 32]>) -> Result<ScanResult, String> {
    let mut paths = fs::read_dir(source)
        .map_err(|error| error.to_string())?
        .map(|entry| {
            entry
                .map(|value| value.path())
                .map_err(|error| error.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    paths.sort();

    let mut result = ScanResult::default();
    let mut source_hashes = HashSet::new();
    for path in paths.into_iter().filter(|path| is_audio_file(path)) {
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("Cannot inspect {}: {error}", path.display()))?;
        if !metadata.is_file() || metadata.len() == 0 {
            result.empty.push(path);
            continue;
        }
        let hash = sha256(&path)?;
        if !source_hashes.insert(hash) {
            result.duplicate_sources.push(path);
        } else if existing.contains(&hash) {
            result.already_imported.push(path);
        } else {
            result
                .import_paths
                .push(path.to_string_lossy().into_owned());
        }
    }
    Ok(result)
}

fn file_name_format(app_data_dir: &Path) -> NoteFileNameFormat {
    match load_app_config(app_data_dir).note_file_name_format.as_str() {
        "uuid_v7" => NoteFileNameFormat::UuidV7,
        "uuid_v7_prefix_slug" => NoteFileNameFormat::UuidV7PrefixSlug,
        _ => NoteFileNameFormat::UtcTimestampSlug,
    }
}

fn print_paths(label: &str, paths: &[PathBuf]) {
    if paths.is_empty() {
        return;
    }
    println!("{label}:");
    for path in paths {
        println!("  - {}", path.display());
    }
}

fn run() -> Result<(), String> {
    let args = parse_args()?;
    let app = AppEnv::new(&args.app_data_dir);
    let notes_root = ensured_notes_root(&app)?;
    let existing = existing_audio_hashes(&notes_root)?;
    let scan = scan_source(&args.source, &existing)?;

    println!("Source: {}", args.source.display());
    println!("Active notes root: {}", notes_root.display());
    println!("Already in Type: {}", scan.already_imported.len());
    println!("New unique audio: {}", scan.import_paths.len());
    println!("Empty files: {}", scan.empty.len());
    println!(
        "Duplicate files in source: {}",
        scan.duplicate_sources.len()
    );
    print_paths("Empty files skipped", &scan.empty);
    print_paths("Duplicate source files skipped", &scan.duplicate_sources);

    if args.dry_run || scan.import_paths.is_empty() {
        if args.dry_run {
            println!("Dry run only; no files were imported.");
        } else {
            println!("Nothing new to import.");
        }
        return Ok(());
    }

    let adapter = RecordingsAdapter::new(app);
    adapter.import_audio_files(ImportAudioFilesArgs {
        source_paths: scan.import_paths,
        target_folder: None,
        file_name_format: file_name_format(&args.app_data_dir),
    })?;

    let mut last_processed = u32::MAX;
    loop {
        let status = adapter.audio_import_status();
        if status.processed != last_processed {
            println!(
                "Imported {}/{} (failed: {}){}",
                status.imported,
                status.total,
                status.failed,
                if status.current.is_empty() {
                    String::new()
                } else {
                    format!(" — {}", status.current)
                }
            );
            last_processed = status.processed;
        }
        if status.done {
            if let Some(error) = status.error {
                return Err(error);
            }
            for error in &status.errors {
                eprintln!("Import failure: {error}");
            }
            if status.failed > 0 {
                return Err(format!(
                    "Import finished with {} failed file(s).",
                    status.failed
                ));
            }
            println!("Import complete: {} recording(s).", status.imported);
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        process::exit(1);
    }
}
