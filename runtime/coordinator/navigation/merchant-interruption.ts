import { characterRuntime, reportMatches, type SharedCommand, type SharedConvoy, type SharedState } from "./shared-route-types.ts";
import { recordConvoyHistory } from "./convoy-history.ts";

export interface MerchantInterruption {
  kind?: "equipment";
  jobId: unknown;
  recipient: string;
  phase: "stopping" | "ready" | "collecting" | "resuming";
  deadline: number;
  resumePhase: string;
  revisions: Record<string, number>;
  commandId?: number;
}
interface MerchantState extends SharedState { merchantCurrent?: { id: unknown } | null }

/** Admission never replaces travel. The navigation tick first stops the whole party. */
export function admitMerchantInterruption(input: unknown, name: string, jobId: unknown, now: number, kind?: "equipment"): boolean {
  const state = input as SharedState, c = state.activeConvoy;
  if (!c?.participants.includes(name)) return !navigationCommand(state.commands[name]);
  if (c.nonPreemptible || ["failed", "defending", "observing"].includes(c.phase) || c.routeProtocol !== 4) return false;
  const pause = c.merchantInterruption;
  if (pause) return pause.jobId === jobId && pause.recipient === name && pause.phase === "ready";
  c.merchantInterruption = { kind, jobId, recipient: name, phase: "stopping", deadline: now + 60000,
    resumePhase: c.phase, revisions: Object.fromEntries(c.participants.map(n => [n, state.navigationIntents?.[n]?.revision || 0])) };
  recordConvoyHistory(state, c, "merchant pause", now, { recipient: name, jobId });
  return false;
}
function navigationCommand(command: SharedCommand | undefined): boolean {
  return !!command && ["event-return-town", "event-resume-travel", "party-monster-travel", "town-party",
    "character-travel", "travel", "return-leader"].includes(command.type);
}

export function attachMerchantInterruption(input: unknown, name: string, command: { id: number; [key: string]: unknown }): void {
  const c = (input as SharedState).activeConvoy, pause = c?.merchantInterruption;
  if (!c || !pause || pause.recipient !== name) return;
  pause.commandId = command.id; pause.phase = "collecting";
  command.convoyContinuation = { convoyId: c.id, navigationRevision: pause.revisions[name], deadline: pause.deadline };
  // A collection does not cancel the enclosing Town/event return generation.
  if (c.purpose === "shared-walk-return") command.purpose = c.purpose;
}

export function finishMerchantInterruption(input: unknown, name: string, commandId: unknown): void {
  const pause = (input as SharedState).activeConvoy?.merchantInterruption;
  if (pause?.recipient === name && pause.commandId === commandId) pause.phase = "resuming";
}

function owned(state: SharedState, c: SharedConvoy, name: string): boolean {
  const pause = c.merchantInterruption!, command = state.commands[name];
  if (!sameIntent(state, c, name)) return false;
  if (!command) return !!c.restartRecovery || (name === pause.recipient && pause.phase === "resuming");
  return command.convoyId === c.id || (name === pause.recipient && command.id === pause.commandId);
}
function sameIntent(state: SharedState, c: SharedConvoy, name: string): boolean {
  const intent = state.navigationIntents?.[name];
  return (intent?.revision || 0) === c.merchantInterruption!.revisions[name] && (!intent?.cancelled || c.navigationExempt);
}
function stopped(state: SharedState, c: SharedConvoy, now: number): boolean {
  return c.participants.filter(n => !c.completed.includes(n)).every(n => {
    const s = state.statuses[n];
    return !!s && s.seenAt >= now - 3000 && !s.moving && reportMatches(state, n) && s.convoyNavigation?.phase === "held";
  });
}
function hold(state: SharedState, c: SharedConvoy, make: (name: string) => SharedCommand): void {
  for (const name of c.participants.filter(n => !c.completed.includes(n))) {
    const command = state.commands[name];
    const runtime = characterRuntime(state.statuses[name]) || "";
    if (command?.convoyId === c.id && command.phase === "shared-hold" && c.runtimes?.[name] === runtime) continue;
    (c.runtimes ||= {})[name] = runtime;
    state.commands[name] = make(name);
    state.commands[name]!.reason = "Travel paused for " + c.merchantInterruption!.recipient + (c.merchantInterruption!.kind === 'equipment' ? "'s delivered equipment" : "'s merchant collection");
  }
}

/** Returns null when ordinary navigation may run; otherwise consumes this tick. */
export function stepMerchantInterruption(input: SharedState, now: number, ports: {
  hold: (name: string) => SharedCommand; resume(phase: string): boolean; fail(reason: string): boolean;
}): boolean | null {
  const state = input as MerchantState, c = state.activeConvoy, pause = c?.merchantInterruption;
  if (!pause) return null;
  if (!c.participants.every(n => c.completed.includes(n) || owned(state, c, n))) {
    delete c.merchantInterruption;
    return ports.fail("Merchant continuation superseded by newer navigation or command");
  }
  c.departAt = null;
  c.phase = "shared-hold";
  if (expired(state, pause, now)) pause.phase = "resuming";
  if (pause.phase === "collecting") return false;
  hold(state, c, ports.hold);
  if (!stopped(state, c, now)) return true;
  if (pause.phase === "resuming") {
    c.restartRecovery = false;
    c.failure = undefined; c.failureCode = undefined;
    recordConvoyHistory(state, c, "merchant resume", now, { recipient: pause.recipient, jobId: pause.jobId });
    delete c.merchantInterruption;
    return ports.resume(pause.resumePhase);
  }
  if (pause.phase === "ready") return false;
  pause.phase = "ready";
  return true;
}
function expired(state: MerchantState, pause: MerchantInterruption, now: number): boolean {
  return now >= pause.deadline || pause.kind !== 'equipment' && state.merchantCurrent?.id !== pause.jobId;
}
