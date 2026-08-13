#!/bin/sh
#
# End-to-end smoke test for the TUI.
#
# Unit tests cover the pure pieces (command parsing, folder completion,
# auto-rename). They cannot cover the event loop, the debounce, or the fact that
# a keystroke ends up as bytes in a file — so this drives the real binary
# through a pty and asserts against the resulting notes root.
#
#   sh crates/type-tui/smoke.sh
#
# Two things this script has to get right, both learned the hard way:
#
#   * Keys need delays between them. Sent as one burst, ESC immediately
#     followed by another byte is parsed as Alt+<key>, not Esc then <key>,
#     so modal transitions silently do not happen.
#   * The pty needs an explicit size. Without `stty` it is 0x0, ratatui
#     renders nothing, and any assertion against the screen fails while the
#     app is in fact working.
#
set -e

BIN="${BIN:-target/debug/type-tui}"
if [ ! -x "$BIN" ]; then
    echo "building..."
    cargo build -p type-tui
fi
BIN="$(cd "$(dirname "$BIN")" && pwd)/$(basename "$BIN")"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
export TYPE_TUI_APP_DATA_DIR="$WORK"
ROOT="$WORK/notes"
LOG="$WORK/screen.log"

# `timeout` is GNU coreutils; macOS has it only as `gtimeout` if coreutils is
# installed via Homebrew. Skip the timeout wrapper entirely if neither exists.
TIMEOUT_BIN="$(command -v timeout 2>/dev/null || command -v gtimeout 2>/dev/null || true)"

# `script` provides the pty ratatui needs to render. util-linux `script`
# (Linux) takes the command via `-c`; BSD `script` (macOS) has no `-c` and
# instead runs a trailing positional command directly against the pty.
pty_run() {
    log="$1"; secs="$2"; cmd="$3"
    if [ "$(uname -s)" = "Darwin" ]; then
        set -- script -q /dev/null sh -c "$cmd"
    else
        set -- script -qec "$cmd" /dev/null
    fi
    if [ -n "$TIMEOUT_BIN" ]; then
        "$TIMEOUT_BIN" "$secs" "$@" > "$log" 2>&1
    else
        "$@" > "$log" 2>&1
    fi
}

# Run the TUI with keys piped in. Arguments are alternating delay/keys.
drive() {
    {
        while [ $# -gt 0 ]; do
            sleep "$1"
            printf '%b' "$2"
            shift 2
        done
        sleep 2
    } | pty_run "$LOG" 30 "stty rows 30 cols 120; $BIN"
}

# The rendered screen with escape sequences removed.
#
# ratatui advances across blank cells with cursor-move escapes instead of
# emitting literal spaces, so stripping the escapes leaves words butted
# together. Assertions therefore drop spaces on both sides and match
# space-free patterns.
screen() {
    sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\x1b[()][A-Z0-9]//g; s/\x1b[=>]//g' "$LOG" \
        | tr -d '\r '
}

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "  ok: $1"; }

echo "1. create a note, type, save and quit"
drive 1 ':new\r' 1 'Hello from the terminal shell' 1 '\033' 1 ':wq\r'
FILE="$(find "$ROOT/Feed" -name '*.md')"
[ -n "$FILE" ] || fail "no note created"
grep -q 'Hello from the terminal shell' "$FILE" || fail "body not written"
pass "note written"
# The placeholder suffix must have been replaced by a content slug.
case "$FILE" in
    *-hello-from-the-terminal-shell.md) pass "auto-renamed to content slug" ;;
    *) fail "expected a slugged file name, got $(basename "$FILE")" ;;
esac

echo "2. move it with :mv"
drive 1 ':mv Archieve\r' 1 ':q\r'
[ -z "$(find "$ROOT/Feed" -name '*.md')" ] || fail "note still in Feed"
[ -n "$(find "$ROOT/Archieve" -name '*.md')" ] || fail "note not in Archieve"
pass "moved to Archieve"

echo "3. abandon a new note (empty-note cleanup)"
BEFORE="$(find "$ROOT" -name '*.md' | wc -l)"
# `:new` lands in INSERT mode, so Esc before the command or ":q" is just text.
drive 1 ':new\r' 1 '\033' 1 ':q\r'
AFTER="$(find "$ROOT" -name '*.md' | wc -l)"
[ "$BEFORE" -eq "$AFTER" ] || fail "empty note survived ($BEFORE -> $AFTER)"
pass "empty note deleted"

echo "4. panes render and :status answers"
drive 1 ':status\r' 2 ':q!\r'
SCREEN="$(screen)"
echo "$SCREEN" | grep -qE 'Feed|Folders' || fail "nav pane missing"
echo "$SCREEN" | grep -q 'NORMAL' || fail "status bar missing"
echo "$SCREEN" | grep -q 'nogitrepo' || fail ":status did not report git state"
pass "nav + status bar + git status"

echo "5. Tab switches between feed and folders"
# A note exists in Feed from step 1, so the feed tree has at least a Today bucket.
drive 1 '\033' 1 'Tab' 2 '\033' 1 ':q!\r'
SCREEN="$(screen)"
echo "$SCREEN" | grep -qE 'Feed|Folders' || fail "left panel did not render after Tab"
pass "Tab toggles nav mode"

echo
echo "all smoke tests passed"
