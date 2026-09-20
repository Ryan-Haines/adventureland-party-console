import type { ReloadResult } from "../../lifecycle/request-reload.ts";
import type { CharacterBlock, Worker, WorkerClock, WorkerLog } from "./types.ts";
import type { FSWatcher } from "node:fs";

interface CodePorts {
  clock: WorkerClock;
  log: WorkerLog;
  enabled: boolean;
  digest(files: readonly string[]): string;
  reload(worker: Worker, generation: string): Promise<ReloadResult>;
  stop(block: CharacterBlock, reason: string): Promise<void>;
  watch(script: string, changed: () => void): FSWatcher;
  watchFailed(error: unknown, script: string): void;
}

const sharedFiles = ["farming-zones.js", "shared.js", "profiles.js", "roles.js"];

export function createCharacterCode(ports: CodePorts) {
  function defer(block: CharacterBlock, milliseconds: number, failure: string): void {
    ports.clock.cancel(block.reload_timeout);
    block.reload_timeout = ports.clock.later(() => {
      if (block.enabled && block.instance)
        void reload(block).catch((error) => ports.log.error(failure, error));
    }, milliseconds);
  }

  async function apply(block: CharacterBlock, generation: string): Promise<boolean> {
    const worker = block.instance;
    if (!worker) return false;
    const result = await ports.reload(worker, generation);
    if (block.instance !== worker || !block.enabled) return false;
    if (result.status === "ready") {
      block.codeGeneration = generation;
      ports.log.log("CODE generation activated without reconnecting", {
        script: block.script,
        generation,
      });
    } else if (result.status === "busy") {
      defer(block, 2000, "deferred CODE reload failed");
    } else if (result.restartRequired) {
      await ports.stop(block, "CODE reload recovery: " + result.error);
    } else {
      ports.log.error("CODE update rejected; current generation retained", result.error);
    }
    return true;
  }

  async function reload(block: CharacterBlock): Promise<void> {
    if (!block.enabled || !block.instance) return;
    if (block.codeReloadRunning) {
      block.codeReloadPending = true;
      return;
    }
    block.codeReloadRunning = true;
    try {
      do {
        block.codeReloadPending = false;
        const files = [block.script || "", ...sharedFiles.map((file) => "adventure_land/" + file)];
        const generation = ports.digest(files);
        if (block.codeGeneration === generation) continue;
        if (!(await apply(block, generation))) return;
      } while (block.codeReloadPending);
    } finally {
      block.codeReloadRunning = false;
    }
  }

  function watch(name: string, block: CharacterBlock): void {
    if (
      !ports.enabled ||
      !block.script ||
      block.code_watcher ||
      block.script.startsWith("adventure_land/generated/")
    )
      return;
    const script = "./CODE/" + block.script;
    try {
      block.code_watcher = ports.watch(script, () => defer(block, 300, "CODE reload failed"));
      ports.log.log(`watching ${script} for ${name}`);
    } catch (error) {
      ports.watchFailed(error, script);
    }
  }

  return { reload, watch };
}
