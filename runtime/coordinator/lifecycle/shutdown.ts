interface ShutdownPorts {
  log(message: string): void;
  stopCharacters(): Promise<void>;
  closeStorage(): void | Promise<void>;
  exit(): void;
  /** True after the console's clean shutdown flushed state; see console-control.ts. */
  prepared?(): boolean;
}
/** tools/hosting/start.mts force-exits 15 s after SIGTERM, before storage closes if workers are slow. */
const PREPARED_STOP_MS = 5000;

/** Signals and supervisor messages share one shutdown operation. */
export function createShutdown(ports: ShutdownPorts) {
  let started = false;
  return async function shutdown(signal: string): Promise<void> {
    if (started) return;
    started = true;
    ports.log(`Received ${signal} on master. Rounding up clients`);
    const stopping = ports.stopCharacters();
    // A prepared shutdown already saved its state, so it bounds the worker
    // wait and the writer lock is released before the host's forced exit.
    if (ports.prepared?.()) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([stopping, new Promise<void>(resolve => { timer = setTimeout(resolve, PREPARED_STOP_MS); })]);
      clearTimeout(timer);
    } else await stopping;
    ports.log("now truly exiting");
    await ports.closeStorage();
    ports.exit();
  };
}
