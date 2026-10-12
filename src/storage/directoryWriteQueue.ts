interface Job<T> { key: object; run: () => Promise<T>; waiters: { resolve: (value: T) => void; reject: (error: unknown) => void }[] }
interface Target<T> { handle: FileSystemDirectoryHandle; running: boolean; jobs: Job<T>[] }

/** Handle identity, rather than project ID, defines a destination. Only not-started jobs can merge. */
export class DirectoryWriteQueue<T> {
  private targets: Target<T>[] = [];
  private resolution: Promise<unknown> = Promise.resolve();

  enqueue(handle: FileSystemDirectoryHandle, key: object, run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Serialize alias detection so two isSameEntry awaits cannot create competing queues.
      const added = this.resolution.catch(() => undefined).then(async () => {
        let target: Target<T> | undefined;
        for (const candidate of this.targets) {
          if (candidate.handle === handle || typeof handle.isSameEntry === 'function' && await handle.isSameEntry(candidate.handle)) { target = candidate; break; }
        }
        if (!target) { target = { handle, running: false, jobs: [] }; this.targets.push(target); }
        const last = target.jobs.at(-1);
        if (last?.key === key) { last.run = run; last.waiters.push({ resolve, reject }); }
        else target.jobs.push({ key, run, waiters: [{ resolve, reject }] });
        if (!target.running) { target.running = true; void this.drain(target); }
      });
      this.resolution = added;
      void added.catch(reject);
    });
  }

  private async drain(target: Target<T>): Promise<void> {
    try {
      for (let job = target.jobs.shift(); job; job = target.jobs.shift()) {
        try { const value = await job.run(); for (const waiter of job.waiters) waiter.resolve(value); }
        catch (error) { for (const waiter of job.waiters) waiter.reject(error); }
      }
    } finally {
      target.running = false;
      this.targets = this.targets.filter((candidate) => candidate !== target);
    }
  }
}
