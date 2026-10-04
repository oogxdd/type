use super::*;

impl editor::EditorAppearance<'_> {
    pub fn render_cursor(&self, editor: Entity<EditorState>, _: &App) -> impl IntoElement + use<> {
        let mode = self.vim.mode;
        let visual_head = self.vim.head;
        let font_size = self.prefs.font_size;
        let dark = self.prefs.dark;
        canvas(
            move |_, _, _| (),
            move |viewport, _, window, cx| {
                let state = editor.read(cx);
                if !editor.focus_handle(cx).is_focused(window) || !window.is_window_active() {
                    return;
                }
                // Visual selections include their last character; the engine's
                // selection endpoint is one character beyond the Vim cursor.
                let offset = if matches!(mode, vim::Mode::Visual | vim::Mode::VisualLine) {
                    visual_head
                } else {
                    state.cursor()
                };
                let value = state.value();
                let Some(text) = value.get(offset..) else {
                    return;
                };
                let Some(mut cell) = state.range_to_bounds(&(offset..offset)) else {
                    return;
                };
                let line_height = cell.size.height;
                let width = text
                    .chars()
                    .next()
                    .filter(|c| *c != '\n')
                    .and_then(|ch| {
                        let end = state
                            .range_to_bounds(&(offset + ch.len_utf8()..offset + ch.len_utf8()))?;
                        // At a soft wrap boundary the next offset belongs to the next
                        // row. Measure the glyph rather than filling across both rows.
                        (end.origin.y == cell.origin.y && end.origin.x > cell.origin.x)
                            .then_some(end.origin.x - cell.origin.x)
                    })
                    .unwrap_or_else(|| {
                        let glyph = text
                            .chars()
                            .next()
                            .filter(|c| !c.is_control())
                            .unwrap_or(' ');
                        let run = TextRun {
                            len: glyph.len_utf8(),
                            font: Font {
                                family: cx.theme().font_family.clone(),
                                ..Default::default()
                            },
                            color: cx.theme().foreground,
                            background_color: None,
                            underline: None,
                            strikethrough: None,
                        };
                        window
                            .text_system()
                            .shape_line(glyph.to_string().into(), px(font_size), &[run], None)
                            .width
                            .max(px(font_size * 0.45))
                    });
                cell.size.width = width;
                cell.size.height = state
                    .cursor_layout()
                    .map(|(bounds, _)| bounds.size.height)
                    .unwrap_or(px(font_size * 1.25))
                    .min(line_height);
                cell.origin.y += (line_height - cell.size.height) / 2.;
                cell.origin.x += state.scroll_offset().x;
                let color = if matches!(mode, vim::Mode::Visual | vim::Mode::VisualLine) {
                    rgba(0x3b82f680)
                } else if dark {
                    rgba(0xffffff4d)
                } else {
                    rgba(0x00000040)
                };
                window.with_content_mask(
                    Some(ContentMask {
                        bounds: viewport.intersect(&state.input_bounds()),
                    }),
                    |window| window.paint_quad(fill(cell, color)),
                );
            },
        )
        .absolute()
        .inset_0()
        .size_full()
    }
}
