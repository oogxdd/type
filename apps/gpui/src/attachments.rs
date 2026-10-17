//! Images dropped or pasted into a profile note. Bytes are copied into
//! `_system/_attachments` and referenced by a Markdown image on its own line.
use super::*;
use std::path::Path;

/// Image bytes ready for storage, with a core-supported extension.
type Attachment = Result<(Vec<u8>, &'static str), String>;

/// Native formats are stored as-is; TIFF (macOS screenshots/Safari) and other
/// raster formats are re-encoded as PNG so every client can display them.
fn normalize(bytes: Vec<u8>, extension: &str) -> Attachment {
    if let Some(extension) = type_core::normalize_image_extension(extension) {
        return Ok((bytes, extension));
    }
    let decoded = image::load_from_memory(&bytes)
        .map_err(|_| format!("Unsupported image type: {extension}."))?;
    let mut png = std::io::Cursor::new(Vec::new());
    decoded
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok((png.into_inner(), "png"))
}

fn from_path(path: &Path) -> Option<Attachment> {
    let extension = path.extension()?.to_str()?.to_lowercase();
    if !matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "gif" | "tif" | "tiff" | "bmp"
    ) {
        return None;
    }
    Some(
        std::fs::read(path)
            .map_err(|error| format!("{}: {error}", path.display()))
            .and_then(|bytes| normalize(bytes, &extension)),
    )
}

/// Images in a clipboard item: raw image data or copied image files.
/// `None` means the item holds no image, so native text paste proceeds.
fn from_clipboard(item: &ClipboardItem) -> Option<Vec<Attachment>> {
    let mut images = Vec::new();
    for entry in item.entries() {
        match entry {
            ClipboardEntry::Image(image) if image.format() != ImageFormat::Svg => images.push(
                normalize(image.bytes().to_vec(), image.format().extension()),
            ),
            ClipboardEntry::ExternalPaths(paths) => {
                images.extend(paths.paths().iter().filter_map(|path| from_path(path)))
            }
            _ => {}
        }
    }
    (!images.is_empty()).then_some(images)
}

impl TypeApp {
    fn can_attach(&self) -> bool {
        !self.locked && !self.busy && !self.settings && self.active_folder.is_none()
    }

    /// Cmd/Ctrl+V with an image on the clipboard. Returns whether it was handled.
    pub(crate) fn paste_images(
        &mut self,
        event: &KeyDownEvent,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let stroke = &event.keystroke;
        let m = stroke.modifiers;
        let primary = if cfg!(target_os = "macos") {
            m.platform && !m.control
        } else {
            m.control && !m.platform
        };
        if stroke.key != "v" || !primary || m.alt || m.shift || !self.can_attach() {
            return false;
        }
        let Some(editor) = self.notes.get(&self.active).and_then(|n| n.editor.clone()) else {
            return false;
        };
        if !editor.focus_handle(cx).is_focused(window) {
            return false;
        }
        let Some(images) = cx.read_from_clipboard().as_ref().and_then(from_clipboard) else {
            return false;
        };
        window.prevent_default();
        cx.stop_propagation();
        let offset = editor.read(cx).cursor();
        self.attach_images(images, offset, window, cx);
        true
    }

    /// Files dropped on the editor pane; images land after the line under
    /// the pointer.
    pub(crate) fn drop_images(
        &mut self,
        paths: &ExternalPaths,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if !self.can_attach() {
            return;
        }
        let Some(editor) = self.notes.get(&self.active).and_then(|n| n.editor.clone()) else {
            return;
        };
        let images: Vec<_> = paths
            .paths()
            .iter()
            .filter_map(|path| from_path(path))
            .collect();
        if images.is_empty() {
            self.error =
                Some("Only images (png, jpg, webp, gif, tiff, bmp) can be attached.".into());
            cx.notify();
            return;
        }
        let offset = editor::line_end_at(&editor, window.mouse_position().y, cx)
            .unwrap_or_else(|| editor.read(cx).cursor());
        self.attach_images(images, offset, window, cx);
    }

    fn attach_images(
        &mut self,
        images: Vec<Attachment>,
        offset: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some(editor) = self.notes.get(&self.active).and_then(|n| n.editor.clone()) else {
            return;
        };
        let mut targets = Vec::new();
        for image in images {
            match image
                .and_then(|(bytes, extension)| self.backend.save_attachment(&bytes, extension))
            {
                Ok(target) => targets.push(target),
                Err(error) => self.error = Some(error),
            }
        }
        if targets.is_empty() {
            cx.notify();
            return;
        }
        editor.update(cx, |state, cx| {
            state.set_readonly(false, cx);
            let text = state.value();
            let offset = offset.min(text.len());
            let (insert, caret) = document::image_insertion(&text, offset, &targets);
            state.set_selected_range(offset..offset, cx);
            state.replace(insert, window, cx);
            state.set_selected_range(offset + caret..offset + caret, cx);
            state.set_readonly(self.prefs.vim && self.vim.mode != vim::Mode::Insert, cx);
            state.focus(window, cx);
        });
        self.refresh_tags(cx);
    }
}
