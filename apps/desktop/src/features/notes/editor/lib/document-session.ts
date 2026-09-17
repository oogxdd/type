import { NoteReadQueue } from "./note-read-queue";
import { getErrorMessage } from "@typenotes/shared/errors";

export type SessionDocument = {
  content: string;
  loaded: boolean;
  loading: boolean;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  edited: boolean;
  version: number;
};
type DocumentIO = {
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  saved?: (path: string) => void;
  leave?: (path: string, content: string, edited: boolean) => Promise<void>;
  needsFinalization?: (path: string, content: string, edited: boolean) => boolean;
};

/** A profile/root owns one session. Drafts and queued writes always retain their path. */
export class DocumentSession {
  readonly documents = new Map<string, SessionDocument>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private readQueue = new NoteReadQueue();
  private finalizationQueue = new NoteReadQueue(2);
  private documentListeners = new Map<string, Set<() => void>>();
  private documentRevisions = new Map<string, number>();
  subscribeDocument = (path: string, listener: () => void) => {
    const listeners = this.documentListeners.get(path) ?? new Set<() => void>();
    this.documentListeners.set(path, listeners);
    listeners.add(listener);
    return () => { listeners.delete(listener); if (!listeners.size) this.documentListeners.delete(path); };
  };
  documentSnapshot = (path: string) => this.documentRevisions.get(path) ?? 0;
  editorSnapshot = (path: string | null) => {
    const entries = [...this.documents];
    return JSON.stringify([
      path ? this.documentSnapshot(path) : 0,
      entries.filter(([, entry]) => entry.saving).length,
      entries.filter(([, entry]) => entry.dirty).length,
      entries.filter(([, entry]) => entry.error).map(([key, entry]) => [key, entry.error]),
    ]);
  };
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private reads = new Map<string, Promise<void>>();
  private writes = new Map<string, Promise<void>>();
  private departures = new Map<string, Promise<void>>();
  private selected = new Set<string>();
  private closed = false;
  constructor(private io: DocumentIO) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  snapshot = () => this.revision;
  private notify(path: string) {
    this.revision++;
    this.documentRevisions.set(path, this.documentSnapshot(path) + 1);
    this.documentListeners.get(path)?.forEach((listener) => listener());
    this.listeners.forEach((listener) => listener());
  }
  private entry(path: string) {
    let entry = this.documents.get(path);
    if (!entry) {
      entry = { content: "", loaded: false, loading: false, dirty: false,
        saving: false, error: null, edited: false, version: 0 };
      this.documents.set(path, entry);
    }
    return entry;
  }
  async load(path: string, refresh = false, priority = false): Promise<void> {
    if (this.closed) return;
    const entry = this.entry(path);
    if (entry.dirty || entry.saving || (entry.loaded && !refresh)) return;
    const pending = this.reads.get(path);
    if (pending) { if (priority) this.readQueue.prioritize(path); return pending; }
    const version = entry.version;
    entry.loading = true;
    entry.error = null;
    this.notify(path);
    const read = this.readQueue.read(path, () => this.io.read(path), priority).then((content) => {
      if (content === undefined || this.documents.get(path) !== entry) return;
      if (!this.closed && !entry.dirty && !entry.saving && entry.version === version) {
        entry.content = content;
        entry.loaded = true;
      }
    }).catch((error: unknown) => {
      if (!this.closed && this.documents.get(path) === entry && entry.version === version) entry.error = getErrorMessage(error);
    }).finally(() => {
      this.reads.delete(path);
      entry.loading = false;
      if (!this.closed) {
        this.notify(path);
        const current = this.documents.get(path);
        // A queued read can be cancelled and immediately reselected (or replayed
        // by StrictMode). Start the current request after the old one settles.
        if (this.selected.has(path) && current && !current.loaded && !current.error && !current.dirty) void this.load(path);
      }
    });
    this.reads.set(path, read);
    return read;
  }
  change = (path: string, content: string) => {
    if (this.closed) return;
    const entry = this.entry(path);
    Object.assign(entry, { content, loaded: true, dirty: true, edited: true, error: null });
    entry.version++;
    this.cancelTimer(path);
    this.timers.set(path, setTimeout(() => {
      this.timers.delete(path);
      void this.flush(path).catch(() => { /* Keep the failed draft for retry. */ });
    }, 400));
    this.notify(path);
  };
  prime(path: string, content: string) {
    if (this.closed) return;
    this.cancelTimer(path);
    const entry = this.entry(path);
    entry.version++;
    Object.assign(entry, { content, loaded: true, dirty: false, error: null });
    this.notify(path);
  }
  private cancelTimer(path: string) {
    clearTimeout(this.timers.get(path));
    this.timers.delete(path);
  }
  flush = async (path: string): Promise<void> => {
    this.cancelTimer(path);
    if (this.closed) return;
    const pending = this.writes.get(path);
    if (pending) {
      await pending;
      return this.flush(path);
    }
    const entry = this.documents.get(path);
    if (!entry?.dirty) return;
    const content = entry.content;
    entry.saving = true;
    entry.error = null;
    this.notify(path);
    const write = this.io.write(path, content).then(() => {
      // Notify while saving so our own preview event cannot reload this document.
      this.io.saved?.(path);
      if (entry.content === content) entry.dirty = false;
    }).catch((error: unknown) => {
      entry.error = getErrorMessage(error);
      throw error;
    }).finally(() => {
      entry.saving = false;
      this.writes.delete(path);
      if (!this.closed) this.notify(path);
    });
    this.writes.set(path, write);
    await write;
    if (entry.dirty && !this.closed) await this.flush(path);
  };
  flushAll = async () => {
    const results = await Promise.allSettled([
      ...[...this.documents.keys()].map((path) => this.flush(path)),
      ...this.departures.values(),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
  select(paths: string[]) {
    const previous = this.selected;
    this.selected = new Set(paths);
    this.readQueue.cancelExcept(this.selected);
    for (const path of paths) void this.load(path);
    for (const path of previous) {
      if (!this.selected.has(path)) void this.leave(path).catch(() => {});
    }
  }
  private leave(path: string): Promise<void> {
    const pending = this.departures.get(path);
    if (pending) return pending;
    const departure = (async () => {
      await this.flush(path);
      const entry = this.documents.get(path);
      if (this.closed || this.selected.has(path)) return;
      if (!entry?.loaded) { this.documents.delete(path); return; }
      if (this.io.needsFinalization && !this.io.needsFinalization(path, entry.content, entry.edited)) {
        this.documents.delete(path);
        return;
      }
      // A move/deletion may already have removed this file. Do not recreate it.
      try {
        const existing = await this.finalizationQueue.read(path, () => this.io.read(path));
        if (existing === undefined) return;
      } catch { this.documents.delete(path); return; }
      if (this.closed || this.selected.has(path)) return;
      await this.io.leave?.(path, entry.content, entry.edited);
      if (!this.selected.has(path)) this.documents.delete(path);
    })().catch((error: unknown) => {
      const entry = this.documents.get(path);
      if (entry) entry.error = getErrorMessage(error);
      throw error;
    }).finally(() => {
      this.departures.delete(path);
      if (!this.closed) this.notify(path);
    });
    this.departures.set(path, departure);
    return departure;
  }
  refresh(path?: string) {
    for (const current of this.selected) {
      if (!path || current === path) void this.load(current, true);
    }
  }
  activate() { this.closed = false; }
  dispose() {
    this.closed = true;
    this.readQueue.dispose();
    this.finalizationQueue.dispose();
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
}
