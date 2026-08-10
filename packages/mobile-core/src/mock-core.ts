// In-memory RawCore implementation. Two consumers:
//
// 1. Tests — core-api and the app's stores run against it without native code.
// 2. Demo mode — when the generated turbo module isn't linked (Expo Go, CI,
//    simulators without a Rust toolchain), the app can boot against this and
//    stay fully interactive; the UI shows a "demo mode" banner.
//
// Behavior mirrors the Rust core where the UI can observe it (system folders,
// note lifecycle, pending → completed transcription statuses, the
// transcription_mode merge rule), but it is deliberately a toy: nothing
// persists, git operations only simulate success.

import type { FolderNode, NoteMeta, ProfileSettings } from "@typenotes/shared/types";

import type { RawCore, RawTranscriptionProvider } from "./raw-core";

type MockNote = {
  content: string;
  meta: NoteMeta;
};

const FEED = "Feed";
const ARCHIEVE = "Archieve"; // intentional typo, matches persisted data
const RECORDINGS = "Recordings"; // hidden storage folder
const ATTACHMENTS = "Attachments"; // hidden storage folder

const defaultProfileSettings = (): ProfileSettings => ({
  git_remote_url: "",
  git_branch: "main",
  git_username: "",
  git_password: "",
  git_commit_message: "Sync notes",
  git_trusted_ssh_host: "",
  git_trusted_ssh_host_key_sha256: "",
  git_iroh_ticket: "",
  mobile_auto_transcription_enabled: true,
  mobile_auto_handwriting_ocr_enabled: true,
  transcription_mode: null,
});

const defaultAppConfig = () => ({
  assemblyai_api_key: "",
  whisper_model: "large-v3",
  handwriting_ocr_provider: "local",
  local_ocr_model_path: "",
  openai_api_key: "",
  openai_model: "gpt-4.1-mini",
  huggingface_api_key: "",
  huggingface_model: "microsoft/trocr-base-handwritten",
  note_file_name_format: "utc_timestamp_slug",
});

const parentOf = (path: string) => {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
};

const nameOf = (path: string) => {
  const index = path.lastIndexOf("/");
  return index === -1 ? path : path.slice(index + 1);
};

const timestampSlug = (ms: number) =>
  new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z").replace(/:/g, "-");

export type MockCoreOptions = {
  /** Seed a few demo notes so the UI has content on first launch. */
  seed?: boolean;
  now?: () => number;
};

export const createMockCore = (options: MockCoreOptions = {}): RawCore => {
  const now = options.now ?? Date.now;

  let folders = new Set<string>([FEED, ARCHIEVE, RECORDINGS, ATTACHMENTS]);
  let notes = new Map<string, MockNote>();
  let audio = new Map<string, { base64: string; mimeType: string }>();
  let images = new Map<string, { base64: string; mimeType: string }>();
  let counter = 0;

  let profileSettings = defaultProfileSettings();
  let appConfig = defaultAppConfig();
  let commits: { id: string; summary: string; authored_ms: number }[] = [];
  let sshPublicKey: string | null = null;

  let security = {
    encryption_enabled: false,
    locked: false,
    auto_lock_on_background: false,
  };
  let unlockPassword = "";
  let panicPassword = "";

  const newNote = (folder: string, content: string, ms: number, extra?: Partial<NoteMeta>) => {
    counter += 1;
    folders.add(folder);
    const path = `${folder}/${timestampSlug(ms)}-note-${counter}.md`;
    notes.set(path, {
      content,
      meta: { created_ms: ms, updated_ms: ms, ...extra },
    });
    return path;
  };

  const seed = () => {
    if (!options.seed) {
      return;
    }
    const base = now();
    newNote(FEED, "Welcome to Type\n\nThis build is running the in-memory demo core — notes are not persisted.", base - 3 * 86_400_000);
    newNote(FEED, "Swipe up on this page to file it away and get a fresh blank page.", base - 86_400_000);
    newNote("Ideas", "Ship the mobile app.", base - 3_600_000);
  };
  seed();

  const buildTree = (): FolderNode => {
    const children = new Map<string, FolderNode>();
    const ensureFolderNode = (path: string): FolderNode => {
      if (!path) {
        throw new Error("root is built separately");
      }
      const existing = children.get(path);
      if (existing) {
        return existing;
      }
      const node: FolderNode = { name: nameOf(path), path, children: [], notes: [] };
      children.set(path, node);
      const parent = parentOf(path);
      if (parent) {
        ensureFolderNode(parent).children.push(node);
      }
      return node;
    };

    for (const folder of folders) {
      if (folder !== RECORDINGS && folder !== ATTACHMENTS) {
        ensureFolderNode(folder);
      }
    }
    for (const path of notes.keys()) {
      const parent = parentOf(path);
      if (parent === RECORDINGS) {
        continue;
      }
      ensureFolderNode(parent || FEED);
      children.get(parent || FEED)!.notes.push({ name: nameOf(path), path });
    }

    const sortNode = (node: FolderNode) => {
      node.children.sort((a, b) => a.name.localeCompare(b.name));
      node.notes.sort((a, b) => a.name.localeCompare(b.name));
      node.children.forEach(sortNode);
    };
    const root: FolderNode = {
      name: "",
      path: "",
      children: [...children.values()].filter((node) => !parentOf(node.path)),
      notes: [],
    };
    sortNode(root);
    return root;
  };

  const requireNote = (path: string): MockNote => {
    const note = notes.get(path);
    if (!note) {
      throw new Error(`Note not found: ${path}`);
    }
    return note;
  };

  const gitStatus = () => ({
    git_available: true,
    repo_initialized: profileSettings.git_remote_url !== "",
    current_branch: profileSettings.git_branch || "main",
    remote_url: profileSettings.git_remote_url || null,
    has_uncommitted_changes: false,
    push_required: false,
    ahead: 0,
    behind: 0,
    notes_root: "/demo/default/notes",
  });

  const profilesSnapshot = () =>
    JSON.stringify({
      active_profile_id: "default",
      profiles: [
        {
          id: "default",
          name: "Default",
          description: "",
          notes_root: "/demo/default/notes",
          settings: profileSettings,
        },
      ],
      app_config: appConfig,
    });

  const securityStateJson = () => JSON.stringify(security);

  const completeTranscriptions = async (
    transcribe: (audioPath: string) => Promise<string>
  ) => {
    let scanned = 0;
    let queued = 0;
    let skipped = 0;
    for (const [, note] of notes) {
      const status = note.meta.transcription_status;
      if (!note.meta.recording_audio_path || status === undefined) {
        continue;
      }
      scanned += 1;
      if (status === "completed") {
        skipped += 1;
        continue;
      }
      note.content = await transcribe(note.meta.recording_audio_path);
      note.meta.transcription_status = "completed";
      note.meta.transcription_updated_ms = now();
      note.meta.updated_ms = now();
      queued += 1;
    }
    return JSON.stringify({ scanned, queued, skipped, in_flight: 0 });
  };

  return {
    initCore: () => {},

    // ── Notes ──
    getTree: async () => JSON.stringify(buildTree()),
    readNote: async (path) => requireNote(path).content,
    createNote: async (argsJson) => {
      const args = JSON.parse(argsJson) as {
        folder_path?: string | null;
        content?: string | null;
        timestamp_ms?: number | null;
      };
      const path = newNote(
        args.folder_path || FEED,
        args.content ?? "",
        args.timestamp_ms ?? now()
      );
      return JSON.stringify({ path });
    },
    writeNote: async (path, content) => {
      const note = requireNote(path);
      note.content = content;
      note.meta.updated_ms = now();
    },
    setNoteTimestamp: async (argsJson) => {
      const args = JSON.parse(argsJson) as { path: string; timestamp_ms: number };
      requireNote(args.path).meta.created_ms = args.timestamp_ms;
    },
    updateNoteMarkers: async (argsJson) => {
      const args = JSON.parse(argsJson) as {
        path: string;
        archived?: boolean | null;
        reviewed?: boolean | null;
      };
      const meta = requireNote(args.path).meta;
      if (args.archived !== undefined && args.archived !== null) {
        meta.archived_ms = args.archived ? now() : null;
      }
      if (args.reviewed !== undefined && args.reviewed !== null) {
        meta.reviewed_ms = args.reviewed ? now() : null;
      }
    },
    getNoteMeta: async (path) => JSON.stringify(requireNote(path).meta),
    listNotePreviews: async (paths) =>
      JSON.stringify(
        paths
          .filter((path) => notes.has(path))
          .map((path) => ({
            path,
            content: notes.get(path)!.content,
            meta: notes.get(path)!.meta,
          }))
      ),
    moveItems: async (items, destination) => {
      folders.add(destination);
      for (const item of items) {
        if (notes.has(item)) {
          const note = notes.get(item)!;
          notes.delete(item);
          notes.set(`${destination}/${nameOf(item)}`, note);
          continue;
        }
        const moved = `${destination}/${nameOf(item)}`;
        for (const folder of [...folders]) {
          if (folder === item || folder.startsWith(`${item}/`)) {
            folders.delete(folder);
            folders.add(moved + folder.slice(item.length));
          }
        }
        for (const [path, note] of [...notes]) {
          if (path.startsWith(`${item}/`)) {
            notes.delete(path);
            notes.set(moved + path.slice(item.length), note);
          }
        }
      }
    },
    deleteItems: async (items) => {
      for (const item of items) {
        notes.delete(item);
        for (const folder of [...folders]) {
          if (folder === item || folder.startsWith(`${item}/`)) {
            folders.delete(folder);
          }
        }
        for (const path of [...notes.keys()]) {
          if (path.startsWith(`${item}/`)) {
            notes.delete(path);
          }
        }
      }
    },
    renameItem: async (path, newName) => {
      const parent = parentOf(path);
      const renamed = parent ? `${parent}/${newName}` : newName;
      if (notes.has(path)) {
        const note = notes.get(path)!;
        notes.delete(path);
        notes.set(renamed, note);
        return renamed;
      }
      for (const folder of [...folders]) {
        if (folder === path || folder.startsWith(`${path}/`)) {
          folders.delete(folder);
          folders.add(renamed + folder.slice(path.length));
        }
      }
      for (const [notePath, note] of [...notes]) {
        if (notePath.startsWith(`${path}/`)) {
          notes.delete(notePath);
          notes.set(renamed + notePath.slice(path.length), note);
        }
      }
      return renamed;
    },
    setOrder: async () => {},

    // ── Working folders ──
    getProfiles: async () => profilesSnapshot(),
    createProfile: async () => profilesSnapshot(),
    setActiveProfile: async () => profilesSnapshot(),
    setProfileNotesRoot: async () => profilesSnapshot(),
    updateProfile: async () => profilesSnapshot(),
    deleteProfile: async () => {
      throw new Error("Demo mode: the default working folder cannot be deleted.");
    },
    updateProfileSettings: async (argsJson) => {
      const args = JSON.parse(argsJson) as { settings: ProfileSettings };
      const incoming = { ...args.settings };
      // Mirror the core's merge rule: a writer that doesn't set a mode must
      // not clear one that is already persisted.
      if (incoming.transcription_mode === undefined || incoming.transcription_mode === null) {
        incoming.transcription_mode = profileSettings.transcription_mode;
      }
      profileSettings = incoming;
      return profilesSnapshot();
    },
    updateAppConfig: async (argsJson) => {
      const args = JSON.parse(argsJson) as { config: typeof appConfig };
      appConfig = args.config;
      return profilesSnapshot();
    },
    createProfilesBackupZip: async () => {
      throw new Error("Demo mode: backups need the native core.");
    },
    exportProfilesToDocuments: async () => {
      throw new Error("Demo mode: exports need the native core.");
    },

    // ── Git sync ──
    generateSshKey: async () => {
      sshPublicKey = "ssh-ed25519 AAAADEMOKEYnotesmobile demo@typenotes";
      return sshPublicKey;
    },
    getSshPublicKey: async () => sshPublicKey ?? undefined,
    deleteSshKey: async () => {
      sshPublicKey = null;
    },
    getGitStatus: async () => JSON.stringify(gitStatus()),
    getGitHistory: async () =>
      JSON.stringify(
        commits
          .slice()
          .reverse()
          .map((commit, index) => ({
            id: commit.id,
            short_id: commit.id.slice(0, 7),
            summary: commit.summary,
            author: "Demo",
            authored_ms: commit.authored_ms,
            sync_state: "synced",
            is_head: index === 0,
          }))
      ),
    connectGitRepo: async (argsJson) => {
      const args = JSON.parse(argsJson) as { remote_url?: string | null; branch?: string | null };
      profileSettings.git_remote_url = args.remote_url ?? profileSettings.git_remote_url;
      profileSettings.git_branch = args.branch ?? profileSettings.git_branch;
      return JSON.stringify(gitStatus());
    },
    gitPull: async () => JSON.stringify(gitStatus()),
    getGitSyncProgress: () =>
      JSON.stringify({
        phase: "idle",
        objects_done: 0,
        objects_total: 0,
        bytes: 0,
        remote_text: "",
      }),
    gitPush: async (argsJson) => {
      const args = JSON.parse(argsJson) as { message?: string | null };
      counter += 1;
      commits.push({
        id: `${counter}`.padStart(40, "0"),
        summary: args.message || profileSettings.git_commit_message,
        authored_ms: now(),
      });
      return JSON.stringify(gitStatus());
    },
    startIrohSyncClient: async (argsJson) => {
      const args = JSON.parse(argsJson) as { remote_url: string };
      return JSON.stringify({
        running: true,
        local_port: 19418,
        local_remote_url: args.remote_url.replace(
          /^(ssh:\/\/(?:[^@/]+@)?)(?:\[[^\]]+\]|[^/:]+)(?::\d+)?\//i,
          "$1127.0.0.1:19418/"
        ),
        endpoint_id: "demo-iroh-endpoint",
      });
    },
    archiveMobileAudioWithIroh: async () =>
      JSON.stringify({ scanned: audio.size, uploaded: 0, already_archived: audio.size }),
    setMobileAudioGitExclusion: async () => {},

    // ── Recordings ──
    saveAudioRecording: async (argsJson) => {
      const args = JSON.parse(argsJson) as {
        audio_base64: string;
        mime_type?: string | null;
        folder_path?: string | null;
      };
      counter += 1;
      const audioPath = `${RECORDINGS}/audio-${counter}.m4a`;
      audio.set(audioPath, {
        base64: args.audio_base64,
        mimeType: args.mime_type ?? "audio/mp4",
      });
      const notePath = newNote(args.folder_path || FEED, "", now(), {
        note_type: "audio_recording",
        recording_audio_path: audioPath,
        transcription_status: "pending",
        transcription_updated_ms: now(),
      });
      return JSON.stringify({
        folder_path: args.folder_path || FEED,
        note_path: notePath,
        audio_path: audioPath,
      });
    },
    queueRecordingTranscriptions: async () =>
      completeTranscriptions(async () => "(demo transcript)"),
    queueProviderTranscriptions: async (provider: RawTranscriptionProvider) =>
      completeTranscriptions((audioPath) => Promise.resolve(provider.transcribe(audioPath))),
    listRecordings: async () =>
      JSON.stringify({
        queue: {
          running: false,
          current_recording: null,
          pending: [],
          in_flight: 0,
          progress: null,
        },
        recordings: [...notes.entries()]
          .filter(([, note]) => note.meta.recording_audio_path)
          .map(([path, note]) => ({
            note_path: path,
            folder_path: parentOf(path),
            audio_path: note.meta.recording_audio_path ?? null,
            archived_on_desktop: false,
            status: note.meta.transcription_status ?? "pending",
            error: note.meta.transcription_error ?? null,
            updated_ms: note.meta.updated_ms,
            is_queued: false,
            is_processing: false,
          })),
      }),
    readRecordingAudio: async (path) => {
      const payload = audio.get(path);
      if (!payload) {
        throw new Error(`Audio not found: ${path}`);
      }
      return JSON.stringify({
        mime_type: payload.mimeType,
        audio_base64: payload.base64,
      });
    },
    pruneMobileAudioCache: async () =>
      JSON.stringify({
        scanned: audio.size,
        evicted: 0,
        already_evicted: 0,
        waiting_for_age: audio.size,
        waiting_for_transcription: 0,
        waiting_for_desktop_receipt: 0,
        waiting_for_git_migration: 0,
      }),

    // ── Photo attachments ──
    saveHandwritingAttachment: async (argsJson) => {
      const args = JSON.parse(argsJson) as {
        image_base64: string;
        mime_type?: string | null;
        folder_path?: string | null;
      };
      counter += 1;
      const attachmentPath = `${ATTACHMENTS}/attachment-${counter}.jpg`;
      images.set(attachmentPath, {
        base64: args.image_base64,
        mimeType: args.mime_type ?? "image/jpeg",
      });
      const folder = args.folder_path || FEED;
      const notePath = newNote(folder, "", now(), {
        note_type: "handwriting_attachment",
        handwriting_attachment_path: attachmentPath,
        ocr_status: "pending",
        ocr_updated_ms: now(),
      });
      return JSON.stringify({
        folder_path: folder,
        note_path: notePath,
        attachment_path: attachmentPath,
      });
    },

    // ── Security ──
    getSecurityState: async () => securityStateJson(),
    enableSecurity: async (argsJson) => {
      const args = JSON.parse(argsJson) as {
        unlock_password: string;
        panic_password: string;
      };
      security.encryption_enabled = true;
      unlockPassword = args.unlock_password;
      panicPassword = args.panic_password;
      return securityStateJson();
    },
    lockSecurity: async () => {
      if (security.encryption_enabled) {
        security.locked = true;
      }
      return securityStateJson();
    },
    unlockSecurity: async (argsJson) => {
      const args = JSON.parse(argsJson) as { password: string };
      if (security.encryption_enabled && args.password === panicPassword) {
        // Panic wipe: reset everything and reseed, like the real core.
        folders = new Set([FEED, ARCHIEVE, RECORDINGS, ATTACHMENTS]);
        notes = new Map();
        audio = new Map();
        images = new Map();
        commits = [];
        profileSettings = defaultProfileSettings();
        appConfig = defaultAppConfig();
        security = {
          encryption_enabled: false,
          locked: false,
          auto_lock_on_background: false,
        };
        unlockPassword = "";
        panicPassword = "";
        seed();
        return JSON.stringify({
          unlocked: false,
          panic_triggered: true,
          reset_required: true,
          message: null,
        });
      }
      const unlocked = !security.encryption_enabled || args.password === unlockPassword;
      if (unlocked) {
        security.locked = false;
      }
      return JSON.stringify({
        unlocked,
        panic_triggered: false,
        reset_required: false,
        message: unlocked ? null : "Invalid password.",
      });
    },
    setSecurityPreferences: async (argsJson) => {
      const args = JSON.parse(argsJson) as { auto_lock_on_background: boolean };
      security.auto_lock_on_background = args.auto_lock_on_background;
      return securityStateJson();
    },
  };
};
