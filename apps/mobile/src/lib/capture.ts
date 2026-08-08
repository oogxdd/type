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
  writeNote(path: string, content: string): Promise<void>;
  deleteNote(path: string): Promise<void>;
};

export const CAPTURE_DEBOUNCE_MS = 500;

export class CaptureSession {
  private path: string | null = null;
  private content = "";
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private storage: CaptureStorage,
    private debounceMs: number = CAPTURE_DEBOUNCE_MS
  ) {}

  /** The path of the note backing the current page, if one exists yet. */
  currentPath(): string | null {
    return this.path;
  }

  onChange(text: string) {
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
      void this.flush().catch(() => {});
    }, this.debounceMs);
  }

  /** Persist the current content (creating the note on first flush). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // A failed storage call used to leave `chain` permanently rejected, so
    // every later flush failed without retrying. Recover the queue boundary
    // while still returning this operation's own error to its caller.
    this.chain = this.chain.catch(() => {}).then(async () => {
      // Loop: content may change while a write is in flight.
      while (this.dirty) {
        const content = this.content;
        if (!this.path && !content.trim()) {
          // Nothing worth creating yet.
          this.dirty = false;
          return;
        }
        if (!this.path) {
          this.path = await this.storage.createNote(content);
        } else {
          await this.storage.writeNote(this.path, content);
        }
        this.dirty = content !== this.content;
      }
    });
    return this.chain;
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
        .then(() => this.storage.deleteNote(path)));
    }
    this.path = null;
    this.content = "";
    this.dirty = false;
    return keep ? path : null;
  }
}
