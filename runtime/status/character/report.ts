// The status owner's character report (report.ts): the status body each
// heartbeat posts, the reference catalogs it carries until the coordinator holds them, and the reads that
// build both. It reads only: each field is its owner's published read, handed in through `ReportPorts`,
// and the writes a report needs first are table A's rows before it (apply.ts `beforeReport`). shared.js
// builds it once at load.
import { CATALOG_VERSIONS, catalogValue, reportedStats } from '../api.ts';
import { attributeStats, levelRunSpeed } from '../../../dashboard/lib/game-formulas.ts';
import { boundsPending, capReached } from './bounds.ts';
import { QUEUE_PROTOCOL } from '../../protocol/reports.ts';
import { characterDoors } from '../../hooks/character-doors.ts';
import { characterReads } from '../../hooks/character-reads.ts';
import { ACQUISITION, TRACKER_ITEMS } from '../../items/api.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the game's character, G and the owners' doors are read as the client gives them */
type Game = any;
type Door = Record<string, any>;

export interface ReportPorts {
  /** The game's character, G, the game window and the shared root. */
  me(): Game; G(): Game; parent(): Game; root(): Game;
  /** The game's account tracker the runner started with, or null. */
  initialTracker(): Game;
  /** The game's own calls the report reads. */
  game: {
    entity(id: string): Game;
    inRange(target: Game): boolean;
    canAttack(target: Game): boolean;
    canUse(skill: string): boolean;
    cooling(skill: string): boolean;
    /** The game renderer's `sprite`, or null where the client has none (caracAL). */
    renderer(): ((skin: string, options: Record<string, unknown>) => string) | null;
    itemProperties(item: Game): Game;
    log(text: string, color: string): void;
  };
  /** The status owner's run scope: whether this runner still runs, and its yield. */
  current(): boolean;
  sleep(ms: number): Promise<unknown>;
  /** Each owner's door, by owner. */
  owners: {
    // movement's walk service and its character parts (`installMovementCharacter`): the walk
    // state, the group walk, the travel and convoy reads, the kite and the report gap.
    movement: Door; walks: Door; survival: Door; targeting: Door; turns: Door; hooks(): Door;
    events: { clock: Door; attend: Door; merchant: Door; anniversary: Door; team: Door; exit: Door };
    items: { reads: Door; bag: Door; bank: Door; market: Door; production: Door; luckySlots: () => Door; visits: Door };
    gathering: Door;
    hunting: { hunt: Door; cave: Door; rares: Door; farm: Door; spawnCatalog(G: Game, sprite: (skin: string) => unknown): Game[] };
    lifecycle: { run: Door; drain: Door; intake: Door };
    // The tasks owner's game party list and farm reunion.
    tasks: { partyList(): unknown; reunion(): unknown };
    // The status owner's own telemetry: the fight packets and the last death.
    telemetry: Door;
  };
  /** The game client's pathfinder state (`smart`). */
  smart(): Game;
}

const RENDER_STYLE = /<img style=(['"])/g;
const pixelated = (html: string) => html.replace(RENDER_STYLE, '<img style=$1max-width: none; image-rendering: pixelated; ');

// The report's game reads: each takes the game objects it reads as arguments, so createReport calls
// them with its ports and a test calls them with its own objects.

const achievementMaximum = (entry: Game) => Array.isArray(entry) ? Number(entry[0]) || 0 :
  Number(entry && entry.count !== undefined ? entry.count : entry) || 0;
/** Each achievement monster's count from the account tracker `data`, or null when it holds no counts. */
export function achievementCounts(G: Game, data: Game, read: (local: number, entry: Game) => unknown): Record<string, unknown> | null {
  const maximums = data.max && data.max.monsters || {};
  if (!data.monsters && !data.monsters_diff && !Object.keys(maximums).length) return null;
  const own = data.monsters || {}, pending = data.monsters_diff || {};
  return Object.keys(G.monsters || {}).reduce((out: Record<string, unknown>, id) => {
    if (!Array.isArray(G.monsters[id].achievements) || !G.monsters[id].achievements.length) return out;
    out[id] = read((Number(own[id]) || 0) + (Number(pending[id]) || 0), maximums[id]);
    return out;
  }, {});
}
type AchievementProgress = Record<string, { score: number; owner: string | null }> | null;
/** Each achievement monster's best score and its holder; `name` holds a score its own count beats. */
export function achievementProgress(G: Game, data: Game, name: string): AchievementProgress {
  return achievementCounts(G, data, (local, entry) => {
    const account = achievementMaximum(entry), owner = Array.isArray(entry) && typeof entry[1] === 'string' ? entry[1] : null;
    return local > account ? { score: local, owner: name } : { score: account, owner: owner || (local === account && local ? name : null) };
  }) as AchievementProgress;
}
const holdsTracktrix = (character: Game) => !!character.tracker ||
  (character.items || []).some((item: Game) => item && TRACKER_ITEMS.includes(item.name));
// The stat rewards a character's achievement scores unlock (G.monsters[id].achievements).
function achievementStats(G: Game, progress: AchievementProgress): Record<string, number> {
  const bonuses: Record<string, number> = {}, scores = progress || {};
  Object.keys(scores).forEach(id => (G.monsters[id].achievements || []).forEach((reward: Game) => {
    if (reward[1] === 'stat' && scores[id].score >= Number(reward[0])) bonuses[reward[2]] = (bonuses[reward[2]] || 0) + (Number(reward[3]) || 0);
  }));
  return bonuses;
}
// The game reports the Tracktrix stats on the character (`monster_stats`); where it does not,
// the report adds them up from the scores and marks the total `calculated`.
export function tracktrixBonuses(character: Game, parent: Game, G: Game, progress: AchievementProgress, sprite: (skin: string) => unknown) {
  const active = holdsTracktrix(character), stats = parent.character && parent.character.monster_stats;
  const calculated = active && !stats && !!progress;
  return { active, calculated, bonuses: !active ? {} : stats ? { ...stats } : calculated ? achievementStats(G, progress) : null,
    sprite: sprite((G.items.tracker || {}).skin || 'tracker') };
}

// The run speed from class, gear and stats before the stand, cruise and terrain, as the game's
// calculate_player_stats computes it. `conditions` adds the conditions on the character; the walk's pace
// reads it without them, so Hard Shell, a slow or a buff never sets a walk's pace.
export function runSpeed(game: { character: Game; G: Game; parent: Game; itemProperties(item: Game): Game },
  progress: AchievementProgress, conditions: boolean): number | null {
  const { character, G, parent } = game, definition = G.classes[character.ctype];
  if (!definition) return null;
  let speed = Number(definition.speed) || 0;
  const sets: Record<string, number> = {};
  Object.keys(character.slots || {}).forEach(slot => {
    const item = character.slots[slot], def = item && G.items[item.name];
    if (!def || /^trade/.test(slot)) return;
    const props = game.itemProperties(item);
    if (props.class && props.class.indexOf(character.ctype) < 0) return;
    speed += Number(props.speed) || 0;
    if (props.set) sets[def.set] = (sets[def.set] || 0) + 1;
    if (slot === 'mainhand') speed += Number(((definition.doublehand || {})[def.wtype] || (definition.mainhand || {})[def.wtype] || {}).speed) || 0;
    if (slot === 'offhand') speed += Number(((definition.offhand || {})[def.wtype] || (definition.offhand || {})[def.type] || {}).speed) || 0;
  });
  Object.keys(sets).forEach(id => { speed += Number((G.sets[id] && G.sets[id][sets[id]] || {}).speed) || 0; });
  if (conditions) Object.keys(character.s || {}).forEach(id => {
    speed += (Number(character.s[id].speed) || 0) + (Number((G.conditions[id] || {}).speed) || 0);
  });
  const reported = parent.character && parent.character.monster_stats;
  if (reported) speed += Number(reported.speed) || 0;
  else if (holdsTracktrix(character)) speed += achievementStats(G, progress).speed || 0;
  return Math.max(5, speed + attributeStats.runSpeed(Number(character.str) || 0, Number(character.dex) || 0) +
    levelRunSpeed(Number(character.level) || 0));
}

// Steam's sprite() uses desktop.imageUrl(), whose blobs belong to the game window, so the dashboard's
// copy resolves them there; root-relative sheet paths point back to Adventure Land. A layer that
// cannot be exported sends null, and the dashboard draws its ordinary sprite. `imageUrls` holds the
// sheet file of each blob the window already handed out.
export function dollHtml(html: string, G: Game, parent: Game, imageUrls: Record<string, string>): string | null {
  const blobs = html.match(/blob:[^'"\s]+/g) || [];
  if (blobs.some(url => !imageUrls[url]) && parent.desktop && typeof parent.desktop.imageUrl === 'function') {
    Object.keys(G.sprites || {}).forEach(key => {
      const file = G.sprites[key].file;
      if (file && /^(\/|https?:\/\/)/.test(file)) imageUrls[parent.desktop.imageUrl(file)] = file;
    });
  }
  let unresolved = false;
  html = html.replace(/src=(['"])(.*?)\1/g, (_match, quote, url) => {
    url = imageUrls[url] || url;
    if (/^(blob:|file:)/i.test(url)) unresolved = true;
    if (url.indexOf('//') === 0) url = 'https:' + url;
    else if (url.charAt(0) === '/') url = 'https://adventure.land' + url;
    return 'src=' + quote + url + quote;
  });
  return unresolved ? null : html;
}
// The renderer draws each layer at its own size, offsets and order; an integer scale keeps adjacent
// sheet rows out of the crop. The card's portrait is the standard 27x38 doll at 2x.
export function renderDoll(game: { renderer: ((skin: string, options: Record<string, unknown>) => string) | null; parent: Game; G: Game;
  imageUrls: Record<string, string> }, skin: string, cosmetics: unknown, scale: number, options: Record<string, unknown> = {}): string | null {
  if (!game.renderer) return null;
  try {
    const html = String(game.renderer.call(game.parent, skin, { cx: JSON.parse(JSON.stringify(cosmetics || {})),
      width: 27 * scale, height: 38 * scale, scale, ...options }) || '');
    return dollHtml(scale > 1 ? pixelated(html) : html, game.G, game.parent, game.imageUrls);
  } catch { return null; }
}
/** Each class's starting looks (G.classes[ctype].looks) as a 2x doll and its sheet layers. */
export function classAppearanceChoices(G: Game, render: (skin: string, cosmetics: unknown, scale: number) => string | null,
  sprite: (skin: string) => unknown) {
  return Object.keys(G.classes || {}).reduce((out: Record<string, unknown>, ctype) => {
    out[ctype] = (G.classes[ctype].looks || []).map((look: Game, index: number) => {
      const cosmetics = look[1] || {};
      const skins = [look[0]].concat(Object.keys(cosmetics).map(key => cosmetics[key]));
      return { index, html: render(look[0], cosmetics, 2), layers: skins.map(sprite).filter(Boolean) };
    });
    return out;
  }, {});
}

export function createReport(p: ReportPorts) {
  // The realm's player names the call budget's background read last delivered (the call
  // budget's `players`).
  let realmPlayers: string[] = [];
  const { owners: o } = p;
  // The catalog state: the coordinator has the catalogs of `generation` once a reply accepts a
  // report that carried them; a tracker table change starts a new generation.
  const catalog = { known: false, prepared: false, preparing: false, generation: 0, sent: { generation: 0, carried: false } };
  let lootOutcomes: Record<string, { probability: number; paths: string[] } | null> = {};
  // The add-on system's door for the game events no owner names,
  // published once.
  let doorsPublished = false;
  let tracker: Game = (() => { const data = p.initialTracker(); return data && Object.keys(data).length ? data : null; })();
  let trackerInitialized = !!tracker;
  const trackerSignature = (data: Game) => data ? JSON.stringify([data.drops || null, data.drops_home || null,
    data.monsters_home_server || null, data.maps || null, data.tables || null]) : '';
  let trackerTables = trackerSignature(tracker);

  // The call budget's Tracktrix read hands each reply here (call-budget-reads.ts `tracker`). Kill
  // counters change often; only a change of the discovery tables rebuilds the catalogs, home rewards
  // learned after the first reply included.
  function observeTracker(data: Game): void {
    if (!data || typeof data !== 'object') return;
    const signature = trackerSignature(data), changed = signature !== trackerTables;
    tracker = data; trackerTables = signature;
    if (trackerInitialized && !changed) return;
    trackerInitialized = true;
    o.items.reads.resetCatalog();
    lootOutcomes = {};
    catalog.known = false; catalog.prepared = false; catalog.generation++;
  }

  function homeDropTables(): Record<string, unknown> {
    const G = p.G();
    return Object.assign({}, G.drops && G.drops.monsters_home_server || {}, tracker && tracker.monsters_home_server || {},
      tracker && tracker.drops_home || {});
  }
  const lootTable = (name: string) => tracker && tracker.tables && tracker.tables[name] || p.G().drops && p.G().drops[name];

  function lootTableOutcome(tableName: string, itemName: string, seen: Record<string, boolean> = {}): { probability: number; paths: string[] } | null {
    const key = tableName + ':' + itemName;
    if (Object.prototype.hasOwnProperty.call(lootOutcomes, key)) return lootOutcomes[key];
    const table = lootTable(tableName);
    if (seen[tableName] || !Array.isArray(table)) return null;
    const nextSeen = { ...seen, [tableName]: true };
    const total = table.reduce((sum: number, drop: Game) => sum + (Array.isArray(drop) ? Number(drop[0]) || 0 : 0), 0);
    if (total <= 0) return null;
    let probability = 0, paths: string[] | null = null;
    table.forEach((drop: Game) => {
      if (!Array.isArray(drop)) return;
      const result = lootRewardOutcome(drop, itemName, nextSeen);
      if (!result || result.probability <= 0) return;
      probability += (Number(drop[0]) || 0) / total * result.probability;
      if (!paths || (result.paths || []).length < paths.length) paths = result.paths || [];
    });
    const outcome = probability > 0 ? { probability: Math.min(1, probability), paths: paths || [] } : null;
    // A failed nested search may only have hit an ancestor cycle, so only a top-level miss proves the
    // item absent; the many monster and map sources that open a table reuse those misses.
    if (outcome || !Object.keys(seen).length) lootOutcomes[key] = outcome;
    return outcome;
  }

  function lootRewardOutcome(drop: Game[], itemName: string, seen: Record<string, boolean>): { probability: number; paths: string[] } | null {
    const G = p.G(), reward = drop[1];
    if (reward === itemName) return { probability: 1, paths: [itemName] };
    if (reward === 'open' && typeof drop[2] === 'string') {
      const opened = lootTableOutcome(drop[2], itemName, seen);
      return opened && { probability: opened.probability, paths: [ACQUISITION.open + drop[2]].concat(opened.paths || []) };
    }
    const exchangeCount = G.items && G.items[reward] && Number(G.items[reward].e);
    if (exchangeCount > 0 && Array.isArray(lootTable(reward))) {
      const exchanged = lootTableOutcome(reward, itemName, seen);
      // A multi-item exchange gives the long-run rolls per drop, so one leather never claims to open a
      // 40-leather table at once.
      return exchanged && { probability: exchanged.probability / exchangeCount,
        paths: [reward + (exchangeCount > 1 ? ' ×' + exchangeCount : '')].concat(exchanged.paths || []) };
    }
    return null;
  }

  function dropOutcome(drop: Game, itemName: string) {
    if (!Array.isArray(drop) || !Number.isFinite(Number(drop[0]))) return null;
    const reward = lootRewardOutcome(drop, itemName, {});
    if (!reward || reward.probability <= 0) return null;
    return { rate: Math.min(1, Number(drop[0]) * reward.probability), originRate: Number(drop[0]),
      quantity: drop[1] === itemName ? Number(drop[2]) || 1 : 1, path: reward.paths || [] };
  }

  // The game renderer's sheets (G.sprites): an animated body has 3 columns and 4 rows of frames per
  // cell, the single-frame layer types one; item and icon skins sit in G.positions (the items
  // owner's `itemSheetSprite`).
  function sheetSprite(skin: string) {
    const G = p.G(), sheets = Object.keys(G.sprites || {});
    for (const id of sheets) {
      const sheet = G.sprites[id];
      if (sheet.skip || !sheet.matrix) continue;
      for (let row = 0; row < sheet.matrix.length; row += 1) {
        const column = sheet.matrix[row].indexOf(skin);
        if (column < 0) continue;
        const frameRows = sheet.type === 'animation' || sheet.type === 'emblem' || sheet.type === 'gravestone' ? 1 : 4;
        const frameColumns = sheet.type === 'tail' ? 4 :
          (['v_animation', 'head', 'hair', 'hat', 's_wings', 'face', 'makeup', 'beard', 'emblem', 'gravestone'].indexOf(sheet.type) >= 0 ? 1 : 3);
        return { url: 'https://adventure.land' + sheet.file, tileSize: 1, columns: sheet.columns * frameColumns,
          rows: sheet.rows * frameRows, x: column * frameColumns + (frameColumns === 3 ? 1 : 0), y: row * frameRows };
      }
    }
    return null;
  }
  const sprite = (skin: string) => o.items.reads.itemSheetSprite(skin) || sheetSprite(skin);

  function activeConditions() {
    const character = p.me(), G = p.G();
    const conditions = Object.keys(character.s || {}).map(id => {
      const live = character.s[id] || {}, definition = G.conditions[id] || G.skills[id] || {}, skin = live.skin || definition.skin;
      return { id, name: definition.name || id, explanation: definition.explanation || '',
        remainingMs: typeof live.ms === 'number' ? live.ms : null, stacks: live.s !== undefined ? live.s : null,
        source: typeof live.f === 'string' || typeof live.f === 'number' ? live.f :
          (typeof live.source === 'string' || typeof live.source === 'number' ? live.source : null),
        definition: o.items.reads.safeItemDefinition(definition), live: o.items.reads.safeItemDefinition(live),
        sprite: skin ? sprite(skin) : null };
    });
    const elixir = character.slots && character.slots.elixir;
    if (elixir && G.items[elixir.name]) {
      const definition = G.items[elixir.name], expiry = new Date(elixir.expires).getTime();
      conditions.push({ id: 'elixir:' + elixir.name, name: definition.name || elixir.name, explanation: definition.explanation || '',
        remainingMs: isFinite(expiry) ? Math.max(0, expiry - Date.now()) : null, stacks: null, source: character.name,
        definition: o.items.reads.safeItemDefinition(definition), live: {}, sprite: sprite(definition.skin) });
    }
    return conditions.sort((a, b) => a.name.localeCompare(b.name));
  }

  function travelPlaces() {
    const G = p.G(), parent = p.parent(), world = parent.world || '', event = parent.current_event || '';
    return Object.keys(G.maps).filter(id => {
      const map = G.maps[id];
      return !map.ignore && !map.unlist && !map.instance && !map.irregular && (map.world || '') === world && (!map.event || map.event === event);
    }).map(id => {
      const map = G.maps[id], spawn = map.spawns && map.spawns[0] || [0, 0];
      return { id, name: map.name, x: spawn[0], y: spawn[1] };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  // The G.events that raise a monster without an ordinary spawn: the event's boss (its sprite), the
  // boss's HP-threshold adds (G.monsters[boss].spawns) and Graveyard Rising's waves.
  function eventMonsterSources(ordinary: Record<string, boolean>) {
    const G = p.G(), sources: Record<string, unknown[]> = {};
    const add = (type: string, source: unknown) => {
      if (!G.monsters[type] || ordinary[type]) return;
      (sources[type] = sources[type] || []).push(source);
    };
    Object.keys(G.events || {}).forEach(id => {
      const definition = G.events[id] || {}, name = definition.name || id, boss = definition.sprite;
      if (!G.monsters[boss]) return;
      add(boss, { id, name, role: 'boss' });
      const thresholds: Record<string, number[]> = {};
      (G.monsters[boss].spawns || []).forEach((spawn: Game) => {
        if (typeof spawn[0] !== 'string' || spawn[0].indexOf('hp:') !== 0) return;
        (thresholds[spawn[1]] = thresholds[spawn[1]] || []).push(Number(spawn[0].slice(3)));
      });
      Object.keys(thresholds).forEach(type => add(type, { id, name, role: 'add', at: thresholds[type] }));
      (Array.isArray(definition.waves) ? definition.waves : []).reduce((types: string[], wave: Game) => {
        Object.keys(wave && wave[1] || {}).forEach(type => { if (types.indexOf(type) < 0) types.push(type); });
        return types;
      }, []).forEach((type: string) => add(type, { id, name, role: 'wave' }));
    });
    return sources;
  }

  function bestiaryCatalog() {
    const G = p.G(), spawns: Record<string, unknown> = {}, ordinary: Record<string, boolean> = {};
    const monsterTables = o.items.reads.nativeMonsterDropTables(), homeTables = homeDropTables() as Record<string, unknown>;
    o.hunting.spawnCatalog(G, sheetSprite).forEach((choice: Game) => { spawns[choice.id] = choice.spawnRecords; ordinary[choice.id] = choice.locations.length > 0; });
    const eventSources = eventMonsterSources(ordinary);
    const rewards = (table: unknown) => (Array.isArray(table) ? table : []).map((drop: Game) => {
      if (!Array.isArray(drop) || typeof drop[1] !== 'string' || !G.items[drop[1]]) return null;
      const item = G.items[drop[1]] || {};
      return { rate: Number(drop[0]) || 0, id: drop[1], name: item.name || drop[1], quantity: Number(drop[2]) || 1, sprite: sprite(item.skin || drop[1]) };
    }).filter(Boolean);
    return Object.keys(G.monsters || {}).map(id => {
      const definition = G.monsters[id] || {};
      return { id, name: definition.name || id, sprite: sheetSprite(definition.skin), hp: Number(definition.hp) || 0,
        attack: Number(definition.attack) || 0, xp: Number(definition.xp) || 0, range: Number(definition.range) || 0,
        threat: (Number(definition.attack) || 0) * (Number(definition.frequency) || 0), definition: catalogValue(definition, capReached),
        drops: rewards(monsterTables[id]), homeRewards: rewards(homeTables[id]), spawnRecords: spawns[id], eventSources: eventSources[id] };
    });
  }

  // caracAL runs game.js and the runner in separate VM contexts: the runner's own `tracker` stays the
  // first empty object, and the socket's account data reaches `parent.tracker` and `observeTracker`.
  function liveTracker(): Game {
    const parent = p.parent();
    return parent && parent.tracker && Object.keys(parent.tracker).length ? parent.tracker : tracker || {};
  }

  function skillCatalog() {
    const G = p.G(), assigned: Record<string, boolean> = {};
    const entry = (id: string, definition: Game) => ({ id, name: definition.name || id, sprite: sprite(definition.skin || id), definition: catalogValue(definition, capReached) });
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const classes = Object.keys(G.classes || {}).map(classId => {
      const skills = Object.keys(G.skills || {}).filter(skillId => {
        const field = G.skills[skillId] && G.skills[skillId].class;
        const belongs = Array.isArray(field) ? field.indexOf(classId) >= 0 : field === classId;
        if (belongs) assigned[skillId] = true;
        return belongs;
      }).map(id => entry(id, G.skills[id] || {})).sort(byName);
      return { id: classId, name: (G.classes[classId] || {}).name || classId, skills };
    });
    classes.push({ id: 'shared', name: 'Shared / system', skills: Object.keys(G.skills || {}).filter(id => !assigned[id]).map(id => entry(id, G.skills[id] || {})).sort(byName) });
    classes.push({ id: 'conditions', name: 'Conditions', skills: Object.keys(G.conditions || {}).map(id => entry(id, G.conditions[id] || {})).sort(byName) });
    return classes;
  }


  const progress = () => achievementProgress(p.G(), liveTracker(), p.me().name);
  const monsterAchievementKills = () => achievementCounts(p.G(), liveTracker(), (local, entry) => Math.max(local, achievementMaximum(entry)));
  const tracktrix = () => tracktrixBonuses(p.me(), p.parent(), p.G(), progress(), sprite);
  const unrestrictedRunSpeed = (conditions: boolean) =>
    runSpeed({ character: p.me(), G: p.G(), parent: p.parent(), itemProperties: p.game.itemProperties }, progress(), conditions);
  // The blob URLs Steam's desktop.imageUrl() handed out, with the sheet file each one stands for.
  const imageUrls: Record<string, string> = {};
  const render = (skin: string, cosmetics: unknown, scale: number, options: Record<string, unknown> = {}) =>
    renderDoll({ renderer: p.game.renderer(), parent: p.parent(), G: p.G(), imageUrls }, skin, cosmetics, scale, options);
  const characterDollHtml = () => render(p.me().skin, p.me().cx, 2);
  function mapDollHtml(entity: Game, direction: unknown): string | null {
    if (!entity || (['character', 'npc'].indexOf(entity.type) < 0 && !entity.cx)) return null;
    return render(entity.skin, entity.cx, 1, { overflow: true, j: Number(direction) || 0 });
  }

  // The per-item caches warm one item per slice after a report, each slice yielding to the game's
  // socket, so catalog discovery never holds the client before its first status.
  async function prepareCatalog(): Promise<void> {
    if (catalog.preparing || catalog.prepared) return;
    catalog.preparing = true;
    const generation = catalog.generation;
    try {
      for (const item of Object.keys(p.G().items || {})) {
        await p.sleep(0);
        if (!p.current() || generation !== catalog.generation) return;
        o.items.reads.itemWorldInfo(item);
      }
      catalog.prepared = true;
    } catch (error) {
      p.game.log('Catalog preparation failed: ' + String(error && (error as Error).message || error), 'red');
    } finally {
      catalog.preparing = false;
    }
  }

  // Bounded read-only diagnostics for discovery publication and cache ownership.
  p.root().__partyCatalogDiagnostic = (monsterId: string, itemId: string) => {
    const cached = o.items.reads.cachedWorld(itemId);
    return { generation: catalog.generation, known: catalog.known, prepared: catalog.prepared, preparing: catalog.preparing,
      trackerHome: (homeDropTables() as Record<string, unknown>)[monsterId], itemCached: !!cached,
      cachedSources: cached && cached.drops.filter((source: Game) => source.monsterId === monsterId).slice(0, 24) };
  };

  // The character's side of the registry: its name and 0 HP for the common holds, every owner's
  // action door and read, then each enabled add-on's tick.
  function addonTick(hooks: Game, character: Game, parent: Game): void {
    if (!hooks.attach) return;
    hooks.attach({ side: 'character', name: character.name, dead: () => !!character.rip || Number(character.hp) <= 0 });
    if (!doorsPublished) {
      doorsPublished = true;
      hooks.publishDoors(characterDoors({ emit: (event, data) => parent.socket?.emit(event, data), band: question => hooks.calls.band(question) }));
      hooks.publishReads(characterReads().answers);
    }
    hooks.tick(character.name);
  }

  function snapshot(): Record<string, unknown> {
    const character = p.me(), G = p.G(), parent = p.parent(), root = p.root();
    const { movement, survival, targeting } = o, hooks = o.hooks();
    const { clock, attend, merchant: eventMerchant, anniversary, team } = o.events;
    const { bag, bank, market, production, visits } = o.items;
    const { hunt, cave } = o.hunting;
    const { run, drain, intake } = o.lifecycle;
    const walk = o.movement.walkState, groupWalk = o.walks.groupWalk, departing = !!o.movement.walkState.departing, facts = bag.facts();
    const selection = targeting.selection(), queueClient = root.partyQueueClient;
    const gathering = o.gathering.report();
    const combatTarget = selection.targetId && p.game.entity(selection.targetId);
    const liveTarget = combatTarget && !combatTarget.dead ? combatTarget : null;
    const threats = Object.keys(parent.entities || {}).map(id => parent.entities[id]).filter((entity: Game) =>
      entity && entity.type === 'monster' && !entity.dead && entity.target === character.name && !!hooks.ask('targeting.allowed', entity))
      .map((entity: Game) => ({ id: entity.id, mtype: entity.mtype }));
    // One event selection for the report and the walk, so the anniversary entry, which no one joins,
    // never hides a live combat event running beside it.
    const selectedEvent = attend.active(), liveEventName = selectedEvent && selectedEvent.name || null;
    const status = clock.status(), anniversaryFeed = status && status.anniversary, refusal = o.events.attend.refused();
    const returning = o.targeting.returnCombatActive();
    const body: Record<string, unknown> = {
      huntLoot: root.partyLootClient && root.partyLootClient.hunt.report(),
      convoyLoot: root.partyLootClient && root.partyLootClient.convoy.report(),
      lootStatus: root.partyLootStatus || null,
      name: character.name,
      // The game party the character is in, which the lifecycle owner's roster
      // ownership groups by.
      actualParty: character.party || null,
      owner: character.owner,
      // The kept bounds' firings this frame queued since the last report the coordinator took.
      boundsFired: boundsPending(),
      runtime: parent.caracAL ? 'headless' : 'native',
      clientVersion: parent.__partyClientVersion || Number(G.version),
      clientInstance: parent.__partyClientInstance || null,
      upgradePreviewSession: production.previewSession,
      upgradePreviewRevision: production.previewRevision(),
      luckySlotTracking: o.items.luckySlots().report(),
      luckySlotCharacterId: production.trackingId(),
      inventoryStackError: bank.stackError(),
      merchantEventReserved: eventMerchant.reserved(),
      upgradeInventoryBusy: !!(facts.tidying || facts.holder === 'producing' || production.luckyHeld()),
      steamPrimary: !parent.caracAL && !parent.no_html && !parent.is_bot,
      escape: survival.record(),
      // The turns owner's turns report: the ranking's damage per MP and each support cast's readiness
      // and target, which the other members' rankings read from the party reply.
      turns: o.turns.report() || null,
      movementClimb: survival.escape.climbReport(),
      movementLive: movement.live(),
      movementClick: movement.clicking(),
      platform: parent.caracAL ? 'caracal' : (parent.game && parent.game.platform || 'browser'),
      codeGeneration: run.generation,
      dashboardRuntime: walk.runtimeId,
      loaderGeneration: Number(root.__partyLoaderGeneration) || 0,
      codeHash: root.__partyCodeHash || null,
      codeLoad: { count: Number(parent.__partyCodeLoads) || 0, ageMs: Date.now() - (Number(root.__partyLoaderRuntimeStartedAt) || Date.now()) },
      codeRevision: 'realm-logistics-v3',
      consoleMaintenance: drain.acknowledge(),
      // The busy rule, without its fight term: a CODE reload answered `busy` retries on the first
      // report that reads false (the lifecycle owner's wait rule), and a Steam handoff waits while it reads
      // true.
      busy: !drain.canReload(), busyReason: drain.busyReason(),
      bankSortProtocol: 1,
      steamRealmProtocol: parent.__partySteamBridge && parent.__partySteamBridge.realmProtocol || 0,
      combatSelection: { id: selection.selection.id, revision: selection.selection.revision, map: selection.selection.map,
        runtimeId: walk.runtimeId, target: o.targeting.groupedNomination() },
      queueTiming: root.__partyQueueTiming || null,
      groupedCombat: {
        independentReady: queueClient && queueClient.independent ? queueClient.independent.readiness() : undefined,
        independentApproach: queueClient && queueClient.independent && !cave.owned() ? true : undefined,
        approach: o.walks.groupedApproachReport(), pursuitAck: targeting.queue() && targeting.queue().pursuit && targeting.queue().pursuit.revoking || null,
        lootPending: !!(root.partyLootClient && root.partyLootClient.huntPending()), reportedAt: Date.now() + walk.clockOffset,
        protocol: QUEUE_PROTOCOL, observationAt: root.__partyEntitiesObservedAt || 0, passingEncounters: o.targeting.passingEncounterReport(),
        passingAcknowledgement: queueClient && queueClient.passingAcknowledgement && queueClient.passingAcknowledgement(),
        huntDefense: hunt.defense(), returnDefense: returning || o.targeting.returnDepartureDefense(), currentAttackers: o.walks.currentTravelAttackers(),
        travelCandidates: returning ? [] : o.targeting.travelStopCandidates(), currentAttackersAt: o.walks.travelObservationAt(),
        travelCommand: o.walks.localTravelCommand(), epoch: root.__partyCombatResetAt || 0, claims: o.targeting.queueClaims(), candidates: o.targeting.queueCandidates(),
        retentions: o.targeting.queueRetentions(), evidence: queueClient ? queueClient.reportEvidence(selection.deaths) : [],
        handoff: queueClient && queueClient.handoff && queueClient.handoff.report(), queueAck: targeting.queue() && targeting.queue().queueRevision,
        deaths: selection.deaths, unreachable: o.targeting.targetingUnreachableReport(), packets: o.telemetry.fightPackets(), threats: o.targeting.groupedThreatReports(),
        sightings: o.targeting.groupedSightings(), ack: o.targeting.groupedAcknowledgement(), anchorVisible: o.targeting.groupedAnchorVisible(), state: targeting.queue() },
      dungeon: character.cave ? Object.assign(cave.client().report(), { recovery: survival.cave.report() }) : cave.client().report(),
      movementGeometry: movement.identity,
      returnTownReady: p.game.canUse('use_town') && !p.game.cooling('use_town'),
      movement: movement.report() || movement.last(),
      convoyNavigation: o.walks.convoyNavigationReport(),
      activeCombatTarget: o.targeting.activeCombatTarget(),
      engagedCombatTarget: o.targeting.engagedCombatTarget(),
      recovery: root.partyCombatState && root.partyCombatState.recovery || null,
      eventWalkFailure: root.__partyEventWalkFailure || null,
      lastCommandId: intake.last(),
      merchantCommand: root.__merchantCommandReport || null,
      server: parent.server_region && parent.server_identifier ? parent.server_region + parent.server_identifier : null,
      ping: typeof character.ping === 'number' && isFinite(character.ping) && character.ping >= 0 ? character.ping : null,
      home: character.home || null,
      realmPlayers,
      ctype: character.ctype,
      inventorySize: Number(character.isize) || character.items.length,
      standSlots: o.items.reads.standSlots(),
      standItem: o.items.reads.standItem(),
      primaryStat: G.classes[character.ctype] && G.classes[character.ctype].main_stat || null,
      level: character.level,
      ...reportedStats(character),
      speed: character.speed,
      unrestrictedSpeed: character.ctype === 'merchant' ? unrestrictedRunSpeed(true) : null,
      xp: character.xp || 0,
      max_xp: character.max_xp || 0,
      hp: character.hp,
      max_hp: character.max_hp,
      mp: character.mp,
      max_mp: character.max_mp,
      cc: Math.ceil(Number(character.cc) || 0),
      // The call budget's largest used per step of the last window and its margin, which a headless
      // character's check reads beside the server's own sum.
      calls: root.__partyCalls && root.__partyCalls.sample ? root.__partyCalls.sample() : null,
      gold: character.gold,
      gameParty: o.tasks.partyList(),
      standOpen: !!character.stand,
      nearbyStandListings: market.nearbyStandListings(),
      nearbyGiveaways: visits.nearbyGiveaways(),
      ponty: character.ctype === 'merchant' ? market.ponty() : null,
      monsterAchievementKills: monsterAchievementKills(),
      monsterAchievements: progress(),
      tracktrix: tracktrix(),
      donationXpPerGold: market.donationRate(),
      donationLevelXp: Object.keys(G.levels || {}).reduce((levels: number[], key) => { levels[Number(key)] = Number(G.levels[key]); return levels; }, []),
      gatheringActive: gathering.gatheringActive, gatheringBlockedReason: gathering.gatheringBlockedReason,
      gatheringPhase: gathering.gatheringPhase, gatheringAttemptId: gathering.gatheringAttemptId,
      gatheringCooldowns: gathering.gatheringCooldowns, gatheringAccess: gathering.gatheringAccess,
      map: character.map,
      in: character.in,
      mainTownSpawn: G.maps.main && G.maps.main.spawns[0] ? { x: G.maps.main.spawns[0][0], y: G.maps.main.spawns[0][1] } : null,
      mapEvent: G.maps && G.maps[character.map] && G.maps[character.map].event || null,
      activeEvent: liveEventName,
      eventRefusal: refusal && { name: refusal.name, id: refusal.id, reply: refusal.reply || null },
      serverLiveEvents: clock.live(),
      serverStagingEvents: clock.staging(),
      eventWalks: clock.walks(),
      eventFeedConnected: !!(parent.socket && parent.socket.connected !== false),
      slendermanSighting: attend.searchReport().sighting,
      slendermanSearchExhausted: attend.searchReport().exhausted,
      goobrawlCombat: attend.arenaFight('goobrawl'),
      activeEventId: liveEventName && status && status[liveEventName] && (status[liveEventName].id || status[liveEventName].event_id) || null,
      eventTeam: team.team(character),
      anniversaryVisit: character.s && character.s.anniversary_visit ? {
        ms: Number(character.s.anniversary_visit.ms) || 0,
        expires: Number(character.s.anniversary_visit.expires) || 0,
        round: character.s.anniversary_visit.round || character.s.anniversary_visit.id || null,
      } : null,
      // The coordinator lets a walk go on through a late report for two of these.
      reportIntervalMs: o.walks.reportGap(),
      // Each enabled add-on's own report (runtime/hooks/registry.ts `status.report`), after each
      // add-on's tick, which runs once per report and then runs the queued actions.
      addonReports: hooks.reports ? (addonTick(hooks, character, parent), hooks.reports({ character, entities: parent.entities, G, now: Date.now(), joinedEvent: attend.eventName() })) : {},
      // The add-on stores this character holds and its own writes, which the coordinator keeps per
      // key and sends back newer, so they outlive a reload of this client (runtime/hooks/store.ts).
      addonStores: hooks.stores ? hooks.stores.report() : {},
      // The outcomes of the coordinator's add-on actions and the replies to its forwarded commands.
      addonActionResults: hooks.carriedResults ? hooks.carriedResults() : [],
      addonCommandReplies: hooks.carriedReplies ? hooks.carriedReplies() : [],
      // The events owner's schedule, feed time and clock age rule, and the anniversary feed in
      // milliseconds through the events owner's one epoch conversion.
      eventSchedules: clock.schedule(), eventFeedAt: clock.feedAt(), eventClockStale: clock.stale(),
      anniversaryServer: anniversaryFeed ? { active: anniversaryFeed.active !== false, live: anniversaryFeed.live !== false,
        available: anniversaryFeed.available !== false, round: anniversaryFeed.round || null, target: anniversaryFeed.target || null,
        id: anniversaryFeed.id || null, map: anniversaryFeed.map || null, x: Number(anniversaryFeed.x), y: Number(anniversaryFeed.y),
        expires: clock.epoch(anniversaryFeed.expires), next: clock.epoch(anniversaryFeed.next) } : null,
      anniversaryState: anniversary.report(eventMerchant.completedRound()),
      // This survives events hosted on normal maps, where mapEvent is null.
      joinedEvent: attend.joined(),
      eventRecovery: o.events.exit.recovery(),
      farmReunion: o.tasks.reunion(),
      navigationState: walk.townTraveling ? 'town' : groupWalk.travel ? 'convoy' : walk.following ? 'follow' : departing ? 'departing' : 'idle',
      navigationDetail: walk.townTraveling || groupWalk.travel || walk.following || departing ? walk.navigationDetail || null : null,
      smartNavigation: (() => {
        const smart = p.smart();
        return smart ? { moving: !!smart.moving, searching: !!smart.searching, found: !!smart.found, map: smart.map || null,
          x: Number(smart.x) || 0, y: Number(smart.y) || 0, plot: Array.isArray(smart.plot) ? smart.plot.length : 0 } : null;
      })(),
      x: Math.round(character.x),
      y: Math.round(character.y),
      moving: !!character.moving,
      rip: !!character.rip,
      lastDeath: o.telemetry.lastDeath(),
      farmingNavigationDebug: { location: o.movement.walkState.partyLocation, cancelled: walk.intent.cancelled,
        occupied: !!root.__partyHooks.skills.allows({ rank: 'damage', occupied: true }), combatOwner: movement.live()?.owner ?? null,
        followingLeader: walk.following, departurePending: departing, town: walk.townActive || walk.townTraveling,
        anniversary: anniversary.busy() || anniversary.staging(), event: !!attend.traveling(), forceTravel: walk.forceTraveling,
        stocking: facts.stocking, upgrading: facts.upgrading },
      banking: facts.banking,
      bankQueued: facts.bankQueued,
      stocking: facts.stocking,
      upgrading: facts.upgrading,
      skin: character.skin,
      characterSprite: sprite(character.skin),
      characterDollHtml: characterDollHtml(),
      target: liveTarget ? { id: liveTarget.id, type: liveTarget.type, name: liveTarget.name || null, team: team.team(liveTarget),
        mtype: liveTarget.mtype, hp: liveTarget.hp, max_hp: liveTarget.max_hp, x: liveTarget.x, y: liveTarget.y } : null,
      eventCombatSighting: team.sighting(combatTarget),
      combat: {
        kiting: o.walks.isCurrentlyKiting(),
        moving: !!character.moving,
        lastAttackAt: selection.lastAttack.at,
        lastAttackTarget: selection.lastAttack.target,
        inRange: liveTarget ? !!p.game.inRange(liveTarget) : false,
        canAttack: liveTarget ? !!p.game.canAttack(liveTarget) : false,
        runner: root.partyCombatState || null,
        positioning: root.partyCombatPosition || null,
        performance: root.partyCombatPerformance || null,
      },
      monsterHunt: hunt.status(),
      huntEventPending: attend.huntPending(),
      threats,
      conditions: activeConditions(),
      bankVaults: o.items.reads.bankVaultCatalog(),
    };
    // The rare client's reports (observation, sightings, fields, kills, loot, walk and deploy) and the
    // farm client's competition evidence.
    Object.assign(body, o.hunting.rares.report(), o.hunting.farm.report());
    o.items.reads.attachStatusInventory(body);
    // The catalogs ride until a reply accepts a report of this generation (`catalogReply`).
    const carried = !catalog.known && catalog.prepared;
    catalog.sent = { generation: catalog.generation, carried };
    if (carried) Object.assign(body, {
      merchantCatalogVersion: o.items.reads.catalogVersion,
      travelPlaces: travelPlaces(),
      monsterChoices: o.hunting.spawnCatalog(G, sheetSprite),
      monsterLocationsVersion: CATALOG_VERSIONS.monsterLocations,
      monsterHunterLocation: hunt.hunterLocation(),
      bestiaryCatalog: bestiaryCatalog(),
      skillCatalog: skillCatalog(),
      appearanceChoices: classAppearanceChoices(p.G(), render, sprite),
      merchantCatalog: o.items.reads.merchantCatalog(),
    });
    return body;
  }

  /** The call budget's read of the realm's players. */
  const receivePlayers = (names: string[]) => { realmPlayers = names; };
  return {
    snapshot, receivePlayers,
    /** Table A's catalog row: a reply that asks again resends; one that accepted this generation's catalogs ends them. */
    catalogReply(state: { needsCatalog?: unknown }): void {
      if (state.needsCatalog) catalog.known = false;
      else if (catalog.sent.carried && catalog.sent.generation === catalog.generation) catalog.known = true;
    },
    prepareCatalog,
    /** Table A's `catalog-prepare` row: the catalog warms for the next report without holding the apply. */
    prepareReply(): void { void prepareCatalog(); },
    /** The lifecycle owner's run part: a stopped run ends every warm-up of the generation before it. */
    stopCatalog(): void { catalog.generation++; },
    catalogKnown: () => catalog.known,
    observeTracker, tracker: () => tracker, homeDropTables, dropOutcome,
    sprite, monsterSprite: sheetSprite, activeConditions, baseSpeed: () => unrestrictedRunSpeed(false), mapDollHtml,
  };
}

const status = ((globalThis as { partyStatus?: Record<string, unknown> }).partyStatus ||= {});
status.report = createReport;
