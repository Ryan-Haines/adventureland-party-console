import { contains } from '../../../dashboard/lib/farming-zones.ts';
import { requestObject } from '../http/contracts.ts';
import { recordConvoyHistory } from './convoy-history.ts';
import { characterRuntime, reportMatches, samePlace, type SharedState, type SharedConvoy, type SharedCommand } from './shared-route-types.ts';

function eligible(state: SharedState, c: SharedConvoy): boolean {
  const h = state.monsterHunt;
  if (!h || interrupted(state, c)) return false;
  return h.convoyId === c.id && ['mission-travel', 'farming'].includes(h.stage) &&
    !!h.target && c.purpose === 'monster-hunt' && !c.continuousReturn && !c.force;
}
function interrupted(state: SharedState, c: SharedConvoy): boolean {
  return c.routeRecovery?.stage === 'relocation' || !!c.merchantInterruption || c.geometryRepair?.phase === 'waiting' ||
    !!state.eventReturn || !!state.escape && state.escape.stage !== 'released';
}
function owned(state: SharedState, c: SharedConvoy): boolean {
  return c.participants.every(name => {
    const s = state.statuses[name], command = state.commands[name], intent = state.navigationIntents?.[name];
    const expected = c.expected?.[name];
    if (!expected) return false;
    if (!s || !command || memberBlocked(s, intent)) return false;
    return command.convoyId === c.id && revisionMatches(command.navigationRevision, intent, expected.revision);
  });
}
function memberBlocked(s: NonNullable<SharedState['statuses'][string]>, intent: {cancelled?: boolean} | undefined): boolean {
  return !!s.activeEvent || !!s.joinedEvent || !!intent?.cancelled;
}
function inside(state: SharedState, c: SharedConvoy, now: number): boolean {
  const h = state.monsterHunt!, area = h.missions[h.currentIndex]?.destination;
  if (!area || !h.participants.length || h.participants.length !== c.participants.length) return false;
  const server = state.statuses[c.leader]?.server;
  return h.participants.every(name => {
    const s = state.statuses[name];
    if (!s || !freshLiving(s, now)) return false;
    return c.participants.includes(name) && s.server === server && samePlace(s, area) &&
      contains(area, s, 0, state.monsterSearchRadiusByCharacter?.[name] || 400);
  });
}
function freshLiving(s: NonNullable<SharedState['statuses'][string]>, now: number): boolean {
  return !s.rip && s.hp !== 0 && !s.transporting && now - s.seenAt <= 3000 && s.seenAt <= now + 500;
}
function stopped(state: SharedState, c: SharedConvoy): boolean {
  return c.participants.every(name => {
    const s = state.statuses[name]!;
    return !s.moving && reportMatches(state, name) && s.convoyNavigation?.phase === 'held' &&
      characterRuntime(s) === c.runtimes?.[name];
  });
}
/** Arrival releases movement ownership; queue nomination never grants attack permission. */
export function stepHuntArrival(state: SharedState, c: SharedConvoy, now: number,
  commandFor: (state: SharedState, c: SharedConvoy, phase: string, name: string) => SharedCommand): boolean | null {
  if (!eligible(state, c) || !owned(state, c)) { delete c.huntArrival; return null; }
  reconcileIdentity(state, c);
  // An existing defensive loot barrier must finish through its original owner.
  if (pendingLoot(c)) return null;
  if (!inside(state, c, now)) return awaitArea(state, c, now);
  if (!c.huntArrival) return begin(state, c, now, commandFor);
  if (c.participants.some(n => characterRuntime(state.statuses[n]) !== c.runtimes?.[n])) {
    delete c.huntArrival;
    return stepHuntArrival(state, c, now, commandFor);
  }
  if (!stopped(state, c)) return false;
  const h = state.monsterHunt!;
  h.arrivalHandoff = {at: now, confirmedAt: now, releasedCommands: Object.fromEntries(c.participants.map(n =>
    [n, {id: state.commands[n]!.id, revision: state.commands[n]!.navigationRevision}]))};
  for (const name of c.participants) delete state.commands[name];
  recordConvoyHistory(state, c, 'Hunt farming handoff', now);
  state.activeConvoy = null; h.convoyId = null; h.stage = 'farming'; h.originArrivedAt = now;
  delete h.travelCause; h.message = 'Monster Hunt: ' + h.target;
  return true;
}

function reconcileIdentity(state: SharedState, c: SharedConvoy): void {
  const h = state.monsterHunt!, prior = c.huntArrival;
  if (prior && (prior.cycleId !== h.cycleId || prior.missionIndex !== h.currentIndex ||
      prior.missionRevision !== (h.missionRevision || 0) || prior.epoch !== c.epoch)) delete c.huntArrival;
}
function begin(state: SharedState, c: SharedConvoy, now: number,
  commandFor: (state: SharedState, c: SharedConvoy, phase: string, name: string) => SharedCommand): boolean {
  const h = state.monsterHunt!;
  c.epoch++; c.phase = 'hunt-arrival'; c.departAt = null;
  c.huntArrival = {cycleId: h.cycleId, missionIndex: h.currentIndex, missionRevision: h.missionRevision || 0, epoch: c.epoch};
  c.runtimes = Object.fromEntries(c.participants.map(n => [n, characterRuntime(state.statuses[n]) || '']));
  for (const name of c.participants) state.commands[name] = commandFor(state, c, 'shared-hold', name);
  h.message = 'Hunt spawn reached; stopping travel for farming';
  recordConvoyHistory(state, c, 'Hunt spawn arrival', now);
  return true;
}

function pendingLoot(c: SharedConvoy): boolean { return !!c.loot && !requestObject(c.loot).complete; }

function revisionMatches(command: number, intent: {revision: number} | undefined, expected: number): boolean {
  return command === (intent?.revision || 0) && expected === command;
}

function awaitArea(state: SharedState, c: SharedConvoy, now: number): false | null {
  if (!c.huntArrival) return null;
  // Fresh drift outside the area resumes the existing route from stopped positions.
  if (c.participants.every(n => !!state.statuses[n] && freshLiving(state.statuses[n]!, now)) && stopped(state, c)) {
    delete c.huntArrival; c.phase = 'shared-hold'; c.sharedStoppedAt = now;
    return null;
  }
  return false;
}
