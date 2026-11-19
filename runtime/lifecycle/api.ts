// Lifecycle's door (L1.1 api.ts): the types other owners and add-ons import, and the reads they take: the saved fields,
// the name rule, the request contract, the run scope, the hold label, the roster reads and the console build status below.
// The worker shapes moved from runtime/coordinator/characters/types.ts and messages.ts.
import type { ChildProcess } from "node:child_process";
import type { FSWatcher } from "node:fs";
// The lifecycle owner's character picks: the report period, which the status owner's character rings and
// telemetry and its dashboard polls of the report-driven sections read (runtime/status/rules.ts
// `STATUS_PICKS.dashboardPolls`).
export { CHARACTER_PICKS } from "./fields.ts";
// The game's character name rule, which the roster, the storage character create and the dashboard read,
// and the Cave map rule the character card's map label reads.
export { caveMap, characterNameAllowed, CHARACTER_NAME_MAX, CHARACTER_NAME_MIN, CHARACTER_NAME_REFUSAL, nameCharacters } from "./rules.ts";
// The route plumbing's HTTP contract: every owner's routes validate their requests through it. It
// needs no node built-in, so the add-on system's routes in a character bundle load it too.
export { isRequestObject, requestObject, requestText, type HttpHandler, type HttpRequest, type HttpResponse, type HttpRouter } from "./http.ts";

export type Worker = ChildProcess & { partyStopReason?: string };
export type Lifecycle = "starting" | "realm-error" | "repairing" | "online" | "failed" | "offline";
export interface CharacterBlock {
  clientUpdating?: boolean;
  clientVersion?: number;
  clientInstance?: string;
  enabled?: boolean;
  connected?: boolean;
  realm?: string;
  script?: string;
  typescript?: string | null;
  version?: number;
  instance?: Worker | null;
  monitor?: { destroy(): void } | null;
  bootstrapRepair?: Promise<unknown> | null;
  restart_timeout?: number;
  reload_timeout?: number;
  code_watcher?: FSWatcher | null;
  codeReloadRunning?: boolean;
  codeReloadPending?: boolean;
  /** The worker answered `busy` to a CODE reload; its next report that reads not busy retries it. */
  codeReloadBusy?: boolean;
  codeGeneration?: string;
  lastExit?: { at: number; code: number | null; signal: string | null; reason: string };
}

export interface WorkerStore {
  set(key: string, value: unknown): void;
  delete(key: string): void;
  entries(): IterableIterator<[string, unknown]>;
}

export interface WorkerArguments {
  version: number;
  clientInstance?: string;
  realm_address?: string;
  realm_path: string;
  realm_port: string | number;
  sess: string | undefined;
  cid: string | number;
  script_file?: string;
  enable_map: boolean;
  cname: string;
  clid: number;
  typescript_file?: string | null;
  full_cave_floors?: boolean;
}

export interface WorkerLog {
  log(message: string, details?: unknown): void;
  warn(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface WorkerClock {
  now(): number;
  later(callback: () => void, milliseconds: number): number;
  cancel(timer: number | undefined): void;
  sleep(milliseconds: number): Promise<void>;
}

/** The worker's local and session storage messages (settings' worker-storage.ts answers them). */
export type StorageMessage =
  | { type: "stor"; ident: string; op: "set"; data: Record<string, unknown> }
  | { type: "stor"; ident: string; op: "del"; data: string[] }
  | { type: "stor"; ident: string; op: "clear" | "init" };

/** `lifecycle.state`: the Pause, the drain and the clean shutdown's phase. */
export interface LifecycleState { paused: boolean; pausedAt: number | null; drain: Drain | null; shutdown: string | null }
/** `lifecycle.drain`: on the coordinator the lease with table R's participants; on the
 *  character the fight targets the drain lets finish and whether movement parks. */
export type Drain = { lease: { id: string; expires: number; mode?: string; loadMode?: string; phase?: string }; participants: string[] }
  | { targets: Record<string, boolean>; park: boolean };
/** The payloads of the lifecycle owner's notices, each with its `by`. */
export interface HoldChanged { character: string; held: boolean; by: string }
export interface ReadinessNotice { character: string; lease: string; waiting: { by: string; reason: string }[]; by: 'core:lifecycle' }
export interface WorkerNotice { character: string; pid?: number; at?: number; code?: number | null; signal?: string | null; reason?: string; by: 'core:lifecycle' }

/** `lifecycle.ready` (part 1): what an answer receives, and its answer. An
 *  answer can hold the drain's readiness, never grant it; no answer is ready. */
export interface ReadyAsk { character: string; lease: unknown }
export interface ReadyAnswer { ready: boolean; reason?: string }
/** The answers together: ready when none refuses, with each refusal's registration and reason. */
export interface Readiness { ready: boolean; waiting: { by: string; reason: string }[] }

export interface ClientRevision { version: number; revision: string }
export interface ClientUpdateStatus { phase: string; version: number; target?: number; character?: string; error?: string }

/** `lifecycle.scope(owner)`: each owner's run scope handle on the character. It is
 *  core only (reason 7): it registers what an owner already decided, and add-ons register through 14. */
export { scope } from "./character/run.ts";
export type { ScopeHandle, Emitter } from "./character/run.ts";
// The card line's words for the lifecycle owner's holds (the status owner's
// table L5).
export { holdLabel } from './rules.ts';
// The roster's reads other owners take: the character order the dashboard and the switcher list by,
// the connection lines of the status owner's state section, and the account projection the items
// owner's storage reads.
export { orderCharacters } from "./roster/character-order.ts";
export { characterConnections } from "./roster/connection-status.ts";
export type { CharacterConnection } from "./roster/connection-status.ts";
export type { AccountCharacter, createRosterProjection } from "./roster/roster-projection.ts";
// The wire shapes the dashboard reads: the console control's status() and the Steam switch the public
// state carries (publicHandoff), with its phase.
export type { HandoffPhase } from "./roster/handoff.ts";
export type SteamSwitch = NonNullable<ReturnType<typeof import("./roster/public-handoff.ts").publicHandoff>>;
export type ConsoleControlState = ReturnType<ReturnType<typeof import("./coordinator/control.ts").createConsoleControl>["status"]>;
// The managed console build's status, which the status owner's build control shows, and
// whether a deployment phase is still running (tools/console-build/contracts.ts, a pure file
// both runtimes load).
export { deploymentPending } from "../../tools/console-build/contracts.ts";
export type { CandidateSummary, Component, ConsoleBuildStatus, DeploymentJournal, DeploymentMode } from "../../tools/console-build/contracts.ts";
// The Steam setup choices and their check (tools/steam/clients.ts, a leaf file both runtimes load),
// which the dashboard's first-use setup carry reads in place of its own list.
export { validSteamSetup } from "../../tools/steam/clients.ts";
// The character drain, which targeting's ports hold.
export type { CharacterDrain } from './character/drain.ts';
