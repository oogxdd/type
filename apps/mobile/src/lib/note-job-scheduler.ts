import type { FeedJob, NoteJob, NoteJobResult } from "./note-processing";

type Pending = { job: NoteJob | FeedJob; resolve: (result: NoteJobResult) => void; reject: (error: unknown) => void };
/** One worker call at a time; obsolete feed requests never build up a backlog. */
export class NoteJobScheduler {
  private queue: Pending[] = [];
  private running = false;
  constructor(private execute: (job: NoteJob | FeedJob) => Promise<NoteJobResult>) {}
  run = (job: NoteJob | FeedJob): Promise<NoteJobResult> => {
    if (job.kind === "feed") {
      const feed = job;
      const index = this.queue.findIndex((item) => item.job.kind === "feed" && item.job.scope === feed.scope && item.job.key === feed.key);
      if (index >= 0) {
        const old = this.queue.splice(index, 1)[0];
        if (old.job.kind === "feed" && !job.notes) job = { ...job, notes: old.job.notes };
        old.resolve({});
      }
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ job, resolve, reject });
      void this.drain();
    });
  };
  private priority(job: NoteJob | FeedJob) {
    return job.kind === "reset" ? 0 : job.kind === "update" || job.kind === "releaseFeed" ? 1 : job.kind === "feed" ? 3 : job.kind === "snapshot" ? 4 : 2;
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        this.queue.sort((a, b) => this.priority(a.job) - this.priority(b.job));
        const item = this.queue.shift()!;
        try { item.resolve(await this.execute(item.job)); }
        catch (error) { item.reject(error); }
      }
    } finally { this.running = false; }
  }
}
