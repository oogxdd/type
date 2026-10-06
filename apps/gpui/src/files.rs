//! Ordinary folders are not notes profiles. No initialization, metadata,
//! auto-naming, Git, or empty-note cleanup belongs on this filesystem seam.
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

const MAX_TEXT_BYTES: u64 = 16 * 1024 * 1024;
static NEXT_SAVE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug)]
pub struct Folder {
    pub root: PathBuf,
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub path: PathBuf,
    pub name: String,
    pub directory: bool,
    pub symlink: bool,
}

#[derive(Debug)]
pub struct TextFile {
    pub text: String,
    original: Vec<u8>,
    encoding: Encoding,
    crlf: bool,
}

#[derive(Debug)]
enum Encoding {
    Utf8 { bom: bool },
    Utf16Le,
    Utf16Be,
}

impl Folder {
    pub fn open(path: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !root.is_dir() {
            return Err("Choose a folder.".into());
        }
        Ok(Self { root })
    }

    fn resolve(&self, relative: &Path) -> Result<PathBuf, String> {
        let mut path = self.root.clone();
        for component in relative.components() {
            let Component::Normal(name) = component else {
                return Err("The file must be inside the opened folder.".into());
            };
            path.push(name);
            if fs::symlink_metadata(&path)
                .map_err(|e| e.to_string())?
                .file_type()
                .is_symlink()
            {
                return Err("Symbolic links are not supported.".into());
            }
        }
        if !fs::canonicalize(&path)
            .map_err(|e| e.to_string())?
            .starts_with(&self.root)
        {
            return Err("The file is outside the opened folder.".into());
        }
        Ok(path)
    }

    /// Read only this directory; the UI loads descendants on expansion.
    pub fn entries(&self, relative: &Path) -> Result<Vec<Entry>, String> {
        let path = self.resolve(relative)?;
        let mut entries = fs::read_dir(path)
            .map_err(|e| e.to_string())?
            .map(|entry| {
                let entry = entry.map_err(|e| e.to_string())?;
                let kind = entry.file_type().map_err(|e| e.to_string())?;
                Ok(Entry {
                    path: relative.join(entry.file_name()),
                    name: entry.file_name().to_string_lossy().into_owned(),
                    directory: kind.is_dir(),
                    symlink: kind.is_symlink(),
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        entries.sort_by(|a, b| {
            b.directory
                .cmp(&a.directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.path.cmp(&b.path))
        });
        Ok(entries)
    }

    pub fn read(&self, relative: &Path) -> Result<TextFile, String> {
        let original = read_bytes(&self.resolve(relative)?)?;
        let (text, encoding) = if original.starts_with(&[0xff, 0xfe])
            || original.starts_with(&[0xfe, 0xff])
        {
            let little = original[0] == 0xff;
            if (original.len() - 2) % 2 != 0 {
                return Err("Encoding not supported. Invalid UTF-16 text.".into());
            }
            let units: Vec<_> = original[2..]
                .chunks_exact(2)
                .map(|bytes| {
                    if little {
                        u16::from_le_bytes([bytes[0], bytes[1]])
                    } else {
                        u16::from_be_bytes([bytes[0], bytes[1]])
                    }
                })
                .collect();
            let text = String::from_utf16(&units)
                .map_err(|_| "Encoding not supported. Invalid UTF-16 text.")?;
            (
                text,
                if little {
                    Encoding::Utf16Le
                } else {
                    Encoding::Utf16Be
                },
            )
        } else {
            let bom = original.starts_with(&[0xef, 0xbb, 0xbf]);
            let text = std::str::from_utf8(if bom { &original[3..] } else { &original })
                .map_err(|_| "Format or encoding not supported. Open a UTF-8 or UTF-16 text file.")?
                .to_owned();
            (text, Encoding::Utf8 { bom })
        };
        if text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t' | '\x0c' | '\x1b'))
        {
            return Err("Format not supported. This file contains binary data.".into());
        }
        let crlf = text.contains("\r\n") && !text.replace("\r\n", "").contains('\n');
        Ok(TextFile {
            text: text.replace("\r\n", "\n"),
            original,
            encoding,
            crlf,
        })
    }

    /// Keep the original file when another application changes it. A failed
    /// save never clears the editor's draft and never recreates a deleted file.
    pub fn save(&self, relative: &Path, file: &mut TextFile, text: &str) -> Result<(), String> {
        if text == file.text {
            return Ok(());
        }
        type_core::application::workspace::try_workspace_write(&self.root, || {
            self.save_unlocked(relative, file, text)
        })
    }
    fn save_unlocked(
        &self,
        relative: &Path,
        file: &mut TextFile,
        text: &str,
    ) -> Result<(), String> {
        if text == file.text {
            return Ok(());
        }
        let path = self.resolve(relative)?;
        let permissions = fs::metadata(&path)
            .map_err(|e| e.to_string())?
            .permissions();
        if permissions.readonly() {
            return Err("This file is read-only.".into());
        }
        let check = || -> Result<(), String> {
            if read_bytes(&self.resolve(relative)?)? != file.original {
                return Err(
                    "This file changed outside the editor. Copy your draft, then reload the file."
                        .into(),
                );
            }
            Ok(())
        };
        check()?;
        let body = if file.crlf {
            text.replace('\n', "\r\n")
        } else {
            text.to_owned()
        };
        let bytes = match file.encoding {
            Encoding::Utf8 { bom } => {
                let mut bytes = if bom { vec![0xef, 0xbb, 0xbf] } else { vec![] };
                bytes.extend(body.as_bytes());
                bytes
            }
            Encoding::Utf16Le | Encoding::Utf16Be => {
                let little = matches!(file.encoding, Encoding::Utf16Le);
                let mut bytes = if little {
                    vec![0xff, 0xfe]
                } else {
                    vec![0xfe, 0xff]
                };
                for unit in body.encode_utf16() {
                    bytes.extend(if little {
                        unit.to_le_bytes()
                    } else {
                        unit.to_be_bytes()
                    });
                }
                bytes
            }
        };
        if bytes.len() as u64 > MAX_TEXT_BYTES {
            return Err("This file is too large to save (limit: 16 MB).".into());
        }
        let tmp = path.parent().unwrap().join(format!(
            ".type-save-{}-{}-{}",
            std::process::id(),
            type_core::now_ms().unwrap_or(0),
            NEXT_SAVE.fetch_add(1, Ordering::Relaxed)
        ));
        let mut output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp)
            .map_err(|e| e.to_string())?;
        let result = (|| {
            output
                .set_permissions(permissions)
                .map_err(|e| e.to_string())?;
            output.write_all(&bytes).map_err(|e| e.to_string())?;
            output.sync_all().map_err(|e| e.to_string())?;
            check()?;
            fs::rename(&tmp, &path).map_err(|e| e.to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        result?;
        file.original = bytes;
        file.text = text.to_owned();
        Ok(())
    }
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    // Inspect before opening: opening a named pipe can wait indefinitely.
    if !fs::metadata(path).map_err(|e| e.to_string())?.is_file() {
        return Err("This entry is not a regular file.".into());
    }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("This entry is not a regular file.".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_TEXT_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_TEXT_BYTES {
        return Err("This file is too large to edit (limit: 16 MB).".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "type-folder-{}-{}",
                std::process::id(),
                NEXT_SAVE.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn folder(&self) -> Folder {
            Folder::open(&self.0).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn opening_and_listing_do_not_initialize_profiles_or_filter_files() {
        let f = Fixture::new();
        fs::create_dir(f.0.join("nested")).unwrap();
        fs::write(f.0.join("image.png"), [0, 1, 2]).unwrap();
        fs::write(f.0.join(".hidden.txt"), "hidden").unwrap();
        let entries = f.folder().entries(Path::new("")).unwrap();
        assert_eq!(entries.len(), 3);
        assert!(entries[0].directory);
        assert!(!f.0.join("_system").exists());
        assert!(!f.0.join(".type").exists());
        assert!(!f.0.join(".git").exists());
        assert!(
            f.folder()
                .read(Path::new("image.png"))
                .unwrap_err()
                .contains("Format")
        );
    }

    #[test]
    fn save_preserves_frontmatter_bom_crlf_unicode_and_empty_files() {
        let f = Fixture::new();
        let path = Path::new("note.MD");
        fs::write(
            f.0.join(path),
            "\u{feff}---\r\nid: original\r\n---\r\nПривет 😀\r\n",
        )
        .unwrap();
        let folder = f.folder();
        let mut file = folder.read(path).unwrap();
        folder
            .save(path, &mut file, "---\nid: original\n---\nНовый β😀\n")
            .unwrap();
        assert_eq!(
            fs::read_to_string(f.0.join(path)).unwrap(),
            "\u{feff}---\r\nid: original\r\n---\r\nНовый β😀\r\n"
        );
        folder.save(path, &mut file, "").unwrap();
        assert!(f.0.join(path).is_file());
        assert_eq!(fs::read(f.0.join(path)).unwrap(), [0xef, 0xbb, 0xbf]);
        assert_eq!(folder.entries(Path::new("")).unwrap().len(), 1);
    }

    #[test]
    fn conflicts_and_deleted_files_never_overwrite_or_recreate() {
        let f = Fixture::new();
        let path = Path::new("note.txt");
        fs::write(f.0.join(path), "original").unwrap();
        let folder = f.folder();
        let mut file = folder.read(path).unwrap();
        fs::write(f.0.join(path), "external").unwrap();
        assert!(
            folder
                .save(path, &mut file, "draft")
                .unwrap_err()
                .contains("changed outside")
        );
        assert_eq!(fs::read_to_string(f.0.join(path)).unwrap(), "external");
        assert_eq!(file.text, "original");
        fs::remove_file(f.0.join(path)).unwrap();
        assert!(folder.save(path, &mut file, "draft").is_err());
        assert!(!f.0.join(path).exists());
    }

    #[test]
    fn traversal_binary_and_non_utf8_are_rejected() {
        let f = Fixture::new();
        assert!(f.folder().read(Path::new("../outside.txt")).is_err());
        fs::write(f.0.join("binary.txt"), [0, 1, 2]).unwrap();
        fs::write(f.0.join("invalid.txt"), [255]).unwrap();
        assert!(f.folder().read(Path::new("binary.txt")).is_err());
        assert!(f.folder().read(Path::new("invalid.txt")).is_err());
    }

    #[test]
    fn text_detection_uses_content_instead_of_extensions() {
        let f = Fixture::new();
        for name in ["mcp.json", ".env", "config.toml", "README", "text.png"] {
            let path = Path::new(name);
            fs::write(f.0.join(path), "some text β😀\n").unwrap();
            let folder = f.folder();
            let mut file = folder.read(path).unwrap();
            folder.save(path, &mut file, "edited\n").unwrap();
            assert_eq!(fs::read_to_string(f.0.join(path)).unwrap(), "edited\n");
        }
        fs::write(f.0.join("binary.json"), [1, 2, 3]).unwrap();
        assert!(f.folder().read(Path::new("binary.json")).is_err());
    }

    #[test]
    fn utf16_configs_keep_their_encoding_and_line_endings() {
        let f = Fixture::new();
        for little in [true, false] {
            let encode = |text: &str| {
                let mut bytes = if little {
                    vec![0xff, 0xfe]
                } else {
                    vec![0xfe, 0xff]
                };
                for unit in text.encode_utf16() {
                    bytes.extend(if little {
                        unit.to_le_bytes()
                    } else {
                        unit.to_be_bytes()
                    });
                }
                bytes
            };
            let path = Path::new("config.ini");
            fs::write(f.0.join(path), encode("title=Привет 😀\r\n")).unwrap();
            let folder = f.folder();
            let mut file = folder.read(path).unwrap();
            assert_eq!(file.text, "title=Привет 😀\n");
            folder.save(path, &mut file, "title=Изменено β\n").unwrap();
            assert_eq!(
                fs::read(f.0.join(path)).unwrap(),
                encode("title=Изменено β\r\n")
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn symlink_files_and_directories_are_not_followed() {
        let f = Fixture::new();
        std::os::unix::fs::symlink(&f.0, f.0.join("cycle")).unwrap();
        fs::write(f.0.join("note.txt"), "original").unwrap();
        std::os::unix::fs::symlink(f.0.join("note.txt"), f.0.join("link.txt")).unwrap();
        assert!(f.folder().entries(Path::new("cycle")).is_err());
        assert!(f.folder().read(Path::new("link.txt")).is_err());
        let folder = f.folder();
        let mut file = folder.read(Path::new("note.txt")).unwrap();
        fs::remove_file(f.0.join("note.txt")).unwrap();
        std::os::unix::fs::symlink("link.txt", f.0.join("note.txt")).unwrap();
        assert!(
            folder
                .save(Path::new("note.txt"), &mut file, "draft")
                .is_err()
        );
    }
}
