import { watch, readFileSync, statSync } from "node:fs";
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
  let manifest: GameManifest;
  try {
    const activation = JSON.parse(readFileSync(path.join(directory,'activation.json'),'utf8')) as {id:string;manifest:GameManifest};
    if (typeof activation.id !== 'string' || !activation.id) throw Error('Invalid CODE activation');
    manifest = activation.manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    manifest = JSON.parse(readFileSync(path.join(directory,"manifest.json"),"utf8")) as GameManifest;
  }
  const entry = manifest.classes?.[className as CharacterClass];
  if (manifest.schema !== 1 || !entry || !/^generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(entry.file))
    throw new Error("Missing compiled class: " + className);
  if (!verifiedClass(path.join(directory, entry.file), entry.sha256))
    throw new Error("Compiled class checksum mismatch: " + className);
  return "adventure_land/" + entry.file;
}

// The merchant's home check reaches classScript on every dispatch, through
// ensureCharacterBlock and worker setup. classScript hashes a verified file again
// only when its inode, size, mtime or ctime changes, which every rewrite does.
// The cache holds at most 32 files; a full cache starts over.
const verifiedClasses = new Map<string, string>();
function verifiedClass(file: string, sha256: string): boolean {
  let identity: string | undefined;
  try {
    const stat = statSync(file, { bigint: true });
    identity = [stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs, sha256].join(":");
  } catch {
    // The read below throws the same error v1.4.0 reported for a missing file.
  }
  if (identity !== undefined && verifiedClasses.get(file) === identity) return true;
  verifiedClasses.delete(file);
  if (digest(readFileSync(file)) !== sha256) return false;
  if (identity === undefined) return true;
  if (verifiedClasses.size >= 32) verifiedClasses.clear();
  verifiedClasses.set(file, identity);
  return true;
}
interface Worker {
  name: string;
  className?: string;
  process: ChildProcess;
  script?: string;
}
interface GenerationPorts {
  directory: string;
  activationFile?: string;
  workers(): Worker[];
  current(worker: Worker): boolean | undefined;
  activated(worker: Worker, script: string): void;
  restart(worker: Worker, script: string, reason: string): Promise<void>;
  report(message: string, detail?: unknown): void;
}

/** Managed consoles consume explicit host activation records; standalone development may watch. */
export function watchGenerations(ports: GenerationPorts): { dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false,
    pending = false,
    disposed = false;
  let activation: {id: string; manifest: GameManifest} | undefined;
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
          ports.activationFile ? activation!.manifest : JSON.parse(await readFile(path.join(ports.directory, "manifest.json"), "utf8")),
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
  const watcher = ports.activationFile ? undefined : watch(ports.directory, (_event, file) => {
    if (file?.toString() === "manifest.json") schedule();
  });
  watcher?.on("error", (error) => ports.report("Game manifest watcher failed", String(error)));
  let reading = false;
  const activationPoll = ports.activationFile ? setInterval(async () => {
    if (reading || disposed) return;
    reading = true;
    try {
      const requested = JSON.parse(await readFile(ports.activationFile!, 'utf8')) as {id: string; manifest: GameManifest};
      if (typeof requested.id !== 'string' || !requested.id || requested.id === activation?.id) return;
      // Validate before accepting; a partial/invalid record cannot replace the selection.
      await verifyManifest(ports.directory, requested.manifest);
      if (disposed) return;
      activation = requested;
      schedule(0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') ports.report('Invalid CODE activation; current runners retained',String(error));
    } finally { reading = false; }
  },1000) : undefined;
  return {
    dispose() {
      disposed = true;
      watcher?.close();
      clearInterval(activationPoll);
      clearTimeout(timer);
    },
  };
}
