// Achievement Hunt target choice (docs/achievement-hunt.md). Pure: no I/O, and the only
// state is an id index per monsterChoices array (choiceById).
import type { GMonster } from "typed-adventureland";
import { legacyPriorities } from "../coordinator/navigation/passive-settings.ts";

/** A bestiary catalog entry. `definition` is the monster's `G.monsters` entry. */
export interface AchievementCatalogEntry {
  id: string;
  name?: string;
  hp?: unknown;
  xp?: unknown;
  threat?: unknown;
  definition?: Partial<Pick<GMonster, "achievements" | "special" | "cooperative" | "unlist" | "respawn">> | null;
}
export interface AchievementChoice {
  id: string;
  locations?: readonly unknown[] | null;
  /** One entry per spawn, with how many of the monster it holds. */
  spawnRecords?: readonly unknown[] | null;
}
/** A spawn as `monsterChoices` reports it: a centre, and a box when the game gives one. */
export interface SpawnPlace {
  map: string;
  x: number;
  y: number;
  boundary?: readonly number[];
}
export interface AchievementMonster {
  id: string;
  name: string;
  /** Kill counts at which each reward is earned, ascending. */
  ladder: number[];
  /** The game's reward for a kill; it follows HP, damage and defenses, so it ranks difficulty. */
  xp: number;
  threat: number;
  hp: number;
  /** Bosses, event, cooperative and random-respawn monsters, monsters the game leaves out of its
   *  list (training dummies, Cave of Many Dreams), and any without a regular spawn. */
  special: boolean;
  /** Flagged special by the game, or boss-like (§ 23): a monster the party keeps away from. */
  boss: boolean;
  /** A random respawn or one of passive hunting's rares: fought when seen, never a target (§ Rare spawns). */
  rare: boolean;
}
export interface AchievementTarget {
  id: string;
  /** Zero-based position of `milestone` in the monster's own ladder. */
  step: number;
  milestone: number;
  kills: number;
}

/** The kill counts of `G.monsters[id].achievements` entries (`[count, "stat", name, value]`). */
export function milestones(achievements: unknown): number[] {
  if (!Array.isArray(achievements)) return [];
  return achievements
    .map((entry) => (Array.isArray(entry) ? Number(entry[0]) : NaN))
    .filter((count) => Number.isFinite(count) && count > 0)
    .sort((a, b) => a - b);
}

// Boss-like monsters the game does not flag (docs/achievement-hunt.md § 23).
const BOSS_SPAWNS = 2;
const BOSS_HP = 50_000;

/** Spawns in the world from the spawn records, leaving out those the game marks "ignore". */
function worldSpawns(choice: AchievementChoice | undefined): number {
  return (choice?.spawnRecords || []).reduce((total: number, record) => {
    const value = record as { count?: unknown; restrictions?: unknown } | null;
    const ignored = Array.isArray(value?.restrictions) && value.restrictions.includes("ignore");
    return ignored ? total : total + (Number(value?.count) || 0);
  }, 0);
}
/** Never respawns, or is a big single spawn: Stompy, Skeletor, the crypt bosses. */
function bossLike(entry: AchievementCatalogEntry, choice: AchievementChoice | undefined): boolean {
  const respawn = Number(entry.definition?.respawn);
  if (Number.isFinite(respawn) && respawn < 0) return true;
  const spawns = worldSpawns(choice);
  return spawns > 0 && spawns <= BOSS_SPAWNS && (Number(entry.hp) || 0) >= BOSS_HP;
}
/** G.maps marks a spawn that moves between places `stype: "randomrespawn"` (Dracul, Phoenix);
 *  characters copy the spawn type into each spawn record. */
function randomRespawn(choice: AchievementChoice | undefined): boolean {
  return (choice?.spawnRecords || []).some((record) => (record as { stype?: unknown } | null)?.stype === "randomrespawn");
}

/** Bosses, event, cooperative and random-respawn monsters, ones the game leaves out of its list,
 *  and any without a regular spawn. */
function isSpecial(entry: AchievementCatalogEntry, routable: ReadonlySet<string>, choice: AchievementChoice | undefined): boolean {
  const definition = entry.definition || {};
  return !!definition.special || !!definition.cooperative || !!definition.unlist || rareSpawn(entry.id, choice) ||
    !routable.has(entry.id) || bossLike(entry, choice);
}
/** Passive hunting's own rares (Phoenix, Golden Bat, Cute Bee, Tiny, chickens) and random respawns. */
function rareSpawn(id: string, choice: AchievementChoice | undefined): boolean {
  return randomRespawn(choice) || Object.hasOwn(legacyPriorities, id);
}

// One index per monsterChoices array. consumeStatusCatalogs replaces the whole array on a new
// report, so each index matches the array choiceById built it from (docs/achievement-hunt.md § 32-34).
const choiceIndexes = new WeakMap<readonly AchievementChoice[], Map<string, AchievementChoice>>();
/** The first choice with `id`, as a linear search would return it. */
function choiceById(choices: readonly AchievementChoice[] | null | undefined, id: string): AchievementChoice | undefined {
  if (!choices) return undefined;
  let index = choiceIndexes.get(choices);
  if (!index) {
    index = new Map();
    for (const choice of choices) if (!index.has(choice.id)) index.set(choice.id, choice);
    choiceIndexes.set(choices, index);
  }
  return index.get(id);
}

/** Every monster that has achievements, weakest first: by XP, then threat (attack × speed), HP and name.
 *  Threat alone misranks monsters (a Vampire Rat hits harder than a Fire Spirit but has a ninth of its HP). */
export function achievementMonsters(
  catalog: readonly AchievementCatalogEntry[] | null | undefined,
  choices: readonly AchievementChoice[] | null | undefined,
): readonly AchievementMonster[] {
  const routable = new Set((choices || []).filter((choice) => (choice.locations || []).length > 0).map((choice) => choice.id));
  const choiceOf = (id: string) => choiceById(choices, id);
  const monsters = (catalog || [])
    .map((entry) => {
      const definition = entry.definition || {};
      return {
        id: entry.id,
        name: entry.name || entry.id,
        ladder: milestones(definition.achievements),
        xp: Number(entry.xp) || 0,
        threat: Number(entry.threat) || 0,
        hp: Number(entry.hp) || 0,
        special: isSpecial(entry, routable, choiceOf(entry.id)),
        boss: !!definition.special || bossLike(entry, choiceOf(entry.id)),
        rare: rareSpawn(entry.id, choiceOf(entry.id)),
      };
    })
    .filter((monster) => monster.ladder.length > 0)
    .sort((a, b) => a.xp - b.xp || a.threat - b.threat || a.hp - b.hp || a.name.localeCompare(b.name));
  // The game names both `snake` and `osnake` "Snake"; a shared name shows the id.
  const counts = new Map<string, number>();
  for (const monster of monsters) counts.set(monster.name, (counts.get(monster.name) || 0) + 1);
  return monsters.map((monster) => (counts.get(monster.name)! > 1 ? { ...monster, name: `${monster.name} (${monster.id})` } : monster));
}

/** The monster list with an id index, kept while both inputs stay the same arrays. */
export interface AchievementOrder {
  order: readonly AchievementMonster[];
  byId: ReadonlyMap<string, AchievementMonster>;
}
/** achievementMonsters, rebuilt only when `catalog` or `choices` is a new array (docs/achievement-hunt.md § 32-33). */
export function createAchievementOrder(): (catalog: readonly AchievementCatalogEntry[] | null | undefined,
  choices: readonly AchievementChoice[] | null | undefined) => AchievementOrder {
  let kept: { catalog: unknown; choices: unknown; value: AchievementOrder } | null = null;
  return (catalog, choices) => {
    if (kept && kept.catalog === catalog && kept.choices === choices) return kept.value;
    const order = achievementMonsters(catalog, choices);
    const byId = new Map<string, AchievementMonster>();
    for (const monster of order) if (!byId.has(monster.id)) byId.set(monster.id, monster);
    kept = { catalog, choices, value: { order, byId } };
    return kept.value;
  };
}

function spawnPlaces(choice: AchievementChoice | undefined, field: "locations" | "spawnRecords" = "locations"): SpawnPlace[] {
  return (choice?.[field] || []).filter((place): place is SpawnPlace => {
    const value = place as Partial<SpawnPlace> | null;
    return !!value && typeof value.map === "string" && Number.isFinite(value.x) && Number.isFinite(value.y);
  });
}

/** Distance from `point` to a spawn: to the edge of its box, or to its centre without one. */
function spawnDistance(point: { x: number; y: number }, place: SpawnPlace): number {
  const box = place.boundary;
  if (!box || box.length < 4) return Math.hypot(point.x - place.x, point.y - place.y);
  const dx = Math.max(box[0]! - point.x, 0, point.x - box[2]!);
  const dy = Math.max(box[1]! - point.y, 0, point.y - box[3]!);
  return Math.hypot(dx, dy);
}

/** Whether `place` is on the same map as one of `id`'s spawns and within `radius` of it. */
export function nearSpawnOf(choices: readonly AchievementChoice[] | null | undefined, id: string,
  place: { map: string; x: number; y: number }, radius: number): boolean {
  const spawns = spawnPlaces(choiceById(choices, id));
  return spawns.some((spawn) => spawn.map === place.map && spawnDistance(place, spawn) <= radius);
}

// A target spot without a box shares ground with spawns this close to it.
const SHARED_GROUND = 100;

/** Whether `spawn` shares ground with the target spot `at`: their boxes overlap, or, without
 *  both boxes, the spawn is within SHARED_GROUND of the spot. A box that only touches does not count. */
function sharesGround(at: SpawnPlace, spawn: SpawnPlace): boolean {
  if (spawn.map !== at.map) return false;
  const a = at.boundary, b = spawn.boundary;
  if (!a || a.length < 4 || !b || b.length < 4) return spawnDistance(at, spawn) <= SHARED_GROUND;
  return Math.min(a[2]!, b[2]!) > Math.max(a[0]!, b[0]!) && Math.min(a[3]!, b[3]!) > Math.max(a[1]!, b[1]!);
}

/** How many of `id` spawn on the ground of the target spot `at`, from its spawn records. */
export function spawnCount(choices: readonly AchievementChoice[] | null | undefined, id: string, at: SpawnPlace): number {
  return spawnPlaces(choiceById(choices, id), "spawnRecords")
    .filter((spawn) => sharesGround(at, spawn))
    .reduce((total, spawn) => total + (Number((spawn as { count?: unknown }).count) || 0), 0);
}

/** Whether one of `id`'s spawns shares ground with the target spot `at`. */
function onGround(choices: readonly AchievementChoice[] | null | undefined, id: string, at: SpawnPlace): boolean {
  return spawnPlaces(choiceById(choices, id)).some((spawn) => sharesGround(at, spawn));
}

/**
 * Monsters the party can fight while the target respawns: a spawn sharing the target spot's
 * ground, no stronger than the target by XP, regular, and not excluded (docs/achievement-hunt.md § 22).
 * With `selected`, only those monsters fill.
 */
export function nearbyFillers(order: readonly AchievementMonster[], choices: readonly AchievementChoice[] | null | undefined,
  targetId: string, at: SpawnPlace, excluded: (id: string) => boolean, selected?: ReadonlySet<string>): string[] {
  const target = order.find((monster) => monster.id === targetId);
  if (!target) return [];
  return order
    .filter((monster) => monster.id !== targetId && !monster.special && monster.xp <= target.xp && !excluded(monster.id))
    .filter((monster) => !selected || selected.has(monster.id))
    .filter((monster) => onGround(choices, monster.id, at))
    .map((monster) => monster.id);
}

/** Bosses with a spawn on the target spot's ground (docs/achievement-hunt.md § Bosses). */
export function bossesOnGround(order: readonly AchievementMonster[], choices: readonly AchievementChoice[] | null | undefined,
  targetId: string, at: SpawnPlace): string[] {
  return order.filter((monster) => monster.boss && monster.id !== targetId && onGround(choices, monster.id, at))
    .map((monster) => monster.id);
}

/** Index of the first milestone not yet reached, or -1 once the ladder is complete. */
export function nextStep(ladder: readonly number[], kills: number): number {
  return ladder.findIndex((milestone) => kills < milestone);
}

/**
 * The first monster, in list order, whose next milestone is at the lowest step
 * among the selected, not excluded, unfinished monsters: every monster reaches
 * step n before any is farmed for step n + 1.
 */
export function chooseAchievementTarget(
  order: readonly AchievementMonster[],
  selected: ReadonlySet<string>,
  excluded: (id: string) => boolean,
  kills: Readonly<Record<string, number>>,
): AchievementTarget | null {
  let best: AchievementTarget | null = null;
  for (const monster of order) {
    // A rare is fought when seen (§ Rare spawns); waiting at one of its spawns would stall the hunt.
    if (!selected.has(monster.id) || excluded(monster.id) || monster.rare) continue;
    const count = Number(kills[monster.id]) || 0;
    const step = nextStep(monster.ladder, count);
    if (step < 0) continue;
    if (!best || step < best.step) best = { id: monster.id, step, milestone: monster.ladder[step]!, kills: count };
  }
  return best;
}

/** Selected rares with steps left, not excluded: the ones to fight when seen. */
export function wantedRares(order: readonly AchievementMonster[], selected: ReadonlySet<string>,
  excluded: (id: string) => boolean, kills: Readonly<Record<string, number>>): string[] {
  return order.filter((monster) => monster.rare && selected.has(monster.id) && !excluded(monster.id) &&
    nextStep(monster.ladder, Number(kills[monster.id]) || 0) >= 0).map((monster) => monster.id);
}

/** Account-wide progress: the highest count any party member's client reports. */
export function partyAchievementKills(
  statuses: Readonly<Record<string, { monsterAchievementKills?: Record<string, unknown> | null } | undefined>>,
  names: readonly string[],
): Record<string, number> {
  const kills: Record<string, number> = {};
  for (const name of names) {
    for (const [id, value] of Object.entries(statuses[name]?.monsterAchievementKills || {})) {
      const count = Number(value);
      if (Number.isFinite(count) && count > (kills[id] || 0)) kills[id] = count;
    }
  }
  return kills;
}
