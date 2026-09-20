import vm from "node:vm";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { RunnerScope } from "./runner-scope.ts";
import { installHostGameLogs } from "../characters/game-logs.ts";
import { ReloadBusyError, ReloadQueue, type CodeRunner } from "./reload-queue.ts";

type Routine = { stop?: () => void; isOccupied?: () => boolean; canReload?: () => boolean };
function occupied(runner: Runner | undefined): boolean {
  if (runner?.__merchantActiveJob) return true;
  const routine = runner?.sharedRoutine;
  return routine?.canReload ? !routine.canReload() : !!routine?.isOccupied?.();
}
interface Runner extends vm.Context {
  sharedRoutine?: Routine;
  partyRoleRunner?: Routine;
  __merchantActiveJob?: unknown;
  __partyLastCommand?: number;
  __partyLastFarmingMonsterType?: string;
  __partyReady?: Promise<void>;
  __partyMovement?: { dispose(): void };
  close(): void;
}
interface HostOptions {
  upper: vm.Context;
  createContext(parent: vm.Context): Runner;
  evaluateFiles(files: string[], context: vm.Context): Promise<void>;
  runnerFiles: string[];
  codeFile: string;
  codeDependencies?: string[];
  /** Handshake is only needed once; it must not accumulate process listeners. */
  connected(): Promise<void>;
  send(message: object): void;
}
type ReloadMessage = { id: string; generation: string; script?: string };

/** Owns CODE contexts only. The game context and its socket outlive every generation. */
export function createRunnerHost(options: HostOptions) {
  const queue = new ReloadQueue();
  let active: Runner | undefined;
  let connected = false;
  let lastCommand: number | undefined;
  let lastMonster: string | undefined;

  async function prepare(codeFile = options.codeFile): Promise<CodeRunner> {
    // Syntax errors are discovered while the old runner is still intact.
    const source = await readFile(codeFile, "utf8");
    const artifactHash = codeFile.replaceAll("\\", "/").match(/\/generated\/([a-f0-9]{64})\//)?.[1];
    if (artifactHash && createHash("sha256").update(source).digest("hex") !== artifactHash)
      throw new Error("Generated CODE checksum mismatch");
    const compiled = new vm.Script(source, { filename: codeFile });
    const dependencies = new Map<string, vm.Script>();
    for (const file of codeFile.replaceAll("\\", "/").includes("/generated/")
      ? []
      : options.codeDependencies || [])
      dependencies.set(file, new vm.Script(await readFile(file, "utf8"), { filename: file }));
    const scope = new RunnerScope();
    const runner = options.createContext(scope.facade(options.upper));
    scope.guardAjax(runner.$);
    if (typeof runner.fetch === "function") runner.fetch = scope.guardFetch(runner.fetch);
    try {
      vm.runInContext(
        'var active=false,catch_errors=true,Place="code",is_code=1,is_server=0,is_game=0,is_bot=parent.is_bot,is_cli=parent.is_cli,is_sdk=parent.is_sdk,Dev=parent.Dev,Staging=parent.Staging,Prod=parent.Prod,Local=parent.Local;',
        runner,
      );
      await options.evaluateFiles(options.runnerFiles, runner);
    } catch (error) {
      scope.dispose();
      runner.close();
      throw error;
    }
    const loads: Promise<void>[] = [];
    let disposed = false;
    return {
      canDispose: () => !occupied(runner),
      async start() {
        // The game owns this hook; CODE receives only a sender registration and
        // a bounded queue pulse, never a raw reference around the scope guard.
        options.upper.caracAL.install_game_logs = (send: Parameters<typeof installHostGameLogs>[1]) =>
          installHostGameLogs(options.upper, send);
        runner.__partyLastCommand = lastCommand;
        runner.__partyLastFarmingMonsterType = lastMonster;
        runner.send_cm = (to: string, data: unknown) => {
          scope.assertActive();
          options.send({ type: "cm", to, data });
        };
        options.upper.caracAL.load_scripts = (locations: string[]) => {
          scope.assertActive();
          const load = (async () => {
            for (const location of locations) {
              const file = "./CODE/" + location;
              const script = dependencies.get(file);
              if (!script)
                throw new Error("CODE dependency is not in the prepared generation: " + file);
              scope.assertActive();
              script.runInContext(runner);
            }
          })();
          loads.push(load);
          return load;
        };
        options.upper.caracAL.runner = runner;
        active = runner;
        if (!connected) {
          await options.connected();
          connected = true;
        }
        vm.runInContext(
          "active=true;parent.code_active=true;set_message('Code Active');if(character.rip)character.trigger('death',{past:true});",
          runner,
        );
        compiled.runInContext(runner);
        // Legacy loaders launch promises at evaluation time. Await them as well
        // as the explicit readiness promise used by the compiled class entries.
        for (let index = 0; index < loads.length; index++) await loads[index];
        await runner.__partyReady;
      },
      async dispose() {
        if (disposed) return;
        disposed = true;
        try {
          runner.partyRoleRunner?.stop?.();
          runner.sharedRoutine?.stop?.();
          runner.__partyMovement?.dispose();
          if (typeof runner.on_destroy === "function") runner.on_destroy();
        } finally {
          if (active === runner) {
            lastCommand = runner.__partyLastCommand;
            lastMonster = runner.__partyLastFarmingMonsterType;
          }
          scope.dispose();
          runner.close();
          if (active === runner) active = undefined;
        }
      },
    };
  }

  return {
    start: () => queue.reload("initial", prepare),
    dispose: () => queue.dispose(),
    async reload(message: ReloadMessage): Promise<void> {
      // Do not interrupt an inventory/merchant transaction: its server-side
      // effects may precede its acknowledgement. Retry after it settles.
      if (occupied(active)) {
        options.send({ type: "code_reload_result", ...message, status: "busy" });
        return;
      }
      try {
        if (
          message.script &&
          !/^adventure_land\/generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(message.script)
        )
          throw new Error("Invalid generated CODE path");
        await queue.reload(message.generation, () =>
          prepare(message.script ? "./CODE/" + message.script : options.codeFile),
        );
        options.send({ type: "code_reload_result", ...message, status: "ready" });
      } catch (error) {
        options.send({
          type: "code_reload_result",
          ...message,
          status: error instanceof ReloadBusyError ? "busy" : "failed",
          restartRequired: !active,
          error: String(error),
        });
      }
    },
  };
}
