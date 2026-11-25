// The headless runner host: the CODE
// contexts of a caracAL worker, their reload queue, the native ajax transport and the Cave floor
// handshake. Moved whole from runner-host.ts, reload-queue.ts, native-ajax.ts and cave-floor-handshake.ts.
import http from "node:http";
import vm from "node:vm";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { installHostGameLogs } from "../../status/character/api.ts";
import { RunnerScope } from "./run.ts";

interface CodeRunner {
  start(): Promise<void>;
  dispose(): Promise<void>;
  canDispose?(): boolean;
}

class ReloadBusyError extends Error {
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

// jQuery's transport contract (jQuery 3 ajaxTransport). These interfaces type
// only the fields this transport reads; jQuery owns the rest of the settings.
interface AjaxOptions {
  url: string;
  type: string;
  async?: boolean;
  crossDomain?: boolean;
  hasContent?: boolean;
  data?: unknown;
  dataTypes: string[];
}
type Complete = (status: number, statusText: string, responses?: { text: string }, headers?: string) => void;
interface Transport {
  send(headers: Record<string, string>, complete: Complete): void;
  abort(): void;
}
interface JQueryAjax {
  ajaxTransport(dataTypes: string, factory: (options: AjaxOptions) => Transport | undefined): void;
  ajax: (url?: unknown, options?: unknown) => unknown;
  ajaxSettings: { url?: unknown; crossDomain?: unknown };
}

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
// Idle sockets close before the coordinator's keep-alive does, so the server never resets a reused
// socket mid-request. The coordinator's server (coordinator/routes.ts `app.listen`) keeps Node's
// default keepAliveTimeout, which a fresh http.Server answers, and names it in each reply's
// Keep-Alive header. Node's agent closes an idle socket its agentKeepAliveTimeoutBuffer before that
// header's timeout, and only when the header's timeout is below the agent's own, so the agent takes
// the server's.
const agent = new http.Agent({ keepAlive: true, timeout: new http.Server().keepAliveTimeout });

/** Asynchronous HTTP requests to this host with a string or empty body. */
export function nativeAjaxEligible(options: AjaxOptions): boolean {
  if (options.async === false) return false;
  if (options.dataTypes.some((type) => type === "script" || type === "jsonp")) return false;
  if (options.hasContent && options.data != null && typeof options.data !== "string") return false;
  let url: URL;
  try { url = new URL(options.url); } catch { return false; }
  return url.protocol === "http:" && loopback.has(url.hostname);
}

function headerText(raw: string[]): string {
  let text = "";
  for (let index = 0; index + 1 < raw.length; index += 2) text += raw[index] + ": " + raw[index + 1] + "\r\n";
  return text;
}

function originKey(url: URL): string {
  return url.protocol + "//" + url.host;
}

/**
 * jQuery decides crossDomain for each request by assigning the URL to a jsdom anchor element and
 * reading its protocol and host back. jsdom parses that URL in JavaScript, about 200 us per request
 * (half of a status POST's CPU in the runner benchmark). For an absolute http(s) URL this wrapper
 * computes the same comparison with Node's URL parser and passes it as the crossDomain option.
 * jQuery keeps its own decision for relative and protocol-relative URLs, unparseable URLs, and
 * requests whose options or ajaxSetup already set crossDomain. The wrapper copies the caller's
 * options object and never edits it.
 */
function presetCrossDomain(host: JQueryAjax): void {
  let origin: string;
  try { origin = originKey(new URL(String(host.ajaxSettings.url))); } catch { return; }
  const decide = (target: unknown, settings: Record<string, unknown> | undefined): boolean | undefined => {
    if (typeof target !== "string" || !/^\s*https?:\/\//i.test(target)) return undefined;
    if (settings?.crossDomain != null || host.ajaxSettings.crossDomain != null) return undefined;
    try { return originKey(new URL(target)) !== origin; } catch { return undefined; }
  };
  const ajax = host.ajax;
  host.ajax = function (this: unknown, url?: unknown, options?: unknown) {
    const object = typeof url === "object" && url !== null;
    const settings = (object ? url : options) as Record<string, unknown> | undefined;
    const crossDomain = decide(object ? settings?.url : url || settings?.url, settings);
    if (crossDomain === undefined) return Reflect.apply(ajax, this, arguments);
    // jQuery merges options with for-in, so the copy keeps their prototype.
    const preset = Object.assign(Object.create(settings ? Object.getPrototypeOf(settings) : null), settings, { crossDomain });
    return Reflect.apply(ajax, this, object ? [preset] : [url, preset]);
  };
}

/**
 * Headless CODE runs inside jsdom. Its XMLHttpRequest builds a new keep-alive
 * agent, so a new TCP connection, for every request, and converts each body
 * with a JavaScript USVString pass over every character. Status reports are
 * hundreds of KB and combat reports go out up to ten times a second. This
 * transport sends the same method, headers and UTF-8 bytes through Node's HTTP
 * client over one keep-alive agent. jQuery still owns timeouts, conversion,
 * deferreds and global ajax events, so callers see the same outcomes.
 */
export function installNativeAjax(jquery: unknown): void {
  const host = jquery as Partial<JQueryAjax> | null;
  if (!host || typeof host.ajaxTransport !== "function") return;
  if (typeof host.ajax === "function" && host.ajaxSettings) presetCrossDomain(host as JQueryAjax);
  host.ajaxTransport("+*", (options) => {
    if (!nativeAjaxEligible(options)) return undefined;
    let request: http.ClientRequest | undefined;
    let settled = false;
    return {
      send(headers, complete) {
        const finish: Complete = (...args) => { if (!settled) { settled = true; complete(...args); } };
        const body = options.hasContent && typeof options.data === "string" ? options.data : null;
        const outgoing: Record<string, string> = { ...headers };
        // jQuery's XHR transport sets this header only for same-origin requests.
        if (!options.crossDomain && !outgoing["X-Requested-With"]) outgoing["X-Requested-With"] = "XMLHttpRequest";
        if (body !== null) outgoing["Content-Length"] = String(Buffer.byteLength(body));
        const send = (retry: boolean) => {
          const current = http.request(options.url, { method: options.type, headers: outgoing, agent }, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => finish(response.statusCode || 0, response.statusMessage || "",
              { text: Buffer.concat(chunks).toString("utf8") }, headerText(response.rawHeaders)));
            response.on("aborted", () => finish(0, ""));
            response.on("error", () => finish(0, ""));
          });
          request = current;
          current.on("error", (error: NodeJS.ErrnoException) => {
            if (settled) return;
            // Node's documented keep-alive race: the server closed an idle socket
            // while the agent reused it, so the request never reached the server.
            if (retry && current.reusedSocket && error.code === "ECONNRESET") return send(false);
            // jQuery's XHR transport reports a network failure as status 0 with
            // an empty status text; jQuery then rejects with "error".
            finish(0, "");
          });
          current.end(body ?? undefined);
        };
        send(true);
      },
      abort() {
        settled = true;
        request?.destroy();
      },
    };
  });
}

// The game server strips tiles, placements, groups and animations from every
// generated Cave floor it sends to a socket whose handshake says no_graphics=1
// (adventureland_mongodb node/logic/generated_maps.js send_generated_maps).
// Every caracAL worker connects that way, so a headless party has no Cave
// floor art for the dashboard map. Only the party leader's worker reports
// no_graphics=0 at connect time. window.no_graphics stays true, so the client
// still draws nothing; the server reads the flag only for Cave floor delivery
// and for observer broadcasts, which also need broadcast=1 in the query.
// The flag is fixed for the socket: a leader chosen after the worker started
// receives full floors after its next reconnect or console restart.
type Options = { query?: unknown } & Record<string, unknown>;
type Connect = (url: unknown, options?: Options) => unknown;

/** Rewrites only no_graphics in the socket.io handshake query. */
function fullCaveFloorOptions(options: Options | undefined): Options | undefined {
  const query = options?.query;
  if (typeof query === "string")
    return { ...options, query: query.replace(/(^|&)no_graphics=1(?=&|$)/, "$1no_graphics=0") };
  if (query && typeof query === "object" && (query as Record<string, unknown>).no_graphics === "1")
    return { ...options, query: { ...(query as Record<string, unknown>), no_graphics: "0" } };
  return options;
}

/** Wraps the worker's socket.io factory before the game's first init_socket(). */
export function installCaveFloorHandshake(game: { io?: unknown }, leader: boolean): boolean {
  if (!leader || typeof game.io !== "function") return false;
  const connect = game.io as Connect;
  const wrapped = function (this: unknown, url: unknown, options?: Options) {
    return connect.call(this, url, fullCaveFloorOptions(options));
  };
  // socket.io-client exposes Manager, Socket, io and connect on the factory.
  game.io = Object.assign(wrapped, connect);
  return true;
}

type Routine = { stop?: () => void; canReload(): boolean };
// A runtime is occupied while the lifecycle owner's drain says a reload would cut work (character/drain.ts `canReload`,
// N3): every owner's `lifecycle.ready` answer, the merchant jobs owner's running job among them.
function occupied(runner: Runner | undefined): boolean {
  return !!runner?.sharedRoutine && !runner.sharedRoutine.canReload();
}
interface Runner extends vm.Context {
  sharedRoutine?: Routine;
  partyRoleRunner?: Routine;
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

function configureApiAddress(runner: Runner) {
  if (process.env.AL_INTERNAL_API_PORT) {
    runner.__partyServer = `http://127.0.0.1:${Number(process.env.AL_INTERNAL_API_PORT) || 924}`;
  }
}

// The geometry repair reload runs universal-loader.js in this jsdom window
// (characters/shared.js reloadConvoyGeometry). jsdom 24 has no crypto.subtle,
// which loader-artifact.ts needs to verify each CODE bundle.
function installLoaderPlatform(runner: Runner) {
  const host = runner as Runner & { crypto?: { subtle?: unknown }; TextEncoder?: unknown };
  if (!host.crypto?.subtle) Object.defineProperty(host, "crypto", { value: webcrypto, configurable: true, writable: true });
  if (typeof host.TextEncoder !== "function") host.TextEncoder = TextEncoder;
}

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
    const sourceHash = createHash("sha256").update(source).digest("hex");
    const artifactHash = codeFile.replaceAll("\\", "/").match(/\/generated\/([a-f0-9]{64})\//)?.[1];
    if (artifactHash && sourceHash !== artifactHash)
      throw new Error("Generated CODE checksum mismatch");
    const compiled = new vm.Script(source, { filename: codeFile });
    const dependencies = new Map<string, vm.Script>();
    for (const file of codeFile.replaceAll("\\", "/").includes("/generated/")
      ? []
      : options.codeDependencies || [])
      dependencies.set(file, new vm.Script(await readFile(file, "utf8"), { filename: file }));
    const scope = new RunnerScope();
    const runner = options.createContext(scope.facade(options.upper));
    runner.__partyCodeHash = sourceHash;
    configureApiAddress(runner);
    installLoaderPlatform(runner);
    installNativeAjax(runner.$);
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
          // The run scope's stop (run.ts createRunScope) ends every timer, listener and request of the
          // generation; the facade's dispose below only retires its game view.
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
