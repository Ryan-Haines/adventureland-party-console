import type { SharedCommand, SharedConvoy, SharedState } from "./shared-route-types.ts";
import { recordConvoyHistory } from "./convoy-history.ts";

/** Read compatibility for interruptions persisted by older coordinators. */
export interface MerchantInterruption {
  jobId: unknown;
  recipient: string;
  phase: "stopping" | "ready" | "collecting" | "resuming";
  deadline: number;
  resumePhase: string;
  revisions: Record<string, number>;
  commandId?: number;
}

/** Legacy clients defer service until idle. A merchant never acquires movement. */
export function admitMerchantInterruption(input: unknown, name: string, _jobId: unknown, _now: number): boolean {
  const state = input as SharedState;
  return !state.activeConvoy?.participants.includes(name) && !state.commands[name];
}

function sameIntent(state: SharedState, c: SharedConvoy, name: string): boolean {
  const intent = state.navigationIntents?.[name];
  return (intent?.revision || 0) === c.merchantInterruption!.revisions[name] && (!intent?.cancelled || c.navigationExempt);
}
function owned(state: SharedState, c: SharedConvoy, name: string): boolean {
  const pause = c.merchantInterruption!, command = state.commands[name];
  if (!sameIntent(state, c, name)) return false;
  if (!command) return !!c.restartRecovery || pause.phase === "resuming";
  return command.convoyId === c.id || name === pause.recipient && command.id === pause.commandId;
}

/** Release old holds immediately, but never resume superseded navigation. */
export function stepMerchantInterruption(state: SharedState, now: number, ports: {
  hold: (name: string) => SharedCommand; resume(phase: string): boolean; fail(reason: string): boolean;
}): boolean | null {
  const c = state.activeConvoy, pause = c?.merchantInterruption;
  if (!pause) return null;
  const current = c.participants.every(n => c.completed.includes(n) || owned(state, c, n));
  delete c.merchantInterruption;
  if (!current) return ports.fail("Merchant continuation superseded by newer navigation or command");
  const command = state.commands[pause.recipient];
  if (command?.id === pause.commandId) delete state.commands[pause.recipient];
  c.restartRecovery = false;
  c.failure = undefined; c.failureCode = undefined;
  recordConvoyHistory(state, c, "merchant hold retired", now, { recipient: pause.recipient, jobId: pause.jobId });
  return ports.resume(pause.resumePhase);
}
