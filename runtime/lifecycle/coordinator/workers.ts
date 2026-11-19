// The headless workers: start, stop, exit,
// the IPC messages, the realm retry, the saved headless slots and the game client update rollout.
// Every transition asks table W (rules.ts) and every wait reads its source in fields.ts.
// Moved from runtime/coordinator/characters/manager.ts, processes.ts, ipc.ts, messages.ts,
// startup-slots.ts, worker-setup.ts and client-updates.ts.
import { randomUUID } from "node:crypto";
import { loadCoordinatorBankVaults, loadCoordinatorItemData } from "../../items/coordinator/api.ts";
import { connectionRealm, type RealmRequest } from "../../merchant-realm/api.ts";
import { boundFired, createInstalledCatalogValidation, resetCatalogs, type CatalogDefinitions, type ReportedCatalogs } from "../../status/coordinator/api.ts";
import { synchronizeStorage } from "../../settings/coordinator/api.ts";
import { lifecycleSavedFields } from "../fields.ts";
import { TABLE_W } from "../rules.ts";
import { fresh } from "../../protocol/reports.ts";
import type { ScopeHandle } from "../character/run.ts";
import type { RosterActor } from "../roster/handoff.ts";
import type {
  CharacterBlock, ClientRevision, ClientUpdateStatus, Lifecycle, StorageMessage, Worker,
  WorkerArguments, WorkerClock, WorkerLog, WorkerStore,
} from "../api.ts";

const fields = lifecycleSavedFields.settings;

/** The workers' and the CODE reload's clock on the lifecycle owner's coordinator handle, so the run's stop ends
 *  their waits; the unit rows hand in a fake one. */
export function coordinatorClock(timers: Pick<ScopeHandle, 'setTimeout' | 'clearTimeout' | 'sleep'>): WorkerClock {
  return { now: () => Date.now(), later: (callback, ms) => timers.setTimeout(callback, ms), cancel: timers.clearTimeout, sleep: timers.sleep };
}

interface Realm { address?: string; addr?: string; path?: string; port?: string | number }
interface Character { id: string | number; type: string }

/** The coordinator state the workers read and write (the party record). */
interface WorkerState extends ReportedCatalogs {
  activeRealm?: string;
  location?: { realm?: string } | null;
  headlessSlots: (string | null)[];
  nativeOwner: string | null;
  lifecycle: Record<string, Lifecycle | undefined>;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  statuses?: Record<string, { server?: string; seenAt?: number; consoleMaintenance?: unknown } | undefined>;
  realmSwitch?: { phase: string; realm: string; participants: string[]; homeTargets?: string[] } | null;
  /** The live client version, its catalog check and the items owner's bank packs, which the client update sets. */
  gameVersion: number;
  clientUpdate?: ClientUpdateStatus | null;
  validateCatalog?: ReturnType<typeof createInstalledCatalogValidation>;
  bankVaults?: ReturnType<typeof loadCoordinatorBankVaults>;
}

/** The game files reader the items owner's loaders and the catalog check share. */
type GameData = Parameters<typeof loadCoordinatorBankVaults>[1] & Parameters<typeof loadCoordinatorItemData>[1];
/** caracAL's web monitor once the web services start it (routes.ts); a worker's monitor UI needs its publisher. */
interface WebMonitor { publisher: unknown }

export interface WorkerPorts {
  blocks: Record<string, CharacterBlock>;
  /** The lifecycle owner's worker notices. */
  notify(hook: 'worker.started' | 'worker.exited', payload: Record<string, unknown>): void;
  state: WorkerState;
  clock: WorkerClock;
  log: WorkerLog;
  local: WorkerStore;
  session: WorkerStore;
  sessionToken: string | undefined;
  typeCode: boolean;
  minimap: boolean;
  classIds: Readonly<Record<string, number>>;
  /** The Cave floors a worker asks the game for (the hunting owner's cave.ts `caveFloors`, E13-07b). */
  caveFloors(name: string): Pick<WorkerArguments, "full_cave_floors">;
  /** A worker stopped: it leaves a deploy lease's participants (table W's stop row, R13-3). */
  stopped(name: string): void;
  resolveRealm(realm: string | undefined): Realm | undefined;
  resolveCharacter(name: string): Character | undefined;
  refreshAccount(): Promise<unknown>;
  account(): unknown;
  fork(module: string, args: string[], options: { stdio: ["ignore", "pipe", "pipe", "ipc"] }): Worker;
  pipe(worker: Worker): void;
  monitorUi(monitor: WebMonitor, name: string, block: CharacterBlock, minimap: boolean): { destroy(): void };
  /** A new or restored worker's realm, class script and CODE watch. */
  configuredRealm: string;
  homeRealm(name: string): string | null;
  script(name: string): string;
  watch(name: string, block: CharacterBlock): void;
  /** The roster's commit (roster/ownership.ts createRosterCommit) after a slot write. */
  commit(by: RosterActor): void;
  /** A slot a Steam handoff holds, and whether the account owns a character. */
  reserved(name: string | null): boolean;
  owned(name: string): boolean;
  /** The game client the coordinator starts on, and the client files that name the official one. */
  client: ClientRevision;
  gameFiles: { refresh_latest?(force?: boolean): Promise<ClientRevision> };
  /** The owners' data for a client version: movement's geometry, the status owner's maps, and the game files the items owner's
   * items and bank packs and the catalog check read. */
  versionData: {
    movement(version: number): Promise<unknown>;
    maps(version: number): () => void;
    gameData: GameData;
  };
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

// The worker's messages cross a process boundary; a message of no known shape is ignored.
type Message =
  | { type: "client_update"; event: "welcome" | "reloaded" }
  | { type: "deploy"; character?: string; realm?: string; script?: string; version?: number }
  | StorageMessage
  | { type: "process_ready" | "initialized" | "bootstrap_failed" | "connected" }
  | { type: "shutdown"; character?: string }
  | { type: "cm"; to: string | string[]; data: unknown };
function storageMessage(value: Record<string, unknown>): StorageMessage | null {
  const ident = text(value.ident) || "";
  if (value.op === "init" || value.op === "clear") return { type: "stor", ident, op: value.op };
  if (value.op === "set" && record(value.data)) return { type: "stor", ident, op: "set", data: value.data };
  if (value.op === "del" && Array.isArray(value.data) && value.data.every((item) => typeof item === "string"))
    return { type: "stor", ident, op: "del", data: value.data };
  return null;
}
function workerMessage(value: unknown): Message | null {
  if (!record(value)) return null;
  const type = value.type;
  if (type === "client_update" && (value.event === "welcome" || value.event === "reloaded")) return { type, event: value.event };
  if (type === "process_ready" || type === "initialized" || type === "bootstrap_failed" || type === "connected") return { type };
  if (type === "stor") return storageMessage(value);
  if (type === "deploy") return { type, character: text(value.character), realm: text(value.realm), script: text(value.script),
    version: typeof value.version === "number" ? value.version : undefined };
  if (type === "shutdown") return { type, character: text(value.character) };
  const to = value.to;
  if (type === "cm" && (typeof to === "string" || (Array.isArray(to) && to.every((name) => typeof name === "string")))) return { type, to, data: value.data };
  return null;
}

function sendWorker(worker: Worker | null | undefined, message: object): void {
  // IPC may close before the exit callback; that send error changes nothing.
  if (worker) worker.send(message, () => {});
}

/** The coordinator's workers: one record per character in `blocks`, its transitions asked of table W. */
export function createWorkers(ports: WorkerPorts) {
  const { blocks, state, clock, log } = ports;
  // The live game client. The client update below is its one writer.
  let client = ports.client;
  // The catalog check for a version reads that version's game definitions when a catalog first arrives.
  const catalogValidator = (version: number) => createInstalledCatalogValidation(version, () => {
    const context: { G?: CatalogDefinitions } = {};
    ports.versionData.gameData.evaluate(ports.versionData.gameData.read("./game_files/" + version + "/data.js"), context);
    if (!context.G) throw new Error("Catalog validation requires installed game definitions");
    return context.G;
  }, (message) => log.log(message));
  state.gameVersion = client.version;
  state.validateCatalog = catalogValidator(client.version);
  // caracAL's web monitor, which the web services hand over when they start it (routes.ts).
  let webMonitor: WebMonitor | null = null;
  const nameOf = (block: CharacterBlock) => Object.keys(blocks).find((name) => blocks[name] === block);
  // The open boundary count the character's last acknowledgement carries (the lifecycle owner's table R, A1), while
  // its reports keep coming (the movement owner's `recent` reading): a worker that stopped reporting holds nothing.
  const boundaryOpen = (name: string | undefined) => {
    const status = name ? state.statuses?.[name] : undefined, ack = status?.consoleMaintenance;
    return record(ack) && typeof ack.boundary === "number" && ack.boundary > 0 && fresh(status?.seenAt, clock.now(), "recent");
  };

  // Stop: table W's stop row. A worker that exits ends the wait at once.
  async function stop(block: CharacterBlock, reason = "requested worker restart"): Promise<void> {
    const worker = block.instance;
    block.instance = null;
    if (!worker) return;
    worker.partyStopReason = reason;
    const name = nameOf(block);
    if (name) ports.stopped(name);
    if (TABLE_W.stop({ connected: !!block.connected, boundaryOpen: boundaryOpen(name) }) !== "kill") {
      log.log("telling client to self-terminate");
      sendWorker(worker, { type: "closing_client" });
      const exited = new Promise<boolean>((resolve) => worker.on("exit", () => {
        log.log("Client terminated gracefully");
        resolve(true);
      }));
      // Each grace asks table W again: the close stays held while the worker reports an open
      // boundary, and the grace that ends it tells the status owner's bound record before the kill.
      let closed: boolean;
      while (!(closed = await Promise.race([clock.sleep(fields.workerCloseGraceMs.default).then(() => false), exited]))) {
        if (TABLE_W.stop({ connected: true, boundaryOpen: boundaryOpen(name) }) === "close-held") continue;
        boundFired({ bound: "workerCloseGraceMs", owner: "13", subject: name ?? "worker", state: { reason, ms: fields.workerCloseGraceMs.default } });
        break;
      }
      if (closed) return;
    }
    log.log("Hard-terminating client");
    worker.kill("SIGKILL");
  }

  function stopAll(): Promise<void> {
    return Promise.all(Object.values(blocks).map((block) => {
      block.enabled = false;
      return stop(block);
    })).then(() => undefined);
  }

  // The client update waits on each restarted worker's first report on the new version.
  const reportWaits = new Map<string, { candidate: ClientRevision; timer: number; settle(error?: Error): void }>();
  function settleWait(name: string, error?: Error): void {
    const wait = reportWaits.get(name);
    if (!wait) return;
    reportWaits.delete(name);
    clock.cancel(wait.timer);
    wait.settle(error);
  }

  function exited(name: string, block: CharacterBlock, worker: Worker, code: number | null, signal: string | null): void {
    const exit = { at: clock.now(), code, signal, reason: worker.partyStopReason || "unexpected worker exit" };
    log.log(`[worker-exit] ${name}: ${JSON.stringify(exit)}`);
    // A retired worker cannot clear the connection or monitor of its replacement.
    const row = TABLE_W.exit({ current: !block.instance || block.instance === worker, updating: !!block.clientUpdating, enabled: !!block.enabled });
    if (row === "ignore") return;
    block.lastExit = exit;
    ports.notify("worker.exited", { character: name, pid: worker.pid, ...exit, by: "core:lifecycle" });
    block.monitor?.destroy();
    block.monitor = null;
    block.connected = false;
    block.instance = null;
    // An exit the player made (table W's offline row) ends the wait as done; any other fails it.
    settleWait(name, row === "offline" ? undefined : Error(name + " exited during client activation"));
    if (row === "offline") state.lifecycle[name] = "offline";
    if (row !== "restart") return;
    state.lifecycle[name] = "failed";
    clock.cancel(block.restart_timeout);
    void Promise.resolve(block.bootstrapRepair)
      .catch((error) => log.warn(`game cache repair failed for ${name}`, error))
      .finally(() => {
        block.bootstrapRepair = null;
        block.restart_timeout = clock.later(() => {
          if (block.enabled && !block.instance) start(name);
        }, fields.workerRestartMs.default);
      });
  }

  // Realm error: the retry runs when the account answers with the realm, from the refresh this
  // start began or the account's own next update.
  const realmWaiting = new Set<string>();
  function retryRealms(): void {
    for (const name of realmWaiting) {
      const block = blocks[name];
      const row = TABLE_W.realm({ enabled: !!block?.enabled, running: !!block?.instance, resolves: !!ports.resolveRealm(block?.realm) });
      if (row === "wait") continue;
      realmWaiting.delete(name);
      if (row === "start") start(name);
    }
  }

  function siblings(account: unknown = ports.account()): void {
    const names = Object.keys(blocks).filter((name) => blocks[name].connected).sort();
    for (const name of names) sendWorker(blocks[name].instance, { type: "siblings_and_acc", account, siblings: names });
  }
  /** Each account update: the siblings learn it and a realm error waiting on it retries. */
  function accountChanged(account: unknown): void {
    siblings(account);
    retryRealms();
  }

  function deploy(name: string, block: CharacterBlock, message: Extract<Message, { type: "deploy" }>): void {
    const target = message.character || name;
    const candidate = blocks[target] || (blocks[target] = {});
    candidate.enabled = true;
    candidate.realm = message.realm || block.realm;
    candidate.typescript = block.typescript?.length ? message.script || block.typescript : null;
    candidate.script = message.script || block.script;
    candidate.version = message.version || block.version;
    // stop reads `connected` before it clears it, so a connected worker gets its close (table W).
    if (candidate.instance) void stop(candidate, "game requested redeploy");
    else start(target);
    candidate.connected = false;
  }

  function receive(name: string, block: CharacterBlock, worker: Worker, args: WorkerArguments, value: unknown): void {
    if (block.instance !== worker) return;
    const message = workerMessage(value);
    if (!message) return;
    switch (message.type) {
      case "client_update": if (!block.version) void requestUpdate(message.event); return;
      case "process_ready": sendWorker(worker, { type: "process_args", arguments: args }); return;
      case "initialized": return;
      case "bootstrap_failed":
        state.lifecycle[name] = "repairing";
        log.warn(`bootstrap failed for ${name}; refreshing cached game files`);
        block.bootstrapRepair = requestUpdate("repair");
        return;
      case "connected":
        block.connected = true;
        state.lifecycle[name] = "online";
        siblings();
        return;
      case "deploy": deploy(name, block, message); return;
      case "shutdown": {
        const candidate = message.character ? blocks[message.character] || {} : block;
        log.log(message.character ? `shutdown requested for ${message.character} from ${name}` : "shutdown requested from " + name);
        candidate.enabled = false;
        void stop(candidate);
        return;
      }
      case "cm": {
        const recipients = Array.isArray(message.to) ? message.to : [message.to];
        const remote = recipients.filter((target) => !blocks[target]?.connected);
        if (remote.length) sendWorker(block.instance, { type: "send_cm", to: remote, data: message.data });
        for (const target of recipients) if (blocks[target]?.connected) sendWorker(blocks[target].instance, { type: "receive_cm", name, data: message.data });
        return;
      }
      case "stor":
        synchronizeStorage(message, { local: ports.local, session: ports.session, owner: name,
          reply: (reply) => sendWorker(block.instance, reply),
          broadcast: (reply) => { for (const each of Object.values(blocks)) sendWorker(each.instance, reply); } });
    }
  }

  function start(name: string): Worker | undefined {
    const block = blocks[name];
    state.lifecycle[name] = "starting";
    const realm = ports.resolveRealm(block.realm), character = ports.resolveCharacter(name);
    const row = TABLE_W.start({ realm: !!realm, character: !!character });
    if (row === "realm-error") {
      log.warn(`could not find intended realm ${block.realm}; refusing to start ${name} elsewhere`);
      state.lifecycle[name] = "realm-error";
      clock.cancel(block.restart_timeout);
      realmWaiting.add(name);
      void ports.refreshAccount().then(retryRealms, (error) => log.warn(`realm refresh failed for ${name}`, error));
      return;
    }
    if (row === "disable") {
      log.error(`could not resolve character ${name}`, "this character will not be started");
      log.error("are you sure you own this character and have not deleted it?");
      block.enabled = false;
      return;
    }
    const args: WorkerArguments = {
      version: block.version || client.version,
      clientInstance: randomUUID(),
      realm_address: realm!.address || realm!.addr,
      realm_path: realm!.path || "",
      realm_port: realm!.port || "",
      sess: ports.sessionToken,
      cid: character!.id,
      script_file: block.script,
      enable_map: ports.minimap,
      cname: name,
      clid: ports.classIds[character!.type] || -1,
      ...ports.caveFloors(name),
      ...(ports.typeCode ? { typescript_file: block.typescript } : {}),
    };
    block.clientVersion = args.version;
    block.clientInstance = args.clientInstance;
    log.log(`starting ${name} running version ${args.version} in ${block.realm}`);
    // Each character runs in caracAL's thread script, its output piped to the console's own.
    const worker = ports.fork("./src/CharacterThread.js", [], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    ports.pipe(worker);
    block.instance = worker;
    worker.on("exit", (code, signal) => exited(name, block, worker, code, signal));
    worker.on("message", (value) => receive(name, block, worker, args, value));
    ports.notify("worker.started", { character: name, pid: worker.pid, by: "core:lifecycle" });
    // A worker gets a monitor UI only while the web UI publishes one.
    if (webMonitor?.publisher) block.monitor = ports.monitorUi(webMonitor, name, block, ports.minimap);
    return worker;
  }

  // A new or restored worker's configuration before it starts or takes a headless slot.
  function ensure(name: string): CharacterBlock {
    const block = blocks[name] || (blocks[name] = {});
    // A running worker keeps its event or realm travel; a new or restored one uses its native home.
    block.realm = connectionRealm(state, name, block.instance ? block.realm : undefined, ports.homeRealm(name), ports.configuredRealm);
    block.code_watcher?.close();
    block.code_watcher = null;
    block.script = ports.script(name);
    block.version = block.version || 0;
    block.connected = !!block.connected;
    ports.watch(name, block);
    return block;
  }
  function assign(slot: number, name: string, by: RosterActor): void {
    state.headlessSlots[slot - 1] = name;
    ports.commit(by);
    const block = ensure(name);
    block.enabled = true;
    state.lifecycle[name] = block.connected ? "online" : "starting";
    if (!block.instance) start(name);
  }
  /** At start every saved worker is off and unconnected until the slot restore turns it on. */
  function prepareSlots(): void {
    for (const [name, block] of Object.entries(blocks)) {
      block.connected = false;
      ports.watch(name, block);
      block.enabled = false;
    }
  }
  /** The saved headless slots start their characters; a slot the account no longer owns, or the native owner's, empties. */
  function restoreSlots(): void {
    state.headlessSlots.forEach((name, index) => {
      if (ports.reserved(name)) return;
      if (!name || !ports.owned(name) || name === state.nativeOwner) {
        state.headlessSlots[index] = null;
        return;
      }
      const block = ensure(name);
      if (!block.enabled) {
        block.enabled = true;
        start(name);
      }
    });
    ports.commit('start');
  }

  // The game client update: one run at a time, started by a worker's welcome, reload or repair
  // (no periodic discovery). Each worker on the live client restarts on the new one in turn.
  let running: Promise<void> | null = null, reloadAgain = false;
  const pending = new Set<string>();
  const updates = (block: CharacterBlock | undefined) => !!block && TABLE_W.update({ enabled: !!block.enabled, pinned: !!block.version });
  function report(phase: string, candidate?: ClientRevision, character?: string, error?: unknown): void {
    const value: ClientUpdateStatus = { phase, version: client.version, target: candidate?.version, character,
      ...(error ? { error: error instanceof Error ? error.message : JSON.stringify(error) } : {}) };
    state.clientUpdate = value;
    if (value.error) log.warn("Game client update failed", value);
    else log.log("Game client update " + value.phase, value);
  }
  // Each owner's data for the candidate, read before anything changes, so a failure keeps the live client.
  async function prepare(candidate: ClientRevision) {
    const { movement, maps, gameData } = ports.versionData;
    return {
      movement: await movement(candidate.version),
      validateCatalog: catalogValidator(candidate.version),
      activateMaps: maps(candidate.version),
      bankVaults: loadCoordinatorBankVaults(candidate.version, gameData),
      items: loadCoordinatorItemData(candidate.version, gameData),
    };
  }
  // The candidate becomes the live client: its maps, catalog check, items and bank packs. Every
  // catalog the characters reported on the old client goes until they report again (the status owner's `resetCatalogs`).
  function activate(candidate: ClientRevision, data: Awaited<ReturnType<typeof prepare>>): void {
    data.activateMaps();
    client = candidate;
    state.gameVersion = candidate.version;
    state.validateCatalog = data.validateCatalog;
    state.bankVaults = data.bankVaults;
    Object.assign(state, data.items);
    resetCatalogs(state);
  }
  // The official client from the client files; a console without the live refresh cannot update.
  function refresh(force: boolean): Promise<ClientRevision> {
    if (!ports.gameFiles.refresh_latest) throw Error("Live client refresh is not installed");
    return ports.gameFiles.refresh_latest(force);
  }
  async function restart(name: string, candidate: ClientRevision): Promise<void> {
    const block = blocks[name];
    if (!updates(block)) return;
    report("restarting", candidate, name);
    block.clientUpdating = true;
    clock.cancel(block.restart_timeout);
    try { await stop(block, "activating game client " + candidate.version); }
    finally { block.clientUpdating = false; }
    if (!updates(block)) return;
    // A restarted worker whose CODE never reports fails the update and tells the status owner's bound record.
    const reported = new Promise<void>((resolve, reject) => reportWaits.set(name, { candidate,
      timer: clock.later(() => {
        boundFired({ bound: "clientUpdateWaitMs", owner: "13", subject: name, state: { version: candidate.version, ms: fields.clientUpdateWaitMs.default } });
        settleWait(name, Error("No report on the new client from " + name + " after client activation"));
      }, fields.clientUpdateWaitMs.default),
      settle: (error) => (error ? reject(error) : resolve()) }));
    if (!start(name)) {
      settleWait(name);
      throw Error("Could not start " + name);
    }
    await reported;
  }
  /** Each report: a restarted worker's first report on its own instance ends its client update wait. */
  function reported(name: string, report: { clientVersion?: unknown; clientInstance?: unknown }): void {
    const wait = reportWaits.get(name), block = blocks[name];
    if (!wait) return;
    if (!updates(block)) return settleWait(name);
    if (report.clientInstance !== block.clientInstance) return;
    settleWait(name, report.clientVersion === wait.candidate.version ? undefined : Error(`${name} reports client ${report.clientVersion} after activating ${wait.candidate.version}`));
  }
  async function update(force: boolean): Promise<void> {
    const before = client;
    report("checking");
    const candidate = await refresh(force);
    if (candidate.version < before.version) throw Error("Official client version is older than the active client");
    if (candidate.version !== before.version || candidate.revision !== before.revision) {
      activate(candidate, await prepare(candidate));
      for (const [name, block] of Object.entries(blocks)) if (updates(block)) pending.add(name);
    }
    for (const name of pending) { await restart(name, candidate); pending.delete(name); }
    report("ready", candidate);
  }
  function requestUpdate(event: "welcome" | "reloaded" | "repair"): Promise<void> {
    if (running) { if (event === "reloaded") reloadAgain = true; return running; }
    running = (async () => {
      try {
        await update(event !== "welcome");
        while (reloadAgain) { reloadAgain = false; await update(true); }
      } catch (error) { report("failed", undefined, undefined, error); }
      finally { running = null; }
    })();
    return running;
  }

  /** The web services hand over caracAL's monitor when they start it (routes.ts `startConfiguredServices`). */
  function retainMonitor(monitor: WebMonitor): void {
    webMonitor = monitor;
  }

  return { start, stop, stopAll, siblings, accountChanged, ensure, assign, prepareSlots, restoreSlots, requestUpdate, reported, retainMonitor };
}
