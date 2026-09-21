import type { HuntCycle, HuntTickPorts, HuntTickState } from "./contracts.ts";

/** A combat stop can release only its original navigation revisions and rendezvous commands. */
export function encounterNavigationBlocked(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, revisions?: Record<string, number>): boolean {
  if (state.activeConvoy || state.eventReturn || state.escape && state.escape.stage !== "released") return true;
  if (state.combatRecovery && !["complete", "cancelled"].includes(state.combatRecovery.phase)) return true;
  return hunt.participants.some(name => memberBlocked(name, hunt, state, ports, revisions));
}

function memberBlocked(name: string, hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, revisions?: Record<string, number>): boolean {
  const intent = ports.intent(name), command = state.commands[name], status = state.statuses[name];
  if (intent.cancelled || revisions && revisions[name] !== intent.revision) return true;
  if (status && (status.activeEvent || status.joinedEvent)) return true;
  if (!command) return false;
  return !hunt.encounter || command.convoyHandoff !== hunt.encounter.convoyId ||
    command.navigationRevision !== hunt.encounter.revisions[name];
}
