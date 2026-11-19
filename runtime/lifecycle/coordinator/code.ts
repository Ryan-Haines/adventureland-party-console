// CODE reload: the standalone watch of each
// character's script, the managed console's game generations, and the reload request both send.
// Each reply is answered by table W's reload row (rules.ts), once for both. Moved from
// runtime/coordinator/characters/code.ts, composition.ts and runtime-lifecycle.ts's generation ports,
// and runtime/lifecycle/generations.ts and request-reload.ts.
import { watch as watchFolder, readFileSync, statSync, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { randomUUID, type Hash } from "node:crypto";
import path from "node:path";
import { digest, verifyManifest, type GameManifest, type CharacterClass } from "../../../tools/game/manifest.ts";
import { RETAIN_BUILDS } from "../../../tools/build-store.ts";
import { lifecycleSavedFields } from "../fields.ts";
import { TABLE_W } from "../rules.ts";
import type { CharacterBlock, Worker, WorkerClock, WorkerLog } from "../api.ts";
import { boundFired } from "../../status/coordinator/api.ts";

const fields = lifecycleSavedFields.settings;

export type ReloadResult = { status: "ready" | "busy" | "failed"; error?: string; restartRequired?: boolean };

/** A worker exit, an IPC error, a stale acknowledgement and no reply are distinct outcomes. */
export function requestReload(clock: WorkerClock, worker: Worker, name: string, generation: string, script?: string): Promise<ReloadResult> {
  const id = randomUUID();
  return new Promise((resolve) => {
    const finish = (result: ReloadResult) => {
      clock.cancel(timer);
      worker.off("message", onMessage);
      worker.off("exit", onExit);
      resolve(result);
    };
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const value = message as Record<string, unknown>;
      if (value.type !== "code_reload_result" || value.id !== id || value.generation !== generation) return;
      if (value.status === "ready" || value.status === "busy" || value.status === "failed")
        finish({ status: value.status, error: typeof value.error === "string" ? value.error : undefined, restartRequired: value.restartRequired === true });
    };
    // A worker exit ends the wait at once.
    const onExit = () => finish({ status: "failed", restartRequired: true, error: "worker exited during CODE reload" });
    // A worker that never acknowledges the reload (a stalled process) fails it and tells the status owner's bound record.
    const timer = clock.later(() => {
      boundFired({ bound: "reloadReplyMs", owner: "13", subject: name, state: { generation, ms: fields.reloadReplyMs.default } });
      finish({ status: "failed", restartRequired: true, error: "CODE reload acknowledgement timed out" });
    }, fields.reloadReplyMs.default);
    worker.on("message", onMessage);
    worker.once("exit", onExit);
    try {
      worker.send({ type: "reload_code", id, generation, script }, (error: Error | null) => {
        if (error) finish({ status: "failed", restartRequired: true, error: error.message });
      });
    } catch (error) {
      finish({ status: "failed", restartRequired: true, error: String(error) });
    }
  });
}

/** The class script a worker runs: the activated or built generation's file, its checksum verified. */
export function classScript(directory: string, className: string | undefined): string {
  let manifest: GameManifest;
  try {
    const activation = JSON.parse(readFileSync(path.join(directory, "activation.json"), "utf8")) as { id: string; manifest: GameManifest };
    if (typeof activation.id !== "string" || !activation.id) throw Error("Invalid CODE activation");
    manifest = activation.manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8")) as GameManifest;
  }
  const entry = manifest.classes?.[className as CharacterClass];
  if (manifest.schema !== 1 || !entry || !/^generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(entry.file))
    throw new Error("Missing compiled class: " + className);
  if (!verifiedClass(path.join(directory, entry.file), entry.sha256, Object.keys(manifest.classes).length))
    throw new Error("Compiled class checksum mismatch: " + className);
  return "adventure_land/" + entry.file;
}

// The merchant's home check reaches classScript on every dispatch, through worker setup.
// classScript hashes a verified file again only when its inode, size, mtime or ctime changes, which
// every rewrite does. The cache holds every live bundle: the manifest's classes (one per game class)
// times the generations kept on disk, the retained builds plus the current and the active one
// (tools/game/history.ts:29-32). A full cache starts over.
const verifiedClasses = new Map<string, string>();
function verifiedClass(file: string, sha256: string, classes: number): boolean {
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
  if (verifiedClasses.size >= classes * (RETAIN_BUILDS + 2)) verifiedClasses.clear();
  verifiedClasses.set(file, identity);
  return true;
}

const sharedFiles = ["farming-zones.js", "shared.js", "profiles.js"];

interface CodePorts {
  blocks: Record<string, CharacterBlock>;
  clock: WorkerClock;
  log: WorkerLog;
  /** Standalone development watches each script (config `watch_CODE`, never in an artifact). */
  watching: boolean;
  hash(): Hash;
  read(file: string): Uint8Array;
  watch(script: string, changed: () => void): FSWatcher;
  /** The account's class of a character. */
  className(name: string): string | undefined;
  stop(block: CharacterBlock, reason: string): Promise<void>;
  /** The coordinator's clock; Date.now when absent. */
  now?(): number;
  /** The lifecycle owner's reload notice. */
  notify(hook: 'lifecycle.reloaded', payload: Record<string, unknown>): void;
}

export function createCode(ports: CodePorts) {
  const { blocks, clock, log } = ports;
  let refreshGenerations: (() => void) | undefined;

  // Table W's reload row, for the standalone reload and the managed generation alike.
  async function answer(name: string, block: CharacterBlock, worker: Worker, result: ReloadResult, script: string | undefined, activated: () => void): Promise<void> {
    if (block.instance !== worker || !block.enabled) return;
    const row = TABLE_W.reload(result);
    block.codeReloadBusy = row === "retry";
    ports.notify("lifecycle.reloaded", { character: name, script: script ?? block.script ?? null, outcome: result.status, by: "core:lifecycle" });
    if (row === "activated") activated();
    else if (row === "restart") {
      if (script) block.script = script;
      await ports.stop(block, "CODE reload recovery: " + (result.error || "CODE reload failed"));
    } else if (row === "keep") log.error("CODE update rejected; current generation retained", { character: name, error: result.error });
  }

  // Standalone: the script and the shared files' digest is the generation.
  function digestOf(files: readonly string[]): string {
    const hash = ports.hash();
    for (const file of files) hash.update(file).update(ports.read("./CODE/" + file));
    return hash.digest("hex");
  }
  async function reload(name: string, block: CharacterBlock): Promise<void> {
    if (!block.enabled || !block.instance) return;
    if (block.codeReloadRunning) {
      block.codeReloadPending = true;
      return;
    }
    block.codeReloadRunning = true;
    try {
      do {
        block.codeReloadPending = false;
        const generation = digestOf([block.script || "", ...sharedFiles.map((file) => "adventure_land/" + file)]);
        const worker: Worker | null | undefined = block.instance;
        if (block.codeGeneration === generation || !worker) continue;
        await answer(name, block, worker, await requestReload(clock, worker, name, generation), undefined, () => {
          block.codeGeneration = generation;
          log.log("CODE generation activated without reconnecting", { script: block.script, generation });
        });
        if (block.instance !== worker || !block.enabled) return;
      } while (block.codeReloadPending);
    } finally {
      block.codeReloadRunning = false;
    }
  }
  function watch(name: string, block: CharacterBlock): void {
    if (!ports.watching || !block.script || block.code_watcher || block.script.startsWith("adventure_land/generated/")) return;
    const script = "./CODE/" + block.script;
    try {
      // An editor's save is not atomic, so the reload waits for the writes to settle (fields.ts).
      block.code_watcher = ports.watch(script, () => {
        clock.cancel(block.reload_timeout);
        block.reload_timeout = clock.later(() => void reload(name, block).catch((error) => log.error("CODE reload failed", error)), fields.codeSaveSettleMs.default);
      });
      log.log(`watching ${script} for ${name}`);
    } catch (error) {
      log.warn("Unable to watch character CODE", { error, script_path: script });
    }
  }

  // Managed: the host's activation record, or standalone the built manifest, names each class's
  // generation. Both files are written whole by rename (tools/build-store.ts `atomicJson`,
  // tools/game/build.mts), so a change event in the folder is a new record; the events of one write
  // coalesce within one event-loop turn.
  function watchGenerations(directory: string, activationFile: string | undefined): { dispose(): void } {
    let running = false, pending = false, disposed = false, queued = false;
    let activation: { id: string; manifest: GameManifest } | undefined;
    async function refresh(): Promise<void> {
      if (running) { pending = true; return; }
      running = true;
      try {
        do {
          pending = false;
          const manifest = await verifyManifest(directory,
            activationFile ? activation!.manifest : JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")));
          await Promise.all(Object.entries(blocks).map(async ([name, block]) => {
            const worker = block.instance, entry = manifest.classes[ports.className(name) as CharacterClass];
            if (!block.enabled || !worker || !entry) return;
            const script = "adventure_land/" + entry.file;
            if (block.script === script) return;
            const result = await requestReload(clock, worker, name, entry.sha256, script);
            if (disposed) return;
            await answer(name, block, worker, result, script, () => {
              block.script = script;
              log.log("CODE updated without reconnecting", { character: name, generation: entry.sha256 });
            });
          }));
        } while (pending && !disposed);
      } catch (error) {
        log.warn("Invalid game generation; current runners retained", String(error));
      } finally {
        running = false;
      }
    }
    function schedule(): void {
      if (disposed || queued) return;
      queued = true;
      clock.later(() => { queued = false; if (!disposed) void refresh(); }, 0);
    }
    refreshGenerations = schedule;
    async function readActivation(): Promise<void> {
      try {
        const requested = JSON.parse(await readFile(activationFile!, "utf8")) as { id: string; manifest: GameManifest };
        if (typeof requested.id !== "string" || !requested.id || requested.id === activation?.id) return;
        // A partial or invalid record cannot replace the selection.
        await verifyManifest(directory, requested.manifest);
        if (disposed) return;
        activation = requested;
        schedule();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") log.warn("Invalid CODE activation; current runners retained", String(error));
      }
    }
    const watched = activationFile ? path.basename(activationFile) : "manifest.json";
    const watcher = watchFolder(directory, (_event, file) => {
      if (file?.toString() !== watched) return;
      if (activationFile) void readActivation();
      else schedule();
    });
    watcher.on("error", (error) => log.warn("Game manifest watcher failed", String(error)));
    if (activationFile) void readActivation();
    return {
      dispose() {
        disposed = true;
        refreshGenerations = undefined;
        watcher.close();
      },
    };
  }

  // A native CODE frame loads its CODE itself (character/loader.ts), so no worker reply reaches
  // `answer`. Its report's `codeLoad` names the game window's install count and this install's age,
  // and a count above the last one is the native member's `lifecycle.reloaded`. The
  // coordinator holds no count after a start, so the first report counts a reload only when the
  // install is younger than this coordinator: the live hooks table reloads CODE right after a
  // coordinator restart, before any member reports again.
  const startedAt = (ports.now ?? Date.now)();
  const nativeLoads = new Map<string, number>();
  function nativeReloaded(name: string, report: { codeLoad?: unknown; codeHash?: unknown }): void {
    const load = report.codeLoad as { count?: unknown; ageMs?: unknown } | undefined;
    const count = Number(load?.count), ageMs = Number(load?.ageMs);
    if (blocks[name]?.instance || !Number.isFinite(count) || count < 1) return;
    const last = nativeLoads.get(name);
    nativeLoads.set(name, count);
    const reloaded = last === undefined ? count > 1 && Number.isFinite(ageMs) && (ports.now ?? Date.now)() - ageMs >= startedAt : count > last;
    if (reloaded)
      ports.notify("lifecycle.reloaded", { character: name, script: typeof report.codeHash === "string" ? report.codeHash : null, outcome: "ready", by: "core:lifecycle" });
  }

  /** Each report: a worker that answered `busy` retries on its first report that reads not busy. */
  function reported(name: string, report: { busy?: unknown }): void {
    const block = blocks[name];
    if (!block?.codeReloadBusy || report.busy !== false) return;
    block.codeReloadBusy = false;
    if (refreshGenerations) refreshGenerations();
    else void reload(name, block).catch((error) => log.error("deferred CODE reload failed", error));
  }

  return { watch, reload, watchGenerations, reported, nativeReloaded };
}
