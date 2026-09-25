import { priority } from "../../hunt/policy.ts";
import type { HuntCycle, HuntConvoy, HuntCommand } from "../hunt/contracts.ts";
import type { EventRecovery, ReturnStatus, Waypoints } from "./return-types.ts";
import { endHuntEventTrip, type HuntEventTrips } from "./hunt-trip.ts";
import type { StoredCombatLogEntry } from "../telemetry/combat-log.ts";

export interface HuntReturnState extends HuntEventTrips {
  farmingPolicy?: string;
  monsterHunt?: HuntCycle | null;
  activeConvoy: (HuntConvoy & { merchantInterruption?: unknown }) | null;
  commands: Record<string, HuntCommand | undefined>;
  statuses: Record<string, ReturnStatus | undefined>;
  deferredEventReturns: Record<string, { cycleId: string; checkpoint?: import("./return-types.ts").ReturnLocation | null } | undefined>;
  escape?: { stage: string } | null;
  combatRecovery?: { phase: string } | null;
  combatLogs?: Record<string, StoredCombatLogEntry[]>;
}
interface Ports {
  now(): number;
  capture(names: string[]): Waypoints;
  cancelConvoy(): void;
}

/** An event exit can finish into a protected Daisy journey, without a second checkpoint convoy. */
export function createHuntReturnHandoff(state: HuntReturnState, ports: Ports) {
  function huntReturn(): HuntCycle | null {
    const hunt = state.monsterHunt;
    return hunt && priority(hunt) && hunt.stage === "returning" ? hunt : null;
  }
  function revision(hunt: HuntCycle, name: string): number | undefined {
    const convoy = state.activeConvoy;
    if (convoy) return convoy.id === hunt.convoyId && convoy.purpose === "monster-hunt"
      ? convoy.expected?.[name]?.revision : undefined;
    return hunt.travelCheckpoint?.revisions[name];
  }
  function authorized(hunt: HuntCycle, name: string, current: Waypoints): boolean {
    return hunt.participants.includes(name) && !!current[name]?.location &&
      current[name]?.revision === revision(hunt, name);
  }
  function preservesTravel(name: string): boolean {
    const hunt = huntReturn(), convoy = state.activeConvoy;
    if (!hunt || !convoy || convoy.phase === "failed") return false;
    return authorized(hunt, name, ports.capture([name])) &&
      state.commands[name]?.convoyId === convoy.id;
  }
  function blocked(): boolean {
    return !!(state.escape && state.escape.stage !== "released") ||
      !!(state.combatRecovery && !["complete", "cancelled"].includes(state.combatRecovery.phase));
  }
  function ready(name: string, recovery: EventRecovery): boolean {
    const status = state.statuses[name], command = state.commands[name];
    if (!exited(status, recovery)) return false;
    if (!command || (command.convoyId && command.convoyId === state.activeConvoy?.id)) return true;
    return command.type === "event-return-town" && command.cycleId === recovery.cycleId &&
      townReady(status, recovery);
  }
  function exited(status: ReturnStatus | undefined, recovery: EventRecovery): status is ReturnStatus {
    return !!status && ports.now() - Number(status.seenAt || 0) <= 3000 && !status.rip &&
      status.map === "main" && status.mapEvent !== recovery.event;
  }
  function townReady(status: ReturnStatus, recovery: EventRecovery): boolean {
    return status.eventRecovery?.cycleId === recovery.cycleId &&
      ["town-ready", "deferred-town-ready"].includes(status.eventRecovery.phase);
  }
  function authorizedParty(hunt: HuntCycle, recovery: EventRecovery): boolean {
    const current = ports.capture(hunt.participants);
    return hunt.participants.every(name => authorized(hunt, name, current) && ready(name, recovery)) &&
      recovery.participants.every(name => authorized(hunt, name, current) &&
        recovery.waypoints?.[name]?.revision === current[name]?.revision);
  }
  function replacedByTown(convoy: HuntConvoy): boolean {
    return convoy.failureCode === "owner-lost" && !!convoy.failure?.includes("event-return-town");
  }
  function complete(recovery: EventRecovery): boolean {
    const hunt = huntReturn();
    if (!hunt || blocked() || !recovery.participants.length) return false;
    if (!authorizedParty(hunt, recovery)) return false;
    const convoy = state.activeConvoy;
    if (convoy?.phase === "failed" && !replacedByTown(convoy)) return false;
    retireFailedReturn(hunt);
    for (const name of recovery.participants) {
      finishMember(name, recovery);
      log(name, recovery, hunt);
    }
    recovery.pending = [];
    recovery.returnCompletedAt = ports.now();
    hunt.message = "Returning to Daisy after " + recovery.event;
    return true;
  }
  function retireFailedReturn(hunt: HuntCycle): void {
    if (state.activeConvoy?.phase !== "failed") return;
    ports.cancelConvoy();
    hunt.convoyId = null;
  }
  function finishMember(name: string, recovery: EventRecovery): void {
    const command = state.commands[name];
    if (command?.cycleId === recovery.cycleId && command.type === "event-return-town")
      delete state.commands[name];
    if (state.deferredEventReturns[name]?.cycleId === recovery.cycleId)
      delete state.deferredEventReturns[name];
    endHuntEventTrip(state, name, recovery.event, ports.now());
  }
  function log(name: string, recovery: EventRecovery, hunt: HuntCycle): void {
    if (state.combatLogs) (state.combatLogs[name] ||= []).push({
        at: ports.now(), type: "navigation",
        message: "Event exit complete; continuing protected Daisy return",
        details: { event: recovery.event, eventCycleId: recovery.cycleId, huntCycleId: hunt.cycleId },
    });
  }
  return { preservesTravel, complete };
}
