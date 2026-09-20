import { watch, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import path from "node:path";
import {
  digest,
  verifyManifest,
  type GameManifest,
  type CharacterClass,
} from "../../tools/game/manifest.ts";
import { requestReload } from "./request-reload.ts";

export function classScript(directory: string, className: string | undefined): string {
  const manifest = JSON.parse(
    readFileSync(path.join(directory, "manifest.json"), "utf8"),
  ) as GameManifest;
  const entry = manifest.classes?.[className as CharacterClass];
  if (manifest.schema !== 1 || !entry || !/^generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(entry.file))
    throw new Error("Missing compiled class: " + className);
  if (digest(readFileSync(path.join(directory, entry.file))) !== entry.sha256)
    throw new Error("Compiled class checksum mismatch: " + className);
  return "adventure_land/" + entry.file;
}
interface Worker {
  name: string;
  className?: string;
  process: ChildProcess;
  script?: string;
}
interface GenerationPorts {
  directory: string;
  workers(): Worker[];
  current(worker: Worker): boolean | undefined;
  activated(worker: Worker, script: string): void;
  restart(worker: Worker, script: string, reason: string): Promise<void>;
  report(message: string, detail?: unknown): void;
}

/** Watches the manifest's directory because atomic replacement changes its inode. */
export function watchGenerations(ports: GenerationPorts): { dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false,
    pending = false,
    disposed = false;
  async function refresh(): Promise<void> {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      do {
        pending = false;
        const manifest = await verifyManifest(
          ports.directory,
          JSON.parse(await readFile(path.join(ports.directory, "manifest.json"), "utf8")),
        );
        await Promise.all(
          ports.workers().map(async (worker) => {
            const entry = manifest.classes[worker.className as CharacterClass];
            if (!entry) return;
            const script = "adventure_land/" + entry.file;
            if (worker.script === script || !ports.current(worker)) return;
            const result = await requestReload(worker.process, entry.sha256, 15000, script);
            if (!ports.current(worker) || disposed) return;
            if (result.status === "ready") {
              ports.activated(worker, script);
              ports.report("CODE updated without reconnecting", {
                character: worker.name,
                generation: entry.sha256,
              });
            } else if (result.status === "busy") schedule(2000);
            else if (result.restartRequired)
              await ports.restart(worker, script, result.error || "CODE reload failed");
            else
              ports.report("CODE update rejected; current runner retained", {
                character: worker.name,
                error: result.error,
              });
          }),
        );
      } while (pending && !disposed);
    } catch (error) {
      ports.report("Invalid game generation; current runners retained", String(error));
    } finally {
      running = false;
    }
  }
  function schedule(delay = 150): void {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), delay);
  }
  const watcher = watch(ports.directory, (_event, file) => {
    if (file?.toString() === "manifest.json") schedule();
  });
  watcher.on("error", (error) => ports.report("Game manifest watcher failed", String(error)));
  return {
    dispose() {
      disposed = true;
      watcher.close();
      clearTimeout(timer);
    },
  };
}
