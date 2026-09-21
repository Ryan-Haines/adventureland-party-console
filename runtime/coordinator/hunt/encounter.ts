import { distance, zones } from "../../../dashboard/lib/farming-zones.ts";
import type { HuntCycle, HuntEncounter, HuntTickPorts, HuntTickState } from "./contracts.ts";
import { encounterLootPending } from "./loot.ts";
import { shouldReturn } from "../../hunt/policy.ts";
import { encounterNavigationBlocked as blocked } from "./encounter-ownership.ts";

function sameTarget(target: { id: string; map: string; in?: string | number; server?: string }, encounter: HuntEncounter): boolean {
  const expected = encounter.target;
  return target.id === expected.id && target.map === expected.map &&
    String(target.in ?? target.map) === String(expected.in ?? expected.map) &&
    (!target.server || target.server === expected.server);
}

function fresh(at: number | undefined, now: number): boolean {
  return at !== undefined && now - at <= 3000 && at <= now + 500;
}

function observations(hunt: HuntCycle, state: HuntTickState, now: number): boolean {
  return hunt.participants.every(name => {
    const status = state.statuses[name];
    return !!status && !status.rip && status.hp !== 0 && fresh(status.seenAt, now) &&
      fresh(status.groupedCombat?.currentAttackersAt, now);
  });
}

function confirmedDeath(encounter: HuntEncounter, hunt: HuntCycle, state: HuntTickState, now: number): boolean {
  const deaths = [...state.groupedCombat?.deaths || [],
    ...hunt.participants.flatMap(name => state.statuses[name]?.groupedCombat?.deaths || [])];
  return deaths.some(death => death.at >= encounter.startedAt && death.at <= now + 500 && sameTarget(death, encounter));
}

function visible(encounter: HuntEncounter, hunt: HuntCycle, state: HuntTickState, now: number): boolean {
  const claims = hunt.participants.flatMap(name => state.statuses[name]?.groupedCombat?.claims || []);
  if (claims.some(c => c.external && fresh(c.at, now) && sameTarget(c, encounter))) return false;
  return hunt.participants.some(name => {
    const status = state.statuses[name]!;
    if (status.server !== encounter.target.server) return false;
    return [...status.groupedCombat?.candidates || [], ...status.groupedCombat?.sightings || []]
      .some(target => target.hp !== 0 && sameTarget(target, encounter));
  });
}

function log(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts, reason: string): void {
  if (!state.combatLogs) return;
  (state.combatLogs[String(state.leader)] ||= []).push({ at: ports.now(), type: "navigation",
    message: "Resuming Hunt travel: " + reason, details: { cycleId: hunt.cycleId,
      retainedDestination: hunt.missions[hunt.currentIndex]?.destination, encounterPosition: hunt.encounter?.target } });
}

/** Durable encounter identity, with observation time that cannot advance during an outage or restart. */
export function createHuntEncounter(state: HuntTickState, ports: HuntTickPorts) {
  let lastSample: number | undefined, sampled: HuntEncounter | undefined;
  function accumulate(hunt: HuntCycle, encounter: HuntEncounter): void {
    if (sampled !== encounter) { sampled = encounter; lastSample = undefined; }
    const sample = Math.min(...hunt.participants.map(name => state.statuses[name]!.groupedCombat!.currentAttackersAt!));
    if (visible(encounter, hunt, state, ports.now())) encounter.missingMs = 0;
    else if (lastSample !== undefined && sample - lastSample <= 3000)
      encounter.missingMs = (encounter.missingMs || 0) + Math.max(0, sample - lastSample);
    lastSample = sample;
  }
  function observe(hunt: HuntCycle, encounter: HuntEncounter): boolean {
    const now = ports.now();
    if (!observations(hunt, state, now)) { lastSample = undefined; return false; }
    if (confirmedDeath(encounter, hunt, state, now)) encounter.resumeReason = "encountered monster died";
    if (shouldReturn(hunt, state.leader!, state.statuses)) encounter.resumeReason = "quest complete or due for turn-in";
    if (encounter.resumeReason) return true;
    accumulate(hunt, encounter);
    if ((encounter.missingMs || 0) < 5000) return false;
    encounter.resumeReason = "encountered monster absent for five seconds of fresh observations";
    return true;
  }

  function step(hunt: HuntCycle): boolean {
    const encounter = hunt.encounter;
    if (!encounter) return false;
    if (!currentEncounter(hunt, encounter)) {
      delete hunt.encounter;
      return false;
    }
    if (blocked(hunt, state, ports, encounter.revisions)) { lastSample = undefined; return true; }
    hunt.message = "Fighting encountered " + hunt.target + "; continuing to hunt area afterward";
    if (!observe(hunt, encounter)) return true;
    if (encounterLootPending(hunt, state, ports)) { ports.persist(); return true; }
    // Travel owns only the completed handoff's commands, never a later command.
    for (const name of hunt.participants) {
      if (state.commands[name]?.convoyHandoff === encounter.convoyId) delete state.commands[name];
    }
    log(hunt, state, ports, encounter.resumeReason!);
    delete hunt.encounter;
    delete hunt.arrivalHandoff;
    hunt.convoyId = null;
    hunt.stage = "mission-travel";
    ports.persist();
    return false;
  }
  return { step, pause: () => { lastSample = undefined; } };
}

function currentEncounter(hunt: HuntCycle, encounter: HuntEncounter): boolean {
  return encounter.cycleId === hunt.cycleId && encounter.missionIndex === hunt.currentIndex &&
    encounter.missionRevision === (hunt.missionRevision || 0) && encounter.target.mtype === hunt.target;
}

function needsReconciliation(hunt: HuntCycle, ports: HuntTickPorts): boolean {
  const mission = hunt.missions[hunt.currentIndex];
  return !!mission && mission.destinationVersion !== 1 && !hunt.encounter && !!ports.monsterDestination;
}

function canReconcile(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  return ports.fresh(hunt) && hunt.participants.every(name => fresh(state.statuses[name]?.seenAt, ports.now())) &&
    !blocked(hunt, state, ports, hunt.missions[hunt.currentIndex]!.destinationRevisions);
}

/** Repair destinations saved by the old point-adoption protocol, without resetting any quests. */
export function reconcileHuntDestination(hunt: HuntCycle, state: HuntTickState, ports: HuntTickPorts): boolean {
  if (!needsReconciliation(hunt, ports)) return false;
  const mission = hunt.missions[hunt.currentIndex]!;
  if (!canReconcile(hunt, state, ports)) return true;
  mission.destinationRevisions ||= Object.fromEntries(hunt.participants.map(name => [name, ports.intent(name).revision || 0]));
  const catalog = zones(state.monsterChoices || [], [mission.target]);
  if (!catalog.length) {
    hunt.message = "Waiting for " + mission.target + " spawn catalog to repair Hunt destination";
    return true;
  }
  if (catalog.some(area => distance(area, mission.destination) === 0)) {
    mission.destinationVersion = 1;
    ports.persist();
    return false;
  }
  if (ports.partyFighting(hunt)) return true;
  const destination = ports.monsterDestination!(mission.target);
  if (!destination) { hunt.message = "Waiting for a valid " + mission.target + " spawn destination"; return true; }
  mission.destination = destination;
  mission.destinationVersion = 1;
  delete hunt.arrivalHandoff;
  hunt.convoyId = null;
  hunt.stage = "mission-travel";
  log(hunt, state, ports, "repaired legacy encounter destination");
  ports.persist();
  return false;
}
