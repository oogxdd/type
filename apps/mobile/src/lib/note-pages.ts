import { CaptureSession, type CaptureStorage } from "./capture";

export type NotePageRequest = { path: string; paths: string[]; requestId: number };

export type NotePageStorage = CaptureStorage & {
  // null means deleted; storage/access errors must reject, never erase a draft.
  readNote(path: string): Promise<string | null>;
};

/** One paper surface, with a retained capture draft while browsing saved notes. */
export class NotePages {
  private draft: CaptureSession;
  session: CaptureSession;
  browsing = false;
  private paths: string[] = [];

  constructor(private storage: NotePageStorage) {
    this.draft = this.session = new CaptureSession(storage);
  }

  get nextPath(): string | null {
    const index = this.paths.indexOf(this.session.currentPath() ?? "");
    return index < 0 ? null : this.paths[index + 1] ?? null;
  }

  get previousPath(): string | null {
    const index = this.paths.indexOf(this.session.currentPath() ?? "");
    return index <= 0 ? null : this.paths[index - 1] ?? null;
  }

  async open(path: string, paths: string[]): Promise<void> {
    await this.session.flush();
    const content = await this.storage.readNote(path);
    if (content === null) throw new Error("This note no longer exists.");
    // Publish only after both saving and reading succeed. Failures retain the
    // previous page, including its dirty state so a later attempt can retry.
    this.session = new CaptureSession(this.storage, undefined, { path, content });
    this.paths = [...paths];
    this.browsing = true;
  }

  async returnToCapture(): Promise<void> {
    await this.session.flush();
    const path = this.draft.currentPath();
    if (path) {
      const content = await this.storage.readNote(path);
      this.draft = new CaptureSession(this.storage, undefined,
        content === null ? undefined : { path, content });
    }
    this.session = this.draft;
    this.paths = [];
    this.browsing = false;
  }

  async advance(step: number = 1): Promise<string | null> {
    if (!this.browsing && step < 0) return null;
    if (this.browsing) {
      const next = step < 0 ? this.previousPath : this.nextPath;
      if (next) await this.open(next, this.paths);
      return null;
    }
    const path = await this.session.commit();
    this.draft = this.session = new CaptureSession(this.storage);
    return path;
  }
}
