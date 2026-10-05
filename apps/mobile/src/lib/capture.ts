// The capture page's note lifecycle, kept free of React and React Native so
// it can be unit-tested. Mirrors the desktop editor's rules:
//
// - the note file is created lazily, on the first non-empty change
// - subsequent edits are debounced writes (against the created path)
// - committing (swipe up / navigating away) flushes pending writes
// - committing an *emptied* note deletes the file (empty-note cleanup)
//
// All storage calls are serialized on an internal chain so a slow createNote
// can never race a following write or delete.

export type CaptureStorage = {
  createNote(content: string): Promise<string>;
  writeNote(path: string, content: string, baseline?: string): Promise<void>;
  deleteNote(path: string, baseline?: string): Promise<void>;
  publishNote?(path: string, exists: boolean): Promise<void>;
  onSaveError?(error: unknown): void;
};

export const CAPTURE_DEBOUNCE_MS = 500;

export class CaptureSession {
  private path: string | null = null;
  private content = "";
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private savedContent = "";
  private savedRevision = 0;
  private publishedRevision = 0;
  private publication: Promise<void> = Promise.resolve();
  private flushing: Promise<void> | null = null;
  private disposed = false;

  constructor(
    private storage: CaptureStorage,
    private debounceMs: number = CAPTURE_DEBOUNCE_MS,
    initial?: { path: string; content: string }
  ) {
    this.path = initial?.path ?? null;
    this.content = initial?.content ?? "";
    this.savedContent = this.content;
  }

  /** The path of the note backing the current page, if one exists yet. */
  currentPath(): string | null {
    return this.path;
  }

  currentContent(): string {
    return this.content;
  }

  isDirty() { return this.dirty; }
  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.content = this.savedContent = "";
    this.dirty = false;
  }

  snapshot() { return { path: this.path, content: this.content, savedContent: this.savedContent, dirty: this.dirty }; }
  restore(value: ReturnType<CaptureSession["snapshot"]>) {
    this.path = value.path;
    this.content = value.content;
    this.savedContent = value.savedContent;
    this.dirty = value.dirty;
  }
  async saveCopy() {
    // Keep the old draft intact until the new file has reached disk.
    await (this.chain = this.chain.catch(() => {}).then(async () => {
      const content = this.content;
      const path = await this.storage.createNote(content);
      this.path = path;
      this.savedContent = content;
      this.dirty = content !== this.content;
      this.savedRevision += 1;
      this.publishedRevision = 0;
    }));
    void this.publishSaved().catch((error) => this.storage.onSaveError?.(error));
  }

  onChange(text: string) {
    if (this.disposed) return;
    if (text === this.content) return;
    this.content = text;
    this.dirty = true;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      // A background autosave failure must not become an unhandled rejection
      // (React Native can surface those as a fatal JS error). Keep the draft
      // dirty so the next explicit flush/commit can retry it.
      void this.flush().catch((error) => this.storage.onSaveError?.(error));
    }, this.debounceMs);
  }

  /** Persist the current content (creating the note on first flush). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // A new edit can arrive after the write loop exits but before the promise's
    // finally clears `flushing`. Joining that promise must flush the new edit.
    if (this.flushing) return this.flushing.then(() => this.dirty ? this.flush() : undefined);
    // A failed storage call used to leave `chain` permanently rejected, so
    // every later flush failed without retrying. Recover the queue boundary
    // while still returning this operation's own error to its caller.
    this.chain = this.chain.catch(() => {}).then(async () => {
      // Loop: content may change while a write is in flight.
      while (this.dirty) {
        const content = this.content;
        if (this.path && content === this.savedContent) {
          this.dirty = false;
          return;
        }
        if (!this.path && !content.trim()) {
          // Nothing worth creating yet.
          this.dirty = false;
          return;
        }
        if (!this.path) {
          this.path = await this.storage.createNote(content);
        } else {
          await this.storage.writeNote(this.path, content, this.savedContent);
        }
        if (this.disposed) return;
        this.savedContent = content;
        this.savedRevision += 1;
        this.dirty = content !== this.content;
      }
    });
    this.flushing = this.chain.finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** Publish saves once, including autosaves completed before this call. */
  async publish(): Promise<void> {
    await this.flush();
    return this.publishSaved();
  }

  private publishSaved(): Promise<void> {
    const path = this.path;
    const revision = this.savedRevision;
    this.publication = this.publication.catch(() => {}).then(async () => {
      if (!path || revision <= this.publishedRevision) return;
      await this.storage.publishNote?.(path, true);
      if (path === this.path) this.publishedRevision = revision;
    });
    return this.publication;
  }

  /**
   * Finish the current page: flush, delete the note if it ended up empty,
   * and reset for a fresh blank page. Returns the committed note's path,
   * or null when nothing was kept.
   */
  async commit(): Promise<string | null> {
    await this.flush();
    const path = this.path;
    const keep = Boolean(path) && Boolean(this.content.trim());
    if (path && !keep) {
      await (this.chain = this.chain
        .catch(() => {})
        .then(() => this.storage.deleteNote(path, this.savedContent)));
      void this.storage.publishNote?.(path, false).catch((error) => this.storage.onSaveError?.(error));
    } else {
      // Publication is a read-model update, never part of the durable write.
      void this.publishSaved().catch((error) => this.storage.onSaveError?.(error));
    }
    this.path = null;
    this.content = "";
    this.dirty = false;
    this.savedContent = "";
    this.publishedRevision = 0;
    return keep ? path : null;
  }
}
