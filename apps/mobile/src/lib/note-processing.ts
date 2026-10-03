import type { NotePreview } from "@typenotes/shared/format";
import type { NoteSummaryEntry, FolderNode, NoteEntry } from "@typenotes/shared/types";
import type { NoteRowSection } from "./feed";

export type PreviewValue = { version: string | null; preview: NotePreview };
export type PreviewChange = [string, PreviewValue];
export type NoteJob =
  | { kind: "summaries"; raw: string }
  | { kind: "tree"; raw: string }
  | { kind: "restore"; scope: string; raw: string }
  | { kind: "reset"; scope: string; workspace?: string }
  | { kind: "update"; scope: string; changes: PreviewChange[]; removed: string[] }
  | { kind: "snapshot"; scope: string }
  | { kind: "releaseFeed"; scope: string; key: string };
export type FeedJob = { kind: "feed"; scope: string; key: string; notes?: NoteEntry[]; filter: "all" | "active" | "archived"; now: number };
export type NoteJobResult = { changes?: PreviewChange[]; tree?: FolderNode; raw?: string; sections?: NoteRowSection[]; sectionTitles?: string[] };

declare global {
  // Lives in the worker's own runtime; React/Zustand objects are never captured.
  var __typePreviewCache: { scope: string; workspace?: string; notes: Record<string, [string | null, Omit<NotePreview, "dateLabel">]> } | undefined;
  var __typeFeedCache: Record<string, {
    scope: string; notes: NoteEntry[]; sections: Record<string, NoteRowSection>;
    rows: Record<string, { value: [string | null, Omit<NotePreview, "dateLabel">] | undefined; name: string; row: NoteRowSection["data"][number] }>;
    sorted: NoteRowSection["data"];
  }> | undefined;
}

/** Self-contained worklet: no native modules, React, Intl or module globals. */
export function processNoteJob(job: NoteJob | FeedJob): NoteJobResult {
  "worklet";
  if (job.kind === "tree") return { tree: JSON.parse(job.raw) as FolderNode };
  if (job.kind === "summaries") {
    const entries = JSON.parse(job.raw) as NoteSummaryEntry[];
    const changes: PreviewChange[] = entries.map((entry) => {
      const m = entry.meta;
      return [entry.path, { version: entry.version ?? null, preview: {
        title: entry.title, secondLine: entry.second_line, dateLabel: "", tags: m.tags ?? [],
        createdMs: m.created_ms, updatedMs: m.updated_ms,
        archivedMs: m.archived_ms ?? null, reviewedMs: m.reviewed_ms ?? null,
        isArchived: Boolean(m.archived_ms), isReviewed: Boolean(m.reviewed_ms),
        isRecording: m.note_type === "audio_recording" || Boolean(m.recording_audio_path?.trim()),
        isHandwriting: m.note_type === "handwriting_attachment" || Boolean(m.handwriting_attachment_path?.trim()),
        recordingAudioPath: m.recording_audio_path || null,
        handwritingAttachmentPath: m.handwriting_attachment_path || null,
        transcriptionStatus: m.transcription_status || null, ocrStatus: m.ocr_status || null,
      } }];
    });
    return { changes };
  }
  if (job.kind === "reset" || !globalThis.__typePreviewCache) {
    globalThis.__typePreviewCache = { scope: job.scope, workspace: job.kind === "reset" ? job.workspace : undefined, notes: Object.create(null) };
    globalThis.__typeFeedCache = Object.create(null);
  }
  const cache = globalThis.__typePreviewCache!;
  if (cache.scope !== job.scope) return {};
  if (job.kind === "releaseFeed") {
    if (globalThis.__typeFeedCache) delete globalThis.__typeFeedCache[job.key];
    return {};
  }
  if (job.kind === "feed") {
    globalThis.__typeFeedCache ??= Object.create(null);
    const feeds = globalThis.__typeFeedCache!;
    const held: (typeof feeds)[string] = feeds[job.key]?.scope === job.scope ? feeds[job.key] : { scope: job.scope, notes: [], sections: Object.create(null), rows: Object.create(null), sorted: [] };
    feeds[job.key] = held;
    if (job.notes) held.notes = job.notes;
    const changes: NoteRowSection["data"] = [];
    const nextRows: typeof held.rows = Object.create(null);
    const positions: Record<string, number> = Object.create(null);
    for (let index = 0; index < held.notes.length; index += 1) {
      const note = held.notes[index];
      positions[note.path] = index;
      const value = cache.notes[note.path];
      const stored = value?.[1];
      if (stored && ((job.filter === "active" && stored.isArchived) || (job.filter === "archived" && !stored.isArchived))) continue;
      const previous = held.rows[note.path];
      if (previous && previous.value === value && previous.name === note.name) {
        nextRows[note.path] = held.rows[note.path];
        continue;
      }
      const utc = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z-/.exec(note.name);
      const uuid = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-/i.exec(note.name);
      const date = utc ? Date.UTC(Number(utc[1]), Number(utc[2]) - 1, Number(utc[3]), Number(utc[4]), Number(utc[5]), Number(utc[6])) : uuid ? parseInt(uuid[1] + uuid[2], 16) : null;
      const base = note.name.replace(/\.md$/i, "");
      const title = base.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-/, "").replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-?/i, "").replace(/^[0-9a-f]{8}-/i, "").replace(/-+/g, " ").trim() || base;
      const preview: NotePreview = stored ? { ...stored, dateLabel: "" } : {
        title, secondLine: "", dateLabel: "", createdMs: date, updatedMs: null,
        archivedMs: null, reviewedMs: null, isArchived: false, isReviewed: false,
        isRecording: false, isHandwriting: false, recordingAudioPath: null,
        handwritingAttachmentPath: null, transcriptionStatus: null, ocrStatus: null,
      };
      const row = { path: note.path, preview, pending: !stored };
      nextRows[note.path] = { value, name: note.name, row };
      changes.push(row);
    }
    const timestamp = (row: NoteRowSection["data"][number]) => row.preview.createdMs ?? row.preview.updatedMs ?? 0;
    const compare = (a: NoteRowSection["data"][number], b: NoteRowSection["data"][number]) => timestamp(b) - timestamp(a) || positions[a.path] - positions[b.path];
    // Sort only changed rows, then merge them with the already sorted history.
    const retained = held.sorted.filter((row) => nextRows[row.path]?.row === row);
    if (changes.length > 1) changes.sort(compare);
    const rows: NoteRowSection["data"] = [];
    let oldIndex = 0, newIndex = 0;
    while (oldIndex < retained.length || newIndex < changes.length) {
      if (newIndex === changes.length || (oldIndex < retained.length && compare(retained[oldIndex], changes[newIndex]) <= 0)) rows.push(retained[oldIndex++]);
      else rows.push(changes[newIndex++]);
    }
    held.rows = nextRows;
    held.sorted = rows;
    const now = new Date(job.now);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const labels: Record<string, string> = Object.create(null);
    const sections: NoteRowSection[] = [];
    for (const row of rows) {
      const timestamp = row.preview.createdMs ?? row.preview.updatedMs ?? 0;
      const value = new Date(timestamp);
      const days = Math.round((today.getTime() - new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()) / 86_400_000);
      let title = "Undated";
      if (timestamp > 0) {
        if (days <= 0) title = "Today";
        else if (days === 1) title = "Yesterday";
        else {
          const key = days < 7 ? `w${value.getDay()}` : `m${value.getFullYear()}-${value.getMonth()}`;
          title = labels[key] ??= value.toLocaleDateString([], days < 7 ? { weekday: "long" } : value.getFullYear() === now.getFullYear() ? { month: "long" } : { month: "long", year: "numeric" });
        }
      }
      if (sections[sections.length - 1]?.title !== title) sections.push({ title, data: [] });
      sections[sections.length - 1].data.push(row);
    }
    const changed: NoteRowSection[] = [];
    const signatures: Record<string, NoteRowSection> = Object.create(null);
    for (const section of sections) {
      const previous = held.sections[section.title];
      const same = previous && previous.data.length === section.data.length && previous.data.every((row, index) => row === section.data[index]);
      signatures[section.title] = same ? previous : section;
      if (!same) changed.push(section);
    }
    held.sections = signatures;
    return { sections: changed, sectionTitles: sections.map((section) => section.title) };
  }
  if (job.kind === "restore") {
    const changes: PreviewChange[] = [];
    try {
      const file = JSON.parse(job.raw) as { format: number; workspace?: string; notes: typeof cache.notes };
      if (file?.format !== 2 || !file.notes || typeof file.notes !== "object" || Array.isArray(file.notes)) return { changes };
      if (cache.workspace !== undefined && file.workspace !== cache.workspace) return { changes };
      for (const [path, entry] of Object.entries(file.notes)) {
        if (!Array.isArray(entry)) continue;
        const [version, preview] = entry;
        if (typeof version !== "string" || !preview || typeof preview !== "object" ||
          typeof preview.title !== "string" || typeof preview.secondLine !== "string" ||
          typeof preview.isArchived !== "boolean" || typeof preview.isReviewed !== "boolean" ||
          !(preview.updatedMs === null || Number.isFinite(preview.updatedMs)) ||
          !(preview.createdMs === null || Number.isFinite(preview.createdMs))) continue;
        cache.notes[path] = [version, preview];
        changes.push([path, { version, preview: { ...preview, dateLabel: "" } }]);
      }
    } catch { /* Corrupt snapshots are a cache miss. */ }
    return { changes };
  }
  if (job.kind === "update") {
    for (const path of job.removed) delete cache.notes[path];
    for (const [path, { version, preview }] of job.changes) {
      const { dateLabel: _dateLabel, ...stored } = preview;
      cache.notes[path] = [version, stored];
    }
  }
  if (job.kind === "snapshot") {
    const notes = Object.create(null);
    for (const [path, entry] of Object.entries(cache.notes)) if (entry[0]) notes[path] = entry;
    return { raw: JSON.stringify({ format: 2, workspace: cache.workspace, notes }) };
  }
  return {};
}
