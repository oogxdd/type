import type { GitSyncCycleResult } from "@typenotes/shared/types";
import { NotePages, type NotePageStorage } from "./note-pages";

export type WorkspaceToken = { profileId: string | null; notesRoot: string | null; generation: number };
export type RuntimeStatus = { operation: string | null; error: string | null };

/** App-owned drafts and task lifetimes. No React, native modules, or stores. */
export class MobileRuntime {
  private token: WorkspaceToken = { profileId: null, notesRoot: null, generation: 0 };
  private pages: NotePages | null = null;
  private active = new Set<Promise<unknown>>();
  private barrier: Promise<unknown> | null = null;
  private parking: Promise<void> | null = null;
  private flushingForSwitch = false;
  private listeners = new Set<() => void>();
  private status: RuntimeStatus = { operation: null, error: null };
  private sealed: { profileId: string | null; notesRoot: string | null; ciphertext: string } | null = null;
  onSaved: (reason: string, timing?: "edit" | "action" | "now") => void = () => {};
  onNotesChanged: (path: string, exists: boolean) => Promise<void> = async () => {};
  onRefreshNotes: () => Promise<void> = async () => {};
  onSyncChanges: (result: GitSyncCycleResult) => Promise<void> = async () => {};

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getStatus = () => this.status;
  saveError = (error: unknown) => this.report(null, error instanceof Error ? error.message : String(error));
  private report(operation: string | null, error: string | null = null) {
    this.status = { operation: this.barrier ? "Changing working folder" : this.parking ? "Locking" : operation, error };
    for (const listener of this.listeners) listener();
  }
  workspace = () => this.token;
  whenWorkspaceReady = () => this.barrier ?? Promise.resolve();
  isCurrent = (token: WorkspaceToken) => token === this.token;
  setWorkspace(profileId: string | null, notesRoot: string | null) {
    if (profileId === this.token.profileId && notesRoot === this.token.notesRoot) return;
    this.reset();
    this.token = { profileId, notesRoot, generation: this.token.generation };
  }
  reset() {
    this.pages?.dispose();
    this.pages = null;
    this.token = { ...this.token, generation: this.token.generation + 1 };
    this.report(null);
    this.sealed = null;
  }
  park(seal: (plaintext: string) => Promise<string>, close: () => Promise<void> = async () => {}) {
    if (this.parking) return this.parking;
    if (this.barrier) return Promise.reject(new Error("Working folder is changing. Try locking again when it finishes."));
    this.parking = this.parkDraft(seal, close).finally(() => {
      this.parking = null; this.report(null, this.status.error);
    });
    return this.parking;
  }
  private async parkDraft(seal: (plaintext: string) => Promise<string>, close: () => Promise<void>) {
    const token = this.token;
    this.report("Locking");
    try {
      try { await this.flushDurable(); } catch (error) { this.report("Locking", String(error)); }
      const pages = this.pages;
      let ciphertext: string | null = null;
      // Native input already queued before readonly applies can arrive while
      // sealing. Include that text rather than discarding a newer draft.
      while (pages) {
        const snapshot = pages.snapshot();
        if (!snapshot.draft.dirty && !snapshot.session.dirty) { ciphertext = null; break; }
        const plaintext = JSON.stringify(snapshot);
        ciphertext = await seal(plaintext);
        if (!this.isCurrent(token)) throw new Error("Working folder changed while locking.");
        if (JSON.stringify(pages.snapshot()) === plaintext) break;
      }
      if (!this.isCurrent(token)) throw new Error("Working folder changed while locking.");
      this.reset();
      this.report("Locking");
      if (ciphertext) this.sealed = { profileId: token.profileId, notesRoot: token.notesRoot, ciphertext };
      await close();
      this.report(null);
    } catch (error) { this.report(null, String(error)); throw error; }
  }
  async resume(storage: NotePageStorage, open: (ciphertext: string) => Promise<string>) {
    const value = this.sealed;
    if (!value) return;
    if (value.profileId !== this.token.profileId || value.notesRoot !== this.token.notesRoot) throw new Error("Recovery draft belongs to a different working folder.");
    const token = this.token;
    const snapshot = JSON.parse(await open(value.ciphertext)) as ReturnType<NotePages["snapshot"]>;
    if (!this.isCurrent(token)) return;
    this.capture(storage).restore(snapshot);
    this.sealed = null;
    this.saveError("An unsaved draft was recovered. Retry saving or save a copy.");
  }
  async saveCopy() {
    await this.pages?.session.saveCopy();
    this.report(null);
  }
  capture(storage: NotePageStorage) { return this.pages ??= new NotePages(storage); }
  async track<T>(work: () => Promise<T>, token = this.token, durableWrite = false): Promise<T> {
    if (!this.isCurrent(token)) throw new Error("Working folder changed.");
    if (this.barrier && !(durableWrite && this.flushingForSwitch)) throw new Error("Working folder is changing. Try again when it finishes.");
    const pending = work();
    this.active.add(pending);
    try { return await pending; }
    finally { this.active.delete(pending); }
  }
  flushDurable = async () => { await this.pages?.flush(); };
  requestSave = () => {
    const token = this.token;
    void this.flushDurable().then(() => {
      if (!this.isCurrent(token)) return;
      if (!this.barrier) this.report(null);
      void this.pages?.publish().catch((error) => {
        if (this.isCurrent(token)) this.report(null, String(error));
      });
    }).catch((error) => {
      if (this.isCurrent(token)) this.report(null, String(error));
    });
  };
  /** Stop admission and drain actual native calls before changing global root. */
  changeWorkspace<T>(work: () => Promise<T>): Promise<T> {
    if (this.parking) return Promise.reject(new Error("The app is locking. Try again after unlocking."));
    if (this.barrier) return Promise.reject(new Error("A working folder change is already running."));
    this.report("Changing working folder");
    this.flushingForSwitch = true;
    const operation = (async () => {
      // Flush before closing admission: the flush itself submits native writes.
      try { await this.flushDurable(); }
      finally { this.flushingForSwitch = false; }
      // Flush may queue an autosave. Drain until there is no admitted work.
      while (this.active.size) await Promise.allSettled([...this.active]);
      return work();
    })();
    const completion = operation.then((value) => { this.report(null); return value; }, (error) => {
      this.report(null, String(error)); throw error;
    }).finally(() => { this.barrier = null; this.report(null, this.status.error); });
    this.barrier = completion;
    return completion;
  }
}
