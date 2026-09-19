//! Local Whisper transcription via the managed Python subprocess (desktop).

use crate::AppEnv;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;

use serde::Deserialize;

use super::WhisperStatusResult;

/// Python script executed as a subprocess for local whisper transcription.
/// Source lives in `whisper_scripts/transcribe.py` (embedded at compile time).
const WHISPER_TRANSCRIBE_SCRIPT: &str = include_str!("whisper_scripts/transcribe.py");

/// Lightweight check script — just verifies faster_whisper can be imported.
/// If a model is provided as an argument, it also tries to load it (which may trigger download).
/// Source lives in `whisper_scripts/check.py` (embedded at compile time).
const WHISPER_CHECK_SCRIPT: &str = include_str!("whisper_scripts/check.py");

/// JSON output from the local whisper Python script.
#[derive(Deserialize)]
struct WhisperScriptOutput {
    text: String,
    #[allow(dead_code)]
    language: Option<String>,
    #[allow(dead_code)]
    language_probability: Option<f64>,
    #[allow(dead_code)]
    duration: Option<f64>,
    #[allow(dead_code)]
    words: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct WhisperCheckOutput {
    available: bool,
    error: Option<String>,
}

/// Report whether local transcription is ready, optionally provisioning it.
///
/// With `setup == false` this is a cheap, side-effect-free probe (safe to call
/// on UI mount / while polling). With `setup == true` it provisions the managed
/// env and, when a model name is supplied, loads it — triggering a download of
/// the model weights when not already cached.
pub fn check_whisper_availability(
    app: &AppEnv,
    model: Option<&str>,
    setup: bool,
) -> WhisperStatusResult {
    if !setup {
        let ready = crate::whisper_env_ready(app);
        return WhisperStatusResult {
            available: ready,
            python_found: ready,
            error: None,
        };
    }

    let python = match crate::ensure_whisper_env(app) {
        Ok(path) => path,
        Err(error) => {
            return WhisperStatusResult {
                available: false,
                python_found: false,
                error: Some(error),
            }
        }
    };

    let mut cmd = Command::new(&python);
    cmd.arg("-c").arg(WHISPER_CHECK_SCRIPT);
    if let Some(m) = model {
        cmd.arg(m);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            return WhisperStatusResult {
                available: false,
                python_found: true,
                error: Some(format!("Failed to run check script: {}", e)),
            }
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return WhisperStatusResult {
            available: false,
            python_found: true,
            error: Some(format!("Check script failed: {}", stderr.trim())),
        };
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    match serde_json::from_str::<WhisperCheckOutput>(&stdout) {
        Ok(result) => WhisperStatusResult {
            available: result.available,
            python_found: true,
            error: result.error,
        },
        Err(e) => WhisperStatusResult {
            available: false,
            python_found: true,
            error: Some(format!(
                "Failed to parse check output: {}. Raw: {}",
                e,
                stdout.trim()
            )),
        },
    }
}

/// One line of progress the embedded script emits per segment as it decodes
/// (it also knows `total_seconds` up front, before any segment is consumed).
#[derive(Deserialize)]
struct WhisperProgressLine {
    processed_seconds: f64,
    total_seconds: f64,
}

/// Transcribe audio using local faster-whisper via the managed Python subprocess.
/// Streams the script's stdout line-by-line as it runs (rather than waiting for
/// the whole process to exit) so `on_progress` can report real-time progress —
/// the script emits one NDJSON line per segment, tagged `"type": "progress"`,
/// and a final `"type": "result"` line once transcription is complete.
/// Returns (plain_text, full_json_string_with_words).
pub fn transcribe_audio_local_whisper(
    audio_path: &Path,
    model: &str,
    python: &Path,
    mut on_progress: impl FnMut(f64, f64),
) -> Result<(String, String), String> {
    // Write embedded script to a temp file for reliable execution
    let script_path = std::env::temp_dir().join("type_whisper_transcribe.py");
    fs::write(&script_path, WHISPER_TRANSCRIBE_SCRIPT)
        .map_err(|e| format!("Failed to write whisper script: {}", e))?;

    let audio_path_str = audio_path
        .to_str()
        .ok_or_else(|| "Audio path contains invalid UTF-8".to_string())?;

    eprintln!(
        "[recordings] starting local whisper transcription: model={}, audio={}",
        model, audio_path_str
    );

    let mut child = Command::new(python)
        .arg(&script_path)
        .arg(audio_path_str)
        .arg(model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn whisper process: {}", e))?;

    // Drain stderr on its own thread while we read stdout below — otherwise a
    // chatty stderr (e.g. library warnings) could fill its pipe buffer and
    // deadlock the process against our blocking stdout read.
    let mut stderr_pipe = child.stderr.take().ok_or("Failed to capture stderr")?;
    let stderr_handle = thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr_pipe.read_to_string(&mut buf);
        buf
    });

    let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;
    let mut result_line: Option<String> = None;
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { continue };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) else {
            continue;
        };
        match value.get("type").and_then(|v| v.as_str()) {
            Some("progress") => {
                if let Ok(progress) = serde_json::from_value::<WhisperProgressLine>(value) {
                    on_progress(progress.processed_seconds, progress.total_seconds);
                }
            }
            Some("result") => {
                result_line = Some(trimmed.to_string());
            }
            _ => {}
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed to wait for whisper process: {}", e))?;
    let stderr = stderr_handle.join().unwrap_or_default();

    if !status.success() {
        return Err(format!("Whisper transcription failed: {}", stderr.trim()));
    }

    let Some(result_line) = result_line else {
        return Err(format!(
            "Whisper process exited without producing a result. Stderr: {}",
            stderr.trim()
        ));
    };

    let parsed: WhisperScriptOutput = serde_json::from_str(&result_line).map_err(|e| {
        format!(
            "Failed to parse whisper output: {}. Raw: {}",
            e,
            &result_line[..result_line.len().min(500)]
        )
    })?;

    let text = parsed.text.clone();
    // Keep the full JSON (including words) as-is for saving
    let full_json = result_line;

    eprintln!(
        "[recordings] whisper transcription complete: {} chars, language={:?}",
        text.len(),
        parsed.language
    );

    Ok((text, full_json))
}

/// Save word-level transcription JSON alongside the audio file.
/// e.g. audio-xxxx.webm → audio-xxxx.transcription.json
pub fn save_word_level_json(
    audio_path: &Path,
    json_content: &str,
) -> Result<PathBuf, String> {
    let stem = audio_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("audio");
    let json_path = audio_path
        .parent()
        .unwrap_or(audio_path)
        .join(format!("{}.transcription.json", stem));
    fs::write(&json_path, json_content)
        .map_err(|e| format!("Failed to write transcription JSON: {}", e))?;
    Ok(json_path)
}

// ── Word-gap reflow ───────────────────────────────────────────────────────
//
// Local whisper is the only backend with word-level timestamps, so it's the
// only one that can lay out a pause as whitespace instead of a plain space.
// Tune the two thresholds here — nothing else needs to change.

/// A pause at or above this many seconds becomes a single line break.
pub const LINE_BREAK_GAP_SECONDS: f64 = 0.2;
/// A pause at or above this many seconds becomes a blank-line paragraph break.
pub const PARAGRAPH_GAP_SECONDS: f64 = 2.0;

#[derive(Deserialize)]
struct TimedWord {
    word: String,
    start: f64,
    end: f64,
}

#[derive(Deserialize)]
struct WordsPayload {
    words: Option<Vec<TimedWord>>,
}

fn no_space_before(c: char) -> bool {
    // '-' is included because faster-whisper splits a hyphenated compound
    // into separate word tokens with the hyphen glued onto the continuation
    // (e.g. "кого" + "-то", "по" + "-любому") rather than as its own token.
    matches!(
        c,
        ',' | '.' | '!' | '?' | ';' | ':' | ')' | ']' | '}' | '-' | '\u{2019}' | '\u{201D}'
    )
}

fn no_space_after(c: char) -> bool {
    matches!(c, '(' | '[' | '{' | '\u{2018}' | '\u{201C}')
}

/// A word ending a sentence (trailing quotes/brackets stripped first) makes
/// any pause after it — even one under `PARAGRAPH_GAP_SECONDS` — read as a
/// paragraph break rather than a mid-sentence line break.
fn ends_sentence(token: &str) -> bool {
    let trimmed = token.trim_end_matches(['"', '\'', ')', ']', '\u{2019}', '\u{201D}']);
    matches!(trimmed.chars().last(), Some('.') | Some('!') | Some('?'))
}

/// Rebuild transcript text from the word-level timestamps in `full_json`
/// (the same payload `save_word_level_json` persists): a pause >=
/// `LINE_BREAK_GAP_SECONDS` wraps to a new line inside the same paragraph,
/// and a pause >= `PARAGRAPH_GAP_SECONDS` (or any pause at all right after a
/// sentence-ending word — see `ends_sentence`) starts a new paragraph.
/// Returns `None` when `full_json` carries no usable word timestamps, so
/// callers can fall back to the plain transcript untouched.
pub fn reformat_transcript_with_word_gaps(full_json: &str) -> Option<String> {
    let payload: WordsPayload = serde_json::from_str(full_json).ok()?;
    let words = payload.words?;
    if words.is_empty() {
        return None;
    }

    let mut out = String::new();
    let mut prev_end: Option<f64> = None;
    let mut prev_token: Option<&str> = None;
    for w in &words {
        let token = w.word.trim();
        if token.is_empty() {
            continue;
        }
        if let Some(prev) = prev_end {
            // A hyphen-glued continuation (faster-whisper splits a hyphenated
            // compound into e.g. "кого" + "-то") must never get a line/paragraph
            // break or a space, no matter the gap — it's one word, not a pause.
            let is_hyphen_continuation = token.starts_with('-');
            let gap = w.start - prev;
            let after_sentence_end = prev_token.is_some_and(ends_sentence);
            if is_hyphen_continuation {
                // glued directly below
            } else if gap >= PARAGRAPH_GAP_SECONDS
                || (after_sentence_end && gap >= LINE_BREAK_GAP_SECONDS)
            {
                out.push_str("\n\n");
            } else if gap >= LINE_BREAK_GAP_SECONDS {
                out.push('\n');
            } else {
                let skip_space = token.chars().next().is_some_and(no_space_before)
                    || out.chars().last().is_some_and(no_space_after);
                if !skip_space {
                    out.push(' ');
                }
            }
        }
        out.push_str(token);
        prev_end = Some(w.end);
        prev_token = Some(token);
    }
    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::reformat_transcript_with_word_gaps;

    fn words_json(words: &[(&str, f64, f64)]) -> String {
        let entries: Vec<String> = words
            .iter()
            .map(|(word, start, end)| {
                format!(
                    r#"{{"word":"{}","start":{},"end":{},"probability":0.9}}"#,
                    word, start, end
                )
            })
            .collect();
        format!(r#"{{"type":"result","words":[{}]}}"#, entries.join(","))
    }

    #[test]
    fn short_gap_stays_a_space() {
        let json = words_json(&[("Hello", 0.0, 0.5), ("there", 0.55, 1.0)]);
        assert_eq!(
            reformat_transcript_with_word_gaps(&json),
            Some("Hello there".to_string())
        );
    }

    #[test]
    fn gap_at_or_above_line_threshold_wraps_within_the_same_paragraph() {
        let json = words_json(&[("Hello", 0.0, 0.5), ("there", 0.8, 1.0)]);
        assert_eq!(
            reformat_transcript_with_word_gaps(&json),
            Some("Hello\nthere".to_string())
        );
    }

    #[test]
    fn gap_at_or_above_paragraph_threshold_starts_a_new_paragraph() {
        let json = words_json(&[("Hello", 0.0, 0.5), ("there", 2.5, 3.0)]);
        assert_eq!(
            reformat_transcript_with_word_gaps(&json),
            Some("Hello\n\nthere".to_string())
        );
    }

    #[test]
    fn punctuation_never_gets_a_leading_space() {
        let json = words_json(&[("Hello", 0.0, 0.5), (",", 0.5, 0.5), ("world", 0.55, 1.0)]);
        assert_eq!(
            reformat_transcript_with_word_gaps(&json),
            Some("Hello, world".to_string())
        );
    }

    #[test]
    fn hyphenated_compound_split_across_tokens_stays_glued_even_across_a_gap() {
        // faster-whisper emits "кого" then "-то" as two word entries for
        // "кого-то" — regression test for the note that showed up as
        // "кого -то" (space) instead of "кого-то" (glued).
        let json = words_json(&[
            ("кого", 42.66, 43.28),
            ("-то", 43.28, 43.46),
            ("по", 43.46, 43.64),
            ("-любому", 3.0, 3.64), // artificial large "gap" before it
        ]);
        assert_eq!(
            reformat_transcript_with_word_gaps(&json),
            Some("кого-то по-любому".to_string())
        );
    }

    #[test]
    fn pause_after_sentence_end_starts_a_new_paragraph_even_under_the_paragraph_threshold() {
        // Gap here (0.68s) is well under PARAGRAPH_GAP_SECONDS (2.0s), but the
        // previous word ends the sentence, so it should still start a new
        // paragraph rather than just wrap within the same one.
        let json = words_json(&[("ты.", 0.0, 0.5), ("Поэтому,", 1.18, 1.5)]);
        assert_eq!(
            reformat_transcript_with_word_gaps(&json),
            Some("ты.\n\nПоэтому,".to_string())
        );
    }

    #[test]
    fn pause_mid_sentence_stays_a_wrapped_line() {
        let json = words_json(&[("возможно,", 0.0, 0.5), ("это", 0.8, 1.0)]);
        assert_eq!(
            reformat_transcript_with_word_gaps(&json),
            Some("возможно,\nэто".to_string())
        );
    }

    #[test]
    fn missing_words_field_returns_none() {
        assert_eq!(
            reformat_transcript_with_word_gaps(r#"{"type":"result","text":"hi"}"#),
            None
        );
    }

    #[test]
    fn empty_words_array_returns_none() {
        assert_eq!(
            reformat_transcript_with_word_gaps(r#"{"type":"result","words":[]}"#),
            None
        );
    }
}
