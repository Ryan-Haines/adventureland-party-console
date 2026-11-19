// The call budget: one emit
// layer per game socket that counts every call the character sends at the charge the game
// server puts on it, and answers each owner's `calls.band` question before a game call by its
// band's limit (3.4, 3.5). An emit no owner asked about goes at once unless it would pass the
// server's limit; then it waits in one queue in emit order.
//
// The game server (kaansoral/adventureland_mongodb, the pin 16881a27 of tools/sim/pins.json)
// keeps each socket's charges of the last 4000 ms and disconnects the socket when their sum
// passes `limits.calls`, 200 (node/server.js:261-262, 5022-5026; server_functions.js:5473-5490).
import type { ClientToServer_cm, ClientToServer_party, ClientToServer_skill, ClientToServer_transport, ServerToClient_player } from 'typed-adventureland';
import { installBudgetReads, type ReadsWindow, type RosterEntry } from './call-budget-reads.ts';
import { BANK_FLOOR, bandLimits, BLINK_LANDS_MS, CALL_LIMIT, CALL_WINDOW_MS, CROSSING, DOOR, MAGIPORT_LANDS_MS, type BandLimits } from './call-budget-limits.ts';
import { MOVEMENT_RING_SIZE } from '../protocol/records.ts';
import type { CallAnswer, CallNotice, CallQuestion, HookRegistry, Registration } from '../hooks/registry.ts';
import { partyHooks } from '../hooks/index.ts';
import { boundFired } from '../status/api.ts';
import type { ScopeHandle } from '../lifecycle/api.ts';


type GameMap = { mount?: boolean };
interface BudgetCharacter { name: string; map: string; real_x?: number; real_y?: number; c?: Record<string, unknown>; items: ({ name: string } | null)[] }
interface BudgetGame { maps: Record<string, GameMap | undefined>; conditions: Record<string, { can_move?: boolean } | undefined>; items: Record<string, { gives?: unknown[] } | undefined>; skills: Record<string, { range?: number } | undefined> }
// The game client's entities around the character, by id (the game window's `entities`).
type Nearby = Record<string, { id?: unknown; type?: string; real_x?: number; real_y?: number; dead?: unknown } | undefined>;
type Emit = (this: unknown, method: string, ...rest: unknown[]) => unknown;
// The game client's socket.io socket: `emit` is replaced by the layer, and `on` and `off` carry
// its two listeners. caracAL's socket is the same object (characters/shared.js:581-584, 901).
export interface BudgetSocket { emit: Emit; on(event: string, listener: (data: never) => void): unknown; off(event: string, listener: (data: never) => void): unknown }
// The game window: the native client's `parent`, or caracAL's. `pings` is the game's own list of
// measured round trips (js/functions.js:302-305). `party` is the game client's party by member
// name, without its merchants (server.js:1181 `party_to_client`); `party_list` names every member
// (js/game.js:3570). Its own timer and clock run the record's drain, which outlives a stopped CODE realm (3.1).
interface BudgetWindow extends ReadsWindow { socket?: BudgetSocket | null; pings?: number[]; entities?: Nearby; party?: Record<string, unknown>; party_list?: string[]; __partyCallBudget?: BudgetRecord;
  setTimeout?(handler: () => void, ms: number): unknown; clearTimeout?(id: unknown): void; Date?: { now(): number } }
// Local storage holds a `limitdc` snapshot until the coordinator has it: the native client's own,
// and caracAL's IPC-backed cache (characters/shared.js:4179-4185), in both runtimes (3.8).
interface BudgetStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
interface BudgetHost { parent: BudgetWindow; character: BudgetCharacter; G: BudgetGame; localStorage?: BudgetStorage; __partyCalls?: CallBudget }
// `cpu` is a real clock for the budget's own meter (7.3); `now` may be virtual time. `tracker` and
// `players` take the background reads' replies (3.7); `request` posts to the coordinator over its
// HTTP connection, which the game socket's loss does not touch (3.8).
interface BudgetPorts { now(): number; cpu?(): number; tracker?(data: unknown): void; players?(names: string[]): void;
  request?(path: string, options: { method: string; timeout: number; body: unknown }): Promise<unknown>;
  // the call budget owner's run scope handle, `observe`: the emit layer's listeners,
  // its admission check and its two reads record and report, so they keep running through a Pause.
  scope: ScopeHandle;
  // Table P on this character (the lifecycle owner's `lifecycle.held`): the band's held row reads it.
  held(): boolean }
export type Band = 'survival' | 'job' | 'background';
export interface Question { band: Band; method: string; data?: unknown }

// One ledger entry: what the character sent, when and at what cost on its socket. `seq` orders
// the entries and the server's figures in one sequence (3.3).
interface LedgerEntry { at: number; method: string; cost: number; seq: number }
// A ring entry (design 3.9), in the shared ring shape with `part: 'calls'`.
interface CallRecord { part: 'calls'; decision: string; method: string; band?: string; cost: number; used: number; limit?: number; waitedMs?: number;
  // A held emit's entry keeps the margin at its hold and at its send, and the server's figure when
  // it went. The margin is the window's largest round trip, so it can rise during the hold, and
  // the entries ahead of the held emit leave by the margin at the send.
  margin?: number; sentMargin?: number; figure?: { value: number; ageMs: number } | null;
  // The `limitdc` entry (3.8) carries the server's report and the ledger at the disconnect.
  report?: LimitdcReport | null; ledger?: LedgerEntry[];
  // A held emit the game's own emit threw on (`send-failed`), or a limitdc list local storage could
  // not read (`unreadable`), names its error (R1: nothing dropped silently).
  error?: string }
// The server's report before a `limitdc` (server.js:5024): the socket's entries, its limit and its
// call count since it connected.
interface LimitdcReport { calls?: unknown; climit?: unknown; total?: unknown }

// The call ring (design 3.9), in the shared ring's shape and bound (`createMovementRing`,
// `MOVEMENT_RING_SIZE`, runtime/protocol/records.ts): each entry numbered and dated, oldest first.
// It is plain data on the record, read and written by the install's own functions: the record
// outlives the CODE realm that made it, and a removed native CODE frame takes its realm's
// `structuredClone` with it, which the shared ring's reads call (fix pass, 13.7).
type CallEntry = CallRecord & { seq: number; at: number };
interface CallRing { seq: number; start: number; entries: CallEntry[] }
function ringPush(record: BudgetRecord, entry: CallRecord): void {
  const ring = record.ring, kept = { ...entry, seq: ++ring.seq, at: record.clock() };
  if (ring.entries.length < MOVEMENT_RING_SIZE) { ring.entries.push(kept); return; }
  ring.entries[ring.start] = kept; ring.start = (ring.start + 1) % MOVEMENT_RING_SIZE;
}
// Oldest first, as copies made in the reading realm, so a reader cannot change the ring.
function ringEntries(record: BudgetRecord): CallEntry[] {
  const ring = record.ring;
  return [...ring.entries.slice(ring.start), ...ring.entries.slice(0, ring.start)].map(entry => JSON.parse(JSON.stringify(entry)) as CallEntry);
}

// One record per socket, kept on the game window (design 3.1), so a CODE frame replacement
// finds the last install and the ledger it counted.
interface BudgetRecord {
  socket: BudgetSocket;
  // The emit this record's first install wrapped: the game's own, or a wrapper below it. A test
  // that forces a `limitdc` sends through it, past the layer.
  emit: Emit;
  ledger: LedgerEntry[];
  // The doors booked with their call, by when they were booked: the `new_map` that follows each
  // one books nothing.
  doors: number[];
  cc?: Figure;
  // The last number given to a ledger entry or a figure (3.3).
  seq: number;
  // The game window's clock and timer: the drain runs on them, so it outlives a stopped realm (3.1).
  clock(): number;
  later(run: () => void, ms: number): () => void;
  ring: CallRing;
  install?: Install;
  // Untagged emits that would pass the limit, in emit order (3.5). A new install takes them.
  held: Held[];
  // Questions answered `send` whose emit has not come yet (3.5).
  admissions: Admission[];
  // The survival admissions of the last window, and the largest sum they reached (3.4).
  survival: LedgerEntry[];
  peak: number;
  // Per band, the largest `used + cost - limit` of any admission; null before the first.
  excess: Record<Band, number | null>;
  // The realm's players and their maps from the last `players` reply (3.7), for Warcry's reach.
  roster: RosterEntry[];
  // Each band and method still waiting, by `band|method`: its first `not-now` and its asker's last
  // ask. A wait whose asker has not asked for one window and the margin has stopped, and prune drops
  // it. A live job wait holds the background band (3.4).
  waits: Map<string, { since: number; last: number }>;
  // Cancels the drain timer that is set.
  drain?: () => void;
  // The largest `used` since the last status sample began, and when it held.
  reported: { from: number; at: number; used: number };
  // The game's round trips as they arrive, with when each was measured (3.3).
  pings: { at: number; rtt: number }[];
  pingSeen?: { length: number; last: number };
  // The arrival times of the character's own player packets in the last window, for its clock step,
  // and the last step those arrivals measured.
  arrivals: number[];
  step?: number;
  // Each band's answers by method since the record began, for the callers' checks.
  answers: Record<Band, Record<string, { send: number; notNow: number }>>;
  meter: { questions: Meter; emits: Meter };
  // Set by the first `limitdc` signal on this socket, so its two signals save one snapshot.
  limitdc?: boolean;
}
// `next` is the emit this install wrapped, which its retirement puts back while it is still on top.
// `stops` end what the install's reads started; `untagged` sees each emit no question admitted.
interface Install { wrapper: Emit; next: Emit; retired: boolean; scope: ScopeHandle; listeners: [string, (data: never) => void][]; stops: (() => void)[]; untagged: ((method: string) => void)[] }
// The server's figure from a player packet (3.3): its value, when it arrived and its number in the
// ledger's sequence; `from` is one round trip before its arrival; `held` the ledger entries it
// holds for certain, and their cost.
interface Figure { value: number; at: number; seq: number; from: number; held: Set<LedgerEntry>; heldCost: number }
// An untagged emit in the hold queue, with the emit below the layer that sends it and the margin
// when it was held.
interface Held { method: string; rest: unknown[]; self: unknown; next: Emit; cost: number; door: boolean; landsMs?: number; at: number; margin: number }
// A question answered `send`: its ledger entries and its door, which leave if no emit comes.
interface Admission { method: string; entries: LedgerEntry[]; door?: number }
// The budget's own cost per question and per emit, in microseconds (7.3).
interface Meter { n: number; totalUs: number; maxUs: number }

interface CallSample { from: number; to: number; at: number; used: number; margin: number }
interface CallView { used: number; ledger: LedgerEntry[]; cc: number | null; ccAge: number | null; ccSeq: number | null; ccFrom: number | null; margin: number; latest: number; limit: number;
  room: number; limits: BandLimits; peak: number; held: number; heldHead: string | null; waiting: { band: string; method: string; ms: number }[];
  excess: Record<Band, number | null>; meter: { questions: Meter; emits: Meter }; answers: BudgetRecord['answers'] }
export interface CallBudget {
  view(): CallView; records(): CallEntry[];
  band(question: Question): 'send' | 'not-now';
  // The status sample, one per report: the largest `used` from the last sample to this one,
  // when it held, and the margin, on the character's clock.
  sample(): CallSample;
  // The margin (3.3) alone, which `calls.margin` answers with no copy of the view.
  margin(): number;
  // Runtime stop with no next install (3.1).
  stop(): void;
}

// A price: the charge the handler puts on the sender, whether that includes the door's 8 of a
// crossing inside the handler, and `landsMs` for a door the call books that lands later.
interface Price { cost: number; door: boolean; landsMs?: number }
const at = (cost: number, door = false): Price => ({ cost, door });
const landing = (cost: number, landsMs: number): Price => ({ cost, door: false, landsMs });
// The server's `distance` between two players (js/old_common_functions.js:732): the gap between
// their boxes, each 26 wide and 36 tall on the server (server.js:11819-11820), from the offset
// between their feet.
const PLAYER_WIDTH = 26, PLAYER_HEIGHT = 36;
const playerGap = (dx: number, dy: number): number => Math.hypot(Math.max(Math.abs(dx) - PLAYER_WIDTH, 0), Math.max(Math.abs(dy) - PLAYER_HEIGHT, 0));
// The charge of one `resend` on the sender's socket (server.js:4632-4670): the modifier for "u",
// the modifier again unless "nc", and four times it for "reopen" on another player's socket.
// `add_call_cost` charges the socket of the call being handled whoever is resent
// (server_functions.js:5421-5428), so a handler's resends of other players count too.

// Each method at the largest charge its handler can put on the sender, from the handler at the
// pin. `node tools/call-cost-inventory.mjs <console> <ref> <game clone> 16881a27` (plan) lists
// every method the console and the game client emit with its handler's line and its direct
// charges; each row below is that handler read in full. CC is server.js:247-260 and the call
// modifier server.js:4982. A row that reads `data` prices the call from its own payload.
export function price(method: string, data: unknown, character: BudgetCharacter, G: BudgetGame, around: Pick<BudgetWindow, 'entities' | 'party' | 'party_list'> & { roster?: RosterEntry[] } = {}): Price {
  const entities = around.entities || {};
  switch (method) {
    // CC.move 1.5 (server.js:249). A move cancels each channel whose condition cannot move, with a
    // `u+cid` resend (11291-11301).
    // A condition with no `can_move` cannot move, as the server reads it (11294).
    case 'move': return at(Object.keys(character.c || {}).some(id => G.conditions[id] && !G.conditions[id]!.can_move) ? 3.5 : 1.5);
    // The `attack` and `heal` handlers run the unwrapped `skill` handler under their own method,
    // so the modifier stays 1 (11012-11017), and the attack's `u+cid` resend adds 2 (3520, 4535).
    case 'attack': return at(2);
    // A heal on another player also resends that player, and its resend's two charges go on the
    // caster's socket too (server.js:4632-4650 `resend`, its `add_call_cost`): 4, measured by
    // TC15. A heal on the caster resends the caster once: 2.
    case 'heal': { const id = (data as { id?: unknown } | null)?.id; return at(id !== undefined && id !== character.name ? 4 : 2); }
    // Modifier 0.05 (4982). A skill on a target resends the target and the caster, 0.1 each
    // (10240-10241 and the other target branches); each further id or target adds one resend.
    // Warcry and Dark Blessing resend every player of the instance within the skill's range, the
    // caster among them (10501-10515), by the server's own `distance`.
    case 'skill': {
      const skill = (data || {}) as Partial<ClientToServer_skill> & { ids?: unknown[]; targets?: unknown[] };
      // Blink and a Magiport cast resend the caster alone, `u+cid` (10853; 10834). Blink lands
      // after its condition, with the door's 8 on the caster.
      if (skill.name === 'blink') return landing(0.1, BLINK_LANDS_MS);
      if (skill.name === 'magiport') return at(0.1);
      // Stomp stuns the monsters within it without a resend on the caster's socket (TC15 read 0.1
      // with seven monsters in its range); on a PvP map it resends each player it stuns
      // (server.js:10693-10703).
      const pvp = !!(G as unknown as { maps?: Record<string, { pvp?: boolean } | undefined> }).maps?.[String(character.map)]?.pvp;
      const area = skill.name === 'warcry' || skill.name === 'darkblessing' || skill.name === 'stomp' && pvp ? 'character' : null;
      if (skill.name === 'stomp' && !area) return at(0.1);
      if (area) {
        const range = Number(G.skills[skill.name!]?.range) || 0, x = Number(character.real_x), y = Number(character.real_y);
        const seen = Object.values(entities).flatMap(e => e && e.type === area && !e.dead ? [e] : []);
        const near = seen.filter(e => playerGap(Number(e.real_x) - x, Number(e.real_y) - y) < range).length;
        // The game client drops every entity outside its 700 by 500 view (js/game.js:604), and
        // both skills reach 600, so a player the client does not see may stand in range: each
        // party member, and each player the last `players` reply put on this map. Each one counts,
        // the largest charge (design 3.2). A player who came to the map since that reply is left
        // to the server's figure (3.3).
        const ids = new Set(seen.map(e => String(e.id)));
        const unseen = skill.name === 'stomp' ? 0 : new Set([...(around.party_list || []).map(String),
          ...(around.roster || []).filter(entry => entry.map === character.map).map(entry => entry.name)]
          .filter(name => name !== character.name && !ids.has(name))).size;
        return at(0.1 * (1 + near + unseen));
      }
      return at(0.1 * (2 + (Array.isArray(skill.ids) ? skill.ids.length : 0) + (Array.isArray(skill.targets) ? skill.targets.length : 0)));
    }
    // CC.equip 3 and the `u+cid+reopen` resend 2 (256, 7876); a potion, an item that gives HP
    // or MP, resends with `nc` and costs 3 + 1 (7858). js/functions.js:5387 sends a potion use as
    // an `equip` of its slot.
    case 'equip': {
      const num = Number((data as { num?: unknown } | null)?.num), item = Number.isInteger(num) ? character.items[num] : null;
      return at(item && G.items[item.name]?.gives?.length ? 4 : 5);
    }
    case 'unequip': return at(8); // CC.unequip 6 + `reopen+u+cid` 2 (257, 7938)
    // 3 x (0.5 + n/2) (4990-4995) and the `reopen+u+cid` resend 2 (7600).
    case 'equip_batch': return at(3 * (0.5 + (Array.isArray(data) ? data.length : 0) / 2) + 2);
    case 'players': return at(12); // CC.players (250)
    case 'secondhands': return at(16); // CC.secondhands (251)
    case 'tracker': return at(50); // CC.tracker (258)
    case 'send_updates': return at(12); // CC.send_updates (253)
    case 'auth': return at(2); // CC.auth (248)
    case 'friend': return at(26); // CC.friend 24 (252) and two `redata` resends (12153, 12225)
    case 'cruise': return at(12); // CC.cruise 10 (254) and `u+cid` (5664)
    // A bank floor's door charges 32 at the call and one leaving it 16; the door's 8 follows on
    // `new_map` (5978, 5989). Every other crossing reaches `transport_player_to` in the handler
    // (6001), so it is a crossing inside the handler.
    case 'transport': {
      const to = (data as Partial<ClientToServer_transport> | null)?.to, into = !!(to && G.maps[to]?.mount), from = !!G.maps[character.map]?.mount;
      return into && !from ? at(BANK_FLOOR) : from && !into ? at(16) : at(CROSSING, true);
    }
    case 'leave': return at(CROSSING, true); // `transport_player_to` (5831)
    case 'join': return at(CROSSING + 1, true); // `transport_player_to` (12657-12703) and the `cid` resend (12706)
    case 'enter': return at(CROSSING + 2, true); // `transport_player_to` (6033-6102) and `u+cid+reopen` (6092)
    case 'respawn': return at(CROSSING + 2, true); // `transport_player_to` (6246, 6249) and `u+cid` (6255)
    // Town moves the character after its channel, so its door's 8 is booked on `new_map`: Town's
    // `u+nc` resend (6215).
    case 'town': return at(1);
    // Accepting a Magiport: `magiport_someone`'s `u+cid` resend (server_functions.js:4097), and
    // the door's 8 when `s.magiport` runs out.
    case 'magiport': return landing(2, MAGIPORT_LANDS_MS);
    // A party call's charge is its event's resends (12405-12595): an accept resends the inviter
    // and the player, all `nc+u+cid`. A leave or a kick runs `leave_party`, which resends every
    // member of the old party but the one leaving it on this socket (server_functions.js:3719-3737),
    // and the handler then resends the one leaving (server.js:12561, 12592): 1 per member of the
    // party, merchants included, and nothing outside one.
    case 'party': {
      const event = (data as Partial<ClientToServer_party> | null)?.event;
      if (event === 'leave' || event === 'kick') return at(Array.isArray(around.party_list) ? around.party_list.length : 0);
      return at(event === 'accept' || event === 'raccept' ? 2 : 0);
    }
    // 1, 2, 3, 10 or 20 by the message's length, times its recipients, times 0.8 for several (4996-5016).
    case 'cm': {
      const cm = (data || {}) as Partial<ClientToServer_cm>, length = JSON.stringify(cm.message ?? null).length;
      const to = Array.isArray(cm.to) ? cm.to.length : 1, step = length > 50000 ? 20 : length > 10000 ? 10 : length > 1000 ? 3 : length > 100 ? 2 : 1;
      return at(step * to * (to > 1 ? 0.8 : 1));
    }
    // One `u+cid` resend at modifier 1.
    case 'stop': case 'code': case 'cx': case 'merchant': case 'interaction': case 'ureward': return at(2);
    // Modifier 0.5 (4982): the handler takes back its own call (`reduce_call_cost`, 5217) and ends in
    // a `u+nc` resend, 0.5 (5264); on cgallery a focus on an NPC body resends `u+cid` first, 1 more (5261).
    case 'target': return at(character.map === 'cgallery' ? 1.5 : 0.5);
    case 'monsterhunt': return at(4); // `u+cid+reopen` (5499) and `u+cid` (5517)
    case 'property': return at(2); // two `u+cid+nc` resends (5641, 5654)
    case 'say': case 'trade_wishlist': return at(1); // one `u` resend with `nc` (5205; 8812)
    case 'trade': return at(2); // two `nc+u+cid` resends (12623, 12627)
    // One `reopen` resend without `nc` on the sender's own socket.
    case 'bank': case 'booster': case 'destroy': case 'donate': case 'split': case 'unlock': return at(1);
    // A `reopen` of another player's socket adds four times the modifier (4664-4667).
    case 'mail_take_item': return at(5); // `reopen` (5777)
    case 'send': return at(4); // the receiver's `reopen+nc+inv` (8514, 8555)
    case 'trade_buy': case 'trade_sell': case 'trade_swap': case 'join_giveaway': return at(7); // `reopen` and the other party's `reopen+u+cid`
    case 'duel': return at(CROSSING + 6, true); // three `u+cid` resends and the challenger's crossing (12239-12404)
    case 'gm': return at(CROSSING + 6, true); // three `u+cid` resends and a pull's crossing (5365-5477)
    // Modifier 0.1 (4982). A party chest resends every member it shares with (11585), the opener
    // too, with no `nc`: 0.1 each. A member whose bag reopens, by the chest's item or by one still
    // pending (`to_reopen`), adds 0.4 on another member's socket (4664-4667), so another member
    // costs up to 0.5 (design 3.2). The chest resends `parties[player.party]` (11557-11585), merchants
    // included, so the members come from `party_list`; the client's `party` drops merchants
    // (`party_to_client`), which booked 0.6 where UP-2 read 0.9 charged with the merchant in the party.
    case 'open_chest': {
      const members = Array.isArray(around.party_list) ? around.party_list.map(String) : Object.keys(around.party || {});
      return at(0.1 + 0.5 * members.filter(member => member !== character.name).length);
    }
    // Handlers that charge nothing on the sender: no `CC`, and their resends carry `nc` without
    // `u` or none at all (`use` is an HP or MP regen, 12035-12074).
    case 'ping_trig': case 'test': case 'use': case 'buy': case 'sell': case 'sbuy': case 'compound': case 'upgrade':
    case 'craft': case 'dismantle': case 'exchange': case 'exchange_buy': case 'lostandfound': case 'imove': case 'throw':
    case 'locksmith': case 'destat': case 'bless_server': case 'buy_shells': case 'buy_with_cash': case 'bet': case 'mail':
    case 'blocker': case 'click': case 'eval': case 'list_pvp': case 'loaded': case 'mreport': case 'poke': case 'poker':
    case 'requested_ack': case 'set_home': case 'tavern':
      return at(0);
    // A method the inventory does not list: only code the player types in the client sends one.
    // One `u` resend without `nc` at modifier 1 (4644, 4657); the server's figure covers the rest
    // within one round trip (design 3.3).
    default: return at(2);
  }
}

// The game's own latest measured round trip; the window itself until the list holds one (3.3).
// The install's margin is the largest round trip measured within the last window, with this as
// its floor (`marginAt`).
function margin(win: BudgetWindow): number {
  const pings = Array.isArray(win.pings) ? win.pings.filter(Number.isFinite) : [];
  return pings.length ? pings[pings.length - 1]! : CALL_WINDOW_MS;
}

// `used` (design 3.3): the larger of the ledger's entries still in the server's window and a fresh
// server figure with what it does not hold. The ledger keeps each entry one round trip longer
// (`latest`, the install's largest within the window): the server dates a charge when its handler
// runs, after the call arrives. A figure holds for certain
// each entry sent between one window and one round trip before it arrived, and each entry booked
// in its own clock step before it. It gives that charge back as each entry leaves the window, keeps
// the charges the ledger cannot see (an emit before the install, a handler that throws) for the
// 4000 ms it counts, and adds every entry it does not hold. Its round trip is the largest measured
// within the last window when it arrived: a server slowed by a burst computes the figure later
// than the latest ping shows.
// The server keeps an entry until it is older than the window (get_call_cost and add_call_cost
// drop at `mssince > 4000`, server_functions.js:5439, 5481 at the game pin), so every edge here
// holds an entry through the window's last millisecond.
export function used(record: Pick<BudgetRecord, 'ledger' | 'cc'>, now: number, latest: number): number {
  const own = record.ledger.reduce((sum, entry) => entry.at >= now - CALL_WINDOW_MS - latest ? sum + entry.cost : sum, 0);
  const cc = record.cc;
  if (!cc || now - cc.at > CALL_WINDOW_MS) return own;
  let left = 0, after = 0;
  for (const entry of cc.held) if (entry.at + CALL_WINDOW_MS + latest < now) left += entry.cost;
  for (const entry of record.ledger) if (!cc.held.has(entry) && (entry.at > cc.from || entry.seq > cc.seq)) after += entry.cost;
  return Math.max(own, Math.max(0, cc.value - cc.heldCost) + cc.heldCost - left + after);
}

// The server runs a call's handler on its next clock step, so it can date a call one step after the
// budget booked it, and the budget keeps each entry that step longer (decided 2026-11-09). The step
// is the smallest gap between two different arrival times of the character's own player packets in
// the window: about 1 ms on the live server, which handles a call on arrival, and 250 ms on
// ChronAL's gameplay clock. The clock's step does not change, so a window with fewer than two
// arrival times keeps the last step measured, and 0 before any. A merchant standing at an NPC can
// hear no player packet for seconds; the item reply bound (two margins, items/character/calls.ts)
// still covers a reply the server answers on its next step then.
function clockStep(record: Pick<BudgetRecord, 'arrivals' | 'step'>, now: number): number {
  const arrivals = record.arrivals;
  while (arrivals.length && arrivals[0]! < now - CALL_WINDOW_MS) arrivals.shift();
  let step = Infinity;
  for (let i = 1; i < arrivals.length; i++) { const gap = arrivals[i]! - arrivals[i - 1]!; if (gap > 0 && gap < step) step = gap; }
  if (Number.isFinite(step)) record.step = step;
  return record.step ?? 0;
}

// The value a property holds on the object itself. In caracAL the CODE's `parent` and its socket
// are the runner scope's proxies (runtime/lifecycle/character/run.ts `facade`): a read returns a
// forwarder that calls the socket's current method, and a write goes to the real socket. A wrapper
// whose next step is that forwarder would call itself, and a forwarder throws once its scope
// retires, so the budget reads the real socket and its real emit, which the proxy's property
// descriptor holds. On the native client's own objects it is the property itself.
function own<T>(holder: object, key: string): T | undefined {
  const value = Object.getOwnPropertyDescriptor(holder, key)?.value as T | undefined;
  return value ?? (holder as Record<string, T | undefined>)[key];
}

const meter = (): Meter => ({ n: 0, totalUs: 0, maxUs: 0 });
// The owners' cost per call reads a real clock. On ChronAL virtual time (e2e runs), Date
// and performance stand still during synchronous work, so the clock receipt's native timer is the
// real one (tools/sim/browser-clock.cjs `cpuNow`). Movement reads the same clock for its own costs.
function cpuClock(): number {
  const chronal = (globalThis as { __e2eChronalClock?: { cpuNow?(): number } }).__e2eChronalClock;
  return typeof chronal?.cpuNow === 'function' ? chronal.cpuNow() : globalThis.performance?.now?.() ?? Date.now();
}
function measure(m: Meter, started: number, clock: () => number): void {
  const us = (clock() - started) * 1000;
  m.n++; m.totalUs += us; m.maxUs = Math.max(m.maxUs, us);
}

// A new socket's record. Its drain timer and its clock are the game window's, so a drain set
// before a runtime stop still runs when the stopped CODE realm's timers and clock no longer do: a
// native CODE frame's removal ends both. A host with no game window timer uses its own realm's.
// The drain is no registration of the lifecycle owner's run scope: it sends the game client's and the player's own
// held emits, which pass while the character is held (untagged emits).
function newRecord(win: BudgetWindow, socket: BudgetSocket, ports: BudgetPorts): BudgetRecord {
  const set = own<NonNullable<BudgetWindow['setTimeout']>>(win, 'setTimeout'), clear = own<NonNullable<BudgetWindow['clearTimeout']>>(win, 'clearTimeout');
  const date = own<NonNullable<BudgetWindow['Date']>>(win, 'Date');
  const clock = typeof date?.now === 'function' ? () => date.now() : ports.now;
  const later = typeof set === 'function' && typeof clear === 'function'
    ? (run: () => void, ms: number) => { const id = set(run, ms); return () => clear(id); }
    : (run: () => void, ms: number) => { const id = setTimeout(run, ms); return () => clearTimeout(id); };
  const began = clock();
  return { socket, emit: own<Emit>(socket, 'emit')!, ledger: [], doors: [], seq: 0, clock, later,
    ring: { seq: 0, start: 0, entries: [] }, held: [], admissions: [], survival: [], peak: 0,
    excess: { survival: null, job: null, background: null }, roster: [], waits: new Map(), reported: { from: began, at: began, used: 0 }, pings: [], arrivals: [],
    answers: { survival: {}, job: {}, background: {} }, meter: { questions: meter(), emits: meter() } };
}

// installCallBudget wraps the socket's emit once per install. The record keeps the ledger and
// the ring across installs on one socket; a new socket (a reconnect, a realm change) gets a new
// record. shared.js calls it first, before movement's install and before any console game call.
export function installCallBudget(host: BudgetHost, ports: BudgetPorts): CallBudget | null {
  const win = host.parent, socket = win && own<BudgetSocket>(win, 'socket');
  if (!socket || typeof own(socket, 'emit') !== 'function') return null;
  let record = win.__partyCallBudget;
  if (record?.socket !== socket) record = win.__partyCallBudget = newRecord(win, socket, ports);
  else retireCallBudget(record);
  const current = record, next = own<Emit>(socket, 'emit')!, clock = ports.cpu ?? cpuClock, hooks = partyHooks();
  // The install's clock until it retires; then the record's, since a stopped realm's clock can
  // stand still while the drain it left runs (3.1).
  const now = () => install.retired ? current.clock() : ports.now();
  // The margin (3.3): the largest round trip the game measured within the last window, and at
  // least the latest one. The game's list keeps 40 pings, one per 3.2 s (js/functions.js:298-305),
  // so its largest can be two minutes old and hold every entry long after the server let it go. A
  // ping measured in the last window covers the calls still in it, which a server slowed by a
  // burst holds longer than the latest ping.
  const marginAt = (at: number): number => {
    const pings = Array.isArray(win.pings) ? win.pings : [], last = Number(pings[pings.length - 1]);
    if (Number.isFinite(last) && (current.pingSeen?.length !== pings.length || current.pingSeen?.last !== last)) {
      current.pingSeen = { length: pings.length, last };
      current.pings.push({ at, rtt: last });
    }
    while (current.pings.length && current.pings[0]!.at < at - CALL_WINDOW_MS) current.pings.shift();
    return Math.max(margin(win), ...current.pings.map(ping => ping.rtt)) + clockStep(current, at);
  };
  const prune = (at: number) => {
    const from = at - CALL_WINDOW_MS - marginAt(at);
    while (current.ledger.length && current.ledger[0]!.at < from) current.ledger.shift();
    while (current.doors.length && current.doors[0]! <= from) current.doors.shift();
    while (current.survival.length && current.survival[0]!.at <= at - CALL_WINDOW_MS) current.survival.shift();
    for (const [key, wait] of current.waits) if (!(wait.last >= from)) current.waits.delete(key);
  };
  // The moment the live job waits stop holding the background band: one window and the margin after
  // their askers' last asks, unless a job call goes first. 0 with no job wait.
  const jobWaitEnds = (at: number): number => {
    let end = 0;
    for (const [key, wait] of current.waits) if (key.startsWith('job|')) end = Math.max(end, wait.last + CALL_WINDOW_MS + marginAt(at) + 1);
    return end;
  };
  // The server dates a call when its handler runs, which a burst-slowed server does up to the
  // largest round trip of the window after the send, so `used` holds an own entry as long as prune
  // and the figure's `from` do: the window and that round trip, not only the latest one
  // (layer 5 step 3's close).
  const usedAt = (at: number) => used(current, at, marginAt(at));
  // The largest `used` since the last status sample, for the next one.
  const note = (at: number) => {
    const value = Math.round(usedAt(at) * 100) / 100, reported = current.reported;
    if (value >= reported.used) { reported.used = value; reported.at = at; }
  };
  const book = (method: string, cost: number, at: number): LedgerEntry[] => {
    if (cost <= 0) return [];
    const entry = { at, method, cost, seq: ++current.seq };
    current.ledger.push(entry);
    return [entry];
  };
  // A call's charge (3.2). The price of a crossing inside its handler already holds its door, so
  // the `new_map` that follows books nothing. A door that lands after its call (Blink, a Magiport
  // accept) is booked with the call, dated at its landing, and the `new_map` that may follow books
  // nothing either.
  const bookPrice = (method: string, charge: Price, at: number): { entries: LedgerEntry[]; door?: number } => {
    const entries = book(method, charge.cost, at);
    if (charge.landsMs !== undefined) {
      const lands = at + charge.landsMs;
      entries.push(...book('transport', DOOR, lands));
      current.doors.push(lands);
      return { entries, door: lands };
    }
    if (!charge.door) return { entries };
    current.doors.push(at);
    return { entries, door: at };
  };
  // A price that throws never stops the game's own call: the call books nothing, and the
  // server's figure covers it within one round trip (3.3).
  const charge = (method: string, data: unknown): Price => {
    try { return price(method, data, host.character, host.G, { entities: win.entities, party: win.party, party_list: win.party_list, roster: current.roster }); } catch { return at(0); }
  };
  // A notice on the realm's registry; with nothing registered it is one empty list.
  const tell = (hook: Parameters<HookRegistry['notify']>[0], payload: Omit<CallNotice, 'character' | 'by'>) =>
    void hooks.notify(hook, { character: host.character.name, ...payload, by: 'core:calls' } satisfies CallNotice);
  // Each ring entry is a change an add-on hears: a held emit's release, a question's wait closed or
  // raised, an unmatched admission, and the `limitdc` snapshot.
  const ring = (entry: Omit<CallRecord, 'part'>) => {
    ringPush(current, { part: 'calls', ...entry });
    const { method, band, cost, waitedMs, margin, sentMargin, limit } = entry;
    if (entry.decision === 'held') tell('calls.released', { method, cost, waitedMs, margin, sentMargin });
    else if (entry.decision === 'waited') tell('calls.waited', { band, method, cost, waitedMs });
    else if (entry.decision === 'read-job') tell('calls.raised', { method, waitedMs });
    else if (entry.decision === 'unmatched') tell('calls.unmatched', { method, band });
    else if (entry.decision === 'limitdc') tell('calls.limitdc', { method, total: cost, limit });
  };
  // The hold queue drains in emit order as the window frees: on the record's timer, set for the
  // moment the next ledger entry or the server's figure leaves, and on every player packet (3.5).
  // A next install cancels the timer and sets its own; a stop leaves it running (3.1).
  function drain(): void {
    current.drain = undefined;
    const at = now();
    prune(at);
    while (current.held.length && usedAt(at) + current.held[0]!.cost <= CALL_LIMIT) {
      const held = current.held.shift()!, cc = current.cc;
      bookPrice(held.method, { cost: held.cost, door: held.door, landsMs: held.landsMs }, at);
      note(at);
      ring({ decision: 'held', method: held.method, cost: held.cost, used: usedAt(at), limit: CALL_LIMIT, waitedMs: at - held.at, margin: held.margin, sentMargin: marginAt(at),
        figure: cc ? { value: cc.value, ageMs: at - cc.at } : null });
      try { held.next.apply(held.self, [held.method, ...held.rest]); } catch (error) {
        ring({ decision: 'send-failed', method: held.method, cost: held.cost, used: usedAt(at), error: String(error) });
      }
    }
    schedule();
  }
  // The moment the next ledger entry or the server's figure leaves the window, one millisecond on.
  function nextFree(): number {
    const at = now(), rtt = marginAt(at);
    const frees = [...current.ledger.map(entry => entry.at + CALL_WINDOW_MS + rtt), current.cc ? current.cc.at + CALL_WINDOW_MS : Infinity].filter(t => t > at);
    return (frees.length ? Math.min(...frees) : at) + 1;
  }
  function schedule(): void {
    if (current.drain !== undefined || !current.held.length) return;
    current.drain = current.later(drain, Math.max(1, nextFree() - now()));
  }
  const install: Install = { next, retired: false, scope: ports.scope, listeners: [], stops: [], untagged: [], wrapper(this: unknown, method: string, ...rest: unknown[]) {
    // A retired wrapper below a newer install passes every emit to the next one (3.1).
    if (install.retired) return next.apply(this, [method, ...rest]);
    const started = clock();
    try {
      // An admitted call goes at once: its cost is already in the ledger.
      const admitted = current.admissions.findIndex(admission => admission.method === method);
      if (admitted >= 0) { current.admissions.splice(admitted, 1); return next.apply(this, [method, ...rest]); }
      const at = now(), cost = charge(method, rest[0]);
      prune(at);
      // The player's own tracker click is an untagged emit: the next tracker window shows (3.7).
      for (const seen of install.untagged) { try { seen(method); } catch { /* A reader's fault never stops the game's call. */ } }
      // An emit in the turn of another method's admission is not the call that was asked.
      if (current.admissions.length) ring({ decision: 'unmatched', method, cost: cost.cost, used: usedAt(at) });
      if (!current.held.length && usedAt(at) + cost.cost <= CALL_LIMIT) {
        bookPrice(method, cost, at);
        note(at);
        return next.apply(this, [method, ...rest]);
      }
      const held: Held = { method, rest, self: this, next, cost: cost.cost, door: cost.door, landsMs: cost.landsMs, at, margin: marginAt(at) };
      current.held.push(held);
      tell('calls.held', { method, cost: held.cost, used: usedAt(at), margin: held.margin, source: 'untagged' });
      schedule();
      // socket.io's emit returns the socket; a held emit returns the same.
      return this;
    } finally { measure(current.meter.emits, started, clock); }
  } };
  // The server's figure from each player packet (server.js:1024), and the door's 8 of a crossing
  // that completes after its call with no door booked: Town and a bank floor (3.2).
  const onPlayer = (data: Partial<Pick<ServerToClient_player, 'cc'>> | null) => {
    if (install.retired) return;
    current.arrivals.push(now());
    if (!Number.isFinite(data?.cc)) return;
    const at = now(), from = at - marginAt(at), held = new Set<LedgerEntry>();
    prune(at);
    let heldCost = 0;
    for (const entry of current.ledger) if (entry.at >= at - CALL_WINDOW_MS && (entry.at <= from || entry.at === at)) { held.add(entry); heldCost += entry.cost; }
    current.cc = { value: Number(data!.cc), at, seq: ++current.seq, from, held, heldCost };
    note(at);
    if (current.held.length) drain();
  };
  const onNewMap = () => {
    if (install.retired) return;
    const at = now();
    prune(at);
    if (current.doors.length) current.doors.shift();
    else book('transport', DOOR, at);
  };
  // Each listener is registered by name on the call budget owner's handle, so owner:check sees it in the budget's module.
  ports.scope.on(socket, 'player', onPlayer as (data: unknown) => void);
  ports.scope.on(socket, 'new_map', onNewMap);
  install.listeners.push(['player', onPlayer as (data: never) => void], ['new_map', onNewMap]);
  socket.emit = install.wrapper;
  current.install = install;
  schedule();
  // One question before each console game call (3.5). `send` books the call at once, so a second
  // question in the same turn sees it; the call follows in the same synchronous turn, and an
  // admission no emit matched by the turn's end leaves the ledger.
  function band(question: Question): 'send' | 'not-now' {
    const started = clock();
    try {
      const at = now(), cost = charge(question.method, question.data), key = question.band + '|' + question.method;
      prune(at);
      // A background question that has waited one window is judged in the job band (3.7): one
      // window frees every ledger entry, so a wait past it runs under a load that does not end,
      // and its readers count on the reply's age. It never rises above job. The Tracktrix read rises
      // the same way: in a fight the room sits at its cap and the background limit is 50, one read's
      // cost, so the read goes out only in a window where nothing else was sent, and a fight has none.
      const asked = current.waits.get(key)?.since, raised = question.band === 'background' && asked !== undefined && at - asked >= CALL_WINDOW_MS + marginAt(at);
      const judged: Band = raised ? 'job' : question.band;
      const limit = bandLimits(current.peak)[judged], before = usedAt(at);
      const count = current.answers[question.band][question.method] ??= { send: 0, notNow: 0 };
      // The held row: while table P holds the character, every tagged question but the
      // background band's waits for Play. The asker's next pass is a held timer, so it asks again then.
      if (question.band !== 'background' && ports.held()) { count.notNow++; return 'not-now'; }
      if (current.held.length || before + cost.cost > limit || judged === 'background' && jobWaitEnds(at) > at) {
        count.notNow++;
        const wait = current.waits.get(key);
        if (wait) wait.last = at;
        else current.waits.set(key, { since: at, last: at });
        return 'not-now';
      }
      count.send++;
      const was = current.excess[judged];
      current.excess[judged] = Math.max(was ?? -Infinity, before + cost.cost - limit);
      const booked = bookPrice(question.method, cost, at), admission: Admission = { method: question.method, ...booked };
      if (question.band === 'survival' && cost.cost > 0) {
        current.survival.push({ at, method: question.method, cost: cost.cost, seq: current.seq });
        current.peak = Math.max(current.peak, current.survival.reduce((sum, entry) => sum + entry.cost, 0));
      }
      const waited = current.waits.get(key)?.since;
      if (waited !== undefined) {
        current.waits.delete(key);
        ring({ decision: raised ? 'read-job' : 'waited', method: question.method, band: question.band, cost: cost.cost, used: before, limit, waitedMs: at - waited });
      }
      current.admissions.push(admission);
      ports.scope.queueMicrotask(() => {
        const open = current.admissions.indexOf(admission);
        if (open < 0) return;
        current.admissions.splice(open, 1);
        current.ledger = current.ledger.filter(entry => !admission.entries.includes(entry));
        if (admission.door !== undefined) { const door = current.doors.indexOf(admission.door); if (door >= 0) current.doors.splice(door, 1); }
        ring({ decision: 'unmatched', method: admission.method, band: question.band, cost: cost.cost, used: usedAt(now()) });
      });
      note(at);
      return 'send';
    } finally { measure(current.meter.questions, started, clock); }
  }
  const budget: CallBudget = {
    view() {
      const at = now(), rtt = marginAt(at), limits = bandLimits(current.peak), cc = current.cc;
      prune(at);
      return { used: usedAt(at), ledger: current.ledger.map(entry => ({ ...entry })), cc: cc?.value ?? null,
        ccAge: cc ? at - cc.at : null, ccSeq: cc?.seq ?? null, ccFrom: cc?.from ?? null, margin: rtt, latest: margin(win), limit: CALL_LIMIT, room: limits.room, limits, peak: current.peak,
        held: current.held.length, heldHead: current.held[0]?.method ?? null, waiting: [...current.waits].map(([key, wait]) => ({ band: key.split('|')[0]!, method: key.slice(key.indexOf('|') + 1), ms: at - wait.since })),
        excess: { ...current.excess }, meter: structuredClone(current.meter), answers: structuredClone(current.answers) };
    },
    records: () => ringEntries(current),
    band,
    // The next sample starts from the `used` this one ends on.
    sample() {
      const at = now();
      prune(at);
      note(at);
      const { from, at: held, used: most } = current.reported;
      current.reported = { from: at, at, used: Math.round(usedAt(at) * 100) / 100 };
      return { from, to: at, at: held, used: most, margin: marginAt(at) };
    },
    margin: () => marginAt(now()),
    stop() { if (current.install === install) stopCallBudget(current); },
  };
  host.__partyCalls = budget;
  // `core:calls`: the realm's first install registers it, and each later install, a reinstall
  // on the same socket or a CODE reload's, puts its own answers in it through the registry's
  // `publish`, so one registration answers from the current install.
  const registered = hooks.publish(callsRegistration({ budget, install }));
  if (!registered.ok) throw Error(`The call budget's core:calls did not load: ${registered.message}`);
  // A `limitdc` that still happens (3.8): one snapshot of the server's report, the ledger and the
  // ring, kept in local storage at once and posted to the ring snapshot route the movement owner
  // built. The server sends its report before the reason (server.js:5024-5025), so the reason
  // alone saves a snapshot only when no report came.
  const onLimitdc = (report: LimitdcReport | null) => {
    if (install.retired || current.limitdc) return;
    current.limitdc = true;
    const at = now();
    prune(at);
    const calls = Array.isArray(report?.calls) ? report!.calls as unknown[] : [];
    const total = calls.reduce((sum: number, call) => sum + (Number(Array.isArray(call) ? call[2] : 0) || 0), 0);
    ring({ decision: 'limitdc', method: 'limitdc', cost: total, used: usedAt(at), limit: Number(report?.climit) || CALL_LIMIT, report, ledger: current.ledger.map(entry => ({ ...entry })) });
    const snapshot: LimitdcSnapshot = { id: `${host.character.name}:${at}`, character: host.character.name, trigger: 'limitdc', records: ringEntries(current), incidents: [] };
    keepLimitdc(host, snapshot);
    postLimitdc(host, ports, snapshot);
  };
  const onLimitdcReport = (data: LimitdcReport | null) => onLimitdc(data ?? null);
  const onDisconnectReason = (reason: unknown) => { if (reason === 'limitdc') onLimitdc(null); };
  ports.scope.on(socket, 'limitdcreport', onLimitdcReport as (data: unknown) => void);
  ports.scope.on(socket, 'disconnect_reason', onDisconnectReason);
  install.listeners.push(['limitdcreport', onLimitdcReport as (data: never) => void], ['disconnect_reason', onDisconnectReason as (data: never) => void]);
  // A copy an earlier install could not post (the process ended on the disconnect) goes now, once
  // the runtime that installed the budget has finished loading its ports.
  if (ports.request) ports.scope.setTimeout(() => { for (const left of keptLimitdcs(host)) postLimitdc(host, ports, left); }, 0);
  // The two background reads (3.7) start on this install and stop with it.
  installBudgetReads({ calls: budget, socket, win, scope: ports.scope, items: () => host.character.items, listen: (event, listener) => install.listeners.push([event, listener]),
    onStop: stop => install.stops.push(stop), onUntagged: seen => install.untagged.push(seen),
    nextFree: () => Math.max(nextFree(), jobWaitEnds(now())), margin: () => marginAt(now()),
    forget: (band, method) => current.waits.delete(band + '|' + method), roster: players => { current.roster = players; } }, ports);
  return budget;
}

// `core:calls`'s answers from one install. After the install retires and before the next one,
// as on a reconnect before the new socket exists, a question waits: `not-now` sends nothing past the
// limit and refuses nothing for good, since the asker asks again on its next pass. The margin then
// is the retired install's last one, from the pings its record keeps.
export function callsRegistration(current: { budget: Pick<CallBudget, 'band' | 'margin'>; install: { retired: boolean } }): Registration {
  return { name: 'core:calls', folder: 'core', author: 'adventureland-party-console',
    summary: 'Lets each game call go when the character has room for it, so no call burst disconnects a character and combat keeps its share.',
    hooks: {
      'calls.band': (question: CallQuestion): CallAnswer => current.install.retired ? 'not-now' : current.budget.band(question),
      'calls.margin': () => current.budget.margin(),
      'calls.window': () => CALL_WINDOW_MS,
    } };
}

// The `limitdc` snapshots not yet at the coordinator, one list per character in local storage
// (3.8). The copy is a diagnostic record no decision reads.
const LIMITDC_KEY = 'party-call-budget-limitdc:';
interface LimitdcSnapshot { id: string; character: string; trigger: 'limitdc'; records: unknown[]; incidents: unknown[] }
// A list local storage cannot read is one `unreadable` ring entry on the socket's record before it
// reads as empty.
function keptLimitdcs(host: BudgetHost): LimitdcSnapshot[] {
  const key = LIMITDC_KEY + host.character.name;
  try {
    const kept = JSON.parse(host.localStorage?.getItem(key) || '[]') as unknown;
    return Array.isArray(kept) ? kept as LimitdcSnapshot[] : [];
  } catch (error) {
    const record = host.parent.__partyCallBudget;
    if (record) ringPush(record, { part: 'calls', decision: 'unreadable', method: 'limitdc', cost: 0,
      used: used(record, record.clock(), margin(host.parent)), error: key + ': ' + String(error) });
    return [];
  }
}
function storeLimitdcs(host: BudgetHost, list: LimitdcSnapshot[]): void {
  try { host.localStorage?.setItem(LIMITDC_KEY + host.character.name, JSON.stringify(list)); } catch { /* Storage full or gone: the post still goes. */ }
}
function keepLimitdc(host: BudgetHost, snapshot: LimitdcSnapshot): void {
  storeLimitdcs(host, [...keptLimitdcs(host).filter(kept => kept.id !== snapshot.id), snapshot]);
}
// The coordinator's answer deletes the local copy; a failed or timed-out post reports the kept bound
// and leaves the copy for the next install.
function postLimitdc(host: BudgetHost, ports: BudgetPorts, snapshot: LimitdcSnapshot): void {
  if (!ports.request) return;
  void Promise.resolve().then(() => ports.request!('/movement-snapshot', { method: 'POST', timeout: 10_000, body: snapshot }))
    .then(() => storeLimitdcs(host, keptLimitdcs(host).filter(kept => kept.id !== snapshot.id)),
      error => boundFired({ bound: 'limitdcPost', owner: '09', state: { id: snapshot.id, error: String(error) } }));
}

// Takes the record's live install off the socket: its listeners and its reads go, and its wrapper
// passes every emit on. The game's emit comes back only while the wrapper is still the socket's
// top; another wrapper above it (the live driver's, e2e/live-game-client.ts; the profiling
// preload's) stays as it is (3.1, the current console's restore rule at characters/shared.js:838).
function takeOff(record: BudgetRecord, install: Install): void {
  install.retired = true;
  for (const [event, listener] of install.listeners) install.scope.off(record.socket as never, event, listener as never);
  for (const end of install.stops) { try { end(); } catch { /* One read's fault leaves the other's end to run. */ } }
  if (own(record.socket, 'emit') === install.wrapper) record.socket.emit = install.next;
  record.install = undefined;
}
// A next install retires the last one: its drain timer goes too, and the new install takes the
// hold queue and sets its own (3.1).
function retireCallBudget(record: BudgetRecord): void {
  if (record.install) takeOff(record, record.install);
  if (record.drain) { record.drain(); record.drain = undefined; }
}
// A runtime stop with no next install (the player's Disengage, the clean shutdown) retires the
// install and leaves the drain on the record's timer, which sends the held emits in order as the
// window frees: they are the game client's and the player's own calls (R1: nothing dropped
// silently). A next install cancels it and takes the queue.
// The game's `stop_runner` takes the CODE frame off and then emits its own `code` call, which
// costs 2 and goes through the game's emit with no wrapper above it, so the stop books that call.
const STOP_CODE_COST = 2;
function stopCallBudget(record: BudgetRecord): void {
  if (!record.install) return;
  takeOff(record, record.install);
  record.ledger.push({ at: record.clock(), method: 'code', cost: STOP_CODE_COST, seq: ++record.seq });
}

Object.assign(globalThis, { installCallBudget, cpuClock });
