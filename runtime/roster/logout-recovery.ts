import type { Handoff, HandoffPorts, RosterOwnership } from './handoff.ts';

export function isSteamLogout(op: Handoff): boolean {
  return !op.returnToHeadless && (op.multi ? op.multi.action === 'logout' : !op.target);
}

function resumed(op: Handoff, body: Record<string, unknown>): boolean {
  if (op.phase === 'failed') return true;
  if (op.steamSessionId && typeof body.sessionId === 'string' && body.sessionId !== op.steamSessionId) return true;
  // Older bridges persisted the release receipt but not a game-session ID.
  return body.released === true && body.operationId === op.id;
}

function resumedGroup(state: RosterOwnership, op: Handoff, character: string): string[] {
  const subject = op.multi?.subject || op.from;
  return [...new Set([...(state.steam || []).filter(name => name !== subject), character])];
}

/** A new connected CODE session supersedes a logout, never an ownership transfer. */
export function recoverSteamLogout(state: RosterOwnership, character: string | null,
  body: Record<string, unknown>, ports: Pick<HandoffPorts, 'validateParticipants' | 'save'>): void {
  const op = state.handoff;
  if (!op || op.phase === 'complete' || !isSteamLogout(op)) return;
  if (!character || state.slots.includes(character)) return;
  if (!Array.isArray(body.running) || !body.running.includes(character) || !resumed(op, body)) return;
  const steam = resumedGroup(state, op, character);
  ports.validateParticipants([...steam, ...state.slots.filter((name): name is string => !!name)]);
  // Retire the object too: an offline check may still be awaiting account I/O.
  op.phase = 'complete';
  state.handoff = null;
  state.steam = steam;
  state.native = character;
  ports.save();
}
