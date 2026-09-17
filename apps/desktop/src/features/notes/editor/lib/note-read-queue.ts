type PendingRead = { path: string; run: () => Promise<string>; resolve: (value: string | undefined) => void; reject: (error: unknown) => void };

/** Bound IPC pressure and yield between completions so input can run. */
export class NoteReadQueue {
  private pending: PendingRead[] = [];
  private running = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(private concurrency = 3) {}
  read(path: string, run: () => Promise<string>, priority = false) {
    const result = new Promise<string | undefined>((resolve, reject) => {
      const task = { path, run, resolve, reject };
      if (priority) this.pending.unshift(task);
      else this.pending.push(task);
    });
    this.pump();
    return result;
  }
  prioritize(path: string) {
    const index = this.pending.findIndex((task) => task.path === path);
    if (index > 0) this.pending.unshift(...this.pending.splice(index, 1));
  }
  cancelExcept(paths: Set<string>) {
    this.pending = this.pending.filter((task) => {
      if (paths.has(task.path)) return true;
      task.resolve(undefined);
      return false;
    });
  }
  private pump() {
    while (this.running < this.concurrency && this.pending.length) {
      const task = this.pending.shift()!;
      this.running++;
      void Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => {
        this.running--;
        if (this.timer === undefined) this.timer = setTimeout(() => {
          this.timer = undefined;
          this.pump();
        }, 0);
      });
    }
  }
  dispose() {
    this.cancelExcept(new Set());
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
