/**
 * Read-only task phases for the dashboard card strip's activity label
 * (dashboard/features/party/character-activity.ts). The core section omits
 * these sources: farming profiles and event attendance are config fields, and escape, daily dungeons and the character-side event
 * exit and farm reunion are not public at all. This copies only the phase
 * and name fields the label reads, so polling stays small and no
 * coordinator behaviour depends on it.
 *
 * The top-level hunt, convoy and farm fields are the leader's farming
 * profile (hunt/scopes.ts). A character outside the leader's party runs its
 * own profile, so `profiles` carries each character's owning profile.
 */
interface ActivitySources {
  leader?: unknown;
  followers?: unknown;
  merchantCharacter?: unknown;
  farmingProfiles?: unknown;
  eventAttendance?: unknown;
  escape?: unknown;
  dailyDungeons?: unknown;
  statuses: Readonly<Record<string, object | undefined>>;
}
type Loose = Record<string, unknown> | null | undefined;
const record = (value: unknown): Loose => value && typeof value === "object" ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value ? value : null;
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;

function attendance(value: unknown): Record<string, Record<string, { ignored: string | null; dead: boolean }>> {
  const result: Record<string, Record<string, { ignored: string | null; dead: boolean }>> = {};
  for (const [name, events] of Object.entries(record(value) || {})) {
    for (const [event, entry] of Object.entries(record(events) || {})) {
      const instance = record(entry);
      // Ended rounds no longer describe what the character is doing.
      if (!instance || instance.ended || !(instance.ignored || instance.dead)) continue;
      (result[name] ||= {})[event] = { ignored: text(instance.ignored), dead: !!instance.dead };
    }
  }
  return result;
}

function characterStage(value: unknown): string | null {
  const phase = text(record(value)?.phase);
  return phase === "idle" || phase === "complete" || phase === "cancelled" ? null : phase;
}

export interface PlacePhase { map?: string; mapName?: string; monsterIds?: string[] }
export interface HuntPhase {
  stage: string; participants: string[]; target?: string | null; message?: string; recovering?: boolean;
  encounter?: unknown; currentIndex?: number; missions?: { target: string }[]; turnIn?: { phase: string } | null;
}
export interface ConvoyPhase {
  id?: string; phase: string; purpose?: string | null; label?: string; failure?: string; defenseReason?: string;
  participants?: string[]; walkingActivity?: string; walkingEvent?: string; eventPursuitBossId?: string | null;
  merchantInterruption?: { phase?: string } | null; location?: PlacePhase | null;
}
export interface RarePhase { encounter?: { mtype: string; stage: string } | null; patrol?: { stage: string } | null }
// PublicState leaves the coordinator's own phase objects untyped; these
// interfaces name the fields the label reads, as hunt/, navigation/ and
// events/ write them.
function pick<T>(value: unknown, keys: readonly string[]): T | null {
  const source = record(value);
  return source ? Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]])) as T : null;
}
const huntKeys = ["stage", "participants", "target", "message", "recovering", "encounter", "currentIndex", "missions", "turnIn"] as const;
const convoyKeys = ["id", "phase", "purpose", "label", "failure", "defenseReason", "participants", "walkingActivity",
  "walkingEvent", "eventPursuitBossId", "merchantInterruption"] as const;

function convoy(value: unknown): ConvoyPhase | null {
  const result = pick<ConvoyPhase>(value, convoyKeys);
  if (result) result.location = pick<PlacePhase>(record(value)?.location, ["map", "mapName", "monsterIds"]);
  return result;
}

function farm(value: unknown) {
  const state = record(value);
  return state ? { active: pick<PlacePhase>(state.active, ["map", "mapName", "monsterIds"]), pending: state.pending ? true : null, paused: !!state.paused } : null;
}

function session(value: unknown) {
  const entry = record(value), event = text(entry?.event);
  return entry && event ? { event, spawnAt: number(entry.stagingSpawnAt), live: !!entry.wasLive } : null;
}

function profilePhases(name: string, profile: Record<string, unknown>) {
  return {
    monsterHunt: pick<HuntPhase>(profile.monsterHunt, huntKeys),
    activeConvoy: convoy(profile.activeConvoy),
    farmAreaState: farm(profile.farmAreaState),
    combatRecovery: pick<{ phase: string; names: string[] }>(profile.combatRecovery, ["phase", "names"]),
    eventReturn: pick<{ phase: string; event?: string; participants?: string[] }>(profile.eventReturn, ["phase", "event", "participants"]),
    rareHuntState: pick<RarePhase>(profile.rareHuntState, ["encounter", "patrol"]),
    partyFarmingMode: text(profile.partyFarmingMode),
    partyFarmingMonsterType: text(profile.partyFarmingMonsterType),
    eventSession: session(record(profile.eventSessions)?.[name]),
  };
}

/** Each character's owning profile: the leader's for a follower, its own otherwise (hunt/scopes.ts `owner`). */
function profiles(state: Readonly<ActivitySources>) {
  const leader = text(state.leader), followers = record(state.followers) || {}, saved = record(state.farmingProfiles) || {};
  const result: Record<string, ReturnType<typeof profilePhases>> = {};
  for (const name of Object.keys(state.statuses)) {
    const owner = leader && name !== state.merchantCharacter && followers[name] ? leader : name;
    const profile = record(saved[owner]);
    if (profile) result[name] = profilePhases(name, profile);
  }
  return result;
}

function dungeon(value: unknown) {
  const state = record(value);
  if (!state || state.phase === "idle") return null;
  const travel = record(state.travel), progress = record(state.progress), priest = record(state.priestRecovery);
  return {
    phase: text(state.phase),
    participants: Array.isArray(state.participants) ? state.participants.filter((name): name is string => typeof name === "string") : [],
    travel: text(travel?.stage),
    message: text(progress?.message),
    reviving: priest ? { priest: text(priest.priest), target: text(priest.target) } : null,
  };
}

function characters(statuses: ActivitySources["statuses"]) {
  const result: Record<string, { eventExit: string | null; farmReunion: string | null }> = {};
  for (const [name, status] of Object.entries(statuses)) {
    const fields = record(status);
    const eventExit = characterStage(fields?.eventRecovery), farmReunion = characterStage(fields?.farmReunion);
    if (eventExit || farmReunion) result[name] = { eventExit, farmReunion };
  }
  return result;
}

export function activityPhases(state: Readonly<ActivitySources>) {
  const escape = record(state.escape);
  return {
    profiles: profiles(state),
    attendance: attendance(state.eventAttendance),
    escape: escape ? { stage: text(escape.stage) } : null,
    dungeon: dungeon(state.dailyDungeons),
    characters: characters(state.statuses),
  };
}
export type ActivityPhases = ReturnType<typeof activityPhases>;
