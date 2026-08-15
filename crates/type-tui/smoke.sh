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
# `$ARGS` is passed to the binary, which is how the custom-folder case opens
# something other than the profile's notes root.
ARGS=""
drive() {
    {
        while [ $# -gt 0 ]; do
            sleep "$1"
            printf '%b' "$2"
            shift 2
        done
        sleep 2
    } | pty_run "$LOG" 30 "stty rows 30 cols 120; $BIN $ARGS"
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
# Step 2 moved the only note out of Feed, so switching to the feed view has to
# land on its empty state — which is also proof the switch happened at all.
drive 1 '\t' 2 ':q!\r'
screen | grep -q 'nofeednotes' || fail "Tab did not switch to the feed view"
pass "Tab toggles nav mode"

echo "6. one Ctrl+W moves focus (it used to take two)"
# `o` creates a note only in the note *list* pane, so a note appearing after a
# single Ctrl+W is proof that one press left the tree. The old two-key
# `Ctrl+W` prefix would have swallowed the `o` instead.
drive 1 '\027' 1 'o' 1 'focus moved with one ctrl w' 1 '\033' 1 ':wq\r'
grep -rq 'focus moved with one ctrl w' "$ROOT" \
    || fail "a single Ctrl+W did not reach the note list"
pass "Ctrl+W is one press"

echo "7. Ctrl+T hides both left panels"
drive 1 '\024' 2 ':q!\r'
SCREEN="$(screen)"
echo "$SCREEN" | grep -q 'panelshidden' || fail "Ctrl+T did not hide the panels"
pass "Ctrl+T hides the navigation"

echo "8. slash palette discovers and runs mark:archive"
# Step 6 left a selected note in Feed, so the marker command has a target as
# soon as the app opens; no tree-navigation assumptions leak into this check.
drive 1 '/mark:archive\r' 2 ':q!\r'
MARKED_FILE="$(grep -rl '^archived_ms:' "$ROOT" --include='*.md' | head -n 1)"
[ -n "$MARKED_FILE" ] || fail "palette did not set archived marker"
SCREEN="$(screen)"
echo "$SCREEN" | grep -q 'Marknotearchived' || fail "slash palette row did not render"
echo "$SCREEN" | grep -q 'markedarchived' || fail "slash palette command did not run"
pass "slash palette renders and dispatches shared commands"

echo "9. an arbitrary folder opens with no Feed and nothing written into it"
WIKI="$WORK/wiki"
mkdir -p "$WIKI/projects"
printf -- '# Inbox\n\nloose note\n' > "$WIKI/inbox.md"
printf -- '# Alpha\n\nproject note\n' > "$WIKI/projects/alpha.md"
ARGS="$WIKI"
drive 1 '\t' 2 ':q!\r'
ARGS=""
SCREEN="$(screen)"
echo "$SCREEN" | grep -q 'noFeedfolderhere' || fail "Tab offered a Feed that does not exist"
echo "$SCREEN" | grep -q 'wiki' || fail "the opened folder is not the tree root"
[ ! -d "$WIKI/Feed" ] || fail "opening a folder created Feed/ in it"
[ ! -d "$WIKI/Archieve" ] || fail "opening a folder created Archieve/ in it"
[ ! -d "$WIKI/Recordings" ] || fail "opening a folder created Recordings/ in it"
pass "custom folder browses without being converted into a notes root"

echo
echo "all smoke tests passed"
