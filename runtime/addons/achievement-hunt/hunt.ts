// Achievement Hunt, the "achievements" target mode entry: chooses farming targets
// from monster kill-achievement progress and hands each one to the regular
// manual-monster convoy (README.md here, from the fork's docs/achievement-hunt.md).
// The fork's runtime/coordinator/hunt/achievement-hunt.ts (972c9fce), with its fixed
// waits replaced by the characters' own report intervals and progress rules.
import { ask, fresh as freshReport, type PassiveRule, type ReturnLocation, type SettingsChange, type SettingsWriteResult } from "../../hooks/addon-api.ts";
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
  type BossCut,
} from "./policy.ts";
import {
  defaultAchievementHuntSettings,
  type AchievementBlacklistEntry,
  type AchievementHuntSettings,
  type AchievementTargetState,
} from "./settings.ts";

// The farming scope the hunt runs for, as the coordinator hands it each tick (the groups and tasks
// owner's `TargetModeView.scope`).
export interface AchievementHuntScope {
  leader: string | null;
  targetMode: string;
  monsterFocus: string[];
  statuses: Record<string, {
    seenAt: number;
    // The gap between the character's last two reports (queue A20).
    reportIntervalMs?: number;
    lastDeath?: { at?: number; eventTrip?: unknown } | null;
    rip?: boolean;
    hp?: number;
    map?: string;
    x?: number;
    y?: number;
    navigationState?: string;
    monsterAchievementKills?: Record<string, unknown> | null;
    /** Each add-on's report fields; this add-on's `sightings` are the avoided bosses its character
     *  sees, with whom each one attacks (index.ts `status.report`). */
    addonReports?: Record<string, { sightings?: { mtype?: unknown; target?: unknown }[] | null } | undefined> | null;
  } | undefined>;
  bestiaryCatalog?: unknown;
  monsterChoices?: AchievementChoice[] | null;
  /** Per character; followers read their own, so every member is set. */
  monsterPrioritiesByCharacter?: Record<string, Record<string, number> | undefined>;
  location?: { map: string; x: number; y: number } | null;
  activeConvoy?: unknown;
}
// What the hunt keeps, all in the scope's add-on store, which persists with the scope's profile.
export interface AchievementHuntStore {
  achievementHunt: AchievementHuntSettings;
  achievementBlacklist: Record<string, AchievementBlacklistEntry>;
  achievementTarget: AchievementTargetState | null;
  achievementMessage: string;
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
  /** Sets the scope's monster focus: the target first, then its fillers. */
  focus(ids: string[]): void;
  /** The leader's monster search radius. */
  radius(): number;
  // The add-on's declared boss cut-off (policy.ts `BossCut`).
  bossCut(): BossCut;
  persist(): void;
  /** Writes the members' monster priorities, a player setting, through the settings writer under
   *  this add-on's name. */
  write(changes: SettingsChange[]): SettingsWriteResult;
  /** Passive rare hunting, for the leader's scope only; independent characters have none. */
  passive?: { rule(id: string): PassiveRule | undefined; set(rules: Record<string, PassiveRule>): SettingsWriteResult };
}

// Characters fight the highest focused priority tier in reach (runtime/characters/targeting/rules.ts
// monsterPriority): the target's tier above every filler's. Only their order matters.
const TARGET_PRIORITY = 90;
const FILLER_PRIORITY = 10;
// A report is fresh by the console's walk reading (queue A20): two of the character's
// own report intervals, or the report age while an attacker is known or before its first interval.
export const fresh = (status: { seenAt: number; reportIntervalMs?: number; groupedCombat?: { currentAttackers?: unknown[] } } | undefined, now: number) =>
  !!status && freshReport(status.seenAt, now, { reading: 'walk', attackerKnown: !!status.groupedCombat?.currentAttackers?.length, intervalMs: status.reportIntervalMs });

const killText = (kills: number, milestone: number, step: number) =>
  `${Math.floor(kills).toLocaleString()} / ${milestone.toLocaleString()} kills (step ${step + 1})`;

// The view of one tick: the scope, its add-on store and the ports, handed in new each tick.
export interface AchievementHuntView { scope: AchievementHuntScope; store: AchievementHuntStore; ports: AchievementHuntPorts }

// `current` answers the newest view, so a tick never reads an older one.
export function createAchievementHunt(current: () => AchievementHuntView) {
  const scope = () => current().scope, store = () => current().store, port = () => current().ports;
  // A monster whose route failed waits until the spawn data it failed on changes (new monster
  // choices), or the settings change, instead of a fixed retry time.
  const unroutable = new Map<string, unknown>();
  // When the hunt last sent the party back to its target: it sends again only once the leader
  // has reported twice since, so a failing return cannot restart every tick.
  let returnedAt = -Infinity;
  // Targets a boss holds: the boss and when a party member last saw it. Memory only: after a
  // restart the party goes back and, if the boss is still there and attacks, leaves again.
  const bossHolds = new Map<string, { boss: string; seenAt: number }>();
  // Deaths a boss-held target had when the party left it, picked up again on return.
  const carriedDeaths = new Map<string, number>();
  // Set again after a restart or a settings change (failure mode 21).
  let refocus = true;

  // The monster list, rebuilt only when a new catalog or new monster choices arrive (failure mode 32).
  const ordered = createAchievementOrder(id => ask('passive.rule', id).corePriority);
  const monsterList = () => ordered(scope().bestiaryCatalog as AchievementCatalogEntry[] | null, scope().monsterChoices, port().bossCut());
  const nameOf = (id: string): string => monsterList().byId.get(id)?.name || id;
  const settings = (): AchievementHuntSettings => (store().achievementHunt ||= { ...defaultAchievementHuntSettings });
  const say = (message: string): void => { store().achievementMessage = message; };
  function excluded(id: string): boolean {
    return !!store().achievementBlacklist[id] || (unroutable.has(id) && unroutable.get(id) === scope().monsterChoices) || bossHeld(id);
  }
  // A boss-held target is left until nobody has seen the boss for this long. The party can't see the
  // spawn while away, so it goes back after this long and checks. Older settings lack it: the default.
  const bossAwayMs = (): number =>
    (Number(settings().bossRecheckMinutes) || defaultAchievementHuntSettings.bossRecheckMinutes) * 60_000;
  // The player can keep farming a target an avoided boss attacks on (user, 2026-11-09). A save from
  // before the setting has no value for it and leaves, as the hunt did then.
  const leavesForBosses = (): boolean => settings().leaveOnBossAttack !== false;
  function bossHeld(id: string): boolean {
    // Switching it off ends every hold, so a stand-in drops and the party goes back to its target.
    if (!leavesForBosses()) bossHolds.clear();
    const hold = bossHolds.get(id);
    if (hold && port().now() - hold.seenAt >= bossAwayMs()) bossHolds.delete(id);
    return bossHolds.has(id);
  }
  /** Fresh sightings of `names`' avoided bosses: [boss, whom it attacks]. */
  function bossSightings(names: string[]): [string, string | null][] {
    return names.flatMap((name) => {
      const status = scope().statuses[name];
      if (!fresh(status, port().now())) return [];
      return (status!.addonReports?.['achievement-hunt']?.sightings || []).filter((seen) => typeof seen?.mtype === "string")
        .map((seen): [string, string | null] => [seen.mtype as string, typeof seen.target === "string" ? seen.target : null]);
    });
  }
  /** Leaves the target once one of its bosses attacks a party member, while the setting is on; deaths still count against it. */
  function watchBosses(names: string[]): void {
    const sightings = bossSightings(names);
    for (const hold of bossHolds.values())
      if (sightings.some(([boss]) => boss === hold.boss)) hold.seenAt = port().now();
    const current = store().achievementTarget;
    const attack = current && sightings.find(([boss, target]) => current.avoid?.includes(boss) && !!target && names.includes(target));
    if (current && attack && leavesForBosses() && !bossHolds.has(current.id)) {
      bossHolds.set(current.id, { boss: attack[0], seenAt: port().now() });
      carriedDeaths.set(current.id, current.deaths);
    }
  }
  /**
   * Passive hunting fights each wanted rare when a character sees it (docs/achievement-hunt.md § Rare spawns).
   * A rare the player already hunts passively is left alone; any other gets an enabled rule, and the rule it
   * replaced comes back once the rare is no longer wanted.
   */
  function syncRares(wanted: string[]): void {
    const passive = port().passive;
    if (!passive) return;
    const saved = (store().achievementPassive ||= {});
    const changes = { ...enableRares(wanted, saved, (id) => passive.rule(id)), ...restoreRares(wanted, saved) };
    if (!Object.keys(changes).length) return;
    const written = passive.set(changes);
    if (!written.ok) say(written.error);
    port().persist();
  }
  /** Rules that switch on each wanted rare not already hunted passively, saving the rule each replaces. */
  function enableRares(wanted: string[], saved: Record<string, PassiveRule | null>,
    rule: (id: string) => PassiveRule | undefined): Record<string, PassiveRule> {
    const changes: Record<string, PassiveRule> = {};
    for (const id of wanted) {
      const current = rule(id);
      if (Object.hasOwn(saved, id) || (current?.enabled && !current.keepMoving)) continue;
      saved[id] = current ? { ...current } : null;
      changes[id] = { ...ask('passive.rule', id).default, ...current, enabled: true, keepMoving: false };
    }
    return changes;
  }
  /** The saved rules of rares no longer wanted, put back. */
  function restoreRares(wanted: string[], saved: Record<string, PassiveRule | null>): Record<string, PassiveRule> {
    const changes: Record<string, PassiveRule> = {};
    for (const [id, rule] of Object.entries(saved)) {
      if (wanted.includes(id)) continue;
      changes[id] = rule || { ...ask('passive.rule', id).default, enabled: false };
      delete saved[id];
    }
    return changes;
  }
  /** The selected monsters that may fill, or undefined when any regular monster may. */
  function fillerChoice(): ReadonlySet<string> | undefined {
    return settings().fillSelectedOnly === false ? undefined : new Set(settings().monsters);
  }
  function leaderOnline(): boolean {
    const { leader, statuses } = scope();
    return fresh(leader ? statuses[leader] : undefined, port().now());
  }
  /** Leaves the target mode for Farming, as picking a monster by hand does (user decision M1,
   *  MV21), and leaves the combat mode as the player chose it. The settings writer names this
   *  add-on on the change's line. */
  function stop(message: string): void {
    const leader = scope().leader;
    const written = port().write([{ field: "targetMode", value: "farming", ...(leader ? { character: leader } : {}) }]);
    if (!written.ok) return say(`Achievement Hunt could not switch to Farming: ${written.error}`);
    release();
    say(message);
    port().persist();
  }

  /** Writes each member's next priorities as one batch; a refusal shows as the hunt's message. */
  function writePriorities(next: Record<string, Record<string, number>>): void {
    const changes = Object.entries(next).map(([character, value]) => ({ field: 'monsterPrioritiesByCharacter', character, value }));
    if (!changes.length) return;
    const written = port().write(changes);
    if (!written.ok) say(written.error);
  }
  /** Puts back the priorities the target replaced. */
  function restorePriorities(target: AchievementTargetState): void {
    const all = scope().monsterPrioritiesByCharacter || {}, next: Record<string, Record<string, number>> = {};
    for (const [name, saved] of Object.entries(target.savedPriorities || {}) as [string, Record<string, number | null>][]) {
      const priorities = next[name] = { ...all[name] };
      for (const [type, value] of Object.entries(saved)) {
        if (value === null) delete priorities[type];
        else priorities[type] = value;
      }
    }
    target.savedPriorities = {};
    writePriorities(next);
  }
  function release(): void {
    const target = store().achievementTarget;
    if (target) restorePriorities(target);
    store().achievementTarget = null;
  }
  /** Focuses the target and the nearby monsters to fight while it respawns, target first. */
  function focusWithFillers(target: AchievementTargetState, location: ReturnLocation, order: readonly AchievementMonster[]): void {
    const fillers = settings().fillIdle === false ? []
      : nearbyFillers(order, scope().monsterChoices, target.id, location, excluded, fillerChoice());
    target.focus = [target.id, ...fillers];
    target.avoid = bossesOnGround(order, scope().monsterChoices, target.id, location);
    target.savedPriorities = {};
    port().focus(target.focus.slice());
    if (!fillers.length) return;
    const all = scope().monsterPrioritiesByCharacter || {}, next: Record<string, Record<string, number>> = {};
    for (const name of port().members()) {
      const priorities = next[name] = { ...all[name] };
      target.savedPriorities[name] = Object.fromEntries(target.focus.map((type) => [type, priorities[type] ?? null]));
      for (const type of target.focus) priorities[type] = type === target.id ? TARGET_PRIORITY : FILLER_PRIORITY;
    }
    writePriorities(next);
  }

  /** Counts each character's death once, and only deaths after the target started. */
  function newDeaths(target: AchievementTargetState, names: string[]): string[] {
    return names.filter((name) => {
      const death = scope().statuses[name]?.lastDeath;
      const at = Number(death?.at) || 0;
      if (at <= target.startedAt || at === target.counted[name]) return false;
      target.counted[name] = at;
      // Hunt does not count deaths on an event trip either (runtime/hunting/rules.ts eventDeath).
      if (death?.eventTrip) return false;
      target.deaths++;
      return true;
    });
  }
  /** Blacklists the target once the party has died there `deathThreshold` times. */
  function recordDeaths(names: string[]): void {
    const target = store().achievementTarget;
    if (!target) return;
    const died = newDeaths(target, names);
    if (!died.length) return;
    const options = settings();
    if (options.blacklistDeaths && target.deaths >= options.deathThreshold) {
      store().achievementBlacklist[target.id] = {
        monsterId: target.id, at: port().now(), deaths: target.deaths, characters: died,
        reason: `${target.deaths} death${target.deaths === 1 ? "" : "s"} while farming for achievements`,
      };
    }
    port().persist();
  }

  /** The player picked something else after our switch settled: every member has reported since it. */
  function focusChangedByHand(): boolean {
    const current = store().achievementTarget;
    return !!current && JSON.stringify(scope().monsterFocus || []) !== JSON.stringify(current.focus || [current.id]) &&
      port().members().every((name) => Number(scope().statuses[name]?.seenAt) > current.startedAt);
  }

  /**
   * Keeps the current target until its milestone is met, so lagging counts never cause a switch.
   * A monster at a lower step (re-selected, unblacklisted, or a route retry) takes over: kills only
   * rise, so that cannot thrash.
   */
  function stillWorking(kills: Record<string, number>, best: AchievementTarget | null): boolean {
    const current = store().achievementTarget;
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
    const minutes = Math.max(1, Math.ceil((bossAwayMs() - (port().now() - hold.seenAt)) / 60_000));
    return ` while ${nameOf(hold.boss)} holds ${nameOf(target.standInFor!)} (back in ${minutes}m)`;
  }

  /** The state for a new target, with the deaths it had before a boss sent the party away. */
  function nextTarget(choice: AchievementTarget, previous: AchievementTargetState | null): AchievementTargetState {
    const target: AchievementTargetState = { id: choice.id, step: choice.step, milestone: choice.milestone, startedAt: port().now(),
      deaths: carriedDeaths.get(choice.id) ?? 0, counted: {} };
    carriedDeaths.delete(choice.id);
    // Leaving a boss-held target, or moving on from one stand-in to another, keeps the target to return to.
    const held = [previous?.id, previous?.standInFor].find((id) => !!id && bossHeld(id));
    if (held && held !== choice.id) target.standInFor = held;
    return target;
  }
  function switchTo(choice: AchievementTarget | null, order: readonly AchievementMonster[]): void {
    if (!choice) {
      release();
      const names = Object.keys(store().achievementPassive || {}).map(nameOf);
      return say(names.length
        ? `No target to farm: fighting ${names.join(", ")} when seen`
        : "Nothing left to farm: every selected monster has finished its ladder or is skipped");
    }
    const location = port().destination(choice.id);
    // The selection refuses a target it cannot start by returning null; a throw is a fault that
    // reaches the hook registry's error path.
    const started = location ? port().select(choice.id, location) : null;
    if (!started) {
      unroutable.set(choice.id, scope().monsterChoices);
      return say(`Skipping ${choice.id}: ${location ? "the party convoy could not be started" : "no known spawn location"}`);
    }
    const target = nextTarget(choice, store().achievementTarget);
    release();
    store().achievementTarget = target;
    focusWithFillers(target, location!, order);
    say(`Farming ${nameOf(choice.id)}: ${killText(choice.kills, choice.milestone, choice.step)}${standInText(target)}`);
    port().persist();
  }

  /** Whether fewer of `rare` than of `common` spawn around `at`. */
  function rarer(rare: string, common: string, at: ReturnLocation): boolean {
    const few = spawnCount(scope().monsterChoices, rare, at);
    return few > 0 && few < spawnCount(scope().monsterChoices, common, at);
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
    const at = step >= 0 && step <= best.step ? port().destination(monster.id) : null;
    if (!at || !rarer(monster.id, best.id, at)) return null;
    if (!nearbyFillers(order, scope().monsterChoices, monster.id, at, excluded, fillerChoice()).includes(best.id)) return null;
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

  /** A status's map position, or null when it reports none. */
  function positionOf(status: AchievementHuntScope["statuses"][string]): { map: string; x: number; y: number } | null {
    if (typeof status?.map !== "string" || !Number.isFinite(status.x) || !Number.isFinite(status.y)) return null;
    return { map: status.map, x: status.x!, y: status.y! };
  }
  /** Party members whose fresh status says they are dead. */
  function deadMembers(names: string[]): string[] {
    return names.filter((name) => {
      const status = scope().statuses[name];
      return fresh(status, port().now()) && (!!status!.rip || status!.hp === 0);
    });
  }
  /** Where the leader stands, when that may count against the target: after our convoy failed,
   *  or while the leader has no convoy and is idle. A town restock or similar errand runs without
   *  a convoy, and is left alone. */
  function leaderPlace(convoy: { phase?: string } | null | undefined): { map: string; x: number; y: number } | null {
    const { leader, statuses } = scope(), lead = leader ? statuses[leader] : undefined;
    const place = positionOf(lead);
    const errandFree = convoy?.phase === "failed" || (!convoy && (lead?.navigationState ?? "idle") === "idle");
    return place && errandFree ? place : null;
  }
  /** Whether the party is away from the target's spawn: the farm location points elsewhere, or
   *  the leader stands elsewhere (failure mode 25). */
  function awayFromTarget(): boolean {
    const current = store().achievementTarget, convoy = scope().activeConvoy as { phase?: string } | null | undefined;
    if (!current || (convoy && !["complete", "failed"].includes(String(convoy.phase)))) return false;
    const near = (place: { map: string; x: number; y: number }) => nearSpawnOf(scope().monsterChoices, current.id, place, port().radius());
    const location = scope().location;
    if (location && !near(location)) return true;
    const leader = leaderPlace(convoy);
    return !!leader && !near(leader);
  }
  const shouldReturn = (): boolean => {
    const { leader, statuses } = scope(), lead = leader ? statuses[leader] : undefined;
    return awayFromTarget() && Number(lead?.seenAt) - returnedAt >= 2 * (Number(lead?.reportIntervalMs) || 0);
  };
  /** Why this tick waits instead of choosing or moving, or null. */
  function holdReason(names: string[]): string | null {
    const busy = port().busy();
    if (busy) return `Waiting: ${busy}`;
    // A convoy started while someone is dead fails during setup (failure mode 24).
    const dead = deadMembers(names);
    return dead.length ? `Waiting: ${dead.join(" and ")} ${dead.length === 1 ? "is" : "are"} dead` : null;
  }
  /** Sets the kept target's focus again around where the party farms, without moving it. */
  function focusKeptTarget(order: readonly AchievementMonster[]): void {
    const current = store().achievementTarget!;
    const { location, monsterChoices } = scope();
    const here = location && nearSpawnOf(monsterChoices, current.id, location, port().radius()) ? location : port().destination(current.id);
    refocus = false;
    if (!here) return;
    restorePriorities(current);
    focusWithFillers(current, here as ReturnLocation, order);
    port().persist();
  }
  function returnToTarget(order: readonly AchievementMonster[]): void {
    const current = store().achievementTarget!;
    returnedAt = port().now();
    const location = port().destination(current.id);
    if (!location || !port().select(current.id, location)) return;
    restorePriorities(current);
    focusWithFillers(current, location, order);
    say(`Returning to the ${nameOf(current.id)} spawn`);
    port().persist();
  }

  function tick(): void {
    if (scope().targetMode !== "achievements") {
      // Another mode was chosen: forget the target; that mode owns travel now.
      if (store().achievementTarget) { release(); say(""); port().persist(); }
      syncRares([]);
      return;
    }
    if (!leaderOnline()) return say("Waiting for an online party leader");
    const names = port().members();
    recordDeaths(names);
    watchBosses(names);
    const hold = holdReason(names);
    if (hold) return say(hold);
    if (focusChangedByHand()) return stop("Switched to Farming: the monster focus was changed by hand");
    const order = monsterList().order;
    const kills = partyAchievementKills(scope().statuses, names.length ? names : [String(scope().leader)]);
    syncRares(wantedRares(order, new Set(settings().monsters), (id) => !!store().achievementBlacklist[id], kills));
    const best = chooseAchievementTarget(order, new Set(settings().monsters), excluded, kills);
    if (!stillWorking(kills, best)) switchTo(preferVariant(best, order, kills), order);
    else if (shouldReturn()) returnToTarget(order);
    else if (refocus) focusKeptTarget(order);
    refocus = false;
  }

  /** Settings changes forget failed routes, so a fixed spawn is tried again at once. */
  const reset = (): void => { unroutable.clear(); refocus = true; };
  /** The switch is off: the scope leaves Achievements as any other way out does (README item 4).
   *  The tick no longer runs once the registry stops ticking the add-on, so the notice does this. */
  function leave(): void {
    if (scope().targetMode === "achievements") stop("Switched to Farming: Achievement Hunt was switched off");
    else if (store().achievementTarget) { release(); port().persist(); }
    syncRares([]);
  }
  return { tick, reset, leave };
}
