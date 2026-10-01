use super::*;
use gpui_kit::base::input::RopeExt;

impl TypeApp {
    pub fn render_current_line(&self, editor: Entity<EditorState>) -> impl IntoElement {
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
                if !state
                    .visible_row_range()
                    .is_some_and(|rows| rows.contains(&row))
                {
                    return;
                }
                if let Some(cell) = state.range_to_bounds(&(offset..offset)) {
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
        let digits = editor.read(cx).text().lines_len().max(1).ilog10() + 1;
        px((self.prefs.font_size * 0.72).clamp(10., 14.) * 0.65 * digits as f32 + 16.)
    }

    pub fn render_line_numbers(&self, editor: Entity<EditorState>, cx: &App) -> impl IntoElement {
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
