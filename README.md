# Type

A **local-first markdown notes app**. Your notes are plain `.md` files in a folder on
your own disk — no account, no lock-in, readable and editable by any other tool. Optional
Git sync keeps them in step across devices, including a one-button local-network server so
a phone can sync over Wi-Fi or a hotspot with **no external host**.

Two apps share **one Rust core**:

- **Desktop** — Tauri v2 + React 19/TypeScript (macOS, Windows, Linux)
- **Mobile** — React Native (Expo), talking to the same core through UniFFI. Opens on a
  blank page you can type on immediately; swipe up files it away and gives you a fresh page.

## Repository layout

npm workspaces + one Cargo workspace:

```
apps/desktop/          Tauri app (React frontend + src-tauri shell)
apps/mobile/           React Native app (Expo) — see apps/mobile/README.md
crates/type-core/      Framework-free Rust core (notes, git sync, recordings,
                       transcription queues, security, working folders)
crates/type-ffi/       UniFFI bindings over type-core for the mobile app
packages/shared/       @typenotes/shared — platform-free TS used by both apps
packages/mobile-core/  @typenotes/mobile-core — typed TS bridge to type-ffi
```

## Highlights

- **Plain-file storage** — notes are `.md` files in a folder tree you can point anywhere; order persists per folder.
- **Rich markdown editor** (Tiptap) with debounced autosave and content-based auto-naming.
- **Git sync** over `https://` or `ssh://` — push/pull across devices via libgit2 (no shell `git` needed on the client).
- **One-button local sync** — host an embedded SSH Git server on the desktop; the phone pairs by QR code, no Remote Login or external host.
- **SSH key auth** — generate an Ed25519 keypair in-app for passwordless SSH.
- **Never-blocked merges** — conflicts keep your version and drop the remote copy beside it as `.conflict.md`.
- **Audio recording + transcription** — zero-install local Whisper on desktop; per-folder modes on mobile (AssemblyAI, defer-to-desktop, native provider).
- **Handwriting OCR** — import an image, get text back (OpenAI / Hugging Face).
- **Processing queues** — voice transcription and handwriting OCR run as separate queues with shared status plumbing.
- **Multi-profile** — independent notes roots and sync settings.
- **Extension surfaces** — multi-note lens and note encryption/lock/panic are kept behind a typed frontend registry.
- **Desktop & mobile UIs** — resizable three-pane on desktop; native-feeling stack/split navigation on phone/tablet.

## Tech stack & architecture

- **Frontend** — React 19, TypeScript, Vite, Zustand, Tiptap, DnD Kit, Tailwind +
  shadcn/ui. Feature-sliced domains feed separate desktop and mobile composition shells.
  Feature-sliced under `src/`: `app/` (composition root), `shared/` (domain-agnostic
  building blocks), `features/<domain>/`, optional `features/extensions/`, shared
  queue plumbing under `features/processing/`, plus thin `desktop/` and `mobile/` shells.
  Context providers are intentionally slim: state/action/workflow hooks carry the notes tree,
  profile, git sync, processing, command palette, and desktop editor/navigation workflows.
  Optional surfaces such as multi-note lens are extension-gated and lazy-loaded where possible.
- **Backend** — Tauri v2 (Rust) in a pragmatic **domain / application / ports / adapters / commands**
  layout, so use cases can move to another shell (e.g. UniFFI for React Native) without a rewrite.

For the full module map and conventions see **[AGENTS.md](./AGENTS.md)**; for the Tauri
shell, **[apps/desktop/src-tauri/README.md](apps/desktop/src-tauri/README.md)**; for the
mobile app and its FFI bridge, **[apps/mobile/README.md](apps/mobile/README.md)** and
**[packages/mobile-core/README.md](packages/mobile-core/README.md)**.

If you want a gentler architecture introduction in Russian, read
**[docs/architecture](docs/architecture/README.md)**.

## Quick start

Rust is pinned to `1.97.1` by `rust-toolchain.toml`. With `rustup` installed,
Cargo selects and installs the same toolchain used by CI and release builds.

```bash
npm install                  # once, at the repo root (npm workspaces)
npm run desktop:dev          # desktop web dev server
npm run desktop:tauri dev    # desktop app
npm run mobile:start         # mobile (Expo; runs in demo mode without a native build)
```

The mobile app runs against an in-memory mock core until the native module is
generated on a Mac (Rust cross-build + `uniffi-bindgen-react-native` codegen) —
see [apps/mobile/README.md](apps/mobile/README.md).

### Isolated desktop dev

If the production macOS app is installed on the same machine, use the isolated
dev flavor so development does not touch production app data (run inside
`apps/desktop/`):

```bash
npm run tauri:dev:isolated -w type
```

Production uses `com.digital.type2` and stores app data under
`~/Library/Application Support/com.digital.type2/`. The isolated dev flavor uses
`com.digital.type2.dev` and stores app data under
`~/Library/Application Support/com.digital.type2.dev/`.

Run the app against the dev identifier — never the production one, which holds
real notes:

```bash
npm run desktop:app       # dev run, isolated data, updater disabled
npm run desktop:dmg:dev   # "Type Dev.dmg", installs alongside production
```

### Build & checks

```bash
npm run desktop:build    # tsc + vite build
cargo check --workspace

npm run typecheck        # tsc --noEmit in every workspace
npm test                 # Vitest in every workspace (pure logic)
cargo test --workspace --lib   # Rust unit tests
```

CI (`.github/workflows/ci.yml`) runs the typecheck and both test suites on every
pull request and on pushes to `main`.

Manual smoke checks:

- **Desktop** — folder tree, note editing, DnD reorder, context menus, settings, keyboard shortcuts
- **Mobile (React Native)** — blank-page capture + swipe-up filing, folder browsing, record, sync

## Notes storage

Notes live in a local folder tree. The app uses the first existing root:

1. `NOTES_ROOT` environment variable
2. `./notes`
3. `../notes`
4. App-data fallback (`<app-data>/notes`)

Each folder keeps its own `.notes-order.json` to persist the order of its child folders and
notes. A few system folders are maintained automatically inside every root: `Feed` (default
notes), `Archieve` (archive — the spelling is intentional and persisted), and the hidden
`Recordings/` (audio storage).

## Security mode extension (encryption + lock + panic)

The backend still contains note-body encryption, lock, and panic-reset support, but the
frontend treats this as an optional extension surface. Enable
`APP_EXTENSIONS.security` in `src/features/extensions/registry.ts` to show
**Settings → Security** and the lock screen in the app shell.

- Note **body** content is encrypted at rest (XChaCha20-Poly1305 with an Argon2id-derived key).
- File names and frontmatter stay plaintext by design.
- The app launches **locked**, and backend content commands reject requests until you unlock.
- Lock manually anytime (`Cmd/Ctrl+Shift+L`, or **Lock now** in settings); optional auto-lock on background.

Unlock vs. panic:

- The **unlock** password decrypts notes and derives the in-memory data key (never persisted in plaintext).
- The **panic** password wipes local notes/profiles/settings/security state, seeds 3 dummy notes, and reloads.

Notes:

- Panic reset is local-only — it does not remove history from remote Git servers.
- Recording audio and attachments are not encrypted in this iteration.

## Git sync

The app uses embedded **libgit2** from Tauri commands — you do not need shell `git`.

### What gets synced

- All note markdown (`.md`), including recording notes. A recording is just a note whose
  frontmatter references its audio and tracks transcription state (`recording_audio_path`,
  `transcription_status`, `transcription_id`, `transcription_error`); the transcript text is
  written into the note body once it completes (no separate transcript file).
- Recording audio, stored flat in the hidden `Recordings/` folder as `Recordings/audio-<id>.<ext>`.
- Folder structure and every `.notes-order.json`.

### One-time setup per device

In **Settings → Profiles**, fill in:

- **Remote URL** — `ssh://user@mac.local/path/to/repo.git` or `https://…`
- **Branch** — usually `main`
- **Commit message** — the default auto-commit message for push
- **Username** / **Token/Password** — for HTTPS auth

Then tap **Connect repo**, and **Push** (first device with notes) or **Pull** (to download
existing notes). Or just tap **Sync now** — it connects if needed, pushes local work, pulls
and merges remote changes, then pushes the result, in one step.

### Three ways to sync

1. **Remote repo** — point the Remote URL at any internet Git host (`https://…` or `ssh://…`) and **Sync now**.
2. **Local network SSH** — same Wi-Fi *or* your phone's hotspot. On desktop,
   open **Settings → Sync**; Type starts its embedded SSH Git server and shows a
   pairing QR code. The phone scans it, generates an app SSH key if needed, pins
   the desktop host key, and saves the remote. No internet, Remote Login, or
   `authorized_keys` setup required.

See [docs/LOCAL_SYNC.md](docs/LOCAL_SYNC.md) for the local-network flow.

### SSH key auth (recommended)

1. **Settings → SSH key → Generate SSH key**
2. Copy the public key into `~/.ssh/authorized_keys` on your server
3. Set the remote URL to `ssh://user@host/path/to/repo.git`
4. No username/password needed — the key authenticates

Full guide incl. hardening: [docs/ssh-sync-setup.md](docs/ssh-sync-setup.md).

### Pull / push & conflicts

- **Pull** allows up-to-date and fast-forward updates. If you have uncommitted local changes,
  pull is blocked until you push/commit.
- **Diverged history** is auto-merged when possible. If the same file changed on both sides,
  your local copy is kept and the remote copy is saved beside it as `note.conflict.md`.
  **The merge always completes — sync is never blocked.** Both files are plain markdown;
  compare, edit the original, and delete the `.conflict.md` when done.
- **Push** auto-commits local changes with your message, then pushes.

Typical loop: **Pull → edit → Push**. Across devices: Desktop edit → Push; phone Pull → edit →
Push; Desktop Pull.

### Security notes

- Git username/token live in local storage on the device; the SSH private key lives in the app's sandboxed data dir.
- Sensitive fields are redacted from frontend invoke logs.
- Prefer least-privilege tokens; for SSH, restrict the key to git-only access (see the SSH guide).

## Audio recording + transcription

- Recordings are saved under `Recordings/` with a unique audio file each.
- Start/stop from the left panel (desktop) or the recording screen (mobile).

### Desktop — local Whisper (faster-whisper)

Desktop transcribes **locally** with [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
— no API key, nothing leaves your machine, and **no manual setup**. The app provisions and
owns an isolated Python + faster-whisper environment under its app-data directory using
[`uv`](https://docs.astral.sh/uv/) (it even fetches `uv` itself on first use). Open
**Settings → Recordings → Set up / Download model**, or just record — the first transcription
provisions automatically (the first run downloads the engine + model, so it can take a few
minutes).

- Default model `large-v3`; change it in **Settings → Recordings** (`medium`, `small`, … or an absolute path to a local model).
- A background worker writes plain transcript text into the note body and word-level timestamps to `<audio-name>.transcription.json` beside the audio.
- Check status, provision, or **Retranscribe** in **Settings → Recordings**.

### Mobile — per-folder transcription mode

Each working folder's `.type/settings.json` carries a `transcription_mode`
(set it in the mobile app's Settings → Transcription; it syncs with the notes):

- **assemblyai** — transcribe right away on the phone via AssemblyAI (add your
  key in Settings; the key itself stays on the device).
- **desktop** — leave recordings pending; after a git sync your desktop's
  auto-queue transcribes them with local Whisper. Record on the phone,
  transcribe on the desktop, no cloud key needed.
- **native** — hook for an on-device speech recognizer, plugged in through the
  core's `TranscriptionProvider` FFI trait.
- **off** — never transcribe automatically.

## Roadmap

> Rough, early ideas — not yet designed or scheduled.

- **Note "revisions" / multi-view notes (keep transcripts in the note, not in
  sidecar files).** Today the transcript result is already injected into the
  recording note's body, but everything still collapses into one flat body. The
  idea is to let a single note hold several distinct "revisions" (views/tabs),
  all stored inside the *same* markdown file — no separate files. For a
  recording that could be:
  - a. raw sentence/utterance-level transcript
  - b. the same transcript reformatted/cleaned up by an LLM
  - c. the user's own personal notes
  - d. anything else the user wants

  This is **not recording-specific** — any note could expose extra views/tabs
  (e.g. the main note plus a side tab of related info the user types). The open
  questions are how to encode multiple views in one markdown file and how the
  editor surfaces them. Needs deeper design before any implementation.

## Troubleshooting

- **"Repository is not initialized. Connect a remote first."** — run **Connect repo** in Profiles settings.
- **"No matching Git credentials available…"** — check username/token for HTTPS, or generate an SSH key for SSH remotes.
- **SSH "Permission denied"** — for internet/manual SSH remotes, ensure the public key is authorized on the host.
- **Local sync unreachable** — keep Type open on desktop, stay on the same Wi-Fi/hotspot, and allow Local Network access on iOS.

## Contributing

Architecture, module map, and codebase patterns live in **[AGENTS.md](./AGENTS.md)**
(overview + both apps) and **[apps/desktop/src-tauri/README.md](apps/desktop/src-tauri/README.md)**
(Tauri shell). The shared Rust core (`crates/type-core`) is organized as
**domain / application / ports / adapters** across the `notes`, `profiles`, `security`,
`recordings`, `handwriting`, `import`, `git_sync`, and `local_sync` domains; the Tauri
shell adds `commands/`, and `crates/type-ffi` exposes the same use cases to React Native.
