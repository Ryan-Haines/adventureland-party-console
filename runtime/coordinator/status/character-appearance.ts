interface Sprite { url: string; tileSize: number; columns: number; rows: number; x: number; y: number;
}

export interface CharacterAppearance {
  skin?: string;
  characterSprite: Sprite | null;
  characterDollHtml: string | null;
  updatedAt: number;
}
export interface AppearanceState {
  characterSnapshots?: Record<string, Record<string, unknown> & { updatedAt: number }>;
  characterAppearances?: Record<string, CharacterAppearance>;
}
interface Report { name: string; skin?: unknown; characterSprite?: unknown; characterDollHtml?: unknown;
}

function sprite(value: unknown): Sprite | null {
  if (!value || typeof value !== 'object') return null;
  const v=value as Sprite;
  return typeof v.url === 'string' && ['tileSize','columns','rows','x','y'].every((k) =>Number.isFinite(v[k as keyof Sprite]))
    ? {url:v.url,tileSize:v.tileSize,columns:v.columns,rows:v.rows,x:v.x,y:v.y} : null;
}

const emptyAppearance: CharacterAppearance={characterSprite:null,characterDollHtml:null,updatedAt:0};
function mergeAppearance(report: Report, before=emptyAppearance, image: Sprite | null, html: string | null) {
  const skin=typeof report.skin === 'string' ? report.skin : before.skin;
  const previous=skin === before.skin ? before : emptyAppearance;
  return {skin,characterSprite:image || previous.characterSprite,
    characterDollHtml:html || previous.characterDollHtml};
}
function sameAppearance(before: CharacterAppearance, next: Omit<CharacterAppearance,'updatedAt'>): boolean {
  return (
    before.skin===next.skin && before.characterDollHtml===next.characterDollHtml &&
    JSON.stringify(before.characterSprite)===JSON.stringify(next.characterSprite)
  );
}

/** Keep appearance separate from live status: a saved doll never makes a character online. */
export function rememberCharacterAppearance(state: AppearanceState, report: Report, now: number): boolean {
  const image=sprite(report.characterSprite);
  const html=typeof report.characterDollHtml === 'string' && report.characterDollHtml.trim() ? report.characterDollHtml : null;
  if (!image && !html) return false;
  const before=state.characterAppearances?.[report.name];
  const next=mergeAppearance(report,before,image,html);
  if (before && sameAppearance(before,next)) return false;
  state.characterAppearances={...state.characterAppearances,[report.name]:{...next,updatedAt:now}};
  return true;
}

// Offline observations are deliberately separate from statuses and ownership.
// Never include commands, session credentials, or private bank/account payloads.
const inspectionFields = [
  "name",
  "ctype",
  "level",
  "xp",
  "max_xp",
  "hp",
  "max_hp",
  "mp",
  "max_mp",
  "gold",
  "map",
  "in",
  "x",
  "y",
  "rip",
  "banking",
  "seenAt",
  "items",
  "slots",
  "skin",
  "characterSprite",
  "characterDollHtml",
  "primaryStat",
  "attack",
  "frequency",
  "range",
  "speed",
  "unrestrictedSpeed",
  "armor",
  "resistance",
  "str",
  "int",
  "dex",
  "vit",
  "fortitude",
  "luck",
  "goldBonus",
  "xpBonus",
  "combatStats",
  "conditions",
  "standOpen",
];
const inspectionMetaFields = [
  "definition",
  "properties",
  "scaling",
  "usage",
  "sprite",
  "maxLevel",
  "title",
  "upgradeable",
  "compoundable",
];
function inspectionEntry(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const entry = raw as Record<string, unknown>,
    meta =
      entry.meta && typeof entry.meta === "object" ? (entry.meta as Record<string, unknown>) : null;
  return {
    slot: entry.slot,
    item: entry.item,
    ...(meta
      ? {
          meta: Object.fromEntries(
            inspectionMetaFields.filter((key) => key in meta).map((key) => [key, meta[key]]),
          ),
        }
      : {}),
  };
}
function physicalInventory(items: unknown, slots: unknown): string {
  const physical = (entry: unknown) => {
    if (!entry || typeof entry !== "object") return null;
    const raw = entry as Record<string, unknown>;
    return [raw.slot, raw.item];
  };
  return JSON.stringify([
    Array.isArray(items) ? items.map(physical) : [],
    slots && typeof slots === "object"
      ? Object.entries(slots).map(([slot, entry]) => [slot, physical(entry)])
      : [],
  ]);
}
/**
 * A snapshot refresh without an inventory change stays in memory until this
 * long after the last saved one. The roster key holds every character's
 * items and slots, so a 30 s refresh per character rewrote it several times a
 * minute (docs/efficiency.md, Persistence: Offline character snapshots).
 */
export const SNAPSHOT_SAVE_MS = 300_000;
const snapshotSavedAt = new WeakMap<AppearanceState, Map<string, number>>();
const savedSnapshots = new WeakMap<object, Map<string, unknown>>();
/**
 * Refreshes the offline-inspection snapshot in memory. Returns true when the
 * caller should save the roster: the physical inventory changed, or the last
 * saved snapshot of this character is SNAPSHOT_SAVE_MS old.
 */
export function rememberCharacterSnapshot(
  state: AppearanceState,
  report: Record<string, unknown>,
  now: number,
): boolean {
  if (
    typeof report.name !== "string" ||
    !Array.isArray(report.items) ||
    !report.slots ||
    typeof report.level !== "number"
  )
    return false;
  const previous = state.characterSnapshots?.[report.name];
  // Compare only physical identities. meta.world carries the complete catalog
  // and must never be serialized on this heartbeat path or persisted per item.
  const inventoryChanged =
    !previous ||
    physicalInventory(previous.items, previous.slots) !==
      physicalInventory(report.items, report.slots);
  if (!inventoryChanged && now - previous.updatedAt < 30000) return false;
  const snapshot = Object.fromEntries(
    inspectionFields.filter((key) => key in report).map((key) => [key, report[key]]),
  );
  snapshot.items = report.items.map(inspectionEntry);
  snapshot.slots = Object.fromEntries(
    Object.entries(report.slots).map(([slot, entry]) => [slot, inspectionEntry(entry)]),
  );
  state.characterSnapshots = {
    ...state.characterSnapshots,
    [report.name]: JSON.parse(JSON.stringify({ ...snapshot, updatedAt: now, seenAt: now })),
  };
  return snapshotSaveDue(state, report.name, inventoryChanged, now);
}
function snapshotSaveDue(state: AppearanceState, name: string, inventoryChanged: boolean, now: number): boolean {
  let saved = snapshotSavedAt.get(state);
  if (!saved) snapshotSavedAt.set(state, (saved = new Map()));
  if (!inventoryChanged && now - (saved.get(name) ?? -Infinity) < SNAPSHOT_SAVE_MS) return false;
  saved.set(name, now);
  let versions = savedSnapshots.get(state);
  if (!versions) savedSnapshots.set(state, (versions = new Map()));
  versions.set(name, state.characterSnapshots?.[name]);
  return true;
}
/**
 * The roster key's copy of the snapshots. nativeOwnership saves the roster on
 * every native report, so the roster carries each character's snapshot from
 * its last due save; a refresh that is not due stays in memory. A character
 * without a refresh since load keeps its loaded snapshot.
 */
export function rosterSnapshots(state: object, current: unknown): unknown {
  const versions = savedSnapshots.get(state);
  if (!versions?.size || !current || typeof current !== "object") return current;
  return Object.fromEntries(Object.entries(current).map(([name, snapshot]) =>
    [name, versions.has(name) ? versions.get(name) : snapshot]));
}
