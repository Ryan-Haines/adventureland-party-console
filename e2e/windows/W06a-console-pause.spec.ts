import {expect, plantVitals, type LiveGame} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {safeReloadRow, toReloadSpot} from '../console-reload-rows';
import {red, tc13Heal, tc13tc15Verdict, tc15Play} from '../turns-rows';
import {porcupineTargetCall} from '../targeting-rows';
import {settleNavigation} from '../movement-owner-helpers';
import {MOVEMENT_HOOKS_ADDON, addonSwitches, characterSeen, registerCharacterHalf, type Seen} from '../fixtures/movement-hooks-addon';

// W06a The console Pause in a fight (test-windows DESIGN.md 2.2 W06, split in DEVIATIONS.md). One
// play with the browser priest: the trio stands on the reload spot of Main, the party travels to
// the map's first spawn and the player presses Pause while the travel's journey is live, then
// Play; back on the reload spot the pair fights a planted goo, a safe reload lease finishes the
// fight without taking the next goo, then the player presses Pause again: nobody moves or attacks,
// the paused priest heals the warrior below its MP cost (TC13), an injured warrior recovers
// nothing and a dead one stays dead, a deploy and a coordinator restart keep the Pause, Play
// lifts it, a clean shutdown resumes once, and a CODE reload follows; last, the trio on Manual in
// the town square spends one call of each executor method (TC15) and the warrior's target call on
// a porcupine asks the call budget (TG8).
// Failure modes: C33 and C34, the movement hooks are not told of a journey's pause and resume;
// E64, a Pause lets a character act, or a deploy, restart or shutdown loses it; T44, the server
// refuses the heal below mp_cost, or an executor call's ledger entry differs from the server's.
// E64's and TC15's steps are the play's own: each stands on the one before it, so a failed step
// ends the play and the runner marks every check not observed, with that step's message.
// Every old spec this window cites is at 21fe30a2b.
const [W, P, M] = ['E2EWarrior', 'E2EPriest', 'E2EMerchant'];
const pause: {seen: Seen[]} = {seen: []}, t44: any = {};
const heard = (seen: Seen[], hook: string) => seen.filter(s => s.hook === hook).map(s => s.payload as Record<string, unknown>);
const seenW = async (live: LiveGame, since = 0) => await live.clients[W]!.run(characterSeen(since)) as Seen[];
const askW = async (live: LiveGame, hook: string) => await live.clients[W]!.run(`globalThis.__partyHooks.ask(${JSON.stringify(hook)})`);
// The planted break of C33 and C34 (E2E_TURNS_RED=c33): the fixture's record drops every
// journey.paused and journey.resumed it hears.
const deafToPause = `(()=>{const s=globalThis.__movementHooksFixture.seen;s.push=function(...e){return Array.prototype.push.apply(this,e.filter(x=>!/^journey\\.(paused|resumed)$/.test(x.hook)));};return true;})()`;

async function consolePausePlay(live: LiveGame, info: LiveWorld['info']) {
  // The movement hooks fixture add-on, character half on both fighters: it only records until a
  // row sets an answer, and W06a sets none.
  for (const name of [W, P]) { await settleNavigation(live.clients[name]!, name); expect(await live.clients[name]!.run(registerCharacterHalf)).toEqual({ok: true}); }
  await live.post('/settings', {changes: [{field: 'addons', value: await live.clients[W]!.run(addonSwitches(true))}]});
  for (const name of [W, P])
    await expect.poll(async () => live.clients[name]!.run(`globalThis.__partyHooks.enabled(${JSON.stringify(MOVEMENT_HOOKS_ADDON)})`), {timeout: 15_000}).toBe(true);
  await toReloadSpot(live);
  // A Pause and Play under a travel (C33, C34). The travel goes to the map's first spawn; the
  // Pause waits for the travel's journey away from the reload spot, while it is live
  // (live-movement-hooks.spec.ts found the assemble journey to the rally point ends within 600 ms).
  const here = await live.clients[W]!.run('({map:character.map,x:character.real_x,y:character.real_y})') as {map: string; x: number; y: number};
  const [x, y] = await live.clients[W]!.run(`G.maps[${JSON.stringify(here.map)}].spawns[0]`) as number[];
  const travelled = await live.clients[W]!.run('Date.now()') as number;
  await live.post('/travel', {map: here.map, x, y});
  const away = (d: unknown) => { const p = d as {x?: number; y?: number} | undefined; return !!p && Math.hypot(Number(p.x) - here.x, Number(p.y) - here.y) > 50; };
  await expect.poll(async () => heard(await seenW(live, travelled), 'journey.started').some(j => away(j.destination)) &&
    (await askW(live, 'movement.live') as {journey?: boolean} | null)?.journey === true, {timeout: 30_000, message: "the travel's journey away from the reload spot is live"}).toBe(true);
  // The play waits on the movement ring's own pause and resume entries, which the notices are told
  // from (movement/character/owner.ts `announce`), so C33 and C34 judge the notices alone and a
  // lost notice fails its check, not the play.
  if (red('c33')) await live.clients[W]!.run(deafToPause);
  const ringFrom = await live.clients[W]!.run('Math.max(0,...__partyMovement.records().map(r=>r.seq))') as number;
  const ringHas = (decision: string) => live.clients[W]!.run(`__partyMovement.records().some(r=>r.seq>${ringFrom}&&r.decision===${JSON.stringify(decision)})`);
  await live.post('/console-control/pause', {});
  await expect.poll(() => ringHas('paused'), {timeout: 30_000, message: 'the journey pauses under the console Pause'}).toBe(true);
  await live.post('/console-control/play', {});
  await expect.poll(() => ringHas('resumed'), {timeout: 30_000, message: 'the journey resumes after Play'}).toBe(true);
  // The CODE reload at E64's end starts a new page registry, so the notices are kept here.
  pause.seen = await seenW(live, travelled);
  // Back on the reload spot: E64's fight, safe reload and Pause, with TC13's heal inside that Pause.
  await toReloadSpot(live);
  await safeReloadRow(live, info, false, async () => {
    await tc13Heal(live, t44);
    await plantVitals(live, P, {hp: 1, mp: 1}); await plantVitals(live, W, {hp: 1});
  });
  // TC15 and TG8 in the town square, with no focus and full vitals, so each call's quiet window
  // holds (turns-rows.ts `turnsCallCosts`, which also holds off the warrior's Warcry upkeep).
  await live.post('/focus', {monsterFocus: [], monsterPriorities: {}, monsterSearchRadius: 300});
  await live.admin(`output=(()=>{for(const [n,x] of [['${W}',0],['${P}',20],['${M}',-20]]){const p=get_player(n);transport_player_to(p,'main',[x,0]);}return true;})()`);
  for (const name of [W, P]) await expect.poll(() => live.clients[name]!.run(`character.map==='main'&&Math.hypot(character.real_x,character.real_y)<=40`),
    {timeout: 30_000, message: 'TC15: the party stands in the town square'}).toBe(true);
  await plantVitals(live, P, {hp: 1, mp: 1}); await plantVitals(live, W, {hp: 1});
  await tc15Play(live, t44);
  await porcupineTargetCall(live);
}

liveWindow({
  id: 'W06a', name: 'The console Pause in a fight',
  use: {loadout: 'combat-range'},
  // E64's row bounds: the resume after the shutdown 200 s, the clean shutdown 90 s, the fight 90 s;
  // TC15's ready waits reach 120 s a skill (live-farm-death-escape.spec.ts ran E64 in a 3,600 s table).
  timeoutMs: 1_200_000,
  async play({live, info}: LiveWorld) { await consolePausePlay(live, info); },
  observers: [
    {id: 'C33', owner: 'movement', behaviours: [], start() {}, reads: () => ({paused: heard(pause.seen, 'journey.paused')}),
      verdict() { expect(heard(pause.seen, 'journey.paused').length, 'journey.paused heard under the Pause').toBeGreaterThan(0); }},
    {id: 'C34', owner: 'movement', behaviours: [], start() {}, reads: () => ({resumed: heard(pause.seen, 'journey.resumed')}),
      verdict() { expect(heard(pause.seen, 'journey.resumed').length, 'journey.resumed heard after Play').toBeGreaterThan(0); }},
    {id: 'E64', owner: 'lifecycle', behaviours: [], start() {}, verdict() {}},
    {id: 'T44', owner: 'turns', behaviours: [], start() {}, reads: () => t44, verdict() { tc13tc15Verdict(t44); }},
  ],
});
