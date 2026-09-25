import type { HuntReturnState } from "./hunt-return.ts";
import type { EventRecovery, Waypoints } from "./return-types.ts";
import { isRecoveryWalk } from "./repair-return-walk.ts";
import { endHuntEventTrip } from "./hunt-trip.ts";

interface Ports {
  now(): number;
  capture(names: string[]): Waypoints;
  cancelConvoy(): void;
}

/** Evacuation finishes into current Hunt policy, never a historical farm waypoint. */
export function createHuntResume(state: HuntReturnState, ports: Ports) {
  function pending(): boolean {
    return !!state.monsterHunt && (state.farmingPolicy === "hunt" || !!state.monsterHunt.exitMode);
  }
  function ownsConvoy(r: EventRecovery): boolean {
    const c = state.activeConvoy;
    if (!c) return true;
    if (c.nonPreemptible || c.merchantInterruption) return false;
    return c.id === r.convoyId || isRecoveryWalk(r, { ...c, participants: c.participants || [] });
  }
  function observedExit(name: string, r: EventRecovery): boolean {
    const s = state.statuses[name];
    if (!s || ports.now() - Number(s.seenAt) > 3000 || s.rip || !s.map || s.mapEvent) return false;
    return !!r.returnDispatchedAt || (s.map === "main" && Math.hypot(Number(s.x), Number(s.y)) <= 90);
  }
  function ownsCommand(name: string, r: EventRecovery): boolean {
    const command = state.commands[name];
    if (!command || command.cycleId === r.cycleId) return true;
    if (command.id === r.returnRoutes?.[name]?.commandId) return true;
    return !!state.activeConvoy && command.convoyId === state.activeConvoy.id;
  }
  function authorized(name: string, r: EventRecovery, current: Waypoints): boolean {
    const revision = current[name]?.revision;
    return !!current[name]?.location && revision !== undefined && (revision === r.waypoints?.[name]?.revision ||
      revision === state.monsterHunt?.travelCheckpoint?.revisions[name]);
  }
  function ready(name: string, r: EventRecovery, current: Waypoints): boolean {
    if (state.deferredEventReturns[name]?.cycleId === r.cycleId) return true;
    if (!authorized(name, r, current)) { r.blocker = "Navigation superseded: " + name; return false; }
    if (!observedExit(name, r)) { r.blocker = "Waiting for fresh Main town arrival: " + name; return false; }
    if (!ownsCommand(name, r)) { r.blocker = "Waiting for current navigation owner: " + name; return false; }
    return true;
  }
  function finishMember(name: string, r: EventRecovery): void {
    const deferred = state.deferredEventReturns[name];
    if (deferred?.cycleId === r.cycleId) {
      deferred.checkpoint = null;
      return;
    }
    const command = state.commands[name];
    if (command?.cycleId === r.cycleId || command?.id === r.returnRoutes?.[name]?.commandId)
      delete state.commands[name];
    endHuntEventTrip(state, name, r.event, ports.now());
  }
  function complete(r: EventRecovery): boolean {
    if (!pending()) return false;
    delete r.blocker;
    if (!ownsConvoy(r)) { r.blocker = "Waiting for navigation owner: " + state.activeConvoy!.id; return false; }
    const current = ports.capture(r.participants);
    if (!r.participants.length || !r.participants.every(n => ready(n, r, current))) return false;
    if (state.activeConvoy) ports.cancelConvoy();
    for (const name of r.participants) finishMember(name, r);
    r.pending = [];
    r.phase = "handoff";
    r.returnCompletedAt = ports.now();
    resumeHunt(r);
    return true;
  }
  function resumeHunt(r: EventRecovery): void {
    const hunt = state.monsterHunt!;
    hunt.convoyId = null;
    if (hunt.stage === "paused-event") hunt.stage = hunt.resumeStage || "checking-quests";
    hunt.message = "Event exit complete; resuming Hunt after " + r.event;
    for (const name of r.participants) if (state.combatLogs) (state.combatLogs[name] ||= []).push({
      at: ports.now(), type: "navigation", message: hunt.message,
      details: { eventCycleId: r.cycleId, huntCycleId: hunt.cycleId, target: hunt.target },
    });
  }
  return { pending, complete };
}
