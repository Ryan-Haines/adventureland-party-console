export interface CodeRunner {
  start(): Promise<void>;
  dispose(): Promise<void>;
  canDispose?(): boolean;
}

export class ReloadBusyError extends Error {
  constructor() {
    super("Runner has an in-flight operation");
  }
}

/** Serializes updates, retaining the current runner until replacement is prepared. */
export class ReloadQueue {
  private current: CodeRunner | undefined;
  private generation = "";
  private pending: Promise<void> = Promise.resolve();

  reload(generation: string, prepare: () => Promise<CodeRunner>): Promise<void> {
    const task = this.pending.then(async () => {
      if (this.generation === generation) return;
      const next = await prepare();
      if (this.current?.canDispose?.() === false) {
        await next.dispose();
        throw new ReloadBusyError();
      }
      try {
        await this.current?.dispose();
        this.current = undefined;
        await next.start();
        this.current = next;
        this.generation = generation;
      } catch (error) {
        await next.dispose();
        throw error;
      }
    });
    this.pending = task.catch(() => undefined);
    return task;
  }

  async dispose(): Promise<void> {
    await this.pending;
    await this.current?.dispose();
    this.current = undefined;
    this.generation = "";
  }
}
