use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::Manager;

const ORDER_FILE: &str = ".notes-order.json";
const UNSORTED_FOLDER: &str = "Unsorted";
const ARCHIEVE_FOLDER: &str = "Archieve";
const SYSTEM_FOLDERS: [&str; 2] = [UNSORTED_FOLDER, ARCHIEVE_FOLDER];
#[cfg(target_os = "macos")]
const MACOS_WINDOW_ALPHA: f64 = 1.0;

#[cfg(target_os = "macos")]
fn apply_macos_window_alpha(window: &tauri::WebviewWindow, alpha: f64) -> tauri::Result<()> {
    use objc::{class, msg_send, sel, sel_impl};
    use objc::runtime::Object;

    let ns_window = window.ns_window()? as *mut Object;
    unsafe {
        let _: () = msg_send![ns_window, setOpaque: false];
        let ns_color: *mut Object = msg_send![class!(NSColor), clearColor];
        let _: () = msg_send![ns_window, setBackgroundColor: ns_color];
        let _: () = msg_send![ns_window, setAlphaValue: alpha];
    }
    Ok(())
}

#[derive(Serialize)]
struct NoteEntry {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct NoteMeta {
    created_ms: Option<i64>,
    updated_ms: Option<i64>,
}

#[derive(Deserialize)]
struct SetOrderArgs {
    parent: String,
    #[serde(rename = "folderOrder")]
    folder_order: Vec<String>,
    #[serde(rename = "noteOrder")]
    note_order: Vec<String>,
}

#[derive(Serialize)]
struct FolderNode {
    name: String,
    path: String,
    children: Vec<FolderNode>,
    notes: Vec<NoteEntry>,
}

#[derive(Default, Deserialize, Serialize)]
struct OrderFile {
    #[serde(default)]
    folder_order: Vec<String>,
    #[serde(default)]
    note_order: Vec<String>,
}

fn notes_root(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("NOTES_ROOT") {
        let root = PathBuf::from(path);
        if root.exists() {
            return Ok(root);
        }
    }

    let cwd = std::env::current_dir().map_err(|err| err.to_string())?;
    let direct = cwd.join("notes");
    if direct.exists() {
        return Ok(direct);
    }
    let parent = cwd.join("..").join("notes");
    if parent.exists() {
        return Ok(parent);
    }

    Err("Notes root not found. Set NOTES_ROOT env var or place a ./notes folder.".to_string())
}

fn sanitize_relative(path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Ok(PathBuf::new());
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err("Absolute paths are not allowed.".to_string());
    }
    for component in candidate.components() {
        match component {
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Invalid path traversal.".to_string())
            }
            _ => {}
        }
    }
    Ok(candidate.to_path_buf())
}

fn resolve_path(app: &tauri::AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = notes_root(app)?;
    let rel_path = sanitize_relative(rel)?;
    Ok(root.join(rel_path))
}

fn read_order_file(dir: &Path) -> OrderFile {
    let file_path = dir.join(ORDER_FILE);
    if let Ok(contents) = fs::read_to_string(file_path) {
        if let Ok(order) = serde_json::from_str::<OrderFile>(&contents) {
            return order;
        }
    }
    OrderFile::default()
}

fn write_order_file(dir: &Path, order: &OrderFile) -> Result<(), String> {
    let file_path = dir.join(ORDER_FILE);
    let contents = serde_json::to_string_pretty(order).map_err(|err| err.to_string())?;
    fs::write(file_path, contents).map_err(|err| err.to_string())
}

fn sort_by_order(mut names: Vec<String>, order: &[String]) -> Vec<String> {
    let mut index = HashMap::new();
    for (idx, name) in order.iter().enumerate() {
        index.insert(name, idx);
    }
    names.sort_by(|a, b| {
        let a_idx = index.get(a).copied().unwrap_or(usize::MAX);
        let b_idx = index.get(b).copied().unwrap_or(usize::MAX);
        a_idx
            .cmp(&b_idx)
            .then_with(|| a.to_lowercase().cmp(&b.to_lowercase()))
    });
    names
}

fn strip_root(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn is_system_folder_name(name: &str) -> bool {
    SYSTEM_FOLDERS.iter().any(|folder| *folder == name)
}

fn is_system_folder_path(root: &Path, path: &Path) -> bool {
    if path.parent() != Some(root) {
        return false;
    }
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(is_system_folder_name)
}

fn ensure_system_folders(root: &Path) -> Result<(), String> {
    for folder in SYSTEM_FOLDERS {
        let path = root.join(folder);
        if path.exists() {
            continue;
        }
        fs::create_dir_all(&path).map_err(|err| {
            format!(
                "Failed to create system folder {}: {}",
                path.to_string_lossy(),
                err
            )
        })?;
    }

    let mut order = read_order_file(root);
    let mut changed = false;
    for folder in SYSTEM_FOLDERS {
        if !order.folder_order.iter().any(|name| name == folder) {
            order.folder_order.push(folder.to_string());
            changed = true;
        }
    }

    if changed {
        write_order_file(root, &order)?;
    }

    Ok(())
}

fn build_folder_node(dir: &Path, rel_path: &str) -> Result<FolderNode, String> {
    let order = read_order_file(dir);
    let mut folders = Vec::new();
    let mut notes = Vec::new();

    for entry in fs::read_dir(dir).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ORDER_FILE {
            continue;
        }
        let meta = entry.metadata().map_err(|err| err.to_string())?;
        if meta.is_dir() {
            folders.push(name);
        } else if meta.is_file() {
            if path.extension().and_then(|ext| ext.to_str()) == Some("md") {
                notes.push(name);
            }
        }
    }

    let folder_names = sort_by_order(folders, &order.folder_order);
    let note_names = sort_by_order(notes, &order.note_order);

    let mut children = Vec::new();
    for name in folder_names {
        let child_path = dir.join(&name);
        let child_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        children.push(build_folder_node(&child_path, &child_rel)?);
    }

    let mut note_entries = Vec::new();
    for name in note_names {
        let note_rel = if rel_path.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel_path, name)
        };
        note_entries.push(NoteEntry {
            name,
            path: note_rel,
        });
    }

    Ok(FolderNode {
        name: if rel_path.is_empty() {
            "Notes".to_string()
        } else {
            dir.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("Folder")
                .to_string()
        },
        path: rel_path.to_string(),
        children,
        notes: note_entries,
    })
}

fn update_order_remove(dir: &Path, names: &[String], is_folder: bool) -> Result<(), String> {
    let mut order = read_order_file(dir);
    if is_folder {
        order.folder_order.retain(|name| !names.contains(name));
    } else {
        order.note_order.retain(|name| !names.contains(name));
    }
    write_order_file(dir, &order)
}

fn update_order_append(dir: &Path, names: &[String], is_folder: bool) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    for name in names {
        if !list.contains(name) {
            list.push(name.clone());
        }
    }
    write_order_file(dir, &order)
}

fn update_order_rename(
    dir: &Path,
    old_name: &str,
    new_name: &str,
    is_folder: bool,
) -> Result<(), String> {
    let mut order = read_order_file(dir);
    let list = if is_folder {
        &mut order.folder_order
    } else {
        &mut order.note_order
    };
    if let Some(pos) = list.iter().position(|item| item == old_name) {
        list[pos] = new_name.to_string();
    }
    write_order_file(dir, &order)
}

#[tauri::command]
fn get_tree(app: tauri::AppHandle) -> Result<FolderNode, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    build_folder_node(&root, "")
}

#[tauri::command]
fn read_note(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let full_path = resolve_path(&app, &path)?;
    fs::read_to_string(full_path).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_note(app: tauri::AppHandle, path: String, content: String) -> Result<(), String> {
    let full_path = resolve_path(&app, &path)?;
    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(full_path, content).map_err(|err| err.to_string())
}

fn time_to_ms(time: std::time::SystemTime) -> Option<i64> {
    let duration = time.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

#[tauri::command]
fn get_note_meta(app: tauri::AppHandle, path: String) -> Result<NoteMeta, String> {
    let full_path = resolve_path(&app, &path)?;
    let metadata = fs::metadata(full_path).map_err(|err| err.to_string())?;
    let created_ms = metadata.created().ok().and_then(time_to_ms);
    let updated_ms = metadata.modified().ok().and_then(time_to_ms);
    Ok(NoteMeta {
        created_ms,
        updated_ms,
    })
}

#[tauri::command]
fn move_items(
    app: tauri::AppHandle,
    items: Vec<String>,
    destination: String,
) -> Result<(), String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    println!(
        "[move_items] root={} destination={}",
        root.to_string_lossy(),
        destination
    );
    let destination_path = resolve_path(&app, &destination)?;
    println!(
        "[move_items] destination_path={}",
        destination_path.to_string_lossy()
    );
    if !destination_path.exists() {
        return Err(format!(
            "Destination folder does not exist: {}",
            destination_path.to_string_lossy()
        ));
    }

    let mut source_groups_folders: HashMap<PathBuf, Vec<String>> = HashMap::new();
    let mut source_groups_notes: HashMap<PathBuf, Vec<String>> = HashMap::new();
    let mut moved_folder_names = Vec::new();
    let mut moved_note_names = Vec::new();

    for item in items {
        let source = resolve_path(&app, &item)?;
        if is_system_folder_path(&root, &source) {
            return Err(format!(
                "Cannot move system folder: {}",
                source.to_string_lossy()
            ));
        }
        if !source.exists() {
            return Err(format!(
                "Source does not exist: {}",
                source.to_string_lossy()
            ));
        }
        let meta = fs::metadata(&source).map_err(|err| {
            format!(
                "Failed to read metadata for {}: {}",
                source.to_string_lossy(),
                err
            )
        })?;
        let name = source
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Invalid item name.".to_string())?
            .to_string();
        let parent = source
            .parent()
            .ok_or_else(|| "Missing parent folder.".to_string())?
            .to_path_buf();

        let target = destination_path.join(&name);
        println!(
            "[move_items] move {} -> {}",
            source.to_string_lossy(),
            target.to_string_lossy()
        );
        fs::rename(&source, &target).map_err(|err| {
            format!(
                "Move failed {} -> {}: {}",
                source.to_string_lossy(),
                target.to_string_lossy(),
                err
            )
        })?;
        if meta.is_dir() {
            source_groups_folders
                .entry(parent)
                .or_default()
                .push(name.clone());
            moved_folder_names.push(name);
        } else {
            source_groups_notes
                .entry(parent)
                .or_default()
                .push(name.clone());
            moved_note_names.push(name);
        }
    }

    for (parent, names) in source_groups_folders {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, true)?;
    }

    for (parent, names) in source_groups_notes {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, false)?;
    }

    let dest_rel = strip_root(&root, &destination_path);
    let dest_full = resolve_path(&app, &dest_rel)?;
    println!(
        "[move_items] update order dest={} folders={} notes={}",
        dest_full.to_string_lossy(),
        moved_folder_names.len(),
        moved_note_names.len()
    );
    if !moved_folder_names.is_empty() {
        update_order_append(&dest_full, &moved_folder_names, true)?;
    }
    if !moved_note_names.is_empty() {
        update_order_append(&dest_full, &moved_note_names, false)?;
    }

    Ok(())
}

#[tauri::command]
fn delete_items(app: tauri::AppHandle, items: Vec<String>) -> Result<(), String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let mut parent_folder_groups: HashMap<PathBuf, Vec<String>> = HashMap::new();
    let mut parent_note_groups: HashMap<PathBuf, Vec<String>> = HashMap::new();

    for item in items {
        let full_path = resolve_path(&app, &item)?;
        if is_system_folder_path(&root, &full_path) {
            return Err(format!(
                "Cannot delete system folder: {}",
                full_path.to_string_lossy()
            ));
        }
        let name = full_path
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| "Invalid item name.".to_string())?
            .to_string();
        let parent = full_path
            .parent()
            .ok_or_else(|| "Missing parent folder.".to_string())?
            .to_path_buf();
        let meta = fs::metadata(&full_path).map_err(|err| err.to_string())?;
        if meta.is_dir() {
            fs::remove_dir_all(&full_path).map_err(|err| err.to_string())?;
            parent_folder_groups.entry(parent).or_default().push(name);
        } else {
            fs::remove_file(&full_path).map_err(|err| err.to_string())?;
            parent_note_groups.entry(parent).or_default().push(name);
        }
    }

    for (parent, names) in parent_folder_groups {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, true)?;
    }

    for (parent, names) in parent_note_groups {
        let rel = strip_root(&root, &parent);
        let parent_path = resolve_path(&app, &rel)?;
        update_order_remove(&parent_path, &names, false)?;
    }

    Ok(())
}

#[tauri::command]
fn rename_item(app: tauri::AppHandle, path: String, new_name: String) -> Result<String, String> {
    let root = notes_root(&app)?;
    ensure_system_folders(&root)?;
    let full_path = resolve_path(&app, &path)?;
    if is_system_folder_path(&root, &full_path) {
        return Err(format!(
            "Cannot rename system folder: {}",
            full_path.to_string_lossy()
        ));
    }
    println!(
        "[rename_item] path={} new_name={}",
        full_path.to_string_lossy(),
        new_name
    );
    let parent = full_path
        .parent()
        .ok_or_else(|| "Missing parent folder.".to_string())?;
    let new_path = parent.join(&new_name);
    fs::rename(&full_path, &new_path).map_err(|err| err.to_string())?;
    let is_folder = new_path.is_dir();
    update_order_rename(
        parent,
        full_path.file_name().unwrap().to_str().unwrap(),
        &new_name,
        is_folder,
    )?;

    Ok(strip_root(&root, &new_path))
}

#[tauri::command]
fn set_order(app: tauri::AppHandle, args: SetOrderArgs) -> Result<(), String> {
    let parent_path = resolve_path(&app, &args.parent)?;
    println!(
        "[set_order] parent={} folder_order={} note_order={} parent_path={}",
        args.parent,
        args.folder_order.len(),
        args.note_order.len(),
        parent_path.to_string_lossy()
    );
    let order = OrderFile {
        folder_order: args.folder_order,
        note_order: args.note_order,
    };
    write_order_file(&parent_path, &order)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = apply_macos_window_alpha(&window, MACOS_WINDOW_ALPHA);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_tree,
            read_note,
            get_note_meta,
            write_note,
            move_items,
            delete_items,
            rename_item,
            set_order
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
