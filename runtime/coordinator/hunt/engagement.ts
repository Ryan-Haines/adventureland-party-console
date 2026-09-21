import { recordConvoyHistory, type ConvoyHistoryState } from "../navigation/convoy-history.ts";
import { distance as zoneDistance, zones, type Catalog } from "../../../dashboard/lib/farming-zones.ts";
import type { ConvoyNavigationPlatform } from "../infrastructure/convoy-platform.ts";
import type { HuntCycle } from "./contracts.ts";
import type { ReturnLocation } from "../events/return-types.ts";
import type { SharedConvoy, SharedStatus } from "../navigation/shared-route-types.ts";
import { samePlace } from "../navigation/shared-route-types.ts";

interface Command {
  id: number; type: string; convoyId?: string; huntTarget?: string;
  combatHandoffAllowed?: boolean; navigationRevision?: number;
  convoyHandoff?: string; location?: ReturnLocation; label?: string;
}
interface State extends ConvoyHistoryState {
  activeConvoy: SharedConvoy | null;
  commands: Record<string, Command | undefined>;
  statuses: Record<string, (SharedStatus & Pick<import("./contracts.ts").HuntStatus, "activeEvent" | "joinedEvent">) | undefined>;
  farmingPolicy: string;
  monsterHunt: HuntCycle | null;
  monsterChoices?: Catalog;
  characterLocations: Record<string, ReturnLocation | undefined>;
  location: ReturnLocation | null;
  nextCommandId: number;
  lastConvoyEngagement?: unknown;
  navigationIntents?: Record<string, { revision: number; cancelled?: boolean } | undefined>;
}
interface Target extends ReturnLocation { id: string; mtype: string }
type Options = Parameters<ConvoyNavigationPlatform["engage"]>[2];

/** Legacy phase transitions also issue commands; preserve the mission's acquisition scope. */
export function propagateHuntTarget(input: Parameters<ConvoyNavigationPlatform["step"]>[0]): void {
  const state = input as State, convoy = state.activeConvoy;
  if (!convoy?.huntTarget) return;
  for (const name of convoy.participants) {
    const command = state.commands[name];
    if (command?.convoyId !== convoy.id) continue;
    command.huntTarget = convoy.huntTarget;
    command.combatHandoffAllowed = convoy.combatHandoffAllowed;
  }
}

function activeMission(state: State, c: SharedConvoy, type: string): boolean {
  const hunt = state.monsterHunt;
  return state.farmingPolicy === "hunt" && !!hunt && hunt.stage === "mission-travel" &&
    hunt.convoyId === c.id && hunt.target === type && c.huntTarget === type &&
    hunt.missions[hunt.currentIndex]?.target === type;
}

function nearby(status: SharedStatus | undefined, target: Target, radius: number, now: number): boolean {
  if (!status || status.rip || status.hp === 0 || now - status.seenAt > 3000 || status.seenAt > now + 500) return false;
  return samePlace(target, status) &&
    Number.isFinite(target.x) && Number.isFinite(target.y) &&
    Math.hypot(target.x - status.x, target.y - status.y) <= radius;
}

function authorized(state: State, c: SharedConvoy, options: Options): boolean {
  return c.participants.every(name => {
    const command = state.commands[name], intent = state.navigationIntents?.[name];
    return participantAvailable(state.statuses[name]) && !intent?.cancelled && (!intent || intent.revision === options.revisions[name]) &&
      !!command && command.convoyId === c.id && command.navigationRevision === options.revisions[name];
  });
}
function participantAvailable(s: State["statuses"][string]): boolean {
  return !!s && !s.rip && s.hp !== 0 && !s.activeEvent && !s.joinedEvent;
}

function destination(state: State, target: Target): ReturnLocation | null {
  const zone = zones(state.monsterChoices || [], [target.mtype])
    .find(area => zoneDistance(area, target) === 0);
  return zone ? { ...zone, in: target.in } : null;
}

function handoff(state: State, c: SharedConvoy, body: Record<string, unknown>, target: Target, options: Options, now: number): void {
  const spawn = destination(state, target);
  const hunt = state.monsterHunt!, mission = hunt.missions[hunt.currentIndex]!;
  const location = spawn || { map: target.map, in: target.in, x: target.x, y: target.y };
  if (spawn) { mission.destination = spawn; mission.destinationVersion = 1; delete hunt.encounter; }
  else hunt.encounter = { target: { ...target, server: state.statuses[String(body.character)]!.server! },
    cycleId: hunt.cycleId, missionIndex: hunt.currentIndex, missionRevision: hunt.missionRevision || 0,
    convoyId: c.id, revisions: { ...options.revisions }, startedAt: now };
  recordConvoyHistory(state, c, "hunt handoff", now, { target: { ...target },
    handoff: spawn ? "spawn" : "temporary", retainedDestination: mission.destination, encounterPosition: location });
  c.location = location;
  state.location = { ...location };
  for (const name of c.participants) {
    state.characterLocations[name] = { ...location };
    if (name === body.character || nearby(state.statuses[name], target, options.radius, now)) delete state.commands[name];
    else state.commands[name] = { id: state.nextCommandId++, type: "event-resume-travel",
      convoyHandoff: c.id, location: { map: target.map, in: target.in, x: target.x, y: target.y }, navigationRevision: options.revisions[name],
      label: spawn ? "the encountered hunt spawn" : "the temporary hunt encounter" };
  }
  state.lastConvoyEngagement = { character: body.character, target: { ...target }, at: now,
    convoyId: c.id, epoch: c.epoch };
  state.activeConvoy = null;
}

/** Only mission travel uses a character-centered radius; ordinary routes retain their area rule. */
function departed(c: SharedConvoy, now: number): boolean {
  return c.cause !== "farming-conflict" && c.combatHandoffAllowed &&
    (["assemble", "shared-prepare"].includes(c.phase) || ["scheduled", "travel"].includes(c.phase) && c.departAt != null && now >= c.departAt);
}
function validTarget(state: State, c: SharedConvoy, body: Record<string, unknown>, options: Options, now: number): body is Record<string, unknown> & { target: Target } {
  const target = body.target as Target | undefined, name = String(body.character);
  return !!target?.id && activeMission(state, c, target.mtype) &&
    Number(body.navigationRevision) === options.revisions[name] &&
    nearby(state.statuses[name], target, options.radius, now);
}
export function engageHunt(input: Parameters<ConvoyNavigationPlatform["engage"]>[0], body: Record<string, unknown>,
  options: Options, legacy: Pick<ConvoyNavigationPlatform, "engage" | "validReport">, now = Date.now()): boolean {
  const state = input as State, c = state.activeConvoy;
  if (c?.purpose !== "monster-hunt") return legacy.engage(input, body, options);
  if (!departed(c, now)) return false;
  if (!legacy.validReport(input, body) || !authorized(state, c, options)) return false;
  if (!validTarget(state, c, body, options, now)) return false;
  handoff(state, c, body, body.target, options, now);
  return true;
}
