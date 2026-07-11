import { beforeEach, describe, expect, it } from "vitest";

import * as core from "./core-api";
import { createMockCore } from "./mock-core";
import { setRawCore } from "./raw-core";

describe("core-api over the mock core", () => {
  beforeEach(() => {
    setRawCore(createMockCore({ now: () => 1_750_000_000_000 }));
  });

  it("creates, writes, reads, and lists notes through the JSON boundary", async () => {
    const created = await core.createNote({ content: "hello" });
    expect(created.path.startsWith("Feed/")).toBe(true);
    expect(created.path.endsWith(".md")).toBe(true);

    await core.writeNote(created.path, "hello world");
    expect(await core.readNote(created.path)).toBe("hello world");

    const previews = await core.listNotePreviews([created.path]);
    expect(previews).toHaveLength(1);
    expect(previews[0].content).toBe("hello world");
    expect(previews[0].meta.created_ms).toBe(1_750_000_000_000);

    const tree = await core.getTree();
    const feed = tree.children.find((child) => child.path === "Feed");
    expect(feed?.notes.map((note) => note.path)).toContain(created.path);
    // The hidden Recordings storage folder is not part of the tree.
    expect(tree.children.map((child) => child.path)).not.toContain("Recordings");
  });

  it("moves and renames items", async () => {
    const created = await core.createNote({ content: "move me" });
    await core.moveItems([created.path], "Projects");
    const tree = await core.getTree();
    const projects = tree.children.find((child) => child.path === "Projects");
    expect(projects?.notes).toHaveLength(1);

    const moved = projects!.notes[0].path;
    const renamed = await core.renameItem(moved, "renamed.md");
    expect(renamed).toBe("Projects/renamed.md");
    expect(await core.readNote(renamed)).toBe("move me");
  });

  it("preserves a persisted transcription_mode when the writer omits it", async () => {
    let snapshot = await core.updateProfileSettings({
      profile_id: "default",
      settings: {
        ...(await core.getProfiles()).profiles[0].settings,
        transcription_mode: "desktop",
      },
    });
    expect(snapshot.profiles[0].settings.transcription_mode).toBe("desktop");

    const { transcription_mode: _dropped, ...withoutMode } =
      snapshot.profiles[0].settings;
    snapshot = await core.updateProfileSettings({
      profile_id: "default",
      settings: withoutMode,
    });
    expect(snapshot.profiles[0].settings.transcription_mode).toBe("desktop");
  });

  it("saves a recording as a pending note and completes it via a provider", async () => {
    const saved = await core.saveAudioRecording({
      audio_base64: "QUJD",
      mime_type: "audio/mp4",
    });
    expect(saved.audio_path.startsWith("Recordings/")).toBe(true);
    expect((await core.getNoteMeta(saved.note_path)).transcription_status).toBe(
      "pending"
    );

    const result = await core.queueProviderTranscriptions({
      id: () => "test-provider",
      transcribe: (audioPath) => `transcript of ${audioPath}`,
    });
    expect(result.queued).toBe(1);
    expect(await core.readNote(saved.note_path)).toBe(
      `transcript of ${saved.audio_path}`
    );
    expect((await core.getNoteMeta(saved.note_path)).transcription_status).toBe(
      "completed"
    );
  });

  it("saves a photo as a pending handwriting note without running OCR", async () => {
    const saved = await core.saveHandwritingAttachment({
      image_base64: "QUJD",
      mime_type: "image/jpeg",
      file_name: "page.jpg",
    });

    expect(saved.attachment_path.startsWith("Attachments/")).toBe(true);
    expect(await core.readNote(saved.note_path)).toBe("");
    const meta = await core.getNoteMeta(saved.note_path);
    expect(meta.note_type).toBe("handwriting_attachment");
    expect(meta.handwriting_attachment_path).toBe(saved.attachment_path);
    expect(meta.ocr_status).toBe("pending");
  });

  it("connects a git remote and records pushes in history", async () => {
    const status = await core.connectGitRepo({
      remote_url: "git@github.com:demo/notes.git",
    });
    expect(status.repo_initialized).toBe(true);

    await core.gitPush({ message: "First sync" });
    const history = await core.getGitHistory();
    expect(history[0].summary).toBe("First sync");
    expect(history[0].is_head).toBe(true);
  });

  it("throws a helpful error when the raw core is not wired", async () => {
    // @ts-expect-error — deliberately unset for this test
    setRawCore(null);
    await expect(core.getTree()).rejects.toThrow(/setRawCore/);
  });
});
