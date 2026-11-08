use super::*;
use gpui_kit::base::TextView;
use gpui_kit::base::input::RopeExt;
use gpui_kit::component::input::DefinitionProvider;
use std::{
    ops::Range,
    path::{Path, PathBuf},
    sync::Arc,
};

pub(crate) struct EditorAppearance<'a> {
    pub prefs: &'a Preferences,
    pub vim: &'a vim::Vim,
    /// Image-only lines (source byte range, resolved local file) to preview.
    pub images: &'a [(Range<usize>, Arc<Path>)],
}

#[cfg(test)]
impl TypeApp {
    pub fn line_number_width(&self, editor: &Entity<EditorState>, cx: &App) -> Pixels {
        EditorAppearance {
            prefs: &self.prefs,
            vim: &self.vim,
            images: &[],
        }
        .line_number_width(editor, cx)
    }
}

impl EditorAppearance<'_> {
    pub fn block_cursor(&self) -> bool {
        self.prefs.vim && self.vim.mode != vim::Mode::Insert
    }

    pub fn render(
        &self,
        editor: &Entity<EditorState>,
        busy: bool,
        replaying_history: bool,
        cx: &App,
    ) -> impl IntoElement + use<> {
        div()
            .id("editor-pane")
            .test_support()
            // The engine's Cmd-hover path compares the pointer against the
            // scroll-shifted text bounds, so every link below the first
            // viewport never reaches it. Track the link under the pointer here.
            .on_mouse_move({
                let links = editor.clone();
                move |event, _, cx| {
                    let hovered = event
                        .modifiers
                        .secondary()
                        .then(|| link_at(&links, event.position, cx))
                        .flatten();
                    set_link_underline(&links, hovered, cx);
                }
            })
            .capture_any_mouse_down({
                let links = editor.clone();
                move |event, window, cx| {
                    if event.button != MouseButton::Left || !event.modifiers.secondary() {
                        return;
                    }
                    let Some(range) = link_at(&links, event.position, cx) else {
                        return;
                    };
                    let text = links.read(cx).value();
                    let Some(uri) = link_uri(&text[range]) else {
                        return;
                    };
                    cx.open_url(&uri.to_string());
                    window.prevent_default();
                    cx.stop_propagation();
                }
            })
            // The engine finds the link under the pointer only on pointer
            // movement. Replay the pointer when Cmd goes down on a still mouse.
            .on_modifiers_changed({
                let links = editor.clone();
                move |event, window, cx| {
                    if event.modifiers.secondary() {
                        let position = window.mouse_position();
                        let hovered = link_at(&links, position, cx);
                        set_link_underline(&links, hovered, cx);
                        window.dispatch_event(
                            PlatformInput::MouseMove(MouseMoveEvent {
                                position,
                                pressed_button: None,
                                modifiers: event.modifiers,
                            }),
                            cx,
                        );
                    } else {
                        set_link_underline(&links, None, cx);
                    }
                }
            })
            .on_hover({
                let links = editor.clone();
                move |hovered, _, cx| {
                    if !hovered {
                        set_link_underline(&links, None, cx);
                    }
                }
            })
            .relative()
            .size_full()
            .min_w_0()
            .min_h_0()
            .pl(if self.prefs.line_numbers {
                self.line_number_width(editor, cx)
            } else {
                px(12.)
            })
            .child(PaintLayer::new(
                div()
                    .relative()
                    .size_full()
                    .child(PaintLayer::new(
                        Editor::new(editor)
                            .bordered(false)
                            .appearance(false)
                            .readonly(busy || (self.block_cursor() && !replaying_history))
                            .h(relative(1.))
                            .text_size(px(self.prefs.font_size))
                            .font_family(cx.theme().font_family.clone()),
                    ))
                    .when(self.prefs.current_line_highlight, |pane| {
                        pane.child(self.render_current_line(editor.clone()))
                    })
                    .when(!self.images.is_empty(), |pane| {
                        pane.child(PaintLayer::new(self.render_images(editor.clone())))
                    })
                    .when(self.block_cursor(), |pane| {
                        pane.child(PaintLayer::new(self.render_cursor(editor.clone(), cx)))
                    }),
            ))
            .when(self.prefs.line_numbers, |pane| {
                pane.child(self.render_line_numbers(editor.clone(), cx))
            })
    }

    /// Paint each image line as a one-row thumbnail over its Markdown source.
    /// The line under the cursor, and images that are loading or unreadable,
    /// keep showing their source so the link stays editable.
    pub fn render_images(&self, editor: Entity<EditorState>) -> impl IntoElement + use<> {
        let visual_head = (self.prefs.vim
            && matches!(self.vim.mode, vim::Mode::Visual | vim::Mode::VisualLine))
        .then_some(self.vim.head);
        let images = self.images.to_vec();
        canvas(
            |_, _, _| (),
            move |_, _, window, cx| {
                let (input, cells) = {
                    let state = editor.read(cx);
                    let cursor_line = editor.focus_handle(cx).is_focused(window).then(|| {
                        let offset = visual_head.unwrap_or_else(|| state.cursor());
                        state.text().offset_to_position(offset).line as usize
                    });
                    let Some(rows) = state.visible_row_range() else {
                        return;
                    };
                    let cells = images
                        .iter()
                        .filter_map(|(range, path)| {
                            let line = state.text().offset_to_position(range.start).line as usize;
                            if !rows.contains(&line) || Some(line) == cursor_line {
                                return None;
                            }
                            let start = state.range_to_bounds(&(range.start..range.start))?;
                            let end = state.range_to_bounds(&(range.end..range.end))?;
                            Some((start, end, path.clone()))
                        })
                        .collect::<Vec<_>>();
                    (state.input_bounds(), cells)
                };
                let background = cx.theme().background;
                window.with_content_mask(Some(ContentMask { bounds: input }), |window| {
                    for (start, end, path) in cells {
                        let resource = Resource::Path(path);
                        let Some(Ok(image)) = window.use_asset::<ImgResourceLoader>(&resource, cx)
                        else {
                            continue;
                        };
                        let cover = Bounds::from_corners(
                            point(start.left(), start.top()),
                            point(input.right(), end.bottom().max(start.bottom())),
                        );
                        window.paint_quad(fill(cover, background));
                        let pixels = image.size(0);
                        let row = start.size.height;
                        let height = (row - px(4.)).max(px(1.));
                        let aspect = pixels.width.0 as f32 / pixels.height.0.max(1) as f32;
                        let width = (height * aspect).min(input.right() - start.left());
                        let bounds = Bounds::new(
                            point(start.left(), start.top() + (row - height) / 2.),
                            size(width, height),
                        );
                        let _ = window.paint_image(
                            bounds,
                            bounds,
                            Corners::all(px(3.)),
                            image,
                            0,
                            false,
                        );
                    }
                });
            },
        )
        .absolute()
        .inset_0()
        .size_full()
    }

    pub fn render_current_line(&self, editor: Entity<EditorState>) -> impl IntoElement + use<> {
        let visual_head = (self.prefs.vim
            && matches!(self.vim.mode, vim::Mode::Visual | vim::Mode::VisualLine))
        .then_some(self.vim.head);
        canvas(
            |_, _, _| (),
            move |viewport, _, window, cx| {
                let state = editor.read(cx);
                if !editor.focus_handle(cx).is_focused(window) {
                    return;
                }
                let offset = visual_head.unwrap_or_else(|| state.cursor());
                let row = state.text().offset_to_position(offset).line as usize;
                let cell = state
                    .visible_row_range()
                    .filter(|rows| rows.contains(&row))
                    .and_then(|_| state.range_to_bounds(&(offset..offset)));
                if let Some(cell) = cell.filter(|cell| {
                    cell.bottom() > state.input_bounds().top()
                        && cell.top() < state.input_bounds().bottom()
                }) {
                    let bounds = Bounds::new(
                        point(viewport.left(), cell.top()),
                        size(viewport.size.width, cell.size.height),
                    );
                    window.with_content_mask(
                        Some(ContentMask {
                            bounds: viewport.intersect(&state.input_bounds()),
                        }),
                        |window| {
                            window.paint_quad(fill(bounds, cx.theme().accent));
                        },
                    );
                }
            },
        )
        .absolute()
        .inset_0()
        .size_full()
    }

    pub fn line_number_width(&self, editor: &Entity<EditorState>, cx: &App) -> Pixels {
        if !self.prefs.line_numbers {
            return px(0.);
        }
        let digits = editor.read(cx).text().lines_len().max(10).ilog10() + 1;
        px((self.prefs.font_size * 0.72).clamp(10., 14.) * 0.65 * digits as f32 + 16.)
    }

    pub fn render_line_numbers(
        &self,
        editor: Entity<EditorState>,
        cx: &App,
    ) -> impl IntoElement + use<> {
        let font_size = (self.prefs.font_size * 0.72).clamp(10., 14.);
        let width = self.line_number_width(&editor, cx);
        canvas(
            |_, _, _| (),
            move |gutter, _, window, cx| {
                // Numbers belong to logical line starts, including empty lines.
                let labels = visible_line_numbers(&editor, cx);
                window.with_content_mask(Some(ContentMask { bounds: gutter }), |window| {
                    for (number, y, height) in labels {
                        let text: SharedString = number.to_string().into();
                        let run = TextRun {
                            len: text.len(),
                            font: Font {
                                family: cx.theme().mono_font_family.clone(),
                                ..Default::default()
                            },
                            color: cx.theme().muted_foreground.opacity(0.6),
                            background_color: None,
                            underline: None,
                            strikethrough: None,
                        };
                        let line =
                            window
                                .text_system()
                                .shape_line(text, px(font_size), &[run], None);
                        let _ = line.paint(
                            point(gutter.right() - px(6.) - line.width, y),
                            height,
                            TextAlign::Left,
                            None,
                            window,
                            cx,
                        );
                    }
                });
            },
        )
        .absolute()
        .left_0()
        .top_0()
        .h_full()
        .w(width)
    }
}

/// Read-only rendered Markdown (GFM tables, lists, code, quotes, images).
/// `note` is relative to `root`; attachment links resolve like editor
/// thumbnails and other image URIs load as-is.
/// Resolve image links the way attachments are stored next to a note.
pub(crate) fn attachment_images(
    root: PathBuf,
    note: String,
) -> impl Fn(&SharedUri) -> ImageSource + Send + Sync + 'static {
    move |uri| {
        type_core::resolve_note_attachment(&root, &note, uri.as_ref())
            .map(ImageSource::from)
            .unwrap_or_else(|| ImageSource::from(uri.clone()))
    }
}

/// The component theme's rich-text style, with wide tables scrolling sideways
/// instead of squeezing their columns to the pane width.
fn preview_style(cx: &App) -> gpui_kit::base::TextViewStyle {
    let theme = cx.theme();
    let mut table = StyleRefinement::default();
    table.overflow.x = Some(Overflow::Scroll);
    table.corner_radii.top_left = Some(theme.radius.into());
    table.corner_radii.top_right = Some(theme.radius.into());
    table.corner_radii.bottom_left = Some(theme.radius.into());
    table.corner_radii.bottom_right = Some(theme.radius.into());
    let mut code_block = StyleRefinement::default();
    code_block.corner_radii = table.corner_radii.clone();
    gpui_kit::base::TextViewStyle::default()
        .with_foreground(theme.foreground)
        .with_muted_foreground(theme.muted_foreground)
        .with_link(theme.link)
        .with_selection(theme.selection)
        .with_code_background(theme.muted)
        .with_border(theme.border)
        .with_code_block(code_block)
        .with_table(table)
        .with_table_head(
            StyleRefinement::default()
                .bg(theme.table_head)
                .text_color(theme.table_head_foreground),
        )
        .with_inline_code(HighlightStyle {
            background_color: Some(theme.accent),
            ..Default::default()
        })
        .with_dark(theme.is_dark())
}

pub(crate) fn markdown_preview<F, T>(
    text: SharedString,
    font_size: f32,
    id: &str,
    images: F,
    open_table: T,
    cx: &App,
) -> impl IntoElement + use<F, T>
where
    F: Fn(&SharedUri) -> ImageSource + Send + Sync + 'static,
    T: Fn(&gpui_kit::base::text::TableData, &mut Window, &mut App) + Send + Sync + 'static,
{
    let open_table = Arc::new(open_table);
    div()
        .id("note-preview")
        .test_support()
        .size_full()
        .min_w_0()
        .min_h_0()
        .text_size(px(font_size))
        .font_family(cx.theme().font_family.clone())
        .child(
            TextView::markdown(SharedString::from(format!("preview:{id}")), text)
                .scrollable(true)
                .selectable(true)
                .image_source(images)
                .style(preview_style(cx))
                .table_actions(move |data, _, _| {
                    let (data, open_table) = (data.clone(), open_table.clone());
                    Button::new("open-table")
                        .ghost()
                        .xsmall()
                        .icon(IconName::Maximize)
                        .label("Open as table")
                        .on_click(move |_, window, cx| open_table(&data, window, cx))
                })
                .size_full()
                .px_4()
                .pb_6(),
        )
}

// Query logical line starts, avoiding Kit's IME hit-testing path (which does
// not accumulate logical line heights). Hidden offsets resolve to the next
// visible line, so keep the last logical line for each distinct rendered row.
pub(crate) fn visible_line_numbers(
    editor: &Entity<EditorState>,
    cx: &App,
) -> Vec<(usize, Pixels, Pixels)> {
    let state = editor.read(cx);
    let Some(height) = state.line_height() else {
        return vec![];
    };
    let bounds = state.input_bounds();
    let mut labels: Vec<(usize, Pixels, Pixels)> = vec![];
    let Some(rows) = state.visible_row_range() else {
        return labels;
    };
    for row in rows {
        let start = state.text().line_start_offset(row);
        let Some(cell) = state.range_to_bounds(&(start..start)) else {
            break;
        };
        if cell.top() >= bounds.bottom() {
            break;
        }
        if cell.bottom() <= bounds.top() {
            continue;
        }
        let label = (row + 1, cell.top(), height);
        if let Some(last) = labels.last_mut().filter(|last| last.1 == cell.top()) {
            *last = label;
        } else {
            labels.push(label);
        }
    }
    labels
}

/// End of the logical line rendered at window `y`, clamped to the visible
/// rows; drops insert their images after that line.
pub(crate) fn line_end_at(editor: &Entity<EditorState>, y: Pixels, cx: &App) -> Option<usize> {
    let state = editor.read(cx);
    let rows = state.visible_row_range()?;
    let mut found = None;
    for row in rows {
        let start = state.text().line_start_offset(row);
        let Some(cell) = state.range_to_bounds(&(start..start)) else {
            break;
        };
        if cell.top() > y && found.is_some() {
            break;
        }
        found = Some(row);
    }
    Some(state.text().line_end_offset(found?))
}

/// Reserve a background layer before painting the editor. The editor's own
/// layer stays above it even when a later sibling paints the background using
/// geometry published by the editor in this same frame.
pub(crate) struct PaintLayer(AnyElement);

impl PaintLayer {
    pub fn new(child: impl IntoElement) -> Self {
        Self(child.into_any_element())
    }
}

impl IntoElement for PaintLayer {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

impl Element for PaintLayer {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        (self.0.request_layout(window, cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.0.prepaint(window, cx);
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        window.paint_layer(bounds, |window| self.0.paint(window, cx));
    }
}

/// Cmd+click on a `http(s)` link opens it in the browser. The editor engine
/// asks this provider while Cmd is held and underlines the hovered link.
struct LinkTargets;

impl DefinitionProvider for LinkTargets {
    fn definitions(
        &self,
        text: &gpui_kit::base::input::Rope,
        offset: usize,
        _window: &mut Window,
        _cx: &mut App,
    ) -> Task<anyhow::Result<Vec<lsp_types::LocationLink>>> {
        let source = text.to_string();
        let found = document::link_ranges(&source)
            .into_iter()
            .find(|range| range.contains(&offset));
        let links = found
            .and_then(|range| {
                let uri = link_uri(&source[range.clone()])?;
                let start = text.offset_to_position(range.start);
                let end = text.offset_to_position(range.end);
                let origin = lsp_types::Range { start, end };
                let target = lsp_types::Range {
                    start: lsp_types::Position::new(0, 0),
                    end: lsp_types::Position::new(0, 0),
                };
                Some(lsp_types::LocationLink {
                    origin_selection_range: Some(origin),
                    target_uri: uri,
                    target_range: target,
                    target_selection_range: target,
                })
            })
            .into_iter()
            .collect();
        Task::ready(Ok(links))
    }
}

/// The decoration that underlines the link under the Cmd-hovered pointer. The
/// engine cannot draw it: its hover-definition path rejects pointers outside
/// the scroll-shifted text bounds, so it never sees links below the viewport.
#[derive(Default)]
struct LinkUnderlines(std::cell::RefCell<HashMap<EntityId, LinkUnderline>>);

struct LinkUnderline {
    collection: TextDecorationCollection,
    hovered: Option<Range<usize>>,
}

impl Global for LinkUnderlines {}

fn link_underlines(cx: &mut App) -> &LinkUnderlines {
    if !cx.has_global::<LinkUnderlines>() {
        cx.set_global(LinkUnderlines::default());
    }
    cx.global::<LinkUnderlines>()
}

/// The link under `position`, if any.
fn link_at(
    editor: &Entity<EditorState>,
    position: Point<Pixels>,
    cx: &App,
) -> Option<Range<usize>> {
    let state = editor.read(cx);
    let rows = state.visible_row_range()?;
    let text = state.value();
    document::link_ranges(&text).into_iter().find(|range| {
        let line = state.text().offset_to_position(range.start).line as usize;
        rows.contains(&line) && link_contains(state, &text, range, position)
    })
}

/// A soft-wrapped link spans several rows; the first row ends at the pane edge
/// and the last one starts at it, so the bounding box of the whole range would
/// miss most of the link.
fn link_contains(
    state: &EditorState,
    text: &str,
    range: &Range<usize>,
    position: Point<Pixels>,
) -> bool {
    let mut last_char = range.end - 1;
    while last_char > range.start && !text.is_char_boundary(last_char) {
        last_char -= 1;
    }
    let (Some(first), Some(last)) = (
        state.range_to_bounds(&(range.start..range.start)),
        state.range_to_bounds(&(last_char..range.end)),
    ) else {
        return false;
    };
    if position.y < first.top() || position.y >= last.bottom() {
        return false;
    }
    if first.top() == last.top() {
        return position.x >= first.left() && position.x < last.right();
    }
    let line_height = f32::from(first.size.height);
    if line_height <= 0. {
        return false;
    }
    let row = ((f32::from(position.y) - f32::from(first.top())) / line_height).floor();
    let rows = ((f32::from(last.top()) - f32::from(first.top())) / line_height).round();
    if row <= 0. {
        position.x >= first.left()
    } else if row >= rows {
        position.x <= last.right()
    } else {
        true
    }
}

/// The ranges currently underlined by the Cmd-hover, for tests.
#[cfg(test)]
pub(crate) fn underline_ranges(editor: &Entity<EditorState>, cx: &App) -> Vec<Range<usize>> {
    if !cx.has_global::<LinkUnderlines>() {
        return Vec::new();
    }
    let map = cx.global::<LinkUnderlines>().0.borrow();
    map.get(&editor.entity_id())
        .map(|entry| entry.collection.get_ranges(cx))
        .unwrap_or_default()
}

fn set_link_underline(editor: &Entity<EditorState>, hovered: Option<Range<usize>>, cx: &mut App) {
    let id = editor.entity_id();
    let collection = {
        let mut map = link_underlines(cx).0.borrow_mut();
        let Some(entry) = map.get_mut(&id) else {
            return;
        };
        if entry.hovered == hovered {
            return;
        }
        entry.hovered = hovered.clone();
        entry.collection.clone()
    };
    let decorations = hovered
        .map(|range| {
            let mut style = HighlightStyle::color(cx.theme().link);
            style.underline = Some(UnderlineStyle {
                thickness: px(1.),
                ..UnderlineStyle::default()
            });
            vec![TextDecoration::new(range, style)]
        })
        .unwrap_or_default();
    collection.set(decorations, cx);
}

/// The link as a URI, with spaces-free non-ASCII text (Cyrillic paths) escaped.
fn link_uri(link: &str) -> Option<lsp_types::Uri> {
    let mut escaped = String::with_capacity(link.len());
    for byte in link.bytes() {
        if byte.is_ascii() && !byte.is_ascii_control() && !b"{}|^[]".contains(&byte) {
            escaped.push(byte as char);
        } else {
            escaped.push_str(&format!("%{byte:02X}"));
        }
    }
    escaped.parse().ok()
}

/// Make links in a text editor clickable and return the collection that colors
/// them. Call [`color_links`] after the text changes.
pub(crate) fn link_support(editor: &Entity<EditorState>, cx: &mut App) -> TextDecorationCollection {
    let (links, underline) = editor.update(cx, |state, cx| {
        state.lsp_mut().definition_provider = Some(std::rc::Rc::new(LinkTargets));
        (
            state.create_decorations_collection(vec![], cx),
            state.create_decorations_collection(vec![], cx),
        )
    });
    link_underlines(cx).0.borrow_mut().insert(
        editor.entity_id(),
        LinkUnderline {
            collection: underline,
            hovered: None,
        },
    );
    links
}

pub(crate) fn color_links(links: &TextDecorationCollection, text: &str, cx: &mut App) {
    let color = cx.theme().link;
    links.set(
        document::link_ranges(text)
            .into_iter()
            .map(|range| TextDecoration::new(range, HighlightStyle::color(color)))
            .collect(),
        cx,
    );
}
