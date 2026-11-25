import {expect, type LiveGame} from '../live-fixtures';
import {liveWindow, type LiveObserver, type LiveWorld} from '../windows';
import {defaultCombatMode, gooRecord, gooWindowsPlay, gooWindowsVerdict} from '../movement-steps-rows';
import {farmWalkPlay, farmWalkRecord, farmWalkVerdict} from '../movement-walks-rows';
import {slotPlainRead, slotPlainStart, slotPlainVerdict} from '../turns-rows';
import {catalogStart} from '../catalog-rows';
import {settleNavigation} from '../movement-owner-helpers';
import {fighters, party} from '../game/hunt-lifecycle';
import {MOVEMENT_HOOKS_ADDON, addonSwitches, characterSeen, registerCharacterHalf, type Seen} from '../fixtures/movement-hooks-addon';
import {statusHooksSwitches, type Heard} from '../fixtures/status-hooks-addon';
import {FOLLOW_DISTANCE} from '../../runtime/movement/rules.ts';
import {SELECTION_MS} from '../turns-tc11';

// W01 Goo field measured farm (test-windows DESIGN.md 2.2). Play: the warrior and priest walk as a
// convoy from the town square to the Main goo field, farm its first minute, then farm six 120 s
// windows of game time from the first kill with both inside the box, and end on the warrior's
// movement hold. The merchant stands at its stand. Every check reads that one walk and fight: the
// walk tier, card and pace (T11), the attack rate, turns spends and call budget per window (T13),
// the priest's slot on plain farming (T43's plain half), the movement and status hooks heard by
// read-only fixture listeners (QUESTIONS.md L5), and the catalog resends (M01). TC33, TC3 and CB20
// measure rates, which a second stack lowers, so it runs alone.
// The walk's start carries T11's plants: the priest's follow journey and low vitals, the warrior's
// Hard Shell and spent Warcry (DEVIATIONS.md, W01). They end before the windows open.
// Every old spec this window cites is at 21fe30a2b.
const [W, P] = [fighters[0]!, fighters[1]!];
const walk = farmWalkRecord(), goo = gooRecord();
let since = 0, statusSince = 0, slot: Awaited<ReturnType<typeof slotPlainRead>> | null = null;
let catalog: Awaited<ReturnType<typeof catalogStart>> | null = null;
const near: {at: number; distance: number; answer: unknown}[] = [];

// The movement hooks fixture: the read-only listeners of live-movement-hooks.spec.ts's shared run.
// Its answers stay unset, so it changes no play. The shipped tank-hold add-on answers group.anchor,
// a one-answer hook, and with no tank named it answers nothing; off, it leaves the ask to the fixture.
const coordinator = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-movement-hooks', body);
const seenC = async (live: LiveGame) => await coordinator(live, {op: 'seen'}) as Seen[];
const seenW = async (live: LiveGame, since = 0) => await live.clients[W]!.run(characterSeen(since)) as Seen[];
const heard = (seen: Seen[], hook: string) => seen.filter(s => s.hook === hook).map(s => s.payload as Record<string, unknown>);
let hooksOn: Promise<void> | null = null;
const movementHooksOn = (live: LiveGame) => hooksOn ??= (async () => {
  await live.post('/addons', {name: 'tank-hold', enabled: false});
  for(const name of fighters){await settleNavigation(live.clients[name]!,name);expect(await live.clients[name]!.run(registerCharacterHalf)).toEqual({ok:true});}
  expect(await coordinator(live,{op:'register'})).toEqual({ok:true});
  await live.post('/settings',{changes:[{field:'addons',value:await live.clients[W]!.run(addonSwitches(true))}]});
  for(const name of fighters)await expect.poll(async()=>live.clients[name]!.run(`globalThis.__partyHooks.enabled(${JSON.stringify(MOVEMENT_HOOKS_ADDON)})`),{timeout:15_000}).toBe(true);
  since = await live.clients[W]!.run('Date.now()') as number;
})();
const hook = (verdict: (live: LiveGame) => Promise<void>): Omit<LiveObserver, 'id'> => ({
  owner: 'movement', behaviours: [], start: ({live}) => movementHooksOn(live), verdict: ({live}) => verdict(live),
});

// The status hooks fixture's coordinator half only: it hears every status notice and asks the
// reads. Its character half answers status.report, an answering hook, which W09 plays (L5).
const status = (live: LiveGame, body: Record<string, unknown>) => live.post('/e2e-status-hooks', body);
const statusHeard = async (live: LiveGame, since: number) => await status(live, {op: 'heard', since}) as Heard[];
const of = (list: Heard[], name: string) => list.filter(h => h.hook === name);

liveWindow({
  id: 'W01', name: 'Goo field measured farm', alone: true,
  // The play is the walk in, the first minute and six 120 s windows (DESIGN.md W01: about 7.3 min
  // with the reset and dump); the movement hooks table held the same walk and fight in 900 s.
  timeoutMs: 900_000,
  // C36 samples once per selection pass, the cadence the role runner asks its decisions at
  // (turns-tc11.ts SELECTION_MS).
  pollMs: SELECTION_MS,
  async play({live, info}: LiveWorld) {
    // The walk in plays on the fixture's Auto mode, whose farm line T11 reads. The windows play on
    // Default: Auto scatters on a learned goo, past the box the windows open in.
    await farmWalkPlay(live, info, walk);
    await defaultCombatMode(live);
    await gooWindowsPlay(live, info, goo);
    slot = await slotPlainRead(live, goo.span[P]!.from, goo.span[P]!.to);
  },
  observers: [
    {id: 'T11', owner: 'movement', behaviours: [], start() {}, verdict() { farmWalkVerdict(walk); }, reads: () => walk},
    {id: 'T13', owner: 'movement', behaviours: [], start() {}, verdict() { gooWindowsVerdict(goo); },
      reads: () => ({windows: goo.windows, budget: goo.budget, cb20: goo.cb20, hold: goo.hold, reaims: goo.reaims, lost: goo.lost})},
    {id: 'T43', owner: 'turns', behaviours: [], start: ({live}) => slotPlainStart(live),
      verdict() { expect(slot, 'the priest slot read over the windows').not.toBeNull(); slotPlainVerdict(slot!); }, reads: () => slot},
    // The verdicts read as live-movement-hooks.spec.ts's rows do, over the window's play.
    {id: 'C30', ...hook(async live=>{
      const asked=heard(await seenC(live),'group.anchor');
      expect(asked.length).toBeGreaterThan(0);
      expect(asked.some(a=>[W,P].every(name=>(a.members as string[]).includes(name)))).toBe(true);
    })},
    {id: 'C32', ...hook(async live=>{
      expect(heard(await seenW(live,since),'journey.started').length).toBeGreaterThan(0);
    })},
    {id: 'C35', ...hook(async live=>{
      const ended=heard(await seenW(live,since),'journey.ended');
      expect(ended.length).toBeGreaterThan(0);
      const codes=['arrived','failed','replaced','cancelled','expired','stale','released','returned-to-safe','superseded'];
      for(const e of ended)expect(codes.some(code=>String(e.code).startsWith(code)),String(e.code)).toBe(true);
    })},
    // C36's near half: the priest asks the follow while it stands inside FOLLOW_DISTANCE of the
    // warrior, read on the window's poll (a farming priest spends most of a window farther off:
    // the run of 2026-11-23 ended with it 291 away, where `true` is the right answer). Three asks
    // inside the distance are enough to see an always-true hook. The far half is W09's play step.
    {id: 'C36', ...hook(async()=>{
      expect(near.length,'the follow asked inside the distance').toBeGreaterThan(0);
      for(const n of near)expect(n.answer,'no walk inside the distance').toBe(false);
    }), async sample({live}){
      if(near.length>=3)return;
      // A moving priest answers true at any distance (movers.ts followLeaderIfFar, as b9b5c91e's
      // shared.js:17757): final-gate-closing12's third ask read true at 20 px. The near half asks
      // only a priest at rest, and reads the distance in the same turn as the answer.
      const r=await live.clients[P]!.run(`(async()=>{const w=parent.entities[${JSON.stringify(W)}];if(!w||w.map!==character.map||character.moving)return null;
        const distance=Math.hypot(w.real_x-character.real_x,w.real_y-character.real_y);if(distance>${FOLLOW_DISTANCE})return null;
        return {distance:Math.round(distance),answer:await globalThis.__partyHooks.ask('movement.followIfFar',{character:${JSON.stringify(P)}})};})()`) as {distance:number;answer:unknown}|null;
      if(r)near.push({at:Date.now(),...r});
    }, reads: () => near},
    {id: 'C38', ...hook(async live=>{
      const formed=heard(await seenC(live),'walk.formed');
      expect(formed.length).toBeGreaterThan(0);
      const walks=formed.map(f=>f.walk);expect(new Set(walks).size,'once per walk').toBe(walks.length);
    })},
    {id: 'C39', ...hook(async live=>{
      const phases=heard(await seenC(live),'walk.phase');
      expect(phases.length).toBeGreaterThan(0);
      for(const p of phases)expect(p.phase,'a change, not a repeat').not.toBe(p.from);
    })},
    // C40 (walk.member) moves to W09 (DEVIATIONS.md, W01): this farm walk ends in its combat
    // handoff, which tells no member change.
    {id: 'C41', ...hook(async live=>{
      const ended=heard(await seenC(live),'walk.ended');
      expect(ended.length).toBeGreaterThan(0);
      const walks=ended.map(e=>e.walk);expect(new Set(walks).size,'once per walk').toBe(walks.length);
      for(const e of ended)expect(String(e.code).length).toBeGreaterThan(0);
    })},
    {id: 'C53', ...hook(async live=>{
      const asked=heard(await seenC(live),'route.avoid');
      expect(asked.length,'the planner asked it for its plans').toBeGreaterThan(0);
      for(const a of asked)expect(a.from&&a.to).toBeTruthy();
    })},
    {id: 'C58', ...hook(async live=>{
      const sent=heard(await seenW(live,since),'step.sent');
      expect(sent.length).toBeGreaterThan(0);
      for(const s of sent)expect(typeof s.mover==='string'&&!!s.point).toBe(true);
    })},
    {id: 'C59', ...hook(async live=>{
      await expect.poll(async()=>heard(await seenW(live,since),'formation.moved').length,{timeout:60_000}).toBeGreaterThan(0);
    })},
    {id: 'M01', owner: 'status', behaviours: [], async start({live, info}) { catalog = await catalogStart(live, info); },
      async verdict() { await catalog!.verdict(); }},
    {id: 'M62', owner: 'status', behaviours: [], async start({live}) {
      await party(live);
      expect(await status(live, {op: 'register'}), 'the coordinator half registers').toEqual({ok: true});
      await live.post('/settings', {changes: [{field: 'addons', value: await live.clients[W]!.run(statusHooksSwitches(true))}]});
      live.undo('status hooks fixture off', () => status(live, {op: 'off'}));
      statusSince = Date.now();
    }, async verdict({live}) {
      // The lines read as live-status-hooks.spec.ts's steps do, over the window's play.
      const heard = statusHeard, since = statusSince, fixture = status;
      await expect.poll(async () => of(await heard(live, since), 'status.received').filter(h => h.payload.character === W).length,
        {timeout: 30_000}).toBeGreaterThan(1);
      const replied = of(await heard(live, since), 'status.replied').find(h => h.payload.character === W);
      expect(replied?.payload.sections, 'the reply lists the table R sections it sent').toEqual(expect.arrayContaining([expect.any(String)]));
      const line = (await status(live, {op: 'ask', hook: 'status.cardLine', args: [W]})).answer;
      expect(line?.text, "the read is table L's line").toBe((await live.state()).characters[W]?.activity?.text);
      const read = (await fixture(live, { op: 'ask', hook: 'status.lastReport', args: [W] })).answer;
      expect(read?.report?.name).toBe(W);
      expect(read?.seenAt).toBeGreaterThan(since);
      expect((await fixture(live, { op: 'ask', hook: 'status.connected', args: [W] })).answer, 'a reporting character reads connected').toBe(true);
      expect((await fixture(live, { op: 'ask', hook: 'status.connected', args: ['E2ENoSuchCharacter'] })).answer).toBe(false);
    }},
  ],
});
