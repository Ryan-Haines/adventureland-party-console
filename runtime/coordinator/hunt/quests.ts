import {recordHuntFailure} from "./settings.ts";
import * as policy from "../../hunt/policy.ts";
import type { HuntCommand, HuntCycle, HuntStatus, HuntTickState } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import { reconcileCurrentHuntParty } from "./current-party.ts";

export interface HuntQuestPorts {
  now(): number;
  nextCommand(): number;
  fresh(hunt: HuntCycle): boolean;
  endBlacklisted(hunt: HuntCycle): void;
  start(
    hunt: HuntCycle,
    location: ReturnLocation | null | undefined,
    label: string,
    stage: string,
  ): unknown;
  missionDestination(hunt: HuntCycle): ReturnLocation | null | undefined;
  monsterDestination(type: string): ReturnLocation | null | undefined;
  cancelConvoy(): void;
  persist(): void;
  clear(): void;
  selectedDestination(name: string): { location: ReturnLocation } | null;
  startNormal(location: ReturnLocation, label: string, names: string[]): unknown;
}

function interactionCompleted(command: HuntCommand, status: HuntStatus, now: number): boolean {
  const completed =
    (command.action === "assign" && status.monsterHunt) ||
    (command.action === "claim" && !status.monsterHunt);
  const stale =
    command.issuedAt && now - command.issuedAt > 15000 && status.seenAt > command.issuedAt;
  return !!(completed || stale);
}

export function createHuntQuests(state: HuntTickState, ports: HuntQuestPorts) {
  function issue(name: string, action: string, hunt: HuntCycle): boolean {
    if (!state.statuses[name] || state.commands[name]) return false;
    state.commands[name] = {
      id: ports.nextCommand(),
      type: "monster-hunt-interact",
      purpose: "monster-hunt",
      cycleId: hunt.cycleId,
      action,
      issuedAt: ports.now(),
    };
    return true;
  }

  function selection(hunt: HuntCycle) {
    return policy.selection(hunt, state.leader!, state.statuses, state.huntBlacklist || {});
  }

  function build(hunt: HuntCycle): void {
    delete hunt.encounter;
    hunt.missionRevision = (hunt.missionRevision || 0) + 1;
    delete hunt.loot;
    hunt.owner = policy.owner(hunt, state.leader!);
    hunt.policyVersion = 3;
    hunt.missions = policy.missions(hunt, state.leader!, state.statuses, state.huntBlacklist || {});
    hunt.owner = selection(hunt)?.owner || state.leader!;
    hunt.selectionLeader = state.leader!;
    hunt.currentIndex = -1;
  }

  function returnToDaisy(hunt: HuntCycle): void {
    if (["returning", "at-daisy"].includes(hunt.stage)) return;
    policy.beginTurnIn(hunt, state.leader!);
    hunt.target = null;
    delete hunt.encounter;
    delete hunt.arrivalHandoff;
    ports.persist();
    ports.cancelConvoy();
    ports.start(hunt, state.monsterHunterLocation, "Monster Hunt turn-in", "returning");
  }

  function unfinished(mission: HuntCycle["missions"][number]): boolean {
    return mission.owners.some((name) => {
      const quest = state.statuses[name]?.monsterHunt;
      return quest && quest.id === mission.target && quest.count > 0;
    });
  }

  function startMission(hunt: HuntCycle, index: number): boolean {
    const mission = hunt.missions[index]!;
    if (mission.skipped || state.huntBlacklist?.[mission.target] || !unfinished(mission))
      return false;
    const destination = (mission.destination ||= ports.monsterDestination(mission.target));
    if (destination) mission.destinationVersion = 1;
    hunt.currentIndex = index;
    hunt.target = mission.target;
    if (destination)
      ports.start(hunt, destination, "Monster Hunt: " + mission.target, "mission-travel");
    else mission.skipped = true;
    return !mission.skipped;
  }

  function advance(hunt: HuntCycle): void {
    delete hunt.travelCause;
    ports.cancelConvoy();
    for (let index = Number(hunt.currentIndex) + 1; index < (hunt.missions || []).length; index++)
      if (startMission(hunt, index)) return;
    hunt.target = null;
    const selected = selection(hunt);
    if (!selected) {
      ports.endBlacklisted(hunt);
      return;
    }
    if (selected.action === "pickup") {
      prepare(hunt);
      return;
    }
    returnToDaisy(hunt);
  }

  function adoptSelection(
    hunt: HuntCycle,
    selected: NonNullable<ReturnType<typeof selection>>,
  ): void {
    hunt.owner = selected.owner;
    hunt.selectionLeader = state.leader!;
    hunt.policyVersion = 3;
    hunt.pickupPending = selected.action === "pickup";
  }

  function resumeSelection(
    hunt: HuntCycle,
    selected: NonNullable<ReturnType<typeof selection>>,
  ): void {
    if (hunt.pickupPending) {
      hunt.target = null;
      ports.start(
        hunt,
        state.monsterHunterLocation,
        "Picking up Monster Hunt for " + selected.owner,
        "daisy-sync-travel",
      );
    } else if (selected.action === "claim") {
      hunt.waitForExpiry = selected.action !== "claim";
      returnToDaisy(hunt);
    } else if (
      hunt.target === selected.quest!.id &&
      (hunt.missions || [])[hunt.currentIndex]?.target === hunt.target
    ) {
      ports.start(
        hunt,
        ports.missionDestination(hunt),
        "Monster Hunt: " + hunt.target,
        "mission-travel",
      );
    } else {
      build(hunt);
      advance(hunt);
    }
  }

  function prepare(hunt: HuntCycle): void {
    if (reconcileCurrentHuntParty(hunt, state, ports.now(), () => ports.cancelConvoy())) ports.persist();
    if (hunt.backup) {
      hunt.stage = "backup-travel";
      return;
    }
    if (!ports.fresh(hunt)) return;
    if (
      hunt.participants.some(
        (name) => state.statuses[name]?.activeEvent || state.statuses[name]?.joinedEvent,
      ) ||
      state.eventReturn
    ) {
      hunt.message = "Waiting for combat event before checking Hunt quests";
      return;
    }
    if (hunt.batchPickup && !hunt.exitMode) {
      hunt.target = null;
      ports.start(
        hunt,
        state.monsterHunterLocation,
        "Picking up the next Hunt batch",
        "daisy-sync-travel",
      );
      return;
    }
    const selected = selection(hunt);
    if (!selected) {
      ports.endBlacklisted(hunt);
      return;
    }
    adoptSelection(hunt, selected);
    resumeSelection(hunt, selected);
    ports.persist();
  }

  function acknowledge(hunt: HuntCycle): void {
    for (const name of hunt.participants) {
      const command = state.commands[name],
        status = state.statuses[name]!;
      if (command?.type !== "monster-hunt-interact" || command.cycleId !== hunt.cycleId) continue;
      if (hunt.batchPickup && command.issuedAt && status.seenAt <= command.issuedAt) continue;
      if (interactionCompleted(command, status, ports.now())) delete state.commands[name];
    }
  }

  function pending(hunt: HuntCycle): boolean {
    return hunt.participants.some((name) => state.commands[name]?.type === "monster-hunt-interact");
  }

  function assign(hunt: HuntCycle): boolean {
    if (hunt.stage !== "assigning" || policy.priority(hunt)) return false;
    const selected = selection(hunt);
    if (!selected) {
      ports.endBlacklisted(hunt);
      return true;
    }
    adoptSelection(hunt, selected);
    if (hunt.pickupPending) {
      hunt.message = "Assigning Monster Hunt to " + selected.owner;
      issue(selected.owner, "assign", hunt);
      return true;
    }
    if (selected.action === "claim") return false;
    build(hunt);
    advance(hunt);
    ports.persist();
    return true;
  }

  function claim(hunt: HuntCycle): boolean {
    if (hunt.turnIn && policy.priority(hunt)) hunt.turnIn.phase = "claiming";
    let changed = false;
    for (const name of hunt.participants) {
      const live = state.statuses[name]?.monsterHunt;
      if (live && live.count === 0) changed = issue(name, "claim", hunt) || changed;
    }
    return changed || pending(hunt);
  }

  function exit(hunt: HuntCycle): boolean {
    if (!hunt.exitMode) return false;
    const names = hunt.participants.filter(
      (name) => name === state.leader || state.followers[name],
    );
    ports.clear();
    const destination = ports.selectedDestination(state.leader!);
    if (destination)
      ports.startNormal(destination.location, "the leader's configured farming focus", names);
    ports.persist();
    return true;
  }

  function blacklistExpired(hunt: HuntCycle): void {
    if (!hunt.waitForExpiry || !hunt.target || policy.quest(hunt, state.leader!, state.statuses))
      return;
    const tracked = Object.values(hunt.expiryAttempts || {}).some(a => a.target === hunt.target && a.revision === (hunt.missionRevision || 0));
    const status = state.statuses[policy.owner(hunt, state.leader!)];
    if (!status || !('monsterHunt' in status)) return;
    if (!tracked && !state.huntBlacklist?.[hunt.target]) recordHuntFailure(state, hunt.target, 'expirations', 1, ports.now());
    hunt.target = null;
    ports.persist();
  }

  function nextQuest(hunt: HuntCycle): void {
    blacklistExpired(hunt);
    const quest = policy.quest(hunt, state.leader!, state.statuses);
    const unfinished = !!quest && quest.count > 0;
    if (unfinished && !hunt.waitForExpiry) {
      hunt.stage = "assigning";
      process(hunt);
      return;
    }
    if (unfinished) {
      hunt.stage = "waiting-expiry";
      hunt.message = "Waiting at Daisy for the selected hunt to expire; events remain allowed";
      return;
    }
    hunt.waitForExpiry = false;
    hunt.stage = "assigning";
    hunt.message = "Assigning Monster Hunts";
    process(hunt);
  }

  function atDaisy(hunt: HuntCycle): boolean {
    const daisy = state.monsterHunterLocation;
    if (!daisy) {
      hunt.message = "Waiting for Daisy location data";
      return false;
    }
    if (
      !hunt.participants.some((name) => {
        const status = state.statuses[name]!;
        return status.map !== daisy.map || Math.hypot(status.x - daisy.x, status.y - daisy.y) > 100;
      })
    )
      return true;
    ports.start(
      hunt,
      daisy,
      "Regrouping at Daisy for missing Hunt interactions",
      "daisy-sync-travel",
    );
    return false;
  }

  function assignBatch(hunt: HuntCycle): boolean {
    if (hunt.batchPickup && !hunt.exitMode) {
      const missing = hunt.participants.filter(
        (n) => !state.statuses[n]?.monsterHunt || state.statuses[n]!.monsterHunt!.remainingMs <= 0,
      );
      for (const name of missing) issue(name, "assign", hunt);
      if (missing.length || pending(hunt)) {
        hunt.message =
          "Picking up Hunt batch: " +
          (hunt.participants.length - missing.length) +
          "/" +
          hunt.participants.length +
          " assigned";
        return true;
      }
      hunt.batchPickup = false;
      hunt.stage = "assigning";
      ports.persist();
    }
    return false;
  }
  function process(hunt: HuntCycle): void {
    if (!ports.fresh(hunt) || !atDaisy(hunt)) return;
    acknowledge(hunt);
    if (assignBatch(hunt)) return;
    if (pending(hunt) || (!hunt.exitMode && assign(hunt)) || claim(hunt)) return;
    policy.completeTurnIn(hunt, ports.now());
    if (policy.eventsPending(hunt, state.statuses, ports.now())) {
      hunt.message = "Rewards checked; allowing pending events before the next hunt";
      ports.persist();
      return;
    }
    if (!exit(hunt)) nextQuest(hunt);
  }
  return { issue, build, returnToDaisy, advance, prepare, process };
}
