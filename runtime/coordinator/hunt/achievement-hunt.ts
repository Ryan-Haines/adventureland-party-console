// Achievement Hunt, the "achievements" farming mode: chooses farming targets
// from monster kill-achievement progress and hands each one to the regular
// manual-monster convoy (docs/achievement-hunt.md § Failure modes).
import type { ReturnLocation } from "../events/return-types.ts";
import { defaultPassiveRule, type PassiveRule } from "../navigation/passive-settings.ts";
import { keepNewestAchievementBlacklist } from "../navigation/rare-retention.ts";
import {
  bossesOnGround,
  chooseAchievementTarget,
  createAchievementOrder,
  nearbyFillers,
  nearSpawnOf,
  spawnCount,
  nextStep,
  partyAchievementKills,
  wantedRares,
  type AchievementCatalogEntry,
  type AchievementChoice,
  type AchievementMonster,
  type AchievementTarget,
} from "../../hunt/achievement-policy.ts";
import {
  defaultAchievementHuntSettings,
  type AchievementBlacklistEntry,
  type AchievementHuntSettings,
  type AchievementTargetState,
} from "./achievement-settings.ts";

export interface AchievementHuntState {
  leader: string | null;
  farmingPolicy: string;
  monsterFocus: string[];
  statuses: Record<string, {
    seenAt: number;
    lastDeath?: { at?: number; eventTrip?: unknown } | null;
    rip?: boolean;
    hp?: number;
    map?: string;
    x?: number;
    y?: number;
    navigationState?: string;
    monsterAchievementKills?: Record<string, unknown> | null;
    /** Visible monsters from the target's avoid list, with whom each one attacks. */
    avoidSightings?: { mtype?: unknown; target?: unknown }[] | null;
  } | undefined>;
  bestiaryCatalog?: unknown;
  monsterChoices?: AchievementChoice[] | null;
  achievementHunt: AchievementHuntSettings;
  achievementBlacklist: Record<string, AchievementBlacklistEntry>;
  achievementTarget: AchievementTargetState | null;
  achievementMessage: string;
  /** Per character; followers read their own, so every member is set. */
  monsterPrioritiesByCharacter?: Record<string, Record<string, number> | undefined>;
  location?: { map: string; x: number; y: number } | null;
  activeConvoy?: unknown;
  /** Passive hunting rules this hunt switched on for selected rares, with the rule each replaced (null when unset). */
  achievementPassive?: Record<string, PassiveRule | null> | null;
}
export interface AchievementHuntPorts {
  now(): number;
  members(): string[];
  /** Why another owner holds travel right now (dungeon, event, rare hunt, convoy), or null. */
  busy(): string | null;
  destination(id: string): ReturnLocation | null | undefined;
  /** Starts the manual-monster convoy, staying in this mode; null when it could not start. */
  select(id: string, location: ReturnLocation): string[] | null;
  /** The leader's monster search radius. */
  radius(): number;
  persist(): void;
  /** Passive rare hunting, for the leader's scope only; independent characters have none. */
  passive?: { rule(id: string): PassiveRule | undefined; set(rules: Record<string, PassiveRule>): void };
}

// A focus change this soon after our own switch is still settling, not the player.
const SWITCH_GRACE_MS = 15_000;
// A party sent back to its target is sent again no sooner than this.
const RETURN_RETRY_MS = 30_000;
// A status older than this no longer says whether a character is dead.
const FRESH_STATUS_MS = 10_000;
// A monster whose route failed is retried after this long.
const UNROUTABLE_RETRY_MS = 10 * 60_000;
// Characters fight the highest focused priority tier in reach (characters/shared.js monsterPriority).
const TARGET_PRIORITY = 90;
const FILLER_PRIORITY = 10;

const killText = (kills: number, milestone: number, step: number) =>
  `${Math.floor(kills).toLocaleString()} / ${milestone.toLocaleString()} kills (step ${step + 1})`;

export function createAchievementHunt(state: AchievementHuntState, ports: AchievementHuntPorts) {
  const unroutable = new Map<string, number>();
  // Targets a boss holds: the boss and when a party member last saw it. Memory only: after a
  // restart the party goes back and, if the boss is still there and attacks, leaves again.
  const bossHolds = new Map<string, { boss: string; seenAt: number }>();
  // Deaths a boss-held target had when the party left it, picked up again on return.
  const carriedDeaths = new Map<string, number>();
  let returnedAt = -Infinity;
  // Set again after a restart or a settings change (failure mode 21).
  let refocus = true;

  // The monster list, rebuilt only when a new catalog or new monster choices arrive (failure mode 32).
  const ordered = createAchievementOrder();
  const monsterList = () => ordered(state.bestiaryCatalog as AchievementCatalogEntry[] | null, state.monsterChoices);
  const nameOf = (id: string): string => monsterList().byId.get(id)?.name || id;
  const settings = (): AchievementHuntSettings => (state.achievementHunt ||= { ...defaultAchievementHuntSettings });
  const say = (message: string): void => { state.achievementMessage = message; };
  function excluded(id: string): boolean {
    const failedAt = unroutable.get(id);
    return !!state.achievementBlacklist[id] || (failedAt !== undefined && ports.now() - failedAt < UNROUTABLE_RETRY_MS) ||
      bossHeld(id);
  }
  // A boss-held target is left until nobody has seen the boss for this long. The party can't see the
  // spawn while away, so it goes back after this long and checks. Older settings lack it: the default.
  const bossAwayMs = (): number =>
    (Number(settings().bossRecheckMinutes) || defaultAchievementHuntSettings.bossRecheckMinutes) * 60_000;
  function bossHeld(id: string): boolean {
    const hold = bossHolds.get(id);
    if (hold && ports.now() - hold.seenAt >= bossAwayMs()) bossHolds.delete(id);
    return bossHolds.has(id);
  }
  /** Fresh sightings of `names`' avoided bosses: [boss, whom it attacks]. */
  function bossSightings(names: string[]): [string, string | null][] {
    return names.flatMap((name) => {
      const status = state.statuses[name];
      if (!status || ports.now() - status.seenAt > FRESH_STATUS_MS) return [];
      return (status.avoidSightings || []).filter((seen) => typeof seen?.mtype === "string")
        .map((seen): [string, string | null] => [seen.mtype as string, typeof seen.target === "string" ? seen.target : null]);
    });
  }
  /** Leaves the target once one of its bosses attacks a party member; deaths still count against it. */
  function watchBosses(names: string[]): void {
    const sightings = bossSightings(names);
    for (const hold of bossHolds.values())
      if (sightings.some(([boss]) => boss === hold.boss)) hold.seenAt = ports.now();
    const current = state.achievementTarget;
    const attack = current && sightings.find(([boss, target]) => current.avoid?.includes(boss) && !!target && names.includes(target));
    if (current && attack && !bossHolds.has(current.id)) {
      bossHolds.set(current.id, { boss: attack[0], seenAt: ports.now() });
      carriedDeaths.set(current.id, current.deaths);
    }
  }
  /**
   * Passive hunting fights each wanted rare when a character sees it (docs/achievement-hunt.md § Rare spawns).
   * A rare the player already hunts passively is left alone; any other gets an enabled rule, and the rule it
   * replaced comes back once the rare is no longer wanted.
   */
  function syncRares(wanted: string[]): void {
    const passive = ports.passive;
    if (!passive) return;
    const saved = (state.achievementPassive ||= {});
    const changes = { ...enableRares(wanted, saved, (id) => passive.rule(id)), ...restoreRares(wanted, saved) };
    if (!Object.keys(changes).length) return;
    passive.set(changes);
    ports.persist();
  }
  /** Rules that switch on each wanted rare not already hunted passively, saving the rule each replaces. */
  function enableRares(wanted: string[], saved: Record<string, PassiveRule | null>,
    rule: (id: string) => PassiveRule | undefined): Record<string, PassiveRule> {
    const changes: Record<string, PassiveRule> = {};
    for (const id of wanted) {
      const current = rule(id);
      if (Object.hasOwn(saved, id) || (current?.enabled && !current.keepMoving)) continue;
      saved[id] = current ? { ...current } : null;
      changes[id] = { ...defaultPassiveRule(id), ...current, enabled: true, keepMoving: false };
    }
    return changes;
  }
  /** The saved rules of rares no longer wanted, put back. */
  function restoreRares(wanted: string[], saved: Record<string, PassiveRule | null>): Record<string, PassiveRule> {
    const changes: Record<string, PassiveRule> = {};
    for (const [id, rule] of Object.entries(saved)) {
      if (wanted.includes(id)) continue;
      changes[id] = rule || { ...defaultPassiveRule(id), enabled: false };
      delete saved[id];
    }
    return changes;
  }
  /** The selected monsters that may fill, or undefined when any regular monster may. */
  function fillerChoice(): ReadonlySet<string> | undefined {
    return settings().fillSelectedOnly === false ? undefined : new Set(settings().monsters);
  }
  function leaderOnline(): boolean {
    const status = state.leader ? state.statuses[state.leader] : undefined;
    return !!status && ports.now() - status.seenAt <= 10_000;
  }
  /** Leaves the mode for Auto, as picking a monster by hand does. */
  function stop(message: string): void {
    state.farmingPolicy = "auto";
    release();
    say(message);
    ports.persist();
  }

  /** Puts back the priorities the target replaced. */
  function restorePriorities(target: AchievementTargetState): void {
    const all = (state.monsterPrioritiesByCharacter ||= {});
    for (const [name, saved] of Object.entries(target.savedPriorities || {})) {
      const priorities = (all[name] ||= {});
      for (const [type, value] of Object.entries(saved)) {
        if (value === null) delete priorities[type];
        else priorities[type] = value;
      }
    }
    target.savedPriorities = {};
  }
  function release(): void {
    if (state.achievementTarget) restorePriorities(state.achievementTarget);
    state.achievementTarget = null;
  }
  /** Focuses the target and the nearby monsters to fight while it respawns, target first. */
  function focusWithFillers(target: AchievementTargetState, location: ReturnLocation, order: readonly AchievementMonster[]): void {
    const fillers = settings().fillIdle === false ? []
      : nearbyFillers(order, state.monsterChoices, target.id, location, excluded, fillerChoice());
    target.focus = [target.id, ...fillers];
    target.avoid = bossesOnGround(order, state.monsterChoices, target.id, location);
    target.savedPriorities = {};
    state.monsterFocus = target.focus.slice();
    if (!fillers.length) return;
    const all = (state.monsterPrioritiesByCharacter ||= {});
    for (const name of ports.members()) {
      const priorities = (all[name] ||= {});
      target.savedPriorities[name] = Object.fromEntries(target.focus.map((type) => [type, priorities[type] ?? null]));
      for (const type of target.focus) priorities[type] = type === target.id ? TARGET_PRIORITY : FILLER_PRIORITY;
    }
  }

  /** Counts each character's death once, and only deaths after the target started. */
  function newDeaths(target: AchievementTargetState, names: string[]): string[] {
    return names.filter((name) => {
      const death = state.statuses[name]?.lastDeath;
      const at = Number(death?.at) || 0;
      if (at <= target.startedAt || at === target.counted[name]) return false;
      target.counted[name] = at;
      // Hunt does not count deaths on an event trip either (scripts/hunt-safety.cjs eventDeath).
      if (death?.eventTrip) return false;
      target.deaths++;
      return true;
    });
  }
  /** Blacklists the target once the party has died there `deathThreshold` times. */
  function recordDeaths(names: string[]): void {
    const target = state.achievementTarget;
    if (!target) return;
    const died = newDeaths(target, names);
    if (!died.length) return;
    const options = settings();
    if (options.blacklistDeaths && target.deaths >= options.deathThreshold) {
      state.achievementBlacklist[target.id] = {
        monsterId: target.id, at: ports.now(), deaths: target.deaths, characters: died,
        reason: `${target.deaths} death${target.deaths === 1 ? "" : "s"} while farming for achievements`,
      };
      keepNewestAchievementBlacklist(state.achievementBlacklist);
    }
    ports.persist();
  }

  /** The player picked something else after our switch settled. */
  function focusChangedByHand(): boolean {
    const current = state.achievementTarget;
    return !!current && JSON.stringify(state.monsterFocus || []) !== JSON.stringify(current.focus || [current.id]) &&
      ports.now() - current.startedAt > SWITCH_GRACE_MS;
  }

  /**
   * Keeps the current target until its milestone is met, so lagging counts never cause a switch.
   * A monster at a lower step (re-selected, unblacklisted, or a route retry) takes over: kills only
   * rise, so that cannot thrash.
   */
  function stillWorking(kills: Record<string, number>, best: AchievementTarget | null): boolean {
    const current = state.achievementTarget;
    if (!current || dropped(current)) return false;
    const monster = monsterList().byId.get(current.id);
    const count = Number(kills[current.id]) || 0;
    if (!monster || nextStep(monster.ladder, count) !== current.step || (best && best.step < current.step)) return false;
    say(`Farming ${monster.name}: ${killText(count, current.milestone, current.step)}${standInText(current)}`);
    return true;
  }
  /** Unselected, excluded, or a stand-in whose boss-held target is free again. */
  function dropped(current: AchievementTargetState): boolean {
    return !settings().monsters.includes(current.id) || excluded(current.id) ||
      (!!current.standInFor && !bossHeld(current.standInFor));
  }
  /** " while Stompy holds White Wolf (back in 9m)" for a stand-in, or "". */
  function standInText(target: AchievementTargetState): string {
    const hold = target.standInFor ? bossHolds.get(target.standInFor) : undefined;
    if (!hold) return "";
    const minutes = Math.max(1, Math.ceil((bossAwayMs() - (ports.now() - hold.seenAt)) / 60_000));
    return ` while ${nameOf(hold.boss)} holds ${nameOf(target.standInFor!)} (back in ${minutes}m)`;
  }

  /** The state for a new target, with the deaths it had before a boss sent the party away. */
  function nextTarget(choice: AchievementTarget, previous: AchievementTargetState | null): AchievementTargetState {
    const target: AchievementTargetState = { id: choice.id, step: choice.step, milestone: choice.milestone, startedAt: ports.now(),
      deaths: carriedDeaths.get(choice.id) ?? 0, counted: {} };
    carriedDeaths.delete(choice.id);
    // Leaving a boss-held target, or moving on from one stand-in to another, keeps the target to return to.
    const held = [previous?.id, previous?.standInFor].find((id) => !!id && bossHeld(id));
    if (held && held !== choice.id) target.standInFor = held;
    return target;
  }
  // A start that throws skips the target like an unroutable one, so the error can't end every tick.
  function startTarget(id: string, location: ReturnLocation | null | undefined): { started: string[] | null; failure: string } {
    try { return { started: location ? ports.select(id, location) : null, failure: "" }; }
    catch (error) { return { started: null, failure: String((error as Error)?.message || error) }; }
  }
  function switchTo(choice: AchievementTarget | null, order: readonly AchievementMonster[]): void {
    if (!choice) {
      release();
      const names = Object.keys(state.achievementPassive || {}).map(nameOf);
      return say(names.length
        ? `No target to farm: fighting ${names.join(", ")} when seen`
        : "Nothing left to farm: every selected monster has finished its ladder or is skipped");
    }
    const location = ports.destination(choice.id);
    const { started, failure } = startTarget(choice.id, location);
    if (!started) {
      unroutable.set(choice.id, ports.now());
      return say(`Skipping ${choice.id}: ${failure || (location ? "the party convoy could not be started" : "no known spawn location")}`);
    }
    const target = nextTarget(choice, state.achievementTarget);
    release();
    state.achievementTarget = target;
    focusWithFillers(target, location!, order);
    say(`Farming ${nameOf(choice.id)}: ${killText(choice.kills, choice.milestone, choice.step)}${standInText(target)}`);
    ports.persist();
  }

  /** Whether fewer of `rare` than of `common` spawn around `at`. */
  function rarer(rare: string, common: string, at: ReturnLocation): boolean {
    const few = spawnCount(state.monsterChoices, rare, at);
    return few > 0 && few < spawnCount(state.monsterChoices, common, at);
  }
  /** `monster` as the target in place of `best`, when it is rarer and `best` would be one of its fillers. */
  // A rare is never a target (chooseAchievementTarget), so it is never a variant either: the Phoenix's
  // spawn area covers Squigtoads' and made it look like their rarer variant.
  function variantCandidate(best: AchievementTarget, monster: AchievementMonster): boolean {
    return monster.id !== best.id && !monster.rare && settings().monsters.includes(monster.id) && !excluded(monster.id);
  }
  function variantOf(best: AchievementTarget, monster: AchievementMonster, order: readonly AchievementMonster[],
    kills: Record<string, number>): AchievementTarget | null {
    if (!variantCandidate(best, monster)) return null;
    const count = Number(kills[monster.id]) || 0, step = nextStep(monster.ladder, count);
    const at = step >= 0 && step <= best.step ? ports.destination(monster.id) : null;
    if (!at || !rarer(monster.id, best.id, at)) return null;
    if (!nearbyFillers(order, state.monsterChoices, monster.id, at, excluded, fillerChoice()).includes(best.id)) return null;
    return { id: monster.id, step, milestone: monster.ladder[step]!, kills: count };
  }
  /** Rare variants first: farming Orange Snakes with snakes as fillers clears the snake step too. */
  function preferVariant(best: AchievementTarget | null, order: readonly AchievementMonster[], kills: Record<string, number>): AchievementTarget | null {
    if (!best || settings().fillIdle === false) return best;
    for (const monster of order) {
      const variant = variantOf(best, monster, order, kills);
      if (variant) return variant;
    }
    return best;
  }

  /** A competition relocation can pick a filler's spawn; the party belongs at one of the target's. */
  /** A status's map position, or null when it reports none. */
  function positionOf(status: AchievementHuntState["statuses"][string]): { map: string; x: number; y: number } | null {
    if (typeof status?.map !== "string" || !Number.isFinite(status.x) || !Number.isFinite(status.y)) return null;
    return { map: status.map, x: status.x!, y: status.y! };
  }
  /** Party members whose fresh status says they are dead. */
  function deadMembers(names: string[]): string[] {
    return names.filter((name) => {
      const status = state.statuses[name];
      return !!status && ports.now() - status.seenAt <= FRESH_STATUS_MS && (!!status.rip || status.hp === 0);
    });
  }
  /** Where the leader stands, when that may count against the target: after our convoy failed,
   *  or while the leader has no convoy and is idle. A town restock or similar errand runs without
   *  a convoy, and is left alone. */
  function leaderPlace(convoy: { phase?: string } | null | undefined): { map: string; x: number; y: number } | null {
    const lead = state.leader ? state.statuses[state.leader] : undefined;
    const place = positionOf(lead);
    const errandFree = convoy?.phase === "failed" || (!convoy && (lead?.navigationState ?? "idle") === "idle");
    return place && errandFree ? place : null;
  }
  /** Whether the party is away from the target's spawn: the farm location points elsewhere, or
   *  the leader stands elsewhere (failure mode 25). */
  function awayFromTarget(): boolean {
    const current = state.achievementTarget, convoy = state.activeConvoy as { phase?: string } | null | undefined;
    if (!current || (convoy && !["complete", "failed"].includes(String(convoy.phase)))) return false;
    const near = (place: { map: string; x: number; y: number }) => nearSpawnOf(state.monsterChoices, current.id, place, ports.radius());
    if (state.location && !near(state.location)) return true;
    const leader = leaderPlace(convoy);
    return !!leader && !near(leader);
  }
  const shouldReturn = (): boolean => awayFromTarget() && ports.now() - returnedAt >= RETURN_RETRY_MS;
  /** Why this tick waits instead of choosing or moving, or null. */
  function holdReason(names: string[]): string | null {
    const busy = ports.busy();
    if (busy) return `Waiting: ${busy}`;
    // A convoy started while someone is dead fails during setup (failure mode 24).
    const dead = deadMembers(names);
    return dead.length ? `Waiting: ${dead.join(" and ")} ${dead.length === 1 ? "is" : "are"} dead` : null;
  }
  /** Sets the kept target's focus again around where the party farms, without moving it. */
  function focusKeptTarget(order: readonly AchievementMonster[]): void {
    const current = state.achievementTarget!;
    const here = state.location && nearSpawnOf(state.monsterChoices, current.id, state.location, ports.radius()) ? state.location : ports.destination(current.id);
    refocus = false;
    if (!here) return;
    restorePriorities(current);
    focusWithFillers(current, here as ReturnLocation, order);
    ports.persist();
  }
  function returnToTarget(order: readonly AchievementMonster[]): void {
    const current = state.achievementTarget!;
    returnedAt = ports.now();
    const location = ports.destination(current.id);
    if (!location || !ports.select(current.id, location)) return;
    restorePriorities(current);
    focusWithFillers(current, location, order);
    say(`Returning to the ${nameOf(current.id)} spawn`);
    ports.persist();
  }

  function tick(): void {
    if (state.farmingPolicy !== "achievements") {
      // Another mode was chosen: forget the target; that mode owns travel now.
      if (state.achievementTarget) { release(); say(""); ports.persist(); }
      syncRares([]);
      return;
    }
    if (!leaderOnline()) return say("Waiting for an online party leader");
    const names = ports.members();
    recordDeaths(names);
    watchBosses(names);
    const hold = holdReason(names);
    if (hold) return say(hold);
    if (focusChangedByHand()) return stop("Switched to Auto: the monster focus was changed by hand");
    const order = monsterList().order;
    const kills = partyAchievementKills(state.statuses, names.length ? names : [String(state.leader)]);
    syncRares(wantedRares(order, new Set(settings().monsters), (id) => !!state.achievementBlacklist[id], kills));
    const best = chooseAchievementTarget(order, new Set(settings().monsters), excluded, kills);
    if (!stillWorking(kills, best)) switchTo(preferVariant(best, order, kills), order);
    else if (shouldReturn()) returnToTarget(order);
    else if (refocus) focusKeptTarget(order);
    refocus = false;
  }

  /** Settings changes forget failed routes, so a fixed spawn is tried again at once. */
  const reset = (): void => { unroutable.clear(); refocus = true; };
  return { tick, reset };
}
