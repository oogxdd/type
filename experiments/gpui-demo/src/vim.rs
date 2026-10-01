//! Modal commands over UTF-8 byte offsets. The host retains text, layout, IME and history.
use std::ops::Range;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Mode {
    #[default]
    Normal,
    Insert,
    Visual,
    VisualLine,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Effect {
    Select(Range<usize>),
    Replace(Range<usize>, String, usize),
    Vertical(bool, usize),
    Undo,
    Redo,
    Search,
}
#[derive(Default)]
pub struct Vim {
    pub mode: Mode,
    pub head: usize,
    anchor: usize,
    count: usize,
    operator: Option<(char, usize)>,
    prefix: Option<char>,
    register: String,
    linewise: bool,
}
impl Vim {
    pub fn label(&self) -> String {
        format!(
            "{} {}{}{}",
            match self.mode {
                Mode::Normal => "NORMAL",
                Mode::Insert => "INSERT",
                Mode::Visual => "VISUAL",
                Mode::VisualLine => "V-LINE",
            },
            self.operator
                .map(|(op, _)| op.to_string())
                .unwrap_or_default(),
            if self.count > 0 {
                self.count.to_string()
            } else {
                String::new()
            },
            self.prefix.map(|p| p.to_string()).unwrap_or_default()
        )
    }
    pub fn reset(&mut self) {
        self.mode = Mode::Normal;
        self.clear();
    }
    fn clear(&mut self) {
        self.count = 0;
        self.operator = None;
        self.prefix = None;
    }
    pub fn visual(&self) -> bool {
        matches!(self.mode, Mode::Visual | Mode::VisualLine)
    }
    pub fn selection(&self, text: &str) -> Range<usize> {
        let start = self.anchor.min(self.head).min(text.len());
        let end = self.anchor.max(self.head).min(text.len());
        if self.mode == Mode::VisualLine {
            line_start(text, start)..line_after(text, end)
        } else {
            start..next(text, end)
        }
    }
    pub fn finish_motion(&mut self, text: &str, cursor: usize) -> Range<usize> {
        self.head = cursor.min(text.len());
        if self.visual() {
            self.selection(text)
        } else {
            self.head..self.head
        }
    }
    /// None lets the native editor handle text input. Normal-mode unknown keys
    /// are consumed, so an incomplete/unsupported command never inserts prose.
    pub fn key(
        &mut self,
        key: &str,
        literal: &str,
        text: &str,
        cursor: usize,
    ) -> Option<Vec<Effect>> {
        if key == "escape" || key == "ctrl-[" {
            let pos = if self.mode == Mode::Insert {
                prev(text, cursor).max(line_start(text, cursor))
            } else if self.visual() {
                self.head
            } else {
                cursor
            };
            self.reset();
            self.head = pos;
            return Some(vec![Effect::Select(pos..pos)]);
        }
        if self.mode == Mode::Insert {
            return None;
        }
        let pos = if self.visual() {
            self.head.min(text.len())
        } else {
            cursor.min(text.len())
        };
        let n = self.count.max(1);
        if !self.visual() {
            self.head = pos;
        }
        if let Some(prefix) = self.prefix.take() {
            if prefix == 'g' && key == "g" {
                let end = nth_line(text, n.saturating_sub(1));
                return Some(self.motion(text, pos, end, false, true));
            }
            if prefix == 'r' {
                self.clear();
                if literal.chars().count() == 1 {
                    let end = advance(text, pos, n).min(line_end(text, pos));
                    return Some(vec![Effect::Replace(
                        pos..end,
                        literal.repeat(text[pos..end].chars().count()),
                        pos,
                    )]);
                }
                return Some(vec![]);
            }
            if prefix == 'f' || prefix == 't' {
                let found = text[next(text, pos)..line_end(text, pos).max(next(text, pos))]
                    .match_indices(literal)
                    .nth(n - 1)
                    .map(|(i, _)| next(text, pos) + i);
                if let Some(end) = found {
                    let end = if prefix == 't' { prev(text, end) } else { end };
                    return Some(self.motion(text, pos, end, true, false));
                }
                self.clear();
                return Some(vec![]);
            }
            if prefix == 'i' || prefix == 'a' {
                let range = text_object(text, pos, key, prefix == 'a');
                if let Some(range) = range {
                    if let Some((op, _)) = self.operator {
                        return Some(self.operate(text, range, op, false));
                    }
                    self.anchor = range.start;
                    self.head = prev(text, range.end);
                    self.count = 0;
                    return Some(vec![Effect::Select(range)]);
                }
            }
            self.clear();
            return Some(vec![]);
        }
        if key.len() == 1 && key.as_bytes()[0].is_ascii_digit() && (key != "0" || self.count > 0) {
            self.count = (self.count * 10 + key.parse::<usize>().unwrap()).min(999);
            return Some(vec![]);
        }
        if matches!(key, "d" | "c" | "y") {
            let op = key.chars().next().unwrap();
            if self.visual() {
                return Some(self.operate(
                    text,
                    self.selection(text),
                    op,
                    self.mode == Mode::VisualLine,
                ));
            }
            if let Some((pending, count)) = self.operator {
                if pending == op {
                    let end = line_down(text, pos, count * n - 1);
                    return Some(self.operate(
                        text,
                        line_start(text, pos)..line_after(text, end),
                        op,
                        true,
                    ));
                }
                self.clear();
                return Some(vec![]);
            }
            self.operator = Some((op, n));
            self.count = 0;
            return Some(vec![]);
        }
        if matches!(key, "i" | "a") && (self.operator.is_some() || self.visual()) {
            self.prefix = key.chars().next();
            return Some(vec![]);
        }
        if matches!(key, "g" | "f" | "t" | "r") {
            self.prefix = key.chars().next();
            return Some(vec![]);
        }
        let total = n * self.operator.map(|(_, count)| count).unwrap_or(1);
        let motion = match key {
            "h" | "left" => Some((
                retreat(text, pos, total).max(line_start(text, pos)),
                false,
                false,
            )),
            "l" | "right" => Some((
                advance(text, pos, total).min(line_end(text, pos)),
                false,
                false,
            )),
            "0" => Some((line_start(text, pos), false, false)),
            "^" => Some((first_nonblank(text, pos), false, false)),
            "$" => Some((
                prev(text, line_end(text, line_down(text, pos, total - 1)))
                    .max(line_start(text, pos)),
                true,
                false,
            )),
            "w" if self.operator.is_some_and(|(op, _)| op == 'c') && at(text, pos) != 0 => {
                Some((repeat_motion(text, pos, total, word_end), true, false))
            }
            "w" => Some((repeat_motion(text, pos, total, word_next), false, false)),
            "b" => Some((repeat_motion(text, pos, total, word_prev), false, false)),
            "e" => Some((repeat_motion(text, pos, total, word_end), true, false)),
            "G" => Some((
                if self.count > 0 {
                    nth_line(text, n - 1)
                } else {
                    line_start(text, text.len())
                },
                false,
                true,
            )),
            "j" | "down" if self.operator.is_some() => {
                Some((line_down(text, pos, total), false, true))
            }
            "k" | "up" if self.operator.is_some() => Some((line_up(text, pos, total), false, true)),
            _ => None,
        };
        if let Some((end, inclusive, linewise)) = motion {
            return Some(self.motion(text, pos, end, inclusive, linewise));
        }
        if self.operator.is_some() {
            self.clear();
            return Some(vec![]);
        }
        self.count = 0;
        let effects = match key {
            "j" | "down" | "k" | "up" => vec![Effect::Vertical(matches!(key, "j" | "down"), n)],
            "v" | "V" => {
                let mode = if key == "V" {
                    Mode::VisualLine
                } else {
                    Mode::Visual
                };
                if self.mode == mode {
                    self.mode = Mode::Normal;
                    vec![Effect::Select(pos..pos)]
                } else {
                    if !self.visual() {
                        self.anchor = pos;
                        self.head = pos;
                    }
                    self.mode = mode;
                    vec![Effect::Select(self.selection(text))]
                }
            }
            "i" | "a" | "I" | "A" => {
                self.mode = Mode::Insert;
                let end = match key {
                    "a" => next(text, pos).min(line_end(text, pos)),
                    "I" => first_nonblank(text, pos),
                    "A" => line_end(text, pos),
                    _ => pos,
                };
                vec![Effect::Select(end..end)]
            }
            "o" | "O" => {
                self.mode = Mode::Insert;
                let at = if key == "O" {
                    line_start(text, pos)
                } else {
                    line_end(text, pos)
                };
                vec![Effect::Replace(
                    at..at,
                    "\n".into(),
                    at + usize::from(key == "o"),
                )]
            }
            "x" => {
                let range = if self.visual() {
                    self.selection(text)
                } else {
                    pos..advance(text, pos, n).min(line_end(text, pos))
                };
                self.operate(text, range, 'd', false)
            }
            "D" | "C" => self.operate(
                text,
                pos..line_end(text, line_down(text, pos, n - 1)),
                if key == "D" { 'd' } else { 'c' },
                false,
            ),
            "p" | "P" => {
                if self.register.is_empty() {
                    vec![]
                } else {
                    let mut value = self.register.repeat(n);
                    let at = if self.linewise {
                        if key == "P" {
                            line_start(text, pos)
                        } else {
                            line_after(text, pos)
                        }
                    } else if key == "p" {
                        next(text, pos).min(line_end(text, pos))
                    } else {
                        pos
                    };
                    let mut cursor = at;
                    if self.linewise && at == text.len() && !text.ends_with('\n') && key == "p" {
                        value.insert(0, '\n');
                        cursor += 1;
                    }
                    let range = if self.visual() {
                        self.selection(text)
                    } else {
                        at..at
                    };
                    if self.visual() {
                        cursor = range.start;
                    }
                    self.mode = Mode::Normal;
                    vec![Effect::Replace(range, value, cursor)]
                }
            }
            "u" => vec![Effect::Undo],
            "ctrl-r" => vec![Effect::Redo],
            "/" => vec![Effect::Search],
            _ => vec![],
        };
        Some(effects)
    }
    fn motion(
        &mut self,
        text: &str,
        pos: usize,
        end: usize,
        inclusive: bool,
        linewise: bool,
    ) -> Vec<Effect> {
        if let Some((op, _)) = self.operator {
            let range = if linewise {
                line_start(text, pos.min(end))..line_after(text, pos.max(end))
            } else {
                pos.min(end)..if inclusive {
                    next(text, pos.max(end))
                } else {
                    pos.max(end)
                }
            };
            return self.operate(text, range, op, linewise);
        }
        self.clear();
        self.head = end;
        vec![Effect::Select(if self.visual() {
            self.selection(text)
        } else {
            end..end
        })]
    }
    fn operate(
        &mut self,
        text: &str,
        range: Range<usize>,
        op: char,
        linewise: bool,
    ) -> Vec<Effect> {
        self.register = text[range.clone()].to_owned();
        self.linewise = linewise;
        if linewise && !self.register.ends_with('\n') {
            self.register.push('\n');
        }
        let yank_cursor = if self.visual() {
            range.start
        } else {
            self.head
        };
        self.clear();
        self.mode = if op == 'c' {
            Mode::Insert
        } else {
            Mode::Normal
        };
        self.head = range.start;
        if op == 'y' {
            return vec![Effect::Select(yank_cursor..yank_cursor)];
        }
        let mut edit = range.clone();
        // Preserve a blank logical line for cc; remove the preceding separator for dd at EOF.
        if linewise && op == 'c' && edit.end > edit.start && text[..edit.end].ends_with('\n') {
            edit.end -= 1;
        } else if linewise
            && op == 'd'
            && edit.end == text.len()
            && edit.start > 0
            && (edit.is_empty() || !text.ends_with('\n'))
        {
            edit.start -= 1;
        }
        vec![Effect::Replace(edit.clone(), String::new(), edit.start)]
    }
}
pub fn next(s: &str, p: usize) -> usize {
    p + s[p..].chars().next().map_or(0, char::len_utf8)
}
pub fn prev(s: &str, p: usize) -> usize {
    s[..p].char_indices().next_back().map_or(0, |(i, _)| i)
}
fn advance(s: &str, mut p: usize, n: usize) -> usize {
    for _ in 0..n {
        p = next(s, p);
    }
    p
}
fn retreat(s: &str, mut p: usize, n: usize) -> usize {
    for _ in 0..n {
        p = prev(s, p);
    }
    p
}
pub fn line_start(s: &str, p: usize) -> usize {
    s[..p].rfind('\n').map_or(0, |i| i + 1)
}
fn line_end(s: &str, p: usize) -> usize {
    s[p..].find('\n').map_or(s.len(), |i| p + i)
}
fn line_after(s: &str, p: usize) -> usize {
    next(s, line_end(s, p))
}
fn line_down(s: &str, mut p: usize, n: usize) -> usize {
    for _ in 0..n {
        let at = line_after(s, p);
        if at == s.len() && !s.ends_with('\n') {
            break;
        }
        p = at;
    }
    p
}
fn line_up(s: &str, mut p: usize, n: usize) -> usize {
    for _ in 0..n {
        p = line_start(s, prev(s, line_start(s, p)));
    }
    p
}
fn nth_line(s: &str, n: usize) -> usize {
    line_down(s, 0, n)
}
fn first_nonblank(s: &str, p: usize) -> usize {
    let start = line_start(s, p);
    start + s[start..line_end(s, p)].len() - s[start..line_end(s, p)].trim_start().len()
}
fn class(c: char) -> u8 {
    if c.is_whitespace() {
        0
    } else if c.is_alphanumeric() || c == '_' {
        1
    } else {
        2
    }
}
fn at(s: &str, p: usize) -> u8 {
    s[p..].chars().next().map_or(0, class)
}
fn word_next(s: &str, mut p: usize) -> usize {
    let c = at(s, p);
    while p < s.len() && at(s, p) == c {
        p = next(s, p);
    }
    while p < s.len() && at(s, p) == 0 {
        p = next(s, p);
    }
    p
}
fn word_prev(s: &str, mut p: usize) -> usize {
    p = prev(s, p);
    while p > 0 && at(s, p) == 0 {
        p = prev(s, p);
    }
    let c = at(s, p);
    while p > 0 && at(s, prev(s, p)) == c {
        p = prev(s, p);
    }
    p
}
fn word_end(s: &str, mut p: usize) -> usize {
    p = next(s, p);
    while p < s.len() && at(s, p) == 0 {
        p = next(s, p);
    }
    let c = at(s, p);
    while next(s, p) < s.len() && at(s, next(s, p)) == c {
        p = next(s, p);
    }
    p
}
fn repeat_motion(s: &str, mut p: usize, n: usize, f: fn(&str, usize) -> usize) -> usize {
    for _ in 0..n {
        p = f(s, p);
    }
    p
}
fn text_object(s: &str, p: usize, key: &str, around: bool) -> Option<Range<usize>> {
    if key == "w" {
        let c = at(s, p);
        let mut start = p;
        let mut end = p;
        while start > 0 && at(s, prev(s, start)) == c {
            start = prev(s, start);
        }
        while end < s.len() && at(s, end) == c {
            end = next(s, end);
        }
        if around {
            while end < s.len() && at(s, end) == 0 {
                end = next(s, end);
            }
        }
        return Some(start..end);
    }
    let (open, close) = match key {
        "\"" => ('"', '"'),
        "'" => ('\'', '\''),
        "(" | ")" | "b" => ('(', ')'),
        "[" | "]" => ('[', ']'),
        "{" | "}" => ('{', '}'),
        _ => return None,
    };
    let start = s[..next(s, p)].rfind(open)?;
    let end = start + open.len_utf8() + s[start + open.len_utf8()..].find(close)?;
    (p <= end).then(|| {
        if around {
            start..next(s, end)
        } else {
            next(s, start)..end
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn run(text: &str, keys: &[&str]) -> (String, usize, Mode) {
        let mut vim = Vim::default();
        let mut text = text.to_string();
        let mut cursor = 0;
        for key in keys {
            for effect in vim.key(key, key, &text, cursor).unwrap_or_default() {
                match effect {
                    Effect::Select(r) => cursor = r.end,
                    Effect::Replace(r, value, at) => {
                        text.replace_range(r, &value);
                        cursor = at.min(text.len());
                    }
                    _ => panic!("host effect"),
                }
            }
        }
        (text, cursor, vim.mode)
    }
    #[test]
    fn unicode_delete_and_paste() {
        assert_eq!(run("Привет мир", &["d", "w", "p"]).0, "мПривет ир");
    }
    #[test]
    fn counts_multiply() {
        assert_eq!(run("a b c d e f g", &["2", "d", "3", "w"]).0, "g");
    }
    #[test]
    fn line_delete_preserves_following_line() {
        assert_eq!(run("one\ntwo\nthree", &["d", "d"]).0, "two\nthree");
    }
    #[test]
    fn change_line_keeps_separator() {
        let (s, p, mode) = run("one\ntwo", &["c", "c"]);
        assert_eq!((s, p, mode), ("\ntwo".into(), 0, Mode::Insert));
    }
    #[test]
    fn last_line_delete_and_put() {
        assert_eq!(run("one\ntwo", &["G", "d", "d", "p"]).0, "one\ntwo\n");
    }
    #[test]
    fn visual_includes_cursor_unicode() {
        assert_eq!(run("абвг", &["v", "l", "d"]).0, "вг");
    }
    #[test]
    fn visual_reverse() {
        assert_eq!(run("abcd", &["l", "l", "v", "h", "d"]).0, "ad");
    }
    #[test]
    fn text_object_and_change() {
        assert_eq!(run("привет мир", &["l", "d", "i", "w"]).0, " мир");
    }
    #[test]
    fn escape_cancels_operator() {
        assert_eq!(run("hello", &["d", "escape", "w"]).0, "hello");
    }
    #[test]
    fn linewise_motion() {
        assert_eq!(run("a\nb\nc", &["d", "j"]).0, "c");
    }
    #[test]
    fn replace_unicode() {
        assert_eq!(run("абв", &["2", "r", "я"]).0, "яяв");
    }
    #[test]
    fn deleting_terminated_last_line_preserves_previous_separator() {
        assert_eq!(run("one\ntwo\n", &["2", "g", "g", "d", "d"]).0, "one\n");
    }
    #[test]
    fn change_word_preserves_space() {
        assert_eq!(run("hello world", &["c", "w"]).0, " world");
    }
    #[test]
    fn empty_commands_are_safe() {
        for key in ["h", "l", "w", "b", "e", "$", "G", "x"] {
            assert_eq!(run("", &[key]).0, "");
        }
    }
}
