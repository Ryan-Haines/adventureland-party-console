interface ShutdownPorts {
  log(message: string): void;
  stopCharacters(): Promise<void>;
  closeStorage(): void;
  exit(): void;
}

/** Signals and supervisor messages share one shutdown operation. */
export function createShutdown(ports: ShutdownPorts) {
  let started = false;
  return async function shutdown(signal: string): Promise<void> {
    if (started) return;
    started = true;
    ports.log(`Received ${signal} on master. Rounding up clients`);
    await ports.stopCharacters();
    ports.log("now truly exiting");
    ports.closeStorage();
    ports.exit();
  };
}
