export interface ResourceLog {
  cleanupFailed(name: string, error: unknown): void;
}

/** Resources are acquired explicitly and released once in reverse startup order. */
export function createResources(log: ResourceLog) {
  const resources: { name: string; release(): void | Promise<void> }[] = [];
  let closing: Promise<void> | undefined;

  async function releaseAll(): Promise<void> {
    for (const resource of resources.reverse()) {
      try {
        await resource.release();
      } catch (error) {
        log.cleanupFailed(resource.name, error);
      }
    }
    resources.length = 0;
  }

  return {
    add(name: string, release: () => void | Promise<void>): void {
      if (closing) throw new Error("Cannot acquire " + name + " during coordinator shutdown");
      resources.push({ name, release });
    },
    close(): Promise<void> {
      closing ??= Promise.resolve().then(releaseAll);
      return closing;
    },
  };
}
