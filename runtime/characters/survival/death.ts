// The death and the respawn on the character: one `death`, one `hit` and one `game_response` handler
// of survival's own, registered on the game socket through the module, the own-death record, and the
// one `respawn` call behind `survival.respawn`. The status owner's telemetry records the death packets itself.
// Another entity's death is targeting's own `death` listener (runtime/characters/targeting/death.ts),
// which closed S85.
import type { CallAnswer, CallQuestion, RespawnAnswer, SurvivalNotice } from '../../hooks/registry.ts';
import type { SurvivalEntry } from './records.ts';
import { chosen } from './needs.ts';
import { boundFired } from '../../status/api.ts';

type Packet = { id?: unknown; name?: unknown; target?: unknown; hid?: unknown; actor?: unknown; damage?: unknown; heal?: unknown; evade?: unknown; miss?: unknown } | null;
interface Socket { on?(event: string, listener: (data: Packet) => void): void; off?(event: string, listener: (data: Packet) => void): void }
export interface DeathMessage { message: string; details: Record<string, unknown> }
// The lifecycle owner's run scope handle (runtime/lifecycle/character/run.ts `ScopeHandle`), the part survival uses.
export interface SurvivalScope {
  on(target: unknown, event: string, listener: (data: unknown) => void): void;
  // The run scope's handle has it; a test's stand-in may not, and its generation ends the listener.
  off?(target: unknown, event: string, listener: (data: unknown) => void): void;
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(id: number | undefined): void;
}
// createDeath reads the game through its ports (the character, G's monster names and the entity
// lookup), so a test plants them without setting globals.
type DeathCharacter = Pick<typeof character, 'name' | 'map' | 'x' | 'y' | 'rip'>;
type Entity = { type?: string; mtype?: string } | null | undefined;
export interface DeathPorts {
  socket(): Socket | undefined;
  character(): DeathCharacter;
  // G.monsters[mtype].name, or undefined for a type G does not hold.
  monsterName(mtype: string): string | undefined;
  entity(id: string): Entity;
  // The survival owner's run scope handle, `act`: its listeners and timers wait while
  // table P holds the character, and the generation's stop removes them, so no record of them is kept on
  // the game window.
  scope: SurvivalScope;
  ownActor(id: unknown): boolean;
  // The realm's registry, which hears `survival.died` for this character's own death once per rip (movement saves its
  // records on it, the death snapshot, the status owner's telemetry writes the death record with its Hunt or event trip
  // and its combat line, runtime/status/character/telemetry.ts) and `survival.respawning` for each respawn answer and
  // reply.
  notify(hook: SurvivalNotice, payload: Record<string, unknown>): void;
  // The escape's warrior shield cycle reads each hit (escape.ts `observeHit`).
  escapeHit(data: Packet): void;
  calls: { band(question: CallQuestion): CallAnswer };
  // The largest round trip of the last 4 s (the call budget's margin).
  margin(): number;
  // The survival ring (records.ts): a respawn `not-now` or refusal.
  ring?(entry: SurvivalEntry): void;
}
export function createDeath(ports: DeathPorts) {
  const monsterName = (mtype: string) => ports.monsterName(mtype) || mtype;
  // What killed the character in this life: the monster the server names in its
  // `defeated_by_a_monster` response, sent before `rip` on a monster's killing blow outside a
  // generated map (node/server.js:13993, :14001), and the last monster that hit it. A death the
  // server names no monster for (a burn, spikes, PvP, `harakiri`, a generated map) names the last
  // monster that hit, and "unknown monster" when none did; a player is never named. Both clear at
  // each death, so a life's record holds only its own hits.
  let lastIncomingDamage: { at: number; id: unknown; mtype?: string; name: string } | null = null, killer: string | null = null;
  // Whether this rip is recorded: the packet and the status snapshot both reach it, once.
  let dead = !!ports.character().rip;
  function message(): DeathMessage {
    const character = ports.character(), at = { map: character.map, x: character.x, y: character.y };
    if (killer) return { message: 'Killed by ' + monsterName(killer), details: { monster: killer,
      ...(lastIncomingDamage?.mtype === killer ? { attacker: lastIncomingDamage.id } : {}), ...at } };
    return lastIncomingDamage ? { message: 'Killed by ' + lastIncomingDamage.name, details: { monster: lastIncomingDamage.mtype, attacker: lastIncomingDamage.id, ...at } }
      : { message: 'Killed by unknown monster', details: at };
  }
  function own() {
    if (dead) return;
    dead = true;
    // The server sets each death's own wait (`cant_respawn`). The last death's wait lies ahead
    // only when a respawn came some other way inside it (the Cave's Nera rescue), and it does not
    // hold this death's first ask. A respawn sent since the character last read alive belongs to
    // this death: its packet can land after that respawn's refusal (UP-3's farm and hunt rows read
    // it 2 ms and 502 ms after the refusal), and the wait the refusal set stays.
    if (!sentThisDeath) waitUntil = 0;
    const m = message(), character = ports.character();
    lastIncomingDamage = null; killer = null;
    ports.notify('survival.died', { name: character.name, at: Date.now(), cause: m.message, details: m.details, map: character.map, x: character.x, y: character.y, event: null, by: 'core:survival' });
  }
  const onDeath = (data: Packet) => {
    if (data && ports.ownActor(data.id || data.name)) own();
  };
  const onHit = (data: Packet) => {
    ports.escapeHit(data);
    if (!data || !ports.ownActor(data.id || data.target) || !(Number(data.damage) > 0)) return;
    const attackerId = data.hid || data.actor, attacker = attackerId ? ports.entity(String(attackerId)) : null;
    if (attacker && attacker.type === 'monster')
      lastIncomingDamage = { at: Date.now(), id: attackerId, mtype: attacker.mtype, name: monsterName(String(attacker.mtype)) };
  };
  // The server's own name for the killer, kept for the next death record.
  const onResponse = (data: Packet) => {
    const d = data as { response?: unknown; monster?: unknown } | null;
    if (d?.response === 'defeated_by_a_monster' && d.monster) killer = String(d.monster);
  };
  function listen() {
    const socket = ports.socket();
    ports.scope.on(socket, 'death', onDeath as never);
    ports.scope.on(socket, 'hit', onHit as never);
    ports.scope.on(socket, 'game_response', onResponse as never);
  }

  // The one respawn (3.5). It goes only while the character is dead, with no respawn in flight,
  // past the server's `rip_time` wait and with the survival band's `send`; Pause refuses it. It
  // settles on the reply; a reply that never comes counts lost after one margin, since a respawn has
  // no cooldown. A `cant_respawn` reply carries
  // `ms`, the wait the server has left (server.js:6229-6232), and the next ask waits it out.
  let flight: Promise<void> | null = null, waitUntil = 0, sentThisDeath = false;
  function after(ms: number) {
    return new Promise<void>(resolve => { ports.scope.setTimeout(resolve, Math.max(0, ms)); });
  }
  // The respawn's own reply times, the family margin's rule: a lost-reply wait is at
  // least the latest one.
  let ownRtt = 0;
  // The reply of a sent respawn: `cant_respawn` sets the wait, and a reply that never comes counts
  // lost after the margin, unless the client already reads the character alive by then. Every
  // refused reply tells `survival.respawning` with its reason and writes the ring, since a hook
  // caller holds only the `sent` answer.
  function settle(sent: unknown, sentAt: number, by: string): Promise<void> {
    let answered = false;
    const reply = Promise.resolve(sent).then(() => { answered = true; ownRtt = Date.now() - sentAt; told(by, 'accepted'); }, (error: { reason?: string; response?: string; ms?: unknown } | undefined) => {
      answered = true; ownRtt = Date.now() - sentAt;
      const reason = String(error?.reason || error?.response || error || '');
      if (reason === 'cant_respawn' && Number.isFinite(Number(error?.ms))) { waitUntil = Date.now() + Number(error!.ms); told(by, 'cant_respawn', { ms: Number(error!.ms) }); }
      else { told(by, 'refused', { reason }); ports.ring?.({ decision: 'respawn', answer: 'refused', reason }); }
      throw error;
    });
    // A reply lost on the network while the character is still dead tells the status owner's bound record.
    const bound = Math.max(ports.margin(), ownRtt);
    const lost = after(bound).then(() => {
      if (!ports.character().rip) return;
      if (!answered) boundFired({ bound: 'respawnLostReply', owner: '05', state: { by, ms: bound } });
      throw { reason: 'lost reply' };
    });
    return Promise.race([reply, lost]);
  }
  // A respawn that does not go writes the ring once per reason in a row: a caller asks again on
  // each of its ticks while the server's wait runs.
  // `survival.respawning`: each answer to an ask of a dead character, and the reply of a
  // sent respawn, named with its asker.
  function told(by: string, outcome: string, extra: Record<string, unknown> = {}): void {
    ports.notify('survival.respawning', { character: ports.character().name, by, outcome, ...extra });
  }
  let lastHeld: string | null = null;
  function hold(answer: RespawnAnswer, reason: string, by: string): RespawnAnswer {
    if (lastHeld !== reason) ports.ring?.({ decision: 'respawn', answer: answer.answer, reason });
    lastHeld = reason;
    told(by, answer.answer);
    return answer;
  }
  // The console Pause needs no row: the respawn timer is `act`, and the respawn call asks the band,
  // whose held row answers `not-now`.
  function answer(ask: { by: string }): RespawnAnswer {
    // A living character ends the death, so the next death's answers write afresh.
    if (!ports.character().rip) { lastHeld = null; sentThisDeath = false; return { answer: 'not-now' }; }
    if (flight) return hold({ answer: 'not-now' }, 'a respawn in flight', ask.by);
    if (Date.now() < waitUntil) return hold({ answer: 'not-now' }, "the server's respawn wait", ask.by);
    // P2: an add-on may hold the respawn past the server's wait, never before it.
    if (Date.now() < chosen('respawn', [], waitUntil, ports.character().name)) return hold({ answer: 'not-now' }, 'an add-on holds the respawn', ask.by);
    // The call goes in the same synchronous turn as the band's `send`.
    if (ports.calls.band({ band: 'survival', method: 'respawn' }) !== 'send') return hold({ answer: 'not-now' }, 'the survival band', ask.by);
    lastHeld = null; sentThisDeath = true;
    // The game's `respawn`: survival's one call of it.
    flight = settle(respawn(), Date.now(), ask.by).finally(() => { flight = null; });
    flight.catch(() => undefined);
    told(ask.by, 'sent');
    return { answer: 'sent' };
  }
  // A caller's respawn: its promise settles with the respawn this ask sent, or rejects `not-now`
  // with the time a next ask can go (a respawn in flight, the server's wait, or the band's margin).
  function respawnFor(by: string): Promise<void> {
    const a = answer({ by });
    if (a.answer === 'sent') return flight!;
    return Promise.reject({ reason: 'not-now', retryAt: flight ? Date.now() : Math.max(waitUntil, Date.now() + ports.margin()) });
  }
  // A command handler's respawn: it waits through `not-now` until its own ask goes.
  async function respawnWhenAllowed(by: string): Promise<void> {
    while (ports.character().rip) {
      try { await respawnFor(by); return; }
      catch (error) {
        const e = error as { reason?: string; retryAt?: number };
        if (e?.reason !== 'not-now') throw error;
        if (flight) await flight.catch(() => undefined);
        else await after(Math.max(1, Number(e.retryAt) - Date.now()));
      }
    }
  }
  return {
    listen, answer, respawn: respawnFor, respawnWhenAllowed,
    // The status snapshot's read of `rip` (shared.js `snapshot`): a death whose packet this
    // client missed records here, and a respawn clears the mark.
    seen(rip: boolean) { if (rip) own(); else { dead = false; sentThisDeath = false; } },
    // The generation's stop removes the listeners and timers (the lifecycle owner's run scope).
    stop() {},
  };
}
export type Death = ReturnType<typeof createDeath>;
