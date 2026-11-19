// The October runtime's ports on the character:
// the runtime of october-runtime.ts, built once on its first use with the
// character's reads, its journal's storage, the Witch's spot and the Cipher ingredient transfer.
// Moved from shared.js `octoberRuntime`. The gathering walk goes to the ingredient
// monster's first spawn in the hunting owner's spawn catalog. shared.js calls
// `installEventOctober` once in the routine's install.
import { firstSpawn, spawnCatalog } from '../../hunting/api.ts';
import { createOctoberRuntime, type OctoberPorts } from '../october-runtime.ts';
import { cipherIngredients } from '../october.ts';
import { SEND_REACH } from '../../protocol/reports.ts';
import { jobCall } from '../character/calls.ts';

interface Point { map: string; x: number; y: number }
interface Item { name: string; q?: number; l?: unknown; b?: unknown; giveaway?: unknown }
interface Character { name: string; ctype?: string; rip?: boolean; map: string; real_x: number; real_y: number; items: (Item | null)[]; trickortreat?: unknown }
interface Entity { rip?: boolean }
// The game data the October port reads: the events and the Witch's NPC, and the monster and map
// spawn fields of the hunting owner's spawnCatalog, which the Cipher's farm walk asks.
type Game = Parameters<typeof spawnCatalog>[0] & {
  events?: Record<string, unknown>;
  maps?: Record<string, { npcs?: { id?: string; position: number[] }[] } | undefined>;
};
// The Witch stands on the Halloween map; the brew is asked from this far in front of her.
const WITCH = { map: 'halloween', id: 'witch', front: 30 };

export interface EventOctoberPorts {
  // The server's time on the character's clock (character/clock.ts `offset`), and its `S` feed.
  now(): number;
  feed(): ReturnType<OctoberPorts['status']>;
  realm(): string;
  character(): Character;
  // The coordinator's reply: the Cipher merchant, the event limits and the gathering plan.
  cipherMerchant(): string | null;
  settings(): ReturnType<OctoberPorts['settings']>;
  gathering(): ReturnType<OctoberPorts['gathering']>;
  game(): Game;
  load(key: string): unknown;
  save(key: string, value: unknown): void;
  // Movement's group walk for the event.
  walk: OctoberPorts['walk'];
  walkAlone: OctoberPorts['walkAlone'];
  knock: OctoberPorts['knock']; info: OctoberPorts['info']; brew: OctoberPorts['brew'];
  // The transfer's holds: this runtime is current, the Cipher selection, the merchant jobs owner's runner holding the
  // merchant, the items owner's bank and upgrade errands, and an inventory command in flight (the items owner's bag facts).
  // `transfer` reads each one.
  current(): boolean;
  selected(name: string): boolean;
  runnerHolds(): boolean;
  bagErrand(): boolean;
  inventoryCommand(): boolean;
  player(name: string): Entity | null | undefined;
  distance(entity: Entity): number;
  send(name: string, slot: number, count: number): Promise<unknown>;
  // The bag's free cells (the items owner's `partyItems.bag.facts().freeCells`).
  freeSlots(): number;
  // The schedule's `due` leads of this member's group, which the last reply carried.
  leads(): Record<string, number> | null;
}

export function installEventOctober(ports: EventOctoberPorts) {
  let runtime: ReturnType<typeof createOctoberRuntime> | null = null;
  const journalKey = () => 'party-october-' + ports.character().name;

  // A fighter hands its Cipher ingredients to the merchant in reach, one stack at a time (1.5 row
  // 23). One transfer runs at a time, and each send re-reads the runtime, the selection, that the
  // character lives and that no merchant job or inventory command holds the bag.
  let sending = false;
  async function transfer(): Promise<void> {
    const merchant = ports.cipherMerchant(), c = ports.character();
    const free = () => ports.current() && ports.selected('witchcipher') && !ports.character().rip && !ports.runnerHolds() && !ports.bagErrand() && !ports.inventoryCommand();
    if (sending || !merchant || c.name === merchant || !free()) return;
    const entity = ports.player(merchant);
    if (!entity || entity.rip || ports.distance(entity) > SEND_REACH) return;
    sending = true;
    try {
      for (let slot = 0; slot < c.items.length; slot++) {
        const item = c.items[slot];
        if (!item || item.l || item.b || !(cipherIngredients as readonly string[]).includes(item.name)) continue;
        if (!free()) return;
        await ports.send(merchant, slot, item.q || 1);
      }
    } finally { sending = false; }
  }
  function witch(): Point | null {
    const npc = (ports.game().maps?.[WITCH.map]?.npcs || []).find(entry => entry.id === WITCH.id);
    return npc ? { map: WITCH.map, x: npc.position[0], y: npc.position[1] + WITCH.front } : null;
  }
  // The bag's tradable stacks, by item.
  function stock(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const item of ports.character().items || [])
      if (item && !item.l && !item.b && !item.giveaway) counts[item.name] = (counts[item.name] || 0) + (item.q || 1);
    return counts;
  }

  return function october() {
    return runtime ??= createOctoberRuntime({
      now: ports.now, realm: ports.realm, name: () => ports.character().name, merchant: () => ports.character().name === ports.cipherMerchant(),
      merchantClass: () => ports.character().ctype === 'merchant', freeSlots: ports.freeSlots, leads: ports.leads,
      settings: ports.settings, status: ports.feed, gathering: ports.gathering,
      definitions: () => (ports.game().events || {}) as ReturnType<OctoberPorts['definitions']>,
      position: () => { const c = ports.character(); return { map: c.map, x: c.real_x, y: c.real_y }; },
      doorStatus: () => (ports.character().trickortreat || null) as ReturnType<OctoberPorts['doorStatus']>,
      stock, load: () => ports.load(journalKey()) as ReturnType<OctoberPorts['load']>, save: journal => ports.save(journalKey(), journal),
      // The game sends the knock, the Cipher read and the brew as its `interaction` socket call
      // (runner_functions.js:2987-2995, each reply's `place: "interaction"`), which 09 prices.
      walk: ports.walk, walkAlone: ports.walkAlone,
      knock: door => jobCall('interaction', () => ports.knock(door), { interaction: 'knock', door }),
      info: () => jobCall('interaction', () => ports.info(), { interaction: 'witchcipher' }),
      brew: mix => jobCall('interaction', () => ports.brew(mix), { interaction: 'witchcipher', mix }),
      farmDestination: type => firstSpawn(spawnCatalog(ports.game(), undefined, type), type), witch, transfer,
    });
  };
}
Object.assign(globalThis, { installEventOctober });
