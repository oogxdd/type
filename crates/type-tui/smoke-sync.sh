#!/bin/sh
#
# End-to-end git sync test: two "devices" over one bare repository.
#
#   sh crates/type-tui/smoke-sync.sh
#
# Device A writes a note, connects to the remote and pushes. Device B connects
# to the same remote, pulls, and must end up with A's note on disk. That is the
# whole contract of :connect / :push / :pull, exercised through the real binary.
#
# Kept separate from smoke.sh because it needs libgit2 to do real work and is
# correspondingly slower.
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
REMOTE="$WORK/remote.git"
git init -q --bare --initial-branch=main "$REMOTE"

# Seed the remote with one commit.
#
# Not cosmetic: fetching a *completely empty* remote makes libgit2 fail with
# "corrupted loose reference file: FETCH_HEAD". That is core/libgit2 behaviour,
# not something this shell introduces — see the note at the bottom of this file.
SEED="$WORK/seed"
git clone -q "$REMOTE" "$SEED"
: > "$SEED/.gitkeep"
git -C "$SEED" add .gitkeep
git -C "$SEED" -c user.email=seed@local -c user.name=seed commit -qm "Initial commit"
git -C "$SEED" push -q origin main
rm -rf "$SEED"

fail() { echo "FAIL: $1"; exit 1; }
pass() { echo "  ok: $1"; }

# Run the TUI as a given "device" — its own app-data dir, hence its own notes
# root and its own git config. Arguments are alternating delay/keys; see the
# note in smoke.sh about why the delays are required.
run_device() {
    device="$1"; shift
    {
        while [ $# -gt 0 ]; do
            sleep "$1"
            printf '%b' "$2"
            shift 2
        done
        sleep 3
    } | TYPE_TUI_APP_DATA_DIR="$WORK/$device" \
        timeout 60 script -qec "stty rows 30 cols 120; $BIN" /dev/null \
        > "$WORK/$device.log" 2>&1
}

screen() {
    sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g; s/\x1b[()][A-Z0-9]//g; s/\x1b[=>]//g' "$WORK/$1.log" \
        | tr -d '\r '
}

echo "1. device A: write a note, connect, sync"
# `:sync` rather than a bare `:push`. After connect the local branch is not a
# descendant of the remote (the core commits this device's notes as their own
# history so nothing is lost), so a raw push is correctly rejected as
# non-fast-forwardable. `:sync` pulls — which merges — and then pushes.
run_device a \
    1 ':new\r' \
    1 'Note written on device A' \
    1 '\033' \
    1 ":connect $REMOTE\r" \
    3 ':sync\r' \
    5 ':q\r'
screen a | grep -q 'connected·' || fail "device A did not connect: $(screen a | grep -o 'connect:[^│]*' | head -1)"
pass "connected"
screen a | grep -q 'pushed·' || fail "device A did not sync: $(screen a | grep -oE '(push|pull):[^│]*' | head -1)"
pass "synced"

echo "2. remote now holds a commit"
git --git-dir="$REMOTE" log --oneline -1 >/dev/null 2>&1 || fail "remote has no commits"
git --git-dir="$REMOTE" ls-tree -r --name-only HEAD | grep -q '\.md$' || fail "remote has no notes"
pass "remote has the note"

echo "3. device B: connect and pull"
run_device b \
    1 ":connect $REMOTE\r" \
    3 ':pull\r' \
    4 ':q\r'
screen b | grep -q 'connected·' || fail "device B did not connect: $(screen b | grep -o 'connect:[^│]*' | head -1)"
pass "connected"

FOUND="$(grep -rl 'Note written on device A' "$WORK/b/notes" 2>/dev/null | head -1)"
[ -n "$FOUND" ] || fail "device B never received the note"
pass "device B has A's note: $(basename "$FOUND")"

echo
echo "sync smoke test passed"
