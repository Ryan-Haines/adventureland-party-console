// The character's bag reads (`character/bag.ts`): find, match, count and free cells, the item
// catalog and item details, and the status inventory with the stand's slot count. shared.js builds it
// once at load over `BagPorts` and reads its answers; the holder of the bag is owner.ts's.
import { exchangeKey, fingerprint, sameItem, sameItemState, type ItemCopy } from '../identity.ts';
import { ACQUISITION, defaultStandPrice, itemFailure, maximumItemLevel, BANK_PACK_CELLS, standSlots as tradeSlots, UPGRADE_CHANCES } from '../rules.ts';
import { SEND_REACH } from '../../protocol/reports.ts';
import { CATALOG_VERSIONS } from '../../status/api.ts';
import { cipherDropRate } from '../../events/api.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the game's character and G objects are read as the client gives them */
type Game = any;
type Item = ItemCopy & { skin?: string; p?: any; expires?: unknown };
interface DropSource {
  monsterId: string; monsterName: string; sprite: unknown; rate: number; originRate?: number; baseRate?: number; quantity: number;
  acquisitionPath: string[]; threat: number; sourceType: 'monster' | 'home' | 'zone' | 'world'; goldPerKill: number | null;
  mapId?: string; mapName?: string;
  // The event whose window a drop exists only in, which the dashboard groups as an event drop.
  eventWindow?: 'witchcipher';
}
interface DropOutcome { rate: number; originRate: number; quantity: number; path: string[] }
export interface BagPorts {
  character(): Game;
  G(): Game;
  // The game's bank vault table (`bank_packs`): each pack's map, then its place.
  bankPacks(): Record<string, readonly [map: string, ...rest: unknown[]]>;
  // The game's `item_properties`, which an old client build may lack.
  itemProperties(item: Item): Record<string, unknown> | null | undefined;
  // The game's `calculate_item_properties`, or null on a client build that lacks it.
  calculateItemProperties: ((item: Item, context: { class: string; map: string }) => Record<string, unknown>) | null;
  getPlayer(name: string): { x?: number; y?: number } | null | undefined;
  // The call budget's margin: the largest round trip of its window (call-budget.ts `marginAt`).
  margin(): number;
  sleep(ms: number): Promise<unknown>;
  now(): number;
  // A walk toward a player for a handoff: the merchant meets (the merchant job owner's runner), a
  // fighter approaches by its errand walk. A fighter's wait ends once the lifecycle owner's runtime
  // stops, the lifecycle owner's last command changes or movement's walk intent takes a new revision.
  meet(name: string, timeout: number): Promise<unknown>;
  approach(x: number, y: number): Promise<unknown>;
  current(): boolean;
  lastCommand(): unknown;
  walkRevision(): unknown;
  engaged(): boolean;
  // The status owner's report reads (runtime/status/character/report.ts): the sprite of a skin, a
  // monster's sprite, the drop outcome of one table row, the home server tables, Tracktrix's last
  // reply and whether the coordinator holds the catalog.
  sprite(skin: string): unknown;
  monsterSprite(skin: string): unknown;
  dropOutcome(drop: unknown, itemName: string): DropOutcome | null;
  homeDropTables(): Record<string, unknown[]>;
  tracker(): Game | null;
  catalogKnown(): boolean;
  // The exchange rewards of one drop table (market.ts `exchangeRewards`).
  exchangeRewards(G: Game, table: string): { id: string }[];
  // The upgrade in flight (character/production.ts's journal, 2.5): its bag cell and the copy.
  activeUpgrade(): { slot: number; item: Item } | null;
}

// The dashboard's catalog version: a coordinator holding another version asks for the catalog again.
const CATALOG_VERSION = CATALOG_VERSIONS.merchant;
// The suggested price assumes the party keeps at least 115% luck, the previous release's valuation; the
// drop rates the bestiary and item details show stay the game's own.
const VALUATION_LUCK = 1.15;
const CLASS_NAMES: Record<string, string> = { warrior: 'Warrior', mage: 'Mage', priest: 'Priest', ranger: 'Ranger',
  rogue: 'Rogue', paladin: 'Paladin', merchant: 'Merchant' };
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const threat = (definition: Game) => (Number(definition.attack) || 0) * (Number(definition.frequency) || 0);

// Past a call's reply, the game's change shows within two measured round trips (the call
// budget's margin). One look per round trip ends the wait at the change; false when none came.
export async function settles(p: Pick<BagPorts, 'margin' | 'sleep' | 'now'>, changed: () => boolean): Promise<boolean> {
  const deadline = p.now() + 2 * p.margin();
  while (!changed()) {
    if (p.now() >= deadline) return false;
    await p.sleep(p.margin());
  }
  return true;
}
/** A copy's count; a copy with no `q` is one. */
export const itemQuantity = (item: Item | null | undefined): number => item ? (Number(item.q) || 1) : 0;
/** A definition's plain fields: strings, numbers, booleans and lists. */
export function safeItemDefinition(definition: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(definition || {}))
    if (['string', 'number', 'boolean'].includes(typeof value) || Array.isArray(value)) safe[key] = value;
  return safe;
}

export function createBagReads(p: BagPorts) {
  const me = () => p.character();
  const items = (): (Item | null)[] => me().items || [];
  let worldCache: Record<string, any> = {}, dropCache: Record<string, DropSource[]> = {}, valuationCache: Record<string, any[]> = {};
  let statusCache: any = null, acknowledged: string | null = null, statusCount = 0;
  const statusSession = p.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // Find, match and count.
  function inventoryTotals(): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const item of items()) if (item?.name) totals[item.name] = (totals[item.name] || 0) + (Number(item.q) || 1);
    return totals;
  }
  const findItem = (wanted: ItemCopy | null | undefined) => items().findIndex(item => sameItem(item, wanted));
  const findInventoryItemByName = (name: string) => items().findIndex(item => item?.name === name);
  const inventoryQuantity = (name: string) => items().reduce((total, item) => total + (item?.name === name ? (Number(item.q) || 1) : 0), 0);
  const inventoryAmount = (wanted: Item) => items().reduce((total, item) => total + (sameItem(item, wanted) ? itemQuantity(item) : 0), 0);
  function findMarkedInventoryItem(mark: { slot?: number; item?: Item } | null | undefined): number {
    if (!mark?.item) return -1;
    if (Number.isInteger(mark.slot) && sameItemState(items()[mark.slot!], mark.item)) return mark.slot!;
    return items().findIndex(item => sameItemState(item, mark.item));
  }
  function findMarkedItem(mark: { slot?: number; item: Item }): number {
    if (Number.isInteger(mark.slot) && sameItem(items()[mark.slot!], mark.item)) return mark.slot!;
    return findItem(mark.item);
  }
  // A marked copy that an unequip sent to the bag shows within the settle window; past it, it is missing.
  async function waitForMarkedItem(mark: { slot?: number; item: Item }): Promise<number> {
    await settles(p, () => findMarkedItem(mark) >= 0);
    return findMarkedItem(mark);
  }
  // `inBank` reads the mounted bank and is zero away from it, never an estimate.
  function itemAvailability(name: string) {
    const bank = me().bank || {};
    const onPlayer = inventoryQuantity(name);
    const inBank = Object.values(bank).reduce((total: number, pack) => !Array.isArray(pack) ? total :
      total + pack.reduce((sum: number, item: Item | null) => sum + (item?.name === name ? itemQuantity(item) : 0), 0), 0);
    return { onPlayer, inBank, total: onPlayer + inBank, existsOnPlayer: onPlayer, existsInBank: inBank };
  }
  function freeInventorySlots(): number {
    const size = Number(me().isize) || items().length;
    let free = 0;
    for (let slot = 0; slot < size; slot += 1) if (!items()[slot]) free += 1;
    return free;
  }
  // A handoff's wait for the other player within the game's send reach (protocol SEND_REACH). The caller gives the time
  // it waits (the merchant job owner's handoff picks); between looks the wait gives the game two measured round trips
  // to report the player's move. A fighter walks toward the player by its errand walk, and a wait that ends
  // unreached names the last walk's failure.
  async function waitForPlayer(name: string, timeout: number) {
    if (me().ctype === 'merchant') return p.meet(name, timeout);
    const deadline = p.now() + timeout;
    const command = p.lastCommand(), revision = p.walkRevision();
    const replaced = () => !p.current() || p.lastCommand() !== command || p.walkRevision() !== revision;
    let approaching = false, walkFailure = '';
    while (p.now() < deadline) {
      if (replaced()) throw itemFailure('interrupted');
      const player = p.getPlayer(name);
      if (player && Math.hypot(Number(player.x) - Number(me().x), Number(player.y) - Number(me().y)) <= SEND_REACH) return player;
      if (player && !me().moving && !approaching && !p.engaged()) {
        approaching = true;
        Promise.resolve().then(() => p.approach(Number(player.x), Number(player.y)))
          .catch((error: any) => { walkFailure = String(error?.reason || error?.message || error); })
          .finally(() => { approaching = false; });
      }
      await p.sleep(2 * p.margin());
    }
    throw Error(name + ' did not become reachable' + (walkFailure ? ': ' + walkFailure : ''));
  }
  // The trade slots the merchant's stand opens with, by rules.ts standSlots. A closed
  // stand counts the last stand in the bag, the one open_stand() with no slot opens (its loop keeps
  // the last stand cell, runner_functions.js:1538-1545 at pin).
  function standSlots(): number {
    const character = me();
    return tradeSlots({ ctype: character.ctype, level: character.level, stand: standItem() ?? undefined });
  }
  // The stand the merchant has open, else the bag's stand that open_stand() opens, else null: the
  // game opens a stand only from a stand item, so the coordinator sends no stand return without one.
  function standItem(): string | null {
    const G = p.G(), character = me();
    return character.stand || items().findLast(item => item && G.items[item.name!]?.type === 'stand')?.name || null;
  }

  // The item catalog and item details.
  function itemSeller(itemName: string): string | null {
    const npcs = p.G().npcs || {};
    for (const npcId of Object.keys(npcs))
      if (Array.isArray(npcs[npcId].items) && npcs[npcId].items.includes(itemName) && !npcs[npcId].ignore) return npcId;
    return null;
  }
  function itemUsage(definition: Game) {
    const G = p.G();
    const restricted: string[] | null = Array.isArray(definition?.class) ? definition.class : typeof definition?.class === 'string' ? [definition.class] : null;
    const wields = (classDefinition: Game, hand: string) => !!classDefinition[hand]?.[definition.wtype];
    const classes = Object.keys(G.classes || {}).filter(ctype => {
      if (restricted) return restricted.includes(ctype);
      if (!definition?.wtype) return true;
      const classDefinition = G.classes[ctype] || {};
      return wields(classDefinition, 'mainhand') || wields(classDefinition, 'doublehand') || wields(classDefinition, 'offhand');
    }).map(ctype => {
      const classDefinition = G.classes[ctype] || {};
      let hands: number | null = null;
      if (definition?.wtype) {
        if (wields(classDefinition, 'doublehand')) hands = 2;
        else if (wields(classDefinition, 'mainhand') || wields(classDefinition, 'offhand')) hands = 1;
      }
      return { id: ctype, name: CLASS_NAMES[ctype] || ctype, hands };
    });
    return { classes, hands: classes.map(entry => entry.hands).filter((hands, index, all) => hands && all.indexOf(hands) === index) };
  }
  // Class-only and map-only bonuses sit in nested fields that safeItemDefinition drops, such as
  // Scorpion Seal's warrior field or Graveglass's halloween field.
  function itemBonuses(definition: Game) {
    const G = p.G(), bonuses: { kind: string; id: string; name: string; stats: Record<string, number> }[] = [];
    for (const [key, value] of Object.entries<any>(definition || {})) {
      const kind = G.classes?.[key] ? 'class' : G.maps?.[key] ? 'map' : null;
      if (!kind || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const stats: Record<string, number> = {};
      for (const stat of Object.keys(value)) if (typeof value[stat] === 'number') stats[stat] = value[stat];
      bonuses.push({ kind, id: key, name: kind === 'map' ? G.maps[key].name || key : key.charAt(0).toUpperCase() + key.slice(1), stats });
    }
    return bonuses;
  }
  const nativeMonsterDropTables = (): Record<string, unknown> => ({ ...(p.G().drops?.monsters || {}), ...(p.tracker()?.drops || {}) });
  function valuationMonsterMaps(monsterId: string): string[] {
    const maps = p.G().maps || {};
    return Object.keys(maps).filter(mapId => (maps[mapId].monsters || []).some((spawn: Game) => spawn?.type === monsterId && (Number(spawn.count) || 0) > 0));
  }
  function farmableValuationMonster(monsterId: string): boolean {
    const definition = p.G().monsters?.[monsterId];
    if (!definition || definition.cute || definition.special || definition.stationary || definition.immune || definition.unlist ||
        Number(definition.respawn) <= 0 || Number(definition.xp) <= 0) return false;
    return valuationMonsterMaps(monsterId).length > 0;
  }
  function itemDropSources(itemName: string): DropSource[] {
    if (dropCache[itemName]) return dropCache[itemName];
    const G = p.G(), tracker = p.tracker(), drops: DropSource[] = [];
    const mapDropsById: Record<string, unknown[]> = tracker?.maps && Object.keys(tracker.maps).length ? tracker.maps : G.drops?.maps || {};
    const source = (monsterId: string, outcome: DropOutcome, sourceType: DropSource['sourceType'], rate: number, goldPerKill: number | null) => {
      const definition = G.monsters[monsterId] || {};
      return { monsterId, monsterName: definition.name || monsterId, sprite: p.monsterSprite(definition.skin), rate,
        originRate: outcome.originRate, quantity: outcome.quantity, acquisitionPath: outcome.path, threat: threat(definition), sourceType, goldPerKill };
    };
    function addMonsterSources(tables: Record<string, unknown>, sourceType: 'monster' | 'home') {
      for (const monsterId of Object.keys(tables)) for (const drop of Array.isArray(tables[monsterId]) ? tables[monsterId] as unknown[] : []) {
        const outcome = p.dropOutcome(drop, itemName);
        if (!outcome) continue;
        const golds = Object.values<any>(G.base_gold?.[monsterId] || {}).map(Number).filter(value => Number.isFinite(value) && value >= 0);
        drops.push(source(monsterId, outcome, sourceType, outcome.rate, golds.length ? Math.min(...golds) : null));
      }
    }
    addMonsterSources(nativeMonsterDropTables(), 'monster');
    addMonsterSources(p.homeDropTables(), 'home');
    // These native drops exist only during the Cipher gathering window, so the condition shows even
    // when Tracktrix was read outside it.
    const cipher = G.events?.witchcipher;
    const ingredient = cipher && (cipher.ingredients || []).find((entry: unknown[]) => entry[0] === itemName);
    const cipherPath = ["Witch's Cipher: gathering window only"];
    if (ingredient) for (const monsterId of ingredient[1] as string[]) {
      const definition = G.monsters[monsterId] || {};
      const existing = drops.find(entry => entry.sourceType === 'monster' && entry.monsterId === monsterId);
      if (existing) { existing.acquisitionPath = cipherPath; existing.eventWindow = 'witchcipher'; continue; }
      drops.push({ monsterId, monsterName: definition.name || monsterId, sprite: p.monsterSprite(definition.skin), sourceType: 'monster',
        rate: cipherDropRate(cipher.loot, definition.hp), quantity: 1, acquisitionPath: cipherPath, eventWindow: 'witchcipher',
        threat: threat(definition), goldPerKill: null });
    }
    for (const mapId of Object.keys(mapDropsById)) {
      if (mapId === 'global' || mapId === 'global_static' || !G.maps[mapId]) continue;
      const mapDefinition = G.maps[mapId] || {};
      const mapDrops = (mapDropsById[mapId] || []).map(drop => ({ drop: drop as unknown[], outcome: p.dropOutcome(drop, itemName) })).filter(entry => !!entry.outcome);
      if (!mapDrops.length) continue;
      const monsterIds = new Set<string>((mapDefinition.monsters || []).filter((pack: Game) => pack?.type && G.monsters[pack.type]).map((pack: Game) => pack.type));
      for (const monsterId of monsterIds) {
        const definition = G.monsters[monsterId] || {};
        // Training dummies, invulnerable fixtures, one-off event spawns and hidden definitions are
        // no repeatable valuation source.
        if (definition.stationary || definition.immune || definition.unlist || Number(definition.respawn) < 0 || Number(definition.xp) <= 0) continue;
        const gold = Number(G.base_gold?.[monsterId]?.[mapId]);
        for (const { drop, outcome } of mapDrops) drops.push({ ...source(monsterId, outcome!, 'zone',
          // The server's map drop roll: random / (share * luck * hp/1000 * luckx) < rate, at
          // neutral share, luck and luckx.
          Math.min(1, outcome!.rate * (Number(definition.hp) || 0) / 1000), Number.isFinite(gold) ? gold : null),
        mapId, mapName: mapDefinition.name || mapId, baseRate: Number(drop[0]) });
      }
    }
    // Tracktrix gives two account-wide tables the static game data lacks: `global` scales with the
    // monster's HP, `global_static` uses the raw rate. Each farmable monster gets one source, so the
    // dashboard shows the world drop price for every target.
    for (const tableName of ['global_static', 'global']) {
      const outcomes = (mapDropsById[tableName] || []).map(drop => ({ drop: drop as unknown[], outcome: p.dropOutcome(drop, itemName) })).filter(entry => !!entry.outcome);
      if (!outcomes.length) continue;
      for (const monsterId of Object.keys(G.monsters || {})) {
        if (!farmableValuationMonster(monsterId)) continue;
        const definition = G.monsters[monsterId] || {}, oneHp = definition['1hp'] ? 1000 : 1;
        const scale = tableName === 'global' ? (Number(definition.hp) || 0) / 1000 * oneHp : oneHp;
        for (const { drop, outcome } of outcomes) drops.push({ ...source(monsterId, outcome!, 'world', Math.min(1, outcome!.rate * scale), null),
          baseRate: Number(drop[0]), acquisitionPath: [tableName === 'global' ? ACQUISITION.scaledWorldDrop : ACQUISITION.worldDrop, ...(outcome!.path || [])] });
      }
    }
    drops.sort((a, b) => (Number(a.threat) || 0) - (Number(b.threat) || 0) || (Number(a.rate) || 0) - (Number(b.rate) || 0));
    return dropCache[itemName] = drops;
  }
  // Suggested values are catalog data. Each row is the cheapest map for one farmable monster; no
  // monster hides another's choice.
  function itemSuggestedPrices(itemName: string) {
    if (valuationCache[itemName]) return valuationCache[itemName];
    const G = p.G(), defaultPrice = defaultStandPrice(G.items?.[itemName]);
    const byMonster: Record<string, DropSource[]> = {};
    for (const entry of itemDropSources(itemName))
      if (farmableValuationMonster(entry.monsterId) && Number(entry.originRate) < 1) (byMonster[entry.monsterId] ||= []).push(entry);
    const baseGold = (monsterId: string, mapId: string) => Number(G.base_gold?.[monsterId]?.[mapId]);
    const prices = Object.keys(byMonster).map(monsterId => {
      const sources = byMonster[monsterId]!, direct = sources.filter(entry => entry.sourceType === 'monster' || entry.sourceType === 'world');
      const maps = valuationMonsterMaps(monsterId).filter(mapId => Number.isFinite(baseGold(monsterId, mapId)));
      for (const entry of sources) if (entry.sourceType === 'zone' && !maps.includes(entry.mapId!)) maps.push(entry.mapId!);
      const candidates = maps.map(mapId => {
        const applicable = [...direct, ...sources.filter(entry => entry.sourceType === 'zone' && entry.mapId === mapId)];
        if (!applicable.length) return null;
        let missChance = 1, expectedYield = 0;
        const paths: string[] = [];
        for (const entry of applicable) {
          const rate = Math.min(1, Math.max(0, Math.min(1, Number(entry.rate) || 0)) * VALUATION_LUCK);
          missChance *= 1 - rate;
          expectedYield += rate * Math.max(1, Number(entry.quantity) || 1);
          const path = (entry.acquisitionPath || []).join(' → ');
          if (path && !paths.includes(path)) paths.push(path);
        }
        const chance = 1 - missChance, gold = baseGold(monsterId, mapId);
        if (!(chance > 0) || !Number.isFinite(gold)) return null;
        // The kills that find the item nine times in ten.
        const kills = chance >= 1 ? 1 : Math.ceil(Math.log(0.1) / Math.log(1 - chance));
        const quantity = Math.max(1, expectedYield / chance), monster = G.monsters[monsterId] || {};
        return { monsterId, monsterName: monster.name || monsterId, sprite: p.monsterSprite(monster.skin), mapId,
          mapName: G.maps[mapId]?.name || mapId, rate: chance, quantity, kills, goldPerKill: gold,
          suggested: Math.max(defaultPrice, Math.ceil(kills * gold / quantity)), paths, luckMultiplier: VALUATION_LUCK,
          worldDrop: applicable.some(entry => entry.sourceType === 'world') };
      }).filter(<T>(entry: T | null): entry is T => !!entry).sort((a, b) => a.suggested - b.suggested || a.kills - b.kills);
      return candidates[0] || null;
    }).filter(<T>(entry: T | null): entry is T => !!entry).sort((a, b) => a.suggested - b.suggested || a.monsterName.localeCompare(b.monsterName));
    return valuationCache[itemName] = prices;
  }
  function itemCraftUses(itemName: string) {
    const G = p.G(), uses: unknown[] = [];
    for (const craftedId of Object.keys(G.craft || {})) {
      const recipe = G.craft[craftedId] || {}, crafted = G.items[craftedId] || {};
      for (const material of recipe.items || []) if (Array.isArray(material) && material[1] === itemName)
        uses.push({ id: craftedId, name: crafted.name || craftedId, quantity: Number(material[0]) || 0, level: Number(material[2]) || 0,
          cost: Number(recipe.cost) || 0, quest: recipe.quest || null, sprite: p.sprite(crafted.skin || craftedId) });
    }
    return (uses as { name: string }[]).sort(byName);
  }
  function itemWorldInfo(itemName: string) {
    if (worldCache[itemName]) return worldCache[itemName];
    const G = p.G(), definition = G.items[itemName] || {}, recipe = G.craft?.[itemName];
    const setDefinition = definition.set && G.sets?.[definition.set];
    let set = null;
    if (setDefinition) {
      const counts: Record<string, number> = {};
      for (const id of setDefinition.items || []) counts[id] = (counts[id] || 0) + 1;
      set = { id: definition.set, name: setDefinition.name || definition.set, explanation: setDefinition.explanation || '',
        items: Object.keys(counts).map(id => ({ id, name: G.items[id]?.name || id, quantity: counts[id], sprite: p.sprite(G.items[id]?.skin || id) })),
        bonuses: Object.keys(setDefinition).filter(key => /^\d+$/.test(key))
          .map(pieces => ({ pieces: Number(pieces), stats: safeItemDefinition(setDefinition[pieces] || {}) }))
          .filter(bonus => Object.keys(bonus.stats).length > 0) };
    }
    return worldCache[itemName] = {
      recipe: recipe ? { cost: Number(recipe.cost) || 0, quest: recipe.quest || null,
        materials: (recipe.items || []).map((material: [number, string, number?]) => {
          const materialDefinition = G.items[material[1]] || {};
          return { quantity: Number(material[0]) || 0, id: material[1], level: Number(material[2]) || 0,
            name: materialDefinition.name || material[1], sprite: p.sprite(materialDefinition.skin || material[1]), drops: itemDropSources(material[1]) };
        }) } : null,
      set, drops: itemDropSources(itemName), suggestedPrices: itemSuggestedPrices(itemName), usedIn: itemCraftUses(itemName),
    };
  }
  // A skin's cell in the game's item sheets (G.positions, G.imagesets).
  function itemSheetSprite(skin: string) {
    const G = p.G(), position = G.positions[skin];
    const pack = position && G.imagesets[position[0] || 'pack_20'];
    return pack && position ? { url: 'https://adventure.land' + pack.file, tileSize: pack.size, columns: pack.columns,
      rows: pack.rows, x: position[1], y: position[2] } : null;
  }
  // The copy's calculated properties. An old client build has no item_properties, and its
  // ReferenceError leaves the base definition showing; any other throw of the game's call goes on.
  function itemProperties(item: Item): Record<string, unknown> {
    const shown: Record<string, unknown> = {};
    let calculated: Record<string, unknown> = {};
    try { calculated = p.itemProperties(item) || {}; }
    catch (error) { if (error instanceof ReferenceError) return shown; throw error; }
    for (const [key, value] of Object.entries(calculated))
      if ((typeof value === 'number' && value !== 0) || (typeof value === 'boolean' && value) || (typeof value === 'string' && value)) shown[key] = value;
    return shown;
  }
  const itemTitle = (item: Item) => item.p && p.G().titles?.[item.p] ? safeItemDefinition(p.G().titles[item.p]) : null;
  function itemDefinition(item: Item | null | undefined) {
    const G = p.G();
    if (!item || !G.items[item.name!]) return null;
    const definition = G.items[item.name!];
    // merchantCatalog's allItems carries every per-type field below. Once a status reply clears
    // needsCatalog the coordinator holds that catalog, so a report carries only what differs
    // between copies of one item.
    if (p.catalogKnown()) {
      const perCopy: Record<string, unknown> = { properties: itemProperties(item) };
      const title = itemTitle(item);
      if (title) perCopy.title = title;
      if (item.skin && item.skin !== definition.skin) perCopy.sprite = itemSheetSprite(item.skin);
      return perCopy;
    }
    return { definition: safeItemDefinition(definition), upgradeable: !!definition.upgrade, compoundable: !!definition.compound,
      buyable: !!itemSeller(item.name!), properties: itemProperties(item), scaling: safeItemDefinition(definition.upgrade || definition.compound || {}),
      maxLevel: maximumItemLevel(definition), usage: itemUsage(definition), bonuses: itemBonuses(definition),
      // A live report never builds the whole drop graph: until the background preparation fills
      // the cache, the dashboard uses its catalog.
      world: worldCache[item.name!],
      // The copy's title (docs/item-titles.md); the dashboard names it and adds its stats.
      title: itemTitle(item), sprite: itemSheetSprite(item.skin || definition.skin) };
  }
  // The exchange tables of one item: its base table, and for an upgradeable or compoundable item one
  // per level the game data holds. The game looks a copy's table up as `G.drops[name + level]`, so
  // the levels are the keys of G.drops that extend the item's id by a level number.
  function exchangeLevels(G: Game, id: string, definition: Game): number[] {
    const leveled = !!(definition.upgrade || definition.compound), levels: number[] = [];
    for (const [key, table] of Object.entries(G.drops || {})) {
      if (!Array.isArray(table) || !table.length || !key.startsWith(id)) continue;
      const suffix = key.slice(id.length);
      if (!suffix) levels.push(0);
      else if (leveled && /^[1-9][0-9]*$/.test(suffix)) levels.push(Number(suffix));
    }
    return levels.sort((a, b) => a - b);
  }
  function merchantCatalog() {
    const G = p.G(), ids = Object.keys(G.items || {});
    const allItems = ids.map(id => {
      const definition = G.items[id] || {};
      return { id, name: definition.name || id, upgradeable: !!definition.upgrade, compoundable: !!definition.compound,
        sprite: p.sprite(definition.skin || id),
        meta: { definition: safeItemDefinition(definition), world: itemWorldInfo(id), upgradeable: !!definition.upgrade,
          compoundable: !!definition.compound, buyable: !!itemSeller(id), scaling: safeItemDefinition(definition.upgrade || definition.compound || {}),
          maxLevel: maximumItemLevel(definition), usage: itemUsage(definition), bonuses: itemBonuses(definition), sprite: p.sprite(definition.skin || id) } };
    }).sort(byName);
    const buyable = ids.map(id => {
      const definition = G.items[id], seller = itemSeller(id);
      if (!seller || !Number.isFinite(definition.g) || definition.g < 0 || definition.cash) return null;
      const grade = Number(definition.igrade) || 0;
      return { id, name: definition.name || id, cost: definition.g, seller, upgradeable: !!definition.upgrade, compoundable: !!definition.compound,
        upgradeGrade: grade, grades: definition.grades || [9, 10, 11, 12], upgradeChances: UPGRADE_CHANCES[grade] || UPGRADE_CHANCES[0],
        scrollCosts: [0, 1, 2, 3].map(scroll => G.items['scroll' + scroll]?.g || 0), sprite: p.sprite(definition.skin || id) };
    }).filter(<T>(entry: T | null): entry is T => !!entry).sort(byName);
    const craftable = Object.keys(G.craft || {}).map(id => {
      const recipe = G.craft[id], definition = G.items[id] || {};
      return { id, name: definition.name || id, cost: Number(recipe.cost) || 0, sprite: p.sprite(definition.skin || id),
        materials: (recipe.items || []).map((material: [number, string, number?]) => {
          const materialDefinition = G.items[material[1]] || {};
          return { quantity: material[0], id: material[1], level: material[2] || 0, name: materialDefinition.name || material[1],
            sprite: p.sprite(materialDefinition.skin || material[1]) };
        }) };
    }).sort(byName);
    const exchangeable: any[] = [];
    for (const id of ids) {
      const definition = G.items[id] || {};
      if (!definition.e || definition.ignore) continue;
      const npc = definition.quest && Object.keys(G.npcs || {}).find(npcId => G.npcs[npcId]?.quest === definition.quest) || 'exchange';
      for (const level of exchangeLevels(G, id, definition)) {
        const table = id + (level ? String(level) : '');
        exchangeable.push({ key: exchangeKey(id, level), id, level, name: (definition.name || id) + (level ? ' +' + level : ''), cost: 0,
          required: Math.max(1, Number(definition.e) || 1), npc, sprite: p.sprite(definition.skin || id),
          results: p.exchangeRewards(G, table).map(result => ({ ...result, sprite: G.items[result.id] ? p.sprite(G.items[result.id].skin || result.id) : null })) });
      }
    }
    exchangeable.sort(byName);
    for (const currency of Object.keys(G.tokens || {})) {
      const token = G.items[currency];
      if (!token || token.ignore) continue;
      for (const reward of Object.keys(G.tokens[currency])) {
        const price = Number(G.tokens[currency][reward]), item = G.items[reward.split('-')[0]!];
        if (!item || !(price > 0)) continue;
        exchangeable.push({ key: currency + '@0:' + reward, id: currency, level: 0, reward, name: item.name || reward, cost: 0,
          required: Math.max(1, price), rewardQuantity: price < 1 ? Math.floor(1 / price) : 1, currencyName: token.name || currency,
          currencySprite: p.sprite(token.skin || currency), npc: token.npc || currency + 's', sprite: p.sprite(item.skin || reward.split('-')[0]), results: [] });
      }
    }
    return { version: CATALOG_VERSION, valuationLuckMultiplier: VALUATION_LUCK, allItems, buyable, craftable, exchangeable };
  }

  // The status inventory.
  function bankSnapshot() {
    const bank = me().bank;
    if (!bank) return null;
    const packs: Record<string, unknown[]> = {};
    // Bank arrays are sparse and an empty pack can report length 0 or 1; every unlocked pack has
    // the game's 42 cells (rules.ts `BANK_PACK_CELLS`).
    for (const pack of Object.keys(bank)) if (Array.isArray(bank[pack]))
      packs[pack] = Array.from({ length: BANK_PACK_CELLS }, (_, slot) => {
        const item = bank[pack][slot];
        return item ? { slot, item: fingerprint(item), meta: itemDefinition(item) } : null;
      });
    return { gold: bank.gold || 0, packs };
  }
  function bankVaultCatalog() {
    const G = p.G(), definitions = p.bankPacks() || {}, floorKeys: Record<string, unknown> = {};
    for (const name of Object.keys(G.items || {})) {
      const item = G.items[name];
      if (item?.type === 'bank_key' && item.unlocks) floorKeys[item.unlocks] = { id: name, name: item.name || name, sprite: itemSheetSprite(item.skin) };
    }
    return Object.keys(definitions).map(pack => {
      const definition = definitions[pack] || [];
      return { pack, floor: definition[0], gold: Number(definition[1]) || 0, shells: Number(definition[2]) || 0, key: floorKeys[definition[0] as string] || null };
    }).sort((first, second) => Number(first.pack.replace(/\D/g, '')) - Number(second.pack.replace(/\D/g, '')));
  }
  function inventoryOperationEntry(item: Item | null, slot: number) {
    const G = p.G(), pending = item?.name === 'placeholder' && item.p;
    const upgrade = p.activeUpgrade(), active = upgrade?.slot === slot ? upgrade : null;
    const displayItem = pending?.name ? (active?.item || { name: pending.name, level: pending.level || 0 }) : item ? fingerprint(item) : active?.item;
    if (!displayItem) return null;
    const entry: Record<string, unknown> = { slot, item: displayItem, meta: itemDefinition(displayItem as Item) };
    if (pending?.scroll && /^(c?scroll)\d+$/.test(pending.scroll))
      entry.operation = { type: pending.scroll.startsWith('cscroll') ? 'compound' : 'upgrade', fromLevel: Number(pending.level) || 0,
        toLevel: (Number(pending.level) || 0) + 1, chance: typeof pending.chance === 'number' ? pending.chance : null,
        sprite: G.items.placeholder ? itemSheetSprite(G.items.placeholder.skin) : null };
    return entry;
  }
  // A report omits items, slots and bank while they match the revision the coordinator's last reply
  // acknowledged (docs/efficiency.md, Inventory deltas). The key is every input of the three
  // builders, so a change rebuilds them once and the next report carries them.
  function statusInventory() {
    const character = me(), upgrade = p.activeUpgrade(), known = p.catalogKnown();
    const key = JSON.stringify([character.items, character.slots || null, character.bank || null, upgrade && [upgrade.slot, upgrade.item]]);
    // Before the catalog acknowledgement itemDefinition reads the world cache, which fills in over time.
    if (known && statusCache?.key === key) return statusCache;
    const slots: Record<string, unknown> = {};
    for (const [slot, item] of Object.entries<any>(character.slots || {})) if (item) slots[slot] = { item: fingerprint(item), meta: itemDefinition(item) };
    return statusCache = { key: known ? key : null, revision: statusSession + '.' + (++statusCount),
      items: (character.items || []).map(inventoryOperationEntry), slots, bank: bankSnapshot() };
  }
  function withStatusInventory<T extends Record<string, unknown>>(status: T): T {
    const inventory = statusInventory();
    return Object.assign(status, { inventoryRevision: inventory.revision, items: inventory.items, slots: inventory.slots, bank: inventory.bank });
  }
  // The full inventory goes out while the coordinator's last reply acknowledged another revision.
  // The first report of a load names a new session's revision, a lost or unanswered full report
  // leaves the old acknowledgement, and a coordinator that lost the inventory answers with none or
  // refuses the report (statusInventoryResend), so each of those gaps sends it on the next exchange.
  function attachStatusInventory<T extends Record<string, unknown>>(status: T): T {
    const inventory = statusInventory();
    if (inventory.revision === acknowledged) return Object.assign(status, { inventoryRevision: inventory.revision });
    return withStatusInventory(status);
  }
  function acknowledgeStatusInventory(body: { combatOnly?: unknown; combatWait?: unknown }, value: { inventoryRevision?: unknown } | null | undefined) {
    if (body.combatOnly || body.combatWait) return;
    acknowledged = typeof value?.inventoryRevision === 'string' ? value.inventoryRevision : null;
  }
  // A coordinator without this inventory revision (a restart, another runtime) refuses the report
  // unapplied with 409 `inventory-required`. A report that carried only the revision then drops the
  // acknowledgement and goes again with the full inventory; any other answer gives null.
  function statusInventoryResend<T extends Record<string, unknown>>(body: T, httpStatus: number, reply: { code?: unknown } | null | undefined): T | null {
    if (httpStatus !== 409 || reply?.code !== 'inventory-required' || Array.isArray(body.items)) return null;
    acknowledged = null;
    return withStatusInventory({ ...body });
  }
  // An item's properties for this character's class and map, or the game's plain read where the
  // client cannot calculate them.
  function characterItemProperties(item: Item): Record<string, unknown> | null | undefined {
    const character = p.character();
    return p.calculateItemProperties ? p.calculateItemProperties(item, { class: character.ctype, map: character.map }) : p.itemProperties(item);
  }
  // A changed Tracktrix discovery table rebuilds the catalog's item caches.
  function resetCatalog() { worldCache = {}; dropCache = {}; valuationCache = {}; }

  return {
    fingerprint, sameItem, sameItemState, itemQuantity, inventoryTotals, findItem, findInventoryItemByName, inventoryQuantity,
    inventoryAmount, findMarkedInventoryItem, findMarkedItem, waitForMarkedItem, itemAvailability, freeInventorySlots, waitForPlayer,
    standSlots, standItem, itemSeller, safeItemDefinition, nativeMonsterDropTables, maximumItemLevel, itemWorldInfo, itemSheetSprite,
    itemDefinition, inventoryOperationEntry, merchantCatalog, bankSnapshot, bankVaultCatalog, attachStatusInventory, withStatusInventory, acknowledgeStatusInventory, statusInventoryResend, resetCatalog,
    characterItemProperties,
    cachedWorld: (name: string) => worldCache[name], catalogVersion: CATALOG_VERSION,
  };
}
export type BagAnswers = ReturnType<typeof createBagReads>;
