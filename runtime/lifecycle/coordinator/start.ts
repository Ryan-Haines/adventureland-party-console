// The coordinator's start and stop (table W's stop row, L3.3). Moved from
// runtime/coordinator/lifecycle/shutdown.ts and runtime/coordinator/characters/startup.ts,
// runtime-lifecycle.ts and runtime/coordinator/environment.ts.
import { boundFired } from '../../status/coordinator/api.ts';
import { CoordinatorJsonlStore, hiddenValue, migrateCoordinatorLegacyStorage } from '../../settings/coordinator/api.ts';
import { convoyDefenseStep, createSharedConvoyNavigation, sharedCommand, type SharedState } from '../../movement/api/coordinator.ts';
// The hunting owner's farm location rule from its door's source, so an edit to areas.ts reaches the coordinator with no
// republished runtime/hunting/farming-areas.cjs.
import { validFarmingLocation } from '../../hunting/api.ts';
import { memberHolds } from './lease.ts';
import { confirmOffline, type OwnershipPorts } from '../roster/ownership.ts';
import type { Question } from '../rules.ts';
import type { LifecycleState } from '../api.ts';
import type { Registration } from '../../hooks/registry.ts';
import type { ScopeHandle } from '../character/run.ts';
import { isRealm } from '../../protocol/realm.ts';

interface ShutdownPorts {
  log(message: string): void;
  stopCharacters(): Promise<void>;
  /** The coordinator run's stop (run.ts createCoordinatorRun): every owner's part and timer ends. */
  stopRun(): void;
  closeStorage(): void | Promise<void>;
  /** The lifecycle owner's coordinator handle, which the grace wait registers on. */
  timers: Pick<ScopeHandle, 'setTimeout' | 'clearTimeout'>;
  exit(): void;
  /** True after the console's clean shutdown flushed state (control.ts). */
  prepared?(): boolean;
  /** How long that flush took, measured in control.ts: the storage close after the wait takes about as long. */
  flushMs?(): number;
}

/** Signals and supervisor messages share one shutdown operation. */
export function createShutdown(ports: ShutdownPorts) {
  let started = false;
  return async function shutdown(signal: string): Promise<void> {
    if (started) return;
    started = true;
    ports.log(`Received ${signal} on master. Rounding up clients`);
    const stopping = ports.stopCharacters();
    // A prepared shutdown already saved its state, so it bounds the worker wait: the wait ends when
    // storage must start closing to finish before the host's forced exit (tools/hosting/start.mts),
    // so the writer lock goes first (a stale lock blocks the next start).
    if (ports.prepared?.()) {
      const grace = hiddenValue('hostExitGraceMs'), closing = ports.flushMs?.() ?? 0;
      let timer: number | undefined, stopped = false;
      void stopping.then(() => { stopped = true; });
      await Promise.race([stopping, new Promise<void>(resolve => { timer = ports.timers.setTimeout(() => resolve(), Math.max(0, grace - closing)); })]);
      ports.timers.clearTimeout(timer);
      // The bound ended the wait with workers still running: the status owner's bound record names it.
      if (!stopped) boundFired({ bound: 'hostExitGraceMs', owner: '13', subject: signal, state: { waitMs: Math.max(0, grace - closing), flushMs: closing } });
    } else await stopping;
    ports.log("now truly exiting");
    // The run stops after the workers, whose close waits sleep on the lifecycle owner's handle, and before storage
    // closes, so no coordinator tick writes into a closed store.
    ports.stopRun();
    await ports.closeStorage();
    ports.exit();
  };
}

interface ProcessEvents { on(event: string, listener: (message?: unknown) => void): unknown }
interface CharacterStart {
  events: ProcessEvents;
  shutdown(reason: string): Promise<unknown>;
  workers: { prepareSlots(): void; restoreSlots(): void; accountChanged(account: unknown): void };
  code: { watchGenerations(directory: string, activationFile: string | undefined): unknown };
  /** Standalone development watches the built manifest (config `watch_CODE`); an artifact reads the host's activation record. */
  watchCode: boolean;
  artifact: boolean;
  subscribeAccount(listener: (account: unknown) => void): void;
  /** `lifecycle.started`: the home realm, the code generation and why it started. */
  started(): { realm: string | null; generation: string | null; reason: 'start' | 'reload' | 'resume' };
  notify(hook: 'lifecycle.started', payload: Record<string, unknown>): void;
  /** The lifecycle owner's coordinator handle, which the slot restore registers on. */
  timers: Pick<ScopeHandle, 'setTimeout'>;
}

/** The characters' start: the stop signals, the saved slots off until their restore, the CODE
 *  generations and the account updates, in that order. */
// K-S1: a start that throws leaves the coordinator up with a failed-start state, which
// /party-api/console-runtime serves, so an update's health check rolls back at once.
let failedStart: string | null = null;
export const startFailure = () => failedStart;
export function failStart(error: unknown): void {
  failedStart = String((error as Error)?.message ?? error);
  console.error('failed to start caracAL', error);
}

export function startCharacters(ports: CharacterStart): void {
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT']) ports.events.on(signal, () => void ports.shutdown(signal));
  ports.events.on('message', (message) => {
    if (message && typeof message === 'object' && 'type' in message && message.type === 'coordinator_shutdown') void ports.shutdown('coordinator reload request');
  });
  ports.workers.prepareSlots();
  // The restore waits for a Steam window's reservation (fields.ts `slotRestoreDelayMs`).
  ports.timers.setTimeout(() => ports.workers.restoreSlots(), hiddenValue('slotRestoreDelayMs'));
  if (ports.watchCode || ports.artifact)
    ports.code.watchGenerations('./CODE/adventure_land', ports.artifact ? './CODE/adventure_land/activation.json' : undefined);
  ports.subscribeAccount(account => ports.workers.accountChanged(account));
  ports.notify('lifecycle.started', { ...ports.started(), by: 'core:lifecycle' });
}

// The start's environment, first in the start order.
interface EnvironmentConfig {
  cull_versions?: boolean;
  session?: string;
  characters: Record<string, { realm?: unknown; version?: unknown } | null | undefined>;
}
interface Storage {
  set: (key: string, value: unknown) => unknown;
}
type MigrationPorts = Parameters<typeof migrateCoordinatorLegacyStorage>[2];
interface EnvironmentPorts<Store, Version, Config, Account> {
  createStorage: () => Store;
  migration: MigrationPorts;
  ensureLatest: () => Promise<Version>;
  configuration: () => Config;
  cullVersions: (versions: Version[]) => Promise<unknown>;
  environmentSession: () => string | undefined;
  account: (session: string | undefined) => Promise<Account>;
  accountHomeRealm?: (account: Account) => string | null;
}

/** Keep startup I/O ordered: migrate storage, obtain game data, read config, then log in. */
export async function initializeCoordinatorEnvironment<
  Store extends Storage,
  Version,
  Config extends EnvironmentConfig,
  Account,
>(ports: EnvironmentPorts<Store, Version, Config, Account>) {
  const localStorage = ports.createStorage();
  migrateCoordinatorLegacyStorage("./localStorage/storage.json", localStorage, ports.migration);
  const sessionStorage = new Map<string, unknown>();
  localStorage.set("caracAL", "Yeah");
  sessionStorage.set("caracAL", "Yup");
  const version = await ports.ensureLatest();
  const configuration = ports.configuration();
  if (configuration.cull_versions) {
    const pinned = Object.values(configuration.characters).map(entry => entry?.version)
      .filter(value => typeof value === typeof version && !!value) as Version[];
    await ports.cullVersions([version, ...pinned]);
  }
  const session = ports.environmentSession() || configuration.session;
  const account = await ports.account(session);
  const workers: Config["characters"] = configuration.characters;
  const configuredRealm =
    ports.accountHomeRealm?.(account) ||
    Object.values(workers)
      .map((entry) => entry && entry.realm)
      .find(isRealm) ||
    "SR_USII";
  return {
    localStorage,
    sessionStorage,
    version,
    configuration,
    session,
    account,
    workers,
    configuredRealm,
  };
}

/** The start's dependencies, resolved through the installed launcher, preserving load order and getter
 * evaluation (L1.1 start.ts: the start composition); moved from runtime/coordinator/infrastructure/dependencies.ts. */
export function loadCoordinatorDependencies(require: NodeRequire) {
  const {
    evaluateGroup,
  }: typeof import("../../coordinator/targeting/api.ts") = require("../../.build/runtime/grouped-combat.cjs");
  const {
    installRosterRoutes,
    publicHandoff,
  }: typeof import("../roster/index.ts") = require("../../.build/runtime/roster.cjs");
  const child_process: typeof import("node:child_process") = require("node:child_process");
  const account_info: (
    session: string | undefined,
  ) => Promise<import("./platform-contracts.ts").CoordinatorAccount> = require("../account_info");
  const game_files: import("./platform-contracts.ts").CoordinatorGameFiles = require("../game_files");
  // The client files' download and data check bounds tell the status owner's bound record (client-files.cjs).
  game_files.reportBounds?.(boundFired);
  const bwi: import("./web-platform.ts").MonitorConstructor = require("bot-web-interface");
  const monitoring_util: import("./web-platform.ts").MonitoringPlatform = require("../monitoring_util");
  const express: import("./web-platform.ts").ExpressPlatform = require("express");
  const fs_regular: typeof import("node:fs") = require("node:fs");
  const crypto: typeof import("node:crypto") = require("node:crypto");
  const vm: typeof import("node:vm") = require("node:vm");
  const farmZones: typeof import("../../hunting/api.ts") = require("../../characters/farming-zones.js");

  const convoyNavigation = createSharedConvoyNavigation((state: SharedState, now: number, command: typeof sharedCommand) => convoyDefenseStep(state, now, command));
  const {
    LOCALSTORAGE_PATH,
    LOCALSTORAGE_ROTA_PATH,
    STAT_BEAT_INTERVAL,
  }: import("./platform-contracts.ts").CoordinatorConstants = require("../src/CONSTANTS");
  const {
    log,
    console,
    ctype_to_clid,
  }: import("./platform-contracts.ts").CoordinatorLogging = require("../src/LogUtils");

  const FileStoredKeyValues: import("./platform-contracts.ts").CoordinatorFileStoreConstructor = CoordinatorJsonlStore;
  return {
    evaluateGroup,
    installRosterRoutes,
    publicHandoff,
    child_process,
    account_info,
    game_files,
    bwi,
    monitoring_util,
    express,
    fs_regular,
    crypto,
    vm,
    farmZones,
    convoyNavigation,
    validFarmingLocation,
    LOCALSTORAGE_PATH,
    LOCALSTORAGE_ROTA_PATH,
    STAT_BEAT_INTERVAL,
    log,
    console,
    ctype_to_clid,
    FileStoredKeyValues,
  };
}

/** The lifecycle owner's one registration on the coordinator: the roster's two reads for the items owner's BankBoi swap (K-S5), the
 * published reads of the Pause, the drain and table D, answered by control.ts, and
 * `member.holder` for the walk members 13 holds (lease.ts `memberHolds`). */
export function lifecycleRegistration<Block>(ports: OwnershipPorts<Block>, control: { state(): LifecycleState; drain(): unknown; allows(question: Question): boolean },
  members: Parameters<typeof memberHolds>[1]): Registration {
  return { name: 'core:lifecycle', folder: 'core', author: 'adventureland-party-console', holder: '13',
    summary: "Observes a character offline in the account list and starts a character in a headless slot, for the BankBoi swap; answers the Pause, the drain and the drain's questions.",
    hooks: { 'roster.offline': (name: string) => confirmOffline(name, ports), 'roster.assign': (slot: number, name: string) => { ports.assignSlot(slot, name, 'storage'); },
      'lifecycle.state': () => control.state(), 'lifecycle.drain': () => control.drain(), 'lifecycle.allows': (question: string) => control.allows(question as Question),
      'member.holder': ({ member }: { member: string }) => memberHolds(member, members) } };
}
