# Migrating a notes root to the `_system` layout

The app used to keep its own folders at the top level of a notes root, mixed in
with the user's. It now keeps all of them under a single `_system` folder, so
the root holds nothing but `_system` and the folders you made yourself.

```
before                          after
------                          -----
Feed/                           _system/
Archieve/                         _attachments/    (new, empty — reserved)
Recordings/                       _handwriting/    <- Attachments/
Attachments/                      _recordings/     <- Recordings/
Work/                             agent/           (new, empty)
Personal/                         me/              (new, empty)
                                  stream/          <- Feed/
                                  archive/         <- Archieve/
                                Work/
                                Personal/
```

In the app, `_system/stream` is still what the sidebar calls **Feed** and
`_system/archive` is still **Trash**. Neither `_system` nor anything inside it
appears in the folder tree; `agent/` and `me/` are reachable only through the
notes MCP.

**There is no automatic migration.** Nothing in the app renames these folders
for you, on either device. Until you run the steps below, an old notes root
opens with `Feed/`, `Archieve/`, `Recordings/` and `Attachments/` showing up as
ordinary user folders, and the app captures new notes into a fresh, empty
`_system/stream`. Nothing is lost in that state, but it is not a state to stay
in.

## What the migration actually does

`scripts/migrate-notes-root-layout.mjs`:

1. moves `Feed/`, `Archieve/`, `Recordings/`, `Attachments/` (and the older
   `Unsorted/`, `_Recordings/`) into their new homes;
2. creates `_system/agent/`, `_system/me/` and `_system/_attachments/`;
3. **rewrites `recording_audio_path` and `handwriting_attachment_path` in every
   note's front matter**, so recordings still play and scans still show their
   image — moving the folders without this is the one way to quietly break
   existing notes;
4. drops the old folder names from the root `.notes-order.json`.

It never touches note bodies, which is also why it works on an encrypted vault:
front matter is plaintext on disk even when the body is not.

Run it without `--apply` first — it prints exactly what it would do and changes
nothing.

```bash
node scripts/migrate-notes-root-layout.mjs "/path/to/your/notes root"
node scripts/migrate-notes-root-layout.mjs "/path/to/your/notes root" --apply
```

Re-running after a successful migration prints `nothing to do`. If the app
already created an empty `_system/` before you got to this, that is fine — the
script merges into it rather than failing.

## The procedure, desktop and phone

You are syncing one notes root between a Mac and a phone over git. The order
matters mostly for one reason: **nothing should write into the old `Feed/`
after the desktop has renamed it.**

### 1. Get the phone's work onto the remote

Open the app on the phone and sync (push). Anything captured but not pushed
would otherwise land in a folder that no longer exists on the other side, and
you would merge it by hand later.

### 2. Back up the desktop notes root

A plain copy of the whole folder, `.git` included:

```bash
cp -a "/path/to/your/notes root" "/path/to/your/notes root.backup-$(date +%Y%m%d)"
```

This is the real safety net for everything below. Keep it until you have used
the app on both devices for a few days.

### 3. Update both apps

Install the new build on the desktop and the phone. An old build pointed at a
migrated root will recreate `Feed/` and `Archieve/` at the top level and capture
into them, which puts you back where you started.

### 4. Migrate on the desktop

Quit the desktop app first — it debounces saves and writes on a timer, and you
do not want a write landing mid-rename.

```bash
cd /path/to/this/repo
node scripts/migrate-notes-root-layout.mjs "/path/to/your/notes root"          # read the plan
node scripts/migrate-notes-root-layout.mjs "/path/to/your/notes root" --apply  # do it
```

If you have several working folders (profiles), run it once per notes root.

Then open the desktop app. You should see:

- the sidebar's Feed showing the notes that were in `Feed/`;
- Trash showing what was in `Archieve/`;
- your own folders unchanged, and no `Feed`/`Archieve`/`Recordings`/
  `Attachments` folders in the tree;
- a recording note plays its audio, and a handwriting note shows its image.

### 5. Push, then pull on the phone

Sync from the desktop. Git records the moves as renames, so the phone's pull is
a fast-forward — it has no local changes of its own if you did step 1.

Open the app on the phone and pull. Check the same things: Feed, folders, one
recording, one photo note.

### 6. If the phone's pull goes wrong

Do not fight it. The phone holds no unique content at this point — everything is
on the remote. Re-pair it from scratch: remove the working folder in the phone's
settings, pair with the desktop again, and let it clone fresh.

## Afterwards

- The old backup copy still has the flat layout. If you ever point the app at it
  by accident, it will look like an un-migrated root — that is expected.
- `scripts/cleanup-orphan-recordings.mjs` understands both layouts and can be
  run afterwards to check no audio file lost its note.
- The notes MCP now writes to `<notes root>/_system/agent` instead of
  `<notes root>/agent`. If you had an `agent/` folder at the root from an
  earlier session, move it yourself — the migration script deliberately leaves
  it alone, because at the top level it is indistinguishable from a folder you
  made.
