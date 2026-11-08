/** Recorder lifetime and durable imports are independent of button renders. */
export type PendingRecording = {
  id: string;
  uri: string;
  profileId: string;
  notesRoot: string;
  mimeType: string;
  startedAt: number;
  notePath?: string;
};

export type RecordingSessionDeps = {
  prepare(): Promise<void>;
  makePending(): PendingRecording;
  remember(clip: PendingRecording): void;
  record(): void;
  pause(): void;
  stop(): Promise<void>;
  save(clip: PendingRecording): Promise<string>;
  forget(clip: PendingRecording): void;
  hold(): () => void;
  changed(startedAt: number | null): void;
  saved(clip: PendingRecording, interrupted: boolean): void;
  error(error: unknown): void;
};

export class RecordingSession {
  private prepared = false;
  private preparing: Promise<void> | null = null;
  private starting: Promise<void> | null = null;
  private stopping: Promise<void> | null = null;
  private current: PendingRecording | null = null;
  private release: (() => void) | null = null;
  private imports = new Map<string, Promise<void>>();
  private failed = new Map<string, PendingRecording>();
  private disposed = false;

  constructor(private deps: RecordingSessionDeps) {}

  get ready() { return this.prepared && !this.stopping; }

  get recording() { return this.current !== null || this.starting !== null; }

  warm(): Promise<void> {
    if (this.disposed || this.prepared || this.current) return Promise.resolve();
    if (this.preparing) return this.preparing;
    this.preparing = this.deps.prepare().then(() => { this.prepared = true; })
      .finally(() => { this.preparing = null; });
    return this.preparing;
  }

  start(): Promise<void> {
    if (this.disposed || this.recording) return this.starting ?? Promise.resolve();
    const begin = () => {
      const clip = this.deps.makePending();
      // Synchronous durable journal precedes native record: no startup crash gap.
      this.deps.remember(clip);
      this.release = this.deps.hold();
      try { this.deps.record(); }
      catch (error) { this.release(); this.release = null; throw error; }
      this.prepared = false;
      this.current = clip;
      this.deps.changed(clip.startedAt);
    };
    if (this.prepared && !this.stopping) {
      try { begin(); return Promise.resolve(); }
      catch (error) { this.deps.error(error); return Promise.resolve(); }
    }
    // A second tap during initial permission/preparation still requests a stop.
    this.starting = (async () => {
      await this.stopping;
      await this.warm();
      if (!this.disposed) begin();
    })().catch(this.deps.error).finally(() => { this.starting = null; });
    return this.starting;
  }

  stop(interrupted = false): Promise<void> {
    if (this.stopping) return this.stopping;
    const finish = async () => {
      if (this.starting) await this.starting;
      const clip = this.current;
      if (!clip) return;
      const release = this.release!;
      // pause is synchronous; cut off capture before any promise/storage work.
      const saveRelease = this.deps.hold();
      try { this.deps.pause(); } catch (error) { saveRelease(); throw error; }
      release();
      this.current = null;
      this.release = null;
      this.deps.changed(null);
      try {
        await this.deps.stop();
        void this.import(clip, interrupted, saveRelease);
      } catch (error) {
        this.failed.set(clip.id, clip);
        saveRelease();
        this.deps.error(error);
      }
    };
    this.stopping = finish().catch(this.deps.error).finally(() => {
      this.stopping = null;
      if (!this.disposed) void this.warm().catch(() => {});
    });
    return this.stopping;
  }

  import(clip: PendingRecording, interrupted = true, held?: () => void): Promise<void> {
    const existing = this.imports.get(clip.id);
    if (existing) { held?.(); return existing; }
    const release = held ?? this.deps.hold();
    const work = (async () => {
      try {
        if (!clip.notePath) {
          clip.notePath = await this.deps.save(clip);
          this.deps.remember(clip);
        }
        this.deps.forget(clip);
        this.failed.delete(clip.id);
        this.deps.saved(clip, interrupted);
      } catch (error) {
        this.failed.set(clip.id, clip);
        this.deps.error(error);
      } finally { release(); }
    })().finally(() => { this.imports.delete(clip.id); });
    this.imports.set(clip.id, work);
    return work;
  }

  retry(): boolean {
    const pending = this.failed.size > 0;
    for (const clip of this.failed.values()) void this.import(clip);
    return pending;
  }

  dispose() {
    this.disposed = true;
    void this.stop(true).catch(this.deps.error);
  }
}
