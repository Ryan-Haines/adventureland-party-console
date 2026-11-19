// The character's escape: the
// escape's record (`escapeState`, the party escape's stage as the last report reply delivered it,
// and `escapeLocal`, this character's own part of it), its apply from the reply, the step that acts
// on it, the Blink landing, the walk home, the member's Magiport accept, and the spends. The party's
// stages are the coordinator's (runtime/coordinator/survival/escape.ts); this file decides what
// the character does in each.
//
// shared.js builds the record at load (install.ts `installSurvivalCharacter`), since its report
// reply applies the escape before the role runner starts. The spends need the turns executor and
// survival's needs, so the role runner's install adopts them into the record (`adopt`). Movement
// moves the character: the escape asks the movement service shared.js hands in, and movement's
// character half and targeting reset their own state on `survival.escapeMember`.
import { eventFacts, eventKey } from '../../events/api.ts';
import type { EscapeHold, SpendAsk } from '../../hooks/registry.ts';
import type { SurvivalEntry } from './records.ts';
import { chosen, type Needs } from './needs.ts';
import type { Target } from '../turns/api.ts';
import { ARRIVAL_TOLERANCE, isSafeAt } from '../../movement/api/character.ts';
import { survivalRound } from '../../protocol/ladder.ts';
import { healFirstBelowOf, type Readiness } from '../turns/api.ts';
import { ESCAPE_SETTLED, ESCAPE_STEP, LANDING_MARGIN, MAGIPORT_OFFSET } from './lines.ts';
import { escapeLabel, escapeResets } from './records.ts';
import type { SurvivalScope } from './death.ts';
import { boundFired } from '../../status/api.ts';
import { ageOf } from '../../protocol/reports.ts';

// The one command purpose an escape stage lets through (`survival.escaping`'s `admits`):
// `escape-recovery` in `recovery-convoy`, nothing in any other stage.
export function escapeAdmits(stage: string): EscapeHold['admits'] {
  return stage === 'recovery-convoy' ? 'escape-recovery' : null;
}

type Point = { x: number; y: number };
type Spot = Point & { map: string };
// The party escape as the coordinator delivers it (runtime/coordinator/survival/escape.ts).
export interface EscapeState {
  id: string; stage: string; leader?: string; participants?: string[]; walk?: string[];
  home?: { map: string; in?: string; x: number; y: number; radius: number } | null;
  destination?: { map: string; in?: string; x: number; y: number } | null;
}
// The character's own part of the escape, which its status report carries (`escape`, runtime/status/character/report.ts). The
// warrior's shield cycle lives here: `attacked` once a hit lands, the shell in flight, seen and
// pending after an accepted cast, and Charge once per shield cycle. `rejected` keeps each landing
// the server refused, so this escape tries it no more.
export interface EscapeLocal {
  id: string; landed: boolean; error: string | null; rejected: Record<string, boolean>;
  trying?: string | null; destination?: { map: string; in?: string; server?: string; x: number; y: number } | null;
  recoveryBlinked?: boolean; blinkFailed?: boolean; readyForPort?: string | null; ported?: string;
  portSent?: string; portEnded?: string; portFailed?: { stage: string; reason: string };
  attacked?: boolean; shellCasting?: boolean; shellObserved?: boolean; shellCycle?: boolean;
  shellPendingUntil?: number; chargeUsed?: boolean; defenseBusy?: boolean;
}
type Request = { kind: string; owner: string };
type Ladder = { next(at: object, flags: object): { rung: string; trying: string; destination?: object; options?: object };
  waited(): void; result(outcome: object): string };
type Journey = { engine?: string; transitions?: unknown; walkingDistance?: unknown; remaining?: unknown };
// The movement service on the character (runtime/movement/character/owner.ts), which shared.js
// hands in: the escape's ladder, holds, crossings and steps are its calls.
export interface EscapeMovement {
  release(owner: string): void; endClimb(owner: string): void; climb(owner: string, round: unknown, activity: string): Ladder;
  climbing(): { activity?: string; trying?: string; notice?: { text: string; incident: unknown } } | null;
  last(): Journey | null | undefined; step(point: Point, mode: string): { sent: Promise<unknown> };
  magiport(request: object, name: string): Promise<unknown>; acceptMagiport(request: object, name: string): Promise<unknown>;
  stop(kind: string, ignored: undefined, request: Request): Promise<unknown>;
}
interface Socket { on?(event: string, listener: (data: unknown) => void): void; off?(event: string, listener: (data: unknown) => void): void }
// What the escape reads from shared.js, the character's composition root: movement's service and
// requesters, the party's reports, the realm and the lifecycle owner's Pause (table P1). The events owner's marker and Goo Brawl exit
// are asked of api.ts `eventFacts()`.
export interface EscapePorts {
  current(): boolean;
  movement(): EscapeMovement;
  blinkAs(request: Request, x: number, y: number): Promise<unknown>;
  timed<T>(request: T): T;
  holdIdle(request: Request): void;
  nextReport(): Promise<unknown>;
  reportGap(): number;
  sleep(ms: number): Promise<unknown>;
  smartMove(destination: object, callback: undefined, options: object): Promise<unknown>;
  realm(): string;
  // The party's reports (the targeting owner's `targeting.positions`), each with the member's own escape record.
  reports(): readonly { name: string; escape?: { id?: string; readyForPort?: string | null } }[];
  socket(): Socket | undefined;
  // The survival owner's run scope handle, `act`: its listeners and timers wait while
  // table P holds the character, and the generation's stop removes them, so no record of them is kept on
  // the game window.
  scope: SurvivalScope;
  notify(hook: 'survival.escapeMember', payload: Record<string, unknown>): void;
}
// What the role runner's install adopts into the record: the spends, Scare's due test, the respawn
// and the survival ring (registrations.ts `installSurvival`).
export interface EscapeAdopted {
  spends: EscapeSpends;
  scareDue(): boolean;
  respawn(by: string): Promise<void>;
  ring(entry: SurvivalEntry): void;
}

// A skill's MP after `mp_reduction`, the escape's budgets' unit.
export function escapeCost(skill: string): number {
  const def = (G.skills as unknown as Record<string, { mp?: number } | undefined>)[skill] ?? {};
  return Math.max(0, Number(def.mp || (skill === 'heal' ? character.mp_cost : 0)) || 0) *
    (100 - (Number((character as { mp_reduction?: number }).mp_reduction) || 0)) / 100;
}
// A crossing the mage may cast now: the Blink and Magiport are movement's calls, which the
// game's own cooldown and class checks gate.
function crossingReady(skill: string): boolean {
  return !!(G.skills as unknown as Record<string, unknown>)[skill] && character.mp >= escapeCost(skill) && !is_on_cooldown(skill as never) && can_use(skill as never);
}
const reason = (error: unknown) => { const e = error as { reason?: unknown; message?: unknown } | undefined; return String(e && (e.reason || e.message) || error); };
type Monster = { type?: string; visible?: boolean; dead?: boolean; x: number; y: number; range?: number; target?: string; s?: Record<string, unknown> };
const monsters = () => Object.values((parent as unknown as { entities?: Record<string, Monster> }).entities ?? {})
  .filter(e => !!e && e.type === 'monster' && !!e.visible && !e.dead);

export function createEscape(ports: EscapePorts) {
  let state: EscapeState | null = null, local: EscapeLocal | null = null, adopted: EscapeAdopted | null = null;
  // The Blink's and the Magiport's landing spots, as the server put them (`s.blink`, `s.magiport`,
  // node/server.js:10842-10846 and :5427-5430). The server clears each condition 200 ms and 400 ms
  // after it sets it (14776-14803), so the escape keeps the spot from the `player` emit that
  // carries it and never reads `character.s` at the step (recheck R2).
  let blinkSpot: Spot | null = null, portSpot: Spot | null = null;
  const owns = () => !!state && character.ctype !== 'merchant';
  const stageOf = () => owns() ? state!.stage : null;
  const own = (id: string) => ({ kind: 'escape', owner: 'escape:' + id });
  const tell = (change: 'joined' | 'stage' | 'left', of: EscapeState) => ports.notify('survival.escapeMember', { character: character.name, id: of.id, stage: of.stage,
    change, landed: !!local?.landed, ported: local?.ported ?? null, blinkFailed: !!local?.blinkFailed, portFailed: local?.portFailed ?? null, by: 'core:survival' });
  // The report reply's escape (shared.js `applyEscape`). A new escape gets a fresh local record; a
  // released one ends only its own journey or hold and its ladder, so a player command that released
  // it keeps the journey it started. A new escape, and a stage change into one where the
  // character walks or holds alone, end its other travel and stop it under the escape's identity:
  // movement's character half and targeting reset their own state on the notice,
  // and the stops settle before the reply's next apply runs. Each stage change writes the ring.
  async function apply(next: EscapeState | null): Promise<void> {
    const old = state, was = stageOf();
    state = next;
    if (was !== stageOf()) adopted?.ring({ decision: 'escape', stage: stageOf() });
    if (!next) {
      local = null;
      if (old) { ports.movement().release('escape:' + old.id); ports.movement().endClimb('escape:' + old.id); tell('left', old); }
      return;
    }
    if (old && old.id !== next.id) tell('left', old);
    if (!old || old.id !== next.id) { local = { id: next.id, landed: false, error: null, rejected: {} }; blinkSpot = null; portSpot = null; }
    if (!escapeResets(old, next)) {
      if (old && old.stage !== next.stage) tell('stage', next);
      return;
    }
    if (state !== next || !ports.current()) return;
    tell(!old || old.id !== next.id ? 'joined' : 'stage', next);
    try { await ports.movement().stop('smart', undefined, own(next.id)); } catch { /* A refused stop leaves the escape's own walk to replace it. */ }
    try { await ports.movement().stop('move', undefined, own(next.id)); } catch { /* As above. */ }
  }
  // The Town or exit landing for the Blink (shared.js `escapeLanding`): the map's first spawn on an
  // outdoor town map, the transporter, and a point off each door's edge; the clear candidates the
  // server has not refused in this escape, least monster risk first, then Town, then nearest.
  function landing(): (Point & { town: boolean }) | undefined {
    const map = (G.maps as unknown as Record<string, { outside?: boolean; event?: unknown; npcs?: { id: string; position?: number[] }[]; spawns?: number[][]; doors?: unknown[][] }>)[character.map] ?? {};
    const candidates: (Point & { town: boolean; risk?: number; distance?: number })[] = [];
    const transporter = (map.npcs ?? []).find(npc => npc.id === 'transporter');
    if (map.outside && !map.event && transporter && map.spawns?.[0]) candidates.push({ x: map.spawns[0][0], y: map.spawns[0][1], town: true });
    if (transporter && Array.isArray(transporter.position)) candidates.push({ x: transporter.position[0], y: transporter.position[1] + ESCAPE_STEP, town: false });
    for (const door of map.doors ?? []) {
      if (!Array.isArray(door)) continue;
      const [x, y, width, height] = door as number[];
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      // The landing sits off the door's edge by half its size (game data's width and height after
      // x and y) plus movement's arrival tolerance, so it never lands on the portal.
      const dx = (Number(width) || 0) / 2 + ARRIVAL_TOLERANCE, dy = (Number(height) || 0) / 2 + ARRIVAL_TOLERANCE;
      for (const [ox, oy] of [[0, dy], [0, -dy], [dx, 0], [-dx, 0]]) candidates.push({ x: x + ox, y: y + oy, town: false });
    }
    const enemies = monsters();
    const clear = candidates.filter(p => !local?.rejected[p.x + ',' + p.y] &&
      (typeof can_move !== 'function' || can_move({ map: character.map, x: p.x, y: p.y, going_x: p.x, going_y: p.y, base: (character as { base?: unknown }).base } as never)));
    for (const p of clear) {
      // G gives every monster its `range`, so its reach is game data.
      p.risk = enemies.reduce((risk, e) => risk + Math.max(0, Number(e.range) + LANDING_MARGIN - Math.hypot(e.x - p.x, e.y - p.y)), 0);
      p.distance = Math.hypot(character.x - p.x, character.y - p.y);
    }
    clear.sort((a, b) => a.risk! - b.risk! || Number(b.town) - Number(a.town) || a.distance! - b.distance!);
    // P2: an add-on may pick another clear landing.
    return clear[0] && chosen('landing', clear, clear[0]);
  }
  // The point one retreat step ahead of a moving character (shared.js `escapeForwardPoint`).
  function forwardPoint(): Point | null {
    const step = ESCAPE_STEP, direction = [[0, step], [-step, 0], [step, 0], [0, -step]][Number(character.direction)];
    return character.moving && direction ? { x: character.x + direction[0], y: character.y + direction[1] } : null;
  }
  const walks = (s: EscapeState) => Array.isArray(s.walk) && s.walk.includes(character.name);
  // Migration steps 3 and 8a: with a home goal from the
  // coordinator, each step runs one rung of movement's ladder until the character stands home. No
  // count ends the walk, and the report names the rung it is on. Between rungs and while it waits
  // for a report, the escape holds the character.
  async function walkHome(s: EscapeState, l: EscapeLocal, current: () => boolean): Promise<void> {
    const home = s.home!, request = own(s.id);
    // An event area (K1 `targets.area`, Goo Brawl) is left through K7's exit before the ladder walks.
    const mapEvent = (G.maps as unknown as Record<string, { event?: unknown }>)[character.map]?.event, area = eventKey(mapEvent);
    if (area?.targets.area) { l.trying = 'leaving ' + area.label; await eventFacts().exitGoobrawlForRecovery(current, request); return; }
    // Queue AV: the team does not Town out of an event.
    // E05-06b: the walk home asks K7's derived marker and the event exit's state.
    const events = eventFacts(), townAllowed = !events.eventTravelling() && !events.exitRunning() && !mapEvent;
    const ladder = ports.movement().climb(request.owner, survivalRound(G as never), 'Regrouping after escape');
    const attempt = ladder.next({ map: character.map, in: character.in, x: character.x, y: character.y }, { townAllowed });
    l.trying = attempt.trying;
    if (attempt.rung === 'wait') {
      // The hold lasts the `walk` reading's age (A20, two report intervals), the longest this waits
      // for one report. A report that does not come in that time is a lost report: it tells the status owner's
      // bound record, and the next step asks the ladder again.
      ports.holdIdle(request);
      const waitMs = ageOf({ reading: 'walk', attackerKnown: false, intervalMs: ports.reportGap() });
      const reported = await Promise.race([ports.nextReport().then(() => true), ports.sleep(waitMs).then(() => false)]);
      if (!reported) boundFired({ bound: 'escapeWalkReportWait', owner: '05', state: { escape: s.id, ms: waitMs } });
      if (current() && reported) ladder.waited();
      return;
    }
    let arrived = false;
    const before = ports.movement().last();
    try { await ports.smartMove(attempt.destination || { map: home.map, x: home.x, y: home.y }, undefined, { request, ...attempt.options }); arrived = !attempt.destination; }
    catch (error) { l.error = reason(error); }
    if (!current()) return;
    // A walk that never started leaves the previous journey as the last one.
    const last = (ports.movement().last() !== before && ports.movement().last()) || {} as Journey;
    const outcome = ladder.result({ arrived: arrived && isSafeAt(home as never, character as never),
      at: { map: character.map, in: character.in, x: character.x, y: character.y }, engine: last.engine,
      planned: last.transitions === undefined ? undefined : { transitions: last.transitions, walking: last.walkingDistance }, remaining: last.remaining });
    if (outcome !== 'failed') l.error = null;
    // The next rung starts on the next step; the hold covers the character until then.
    if (outcome === 'arrived') ports.movement().endClimb(request.owner); else ports.holdIdle(request);
  }
  // The step's survival half (shared.js `escapeSurvivalPulse`): potions, and the warrior's defence or
  // the priest's heal, while the character walks or holds alone.
  async function survivalHalf(): Promise<void> {
    const s = state, spends = adopted?.spends;
    if (!s || !spends || !owns() || character.rip || !(['recovering', 'recovery-convoy', ...ESCAPE_SETTLED] as string[]).includes(s.stage) && !walks(s)) return;
    const current = () => ports.current() && state?.id === s.id && !character.rip;
    if (local) await spends.potion(local);
    if (!current()) return;
    // An escape with no safe goal (no game data on the coordinator) holds where it stands.
    const safe = !!s.home && isSafeAt(s.home as never, character as never);
    if (character.ctype === 'warrior' && !safe) await spends.warriorDefense(forwardPoint());
    else if (character.ctype === 'priest') await spends.heal();
  }
  // A member stands beside the mage once it lands on the spot the server's Magiport put it, or, when
  // it walked, within the arrival tolerance plus the largest Magiport offset of the mage's landing
  // (server_functions.js:4070-4090, recheck R2).
  function arrivedBesideMage(s: EscapeState): boolean {
    const d = s.destination;
    if (!d || character.map !== d.map || character.in !== d.in) return false;
    if (portSpot && portSpot.map === character.map && Math.hypot(character.x - portSpot.x, character.y - portSpot.y) <= ARRIVAL_TOLERANCE) return true;
    return Math.hypot(character.x - d.x, character.y - d.y) <= ARRIVAL_TOLERANCE + MAGIPORT_OFFSET;
  }
  // The step's stage half (shared.js `escapePulse`): the walk home, the mage's Blink and Magiports,
  // and the member's wait for its port with its spends and its retreat step.
  async function stageHalf(): Promise<void> {
    if (!owns() || !local) return;
    const s = state!, l = local, spends = adopted?.spends;
    const current = () => ports.current() && state?.id === s.id && state.stage === s.stage && local === l;
    try {
      if ((['recovery-convoy', ...ESCAPE_SETTLED] as string[]).includes(s.stage)) return;
      // D4: a jacko's Scare goes before the Blink, the Magiport and the walk; survival's request
      // sends it on the role loop's next pass.
      if (adopted?.scareDue()) { l.error = 'Scaring the monsters on it before leaving'; return; }
      if (s.stage === 'recovering' || walks(s)) {
        if (character.rip) {
          // The one respawn answers `not-now` while one is in flight or the server's wait runs.
          await adopted?.respawn('escape').catch(() => undefined);
          return;
        }
        if (isSafeAt(s.home as never, character as never)) {
          l.trying = null; ports.movement().release('escape:' + s.id); ports.movement().endClimb('escape:' + s.id);
          return;
        }
        // A failed group rescue does not stop survivors: each still escapes.
        if (character.ctype === 'mage' && !l.recoveryBlinked && crossingReady('blink') && spends) {
          const point = landing();
          if (point) {
            l.recoveryBlinked = true;
            try { await spends.crossing(ports.blinkAs(own(s.id), point.x, point.y), 'blink'); }
            catch (error) { l.error = reason(error); }
          }
          if (!current()) return;
        }
        await walkHome(s, l, current);
        return;
      }
      if (character.rip || !spends) return;
      if (character.ctype !== 'mage' && arrivedBesideMage(s)) return;
      await spends.potion(l);
      if (!current()) return;
      if (character.ctype === 'mage') {
        if (s.stage === 'blink') {
          // The mage has landed where the server put its Blink (recheck R2).
          if (blinkSpot && l.destination && character.map === blinkSpot.map &&
              Math.hypot(character.x - blinkSpot.x, character.y - blinkSpot.y) <= ARRIVAL_TOLERANCE) { l.landed = true; l.error = null; return; }
          // A mage that cannot Blink leaves every member to the walk; a cooldown waits.
          if (character.mp < escapeCost('blink')) { l.error = 'Blink needs more MP'; l.blinkFailed = true; return; }
          if (!crossingReady('blink')) { l.error = 'Waiting for Blink cooldown'; return; }
          const point = landing();
          if (!point) { l.error = 'No valid Town or exit landing on ' + character.map; l.blinkFailed = true; return; }
          l.destination = { map: character.map, in: character.in, server: ports.realm(), x: point.x, y: point.y };
          try { await spends.crossing(ports.blinkAs(own(s.id), point.x, point.y), 'blink'); }
          catch (error) { if (current()) { l.rejected[point.x + ',' + point.y] = true; l.error = reason(error); } }
        } else {
          // One `port:<member>` stage per participant. A port the mage's MP cannot cover, or one
          // the server refused or never answered, ends that member's stage: it walks home.
          const name = s.stage.startsWith('port:') ? s.stage.slice(5) : null, member = ports.reports().find(p => p.name === name);
          // The server charges Magiport's MP when it sends the offer, so a sent port waits for its
          // crossing before the MP check reads the spent MP as a port it cannot cover.
          if (!name || l.portEnded === s.stage || l.portSent === s.stage) return;
          if (character.mp < escapeCost('magiport')) { l.portEnded = s.stage; l.portFailed = { stage: s.stage, reason: 'Magiport needs more MP' }; return; }
          if (!member?.escape || member.escape.id !== s.id || member.escape.readyForPort !== s.stage) { l.error = 'Waiting for ' + name + ' to accept rescue'; return; }
          if (!crossingReady('magiport')) { l.error = 'Waiting for Magiport cooldown'; return; }
          l.portSent = s.stage;
          try { await spends.crossing(ports.movement().magiport(ports.timed(own(s.id)), name), 'magiport'); l.error = 'Waiting for ' + name + ' arrival'; }
          catch (error) { l.portEnded = s.stage; l.portFailed = { stage: s.stage, reason: reason(error) }; }
        }
        return;
      }
      l.readyForPort = s.stage === 'port:' + character.name ? s.stage : null;
      if (character.ctype === 'warrior') await spends.warriorDefense(forwardPoint());
      if (!current()) return;
      if (character.ctype === 'priest') {
        // The escape Curse goes only after a heal that did not land or was not needed.
        const healed = await spends.heal();
        if (!current()) return;
        const threat = monsters().find(e => (s.participants ?? []).includes(String(e.target)) && !(e.s && e.s.cursed) && is_in_range(e as never, 'curse' as never));
        if (!healed && threat) await spends.curse(threat);
      }
      if (!current() || character.moving) return;
      const enemy = monsters().sort((a, b) => Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y))[0];
      if (!enemy) return;
      const step = ESCAPE_STEP;
      const point = [[step, 0], [-step, 0], [0, step], [0, -step]].map(([dx, dy]) => ({ x: character.x + dx, y: character.y + dy }))
        .filter(p => can_move_to(p.x, p.y))
        .sort((a, b) => Math.hypot(b.x - enemy.x, b.y - enemy.y) - Math.hypot(a.x - enemy.x, a.y - enemy.y))[0];
      if (!point) { l.error = 'Retreat blocked by terrain'; return; }
      // The retreat is a combat step: step safety judges it (design section 2.4).
      if (!await spends.warriorDefense(point) && current()) Promise.resolve(ports.movement().step(point, 'escape-retreat').sent).catch(() => undefined);
    } catch (error) { if (current()) l.error = reason(error); }
  }
  // The step runs on each `skills.passed` of the turns owner's role loop, the console Pause asked once at
  // its start (table P1). Each half runs one at a time: an event that comes while it runs is skipped,
  // and a half that ends on another escape or stage than it began with runs once more at once, so a
  // stage that changed mid-run never waits for the next event. The two halves run side
  // by side, as today's two pulses did, since the walk half awaits a whole walk while the survival
  // half keeps drinking and defending.
  const running = { survival: false, stage: false };
  function runHalf(name: 'survival' | 'stage', half: () => Promise<void>): Promise<void> {
    if (running[name]) return Promise.resolve();
    running[name] = true;
    const began = state && state.id + ':' + state.stage;
    // A half's error lands in the local record the status report carries, as stageHalf's own catch
    // writes it, so the step never rejects.
    return half().catch((error: unknown) => { if (local && ports.current()) local.error = reason(error); }).finally(() => {
      running[name] = false;
      if (state && state.id + ':' + state.stage !== began && ports.current()) void runHalf(name, half);
    });
  }
  // The step runs from the escape pulse, an `act` timer that table P holds, and each half's calls ask
  // the band's held row, so the step reads no Pause of its own.
  function step(): Promise<void> {
    if (!ports.current() || !owns()) return Promise.resolve();
    return Promise.all([runHalf('survival', survivalHalf), runHalf('stage', stageHalf)]).then(() => undefined);
  }
  // The member's Magiport accept (shared.js `reunionCm`'s escape branch, E02-s4): true when the
  // escape owns the character, whether or not it accepts this offer, so the reunion's own accept
  // never takes an escape's offer.
  function acceptPort(name: string): boolean {
    if (!owns()) return false;
    const s = state!;
    if (name !== s.leader || s.stage !== 'port:' + character.name || !local || local.readyForPort !== s.stage) return true;
    Promise.resolve(ports.movement().stop('smart', undefined, own(s.id))).then(() => {
      if (state?.id === s.id && state.stage === s.stage && !character.rip)
        return ports.movement().acceptMagiport(ports.timed(own(s.id)), name).then(() => {
          // The accepted Magiport's reply names the port stage it ended: the coordinator moves
          // on from it, wherever the member steps after it lands.
          if (local && state?.id === s.id) local.ported = s.stage;
        });
    }).catch(error => { if (local) local.error = reason(error); });
    return true;
  }
  // The Blink's and the Magiport's spots from the `player` emit that carries them (recheck R2): a
  // Blink spot counts only once this escape sent its Blink.
  const onPlayer = (data: unknown) => {
    const d = data as { s?: Record<string, { x?: unknown; y?: unknown } | undefined>; map?: string } | null;
    if (!d?.s || !owns()) return;
    const spot = (c: { x?: unknown; y?: unknown } | undefined): Spot | null => c && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)) ?
      { x: Number(c.x), y: Number(c.y), map: String(d.map ?? character.map) } : null;
    if (d.s.blink && local?.destination) blinkSpot = spot(d.s.blink) ?? blinkSpot;
    if (d.s.magiport) portSpot = spot(d.s.magiport) ?? portSpot;
  };
  function listen(): void {
    ports.scope.on(ports.socket(), 'player', onPlayer);
  }
  return {
    owns, apply, step, landing, acceptPort, listen, forwardPoint,
    // `survival.escaping` on the character (recheck R1): the escape that owns this
    // character, its stage and the one command purpose it lets through, `escape-recovery` in
    // `recovery-convoy`. A merchant is never owned, today's `escapeOwns` rule.
    answer(name: string): EscapeHold | undefined {
      if (name !== character.name || !owns()) return undefined;
      return { id: state!.id, stage: state!.stage, admits: escapeAdmits(state!.stage), ...escapeLabel(state!.stage, local?.trying) };
    },
    // The character's own record for its status report (report.ts), a merchant's included.
    record: () => local,
    // The stage while the escape owns the character, else null.
    stage: stageOf,
    // The death recovery leaves the respawn to the escape while the party recovers (shared.js
    // `escapeOwnsRevival`).
    ownsRevival: () => stageOf() === 'recovering',
    // What movement's climber does, for the card: the activity, the rung in plain words and,
    // after a rung with no progress, the stuck notice and its record's id (shared.js
    // `movementClimbReport`).
    climbReport() {
      const climb = ports.movement().climbing();
      return climb && { activity: climb.activity || null, trying: climb.trying || null,
        notice: climb.notice ? climb.notice.text : null, incident: climb.notice ? climb.notice.incident : null };
    },
    adopt(next: EscapeAdopted | null) { adopted = next; },
    // The runtime's stop (the lifecycle owner's `stop`, E13-s1): the record resets with the frame.
    stop() { state = null; local = null; },
  };
}
export type Escape = ReturnType<typeof createEscape>;

// The escape's spends: its potions, the warrior's Hardshell, Charge, Dash and Stomp, the
// priest's heal and Curse, and the lost-reply rule for the mage's Blink and Magiport. Each spend is
// a push into the turns executor at rank `survival`, so it asks the call budget and joins its
// family's one flight (X5 to X7); the push settles with the server's reply.
interface Turns { spend(ask: SpendAsk<Target> & { by: string }): Promise<unknown>; ready(skill: string): Readiness }
export interface SpendPorts {
  turns(): Turns | undefined;
  scope: SurvivalScope;
  // The largest round trip of the last 4 s (the call budget's margin).
  margin(): number;
  // "Heal first below" as the last report reply delivered it (the turns owner's A7 setting), which the escape
  // reads through the turns owner's one default.
  healFirstBelow(): unknown;
  // The escape's record while it owns the character, and whether it still does.
  local(): EscapeLocal | null;
  current(): boolean;
  // The survival ring (records.ts): a refused spend.
  ring?(entry: SurvivalEntry): void;
}

export function createEscapeSpends(ports: SpendPorts, needs: Pick<Needs, 'escapePotion' | 'healChoice' | 'channelling'>) {
  const skills = () => G.skills as unknown as Record<string, { mp?: number; duration?: number; cooldown?: number } | undefined>;
  // A skill the escape may spend now: its family ready on the turns owner and its MP covered.
  function ready(skill: string): boolean {
    const answer = ports.turns()?.ready(skill);
    return !!skills()[skill] && !!answer?.ready && character.mp >= escapeCost(skill);
  }
  function push(skill: string, target?: unknown): Promise<unknown> {
    const turns = ports.turns();
    if (!turns) return Promise.reject({ reason: 'turns stopped' });
    const sent = turns.spend({ skill, ...(target ? { targets: [target as Target] } : {}), rank: 'survival', category: 'survival',
      reason: 'escape ' + skill, by: 'core:survival/escape' });
    sent.catch((error: { reason?: unknown } | undefined) => ports.ring?.({ decision: 'refused', skill, reason: String(error?.reason ?? error) }));
    return sent;
  }
  function shielded(local: EscapeLocal): boolean {
    if (local.shellCasting) return true;
    if (character.s && (character.s as Record<string, unknown>).hardshell) { local.shellObserved = true; local.shellCycle = true; return true; }
    // An accepted cast can resolve before its condition reaches the client.
    return !!local.shellPendingUntil && !local.shellObserved && Date.now() < local.shellPendingUntil;
  }
  // The potion rows of the escape: MP up to the class budget, after HP below its
  // line. The budgets are today's: the warrior keeps Hardshell and two Dashes (its whole MP
  // while shielded), the priest its Curse, partyheal and heal, the rest their whole MP. A potion's
  // `equip` ends a Town channel (server.js:7657), so none goes while one is cast or channelled.
  async function potion(local: EscapeLocal): Promise<void> {
    if (character.rip || !ports.current() || needs.channelling()) return;
    const budget = character.ctype === 'warrior' ? (shielded(local) ? character.max_mp : escapeCost('hardshell') + 2 * escapeCost('dash'))
      : character.ctype === 'priest' ? escapeCost('curse') + escapeCost('partyheal') + escapeCost('heal') : character.max_mp;
    const core = needs.escapePotion(budget);
    // P2: an add-on may pick the other potion; it never skips core's.
    const skill = core && chosen('escapeSpend', ['use_hp', 'use_mp'] as const, core);
    if (skill) await push(skill).catch(() => undefined);
  }
  // Charge once per shield cycle, set only after the server accepts it.
  async function charge(local: EscapeLocal): Promise<void> {
    if (!ports.current() || character.rip || ports.local() !== local || local.chargeUsed || shielded(local) || !ready('charge')) return;
    try {
      await push('charge');
      if (ports.current() && ports.local() === local) local.chargeUsed = true;
    } catch { /* A refused Charge tries again on a later step; the retreat goes on. */ }
  }
  // The warrior's defence: a Stomp as a shield cycle ends, Hardshell once attacked,
  // then Charge and Dash toward the retreat point. True when it took the step's movement.
  async function warriorDefense(point: Point | null): Promise<boolean> {
    const local = ports.local();
    if (character.ctype !== 'warrior' || character.rip || !local || !ports.current()) return false;
    if (local.defenseBusy) return true;
    local.defenseBusy = true;
    const still = () => ports.current() && ports.local() === local && !character.rip;
    try {
      if (shielded(local)) return false;
      const shieldEnded = !!local.shellCycle;
      if (shieldEnded) {
        local.shellCycle = false; local.shellPendingUntil = 0; local.shellObserved = false; local.chargeUsed = false;
        const weapon = (character.slots as unknown as Record<string, { name: string } | null> | undefined)?.mainhand;
        const basher = !!weapon && (G.items as unknown as Record<string, { wtype?: string }>)[weapon.name]?.wtype === 'basher';
        const nearby = monsters().some(e => is_in_range(e as never, 'stomp' as never));
        // The stun is optional; a refused Stomp leaves the escape going.
        if (basher && nearby && ready('stomp')) await push('stomp').catch(() => undefined);
        if (!still()) return true;
      }
      // Hardshell goes when its family is ready, which holds a refused cast for one round trip
      //. An accepted shell is pending for game data's duration; with none,
      // nothing is pending and the condition itself shows it.
      if (!shieldEnded && local.attacked && ready('hardshell')) {
        local.shellCasting = true;
        try {
          await push('hardshell');
          if (!still()) return true;
          local.shellCycle = true;
          local.shellObserved = !!(character.s && (character.s as Record<string, unknown>).hardshell);
          const duration = Number(skills().hardshell?.duration);
          local.shellPendingUntil = Number.isFinite(duration) && duration > 0 ? Date.now() + duration : 0;
          return false;
        } catch { /* A refused shield must not prevent the retreat. */ }
        finally { local.shellCasting = false; }
      }
      if (!still() || shielded(local)) return true;
      if (!point || character.s && (character.s as Record<string, unknown>).dash || !can_move_to(point.x, point.y)) return false;
      await charge(local);
      if (!still() || shielded(local)) return true;
      if (!ready('dash')) return false;
      const reserve = escapeCost('hardshell') + 2 * escapeCost('dash');
      if (!local.attacked && character.mp - escapeCost('dash') < reserve) return false;
      character.direction = point.x !== character.x ? (point.x < character.x ? 1 : 2) : (point.y < character.y ? 3 : 0);
      // Dash goes in the character's direction, as today's `use_skill("dash")`.
      try { await push('dash'); return true; }
      catch { return false; }
    } finally { local.defenseBusy = false; }
  }
  // The escape heal (3.4): the priest's one heal choice, the same lines as the role loop and the
  // pulse, pushed. True only when a heal or partyheal landed. The heal choice
  // holds while a Town cast is in flight or channelled (needs.ts `channelling`).
  async function heal(): Promise<boolean> {
    if (character.ctype !== 'priest' || character.rip) return false;
    const choice = needs.healChoice({ healFirstBelow: healFirstBelowOf(ports.healFirstBelow()), regularOnly: false });
    if (!choice) return false;
    try { await push(choice.skill, choice.target); return true; }
    catch { return false; }
  }
  // The escape Curse on a monster that targets a participant, after a heal that did not land. A
  // Curse is an attack, which ends a Town channel (server.js:3519).
  async function curse(threat: unknown): Promise<void> {
    if (!needs.channelling() && ready('curse')) await push('curse', threat).catch(() => undefined);
  }
  // A hit on the warrior starts its shield cycle (shared.js `escapeObserveHit`).
  function observeHit(data: { id?: unknown; target?: unknown; heal?: unknown; damage?: unknown; evade?: unknown; miss?: unknown } | null): void {
    const local = ports.local();
    if (!local || character.ctype !== 'warrior' || character.rip || !data) return;
    const target = String(data.id || data.target || '');
    if (target !== character.name && (!character.id || target !== String(character.id))) return;
    if (!data.heal && (Number(data.damage) > 0 || data.evade || data.miss)) local.attacked = true;
  }
  // The mage's Blink and Magiport are movement's crossings; each settles on its reply, and a
  // reply that never comes counts lost after the skill's cooldown and the largest round trip of the
  // last 4 s: the call budget's margin and the skill family's own reply
  // times, which `skills.ready` names. A lost reply tells the status owner's bound record.
  function crossing<T>(sent: Promise<T>, skill: string): Promise<T> {
    const waitMs = Math.max(0, Number(skills()[skill]?.cooldown) || 0) + Math.max(ports.margin(), ports.turns()?.ready(skill).margin ?? 0);
    let timer: number | undefined;
    const lost = new Promise<never>((_, reject) => {
      timer = ports.scope.setTimeout(() => reject({ reason: 'lost reply' }), waitMs);
    });
    const reported = lost.catch((error: unknown) => { boundFired({ bound: 'crossingLostReply', owner: '05', state: { skill, ms: waitMs } }); throw error; });
    return Promise.race([sent, reported]).finally(() => ports.scope.clearTimeout(timer));
  }
  return { ready, use: push, shielded, potion, charge, warriorDefense, heal, curse, observeHit, crossing };
}
export type EscapeSpends = ReturnType<typeof createEscapeSpends>;
