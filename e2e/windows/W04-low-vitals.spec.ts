import {expect, plantVitals, waitForGameplay, type LiveGame} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {survivalStart, sv1Play, sv3Play, sv11Play, sv1Verdict, sv3Verdict, sv11Verdict} from '../survival-rows';
import {red, spendsSince} from '../turns-rows';
import {addonSwitches, breakReportListener, registerTurnsChargeAddon, TURNS_CHARGE_ADDON, TURNS_NOTICES, turnsHeardSince, type HeardTurns} from '../fixtures/turns-hooks-addon';

// W04 Goo farm under planted low vitals (test-windows DESIGN.md 2.2). One play on one goo farm, with
// T45 and C25 both observing it: the turns hooks fixture add-on registers on both fighters, the party
// farms goo on Main and the server records every hit it sends the priest; each fighter is planted to
// 40% HP (SV1, and C25's potion readiness), then to 15% MP (SV3); then the priest low on an
// out-of-range selection, a held pull, Manual with Combat off, a call figure of 199 and one dropped
// attack reply; last, the party casts Town with the priest planted below both lines (SV11), and the
// play ends in town.
// Failure modes: T45, a potion misses its cooldown or a potion or heal ends a Town channel; T44, a
// potion family call is refused not_ready or the priest logs a failed potion; C25, a turns hook or
// event of runtime/hooks/rows/03-turns.ts is not asked, not heard or reads wrong.
// T45 keeps SV1, SV3 and SV11 live (DESIGN.md 4.3 T45); SV2, SV5, SV6, SV13 and SV41 map to
// survival-needs.test.cjs rows or step 12 (coverage ledger). Each C25 row below is one hook or
// event; its title is the `fixture` its HOOKS row names, and its reading goes to `c25.rows`.
// Red plants (E2E_TURNS_RED): `c25hit` drops one server hit to the priest, `c25interval` stops the
// warrior's executor until a selection passes with no pass after it, `c25report` breaks the add-on's
// report.sent listener on the warrior so it hears one notice in three.
const W = 'E2EWarrior', P = 'E2EPriest';
const survival: any = {}, c25 = {rows: {} as Record<string, unknown>, failed: {} as Record<string, string>}, tc9: any = {};
// A notice payload can carry a game entity (skills.dropped's `selected`), whose sprite links back
// to itself, so the reading keeps each value once and writes a repeat as "[seen]".
const plain = (value: unknown) => { const seen = new WeakSet<object>();
  return JSON.parse(JSON.stringify(value, (_key, v) => { if (v && typeof v === 'object') { if (seen.has(v)) return '[seen]'; seen.add(v); } return v; })); };

// The server's own record of each hit it sends the priest. Every hit and action goes out through
// xy_emit (server.js complete_attack, the miss, avoid and evade branches included), which fans out
// with one encode and never calls the player's `socket.emit`, so the record wraps xy_emit. It keeps
// the hits of the priest's damaging projectiles: an `action` with a pid, damage and an eta, as the
// tracker's `usable` reads it (runtime/characters/turns/skills/projectiles.ts); a curse's action
// carries damage 0 and no flight. A hit on a monster that was gone or dead when it resolved is kept
// apart: the client's `disappear` ended that flight first (projectiles.ts `gone`). A transport of the
// priest (the skills.dropped step's plants) ends its flights in flight, as the client's `new_map`
// clears the tracker (skills/runtime.ts `newMap`; red3 read one such hit unlanded). `drop` withholds
// the first live hit after the record starts (the `c25hit` plant).
const serverHits = (drop: boolean) => `output=(()=>{const g=globalThis;if(g.__e2eServerHits)return true;const hits=g.__e2eServerHits={list:[],dropped:null,transports:0},flying=new Set(),emit=xy_emit,transport=transport_player_to;
  transport_player_to=function(player){if(player&&player.name==='${P}'){flying.clear();hits.transports++;}return transport.apply(this,arguments);};
  xy_emit=function(entity,event,data,must){
    if(event==='action'&&data&&data.attacker==='${P}'&&data.pid&&Number(data.damage)>0&&Number(data.eta)>0)flying.add(String(data.pid));
    if(event==='hit'&&data&&data.hid==='${P}'&&flying.delete(String(data.pid))){const m=instances[entity.in]&&instances[entity.in].monsters[data.id];
      const hit={pid:String(data.pid),id:String(data.id),gone:!m||!!m.dead,at:Date.now()};hits.list.push(hit);
      if(${drop}&&!hit.gone&&!hits.dropped){hits.dropped=hit.pid;return;}}
    return emit.apply(this,arguments);};
  hits.off=()=>{xy_emit=emit;transport_player_to=transport;delete g.__e2eServerHits;return {list:hits.list,dropped:hits.dropped,transports:hits.transports};};return true;})()`;
const serverHitsOff = 'output=globalThis.__e2eServerHits?globalThis.__e2eServerHits.off():null';

async function lowVitalsPlay(live: LiveGame) {
  const pages: Record<string, NonNullable<(typeof live.clients)[string]>> = {[W]: live.clients[W]!, [P]: live.clients[P]!};
  const clock = (name: string) => pages[name]!.run('Date.now()') as Promise<number>;
  const heard = async (name: string, from: number) => (await pages[name]!.run(turnsHeardSince(from))) as HeardTurns[];
  const of = (list: HeardTurns[], event: string) => list.filter(n => n.event === event);
  const rows = c25.rows;
  // A row's failure stays on its own title, and the play goes on.
  const hookRow = async (title: string, run: () => Promise<unknown>) => {
    try { await run(); } catch (error) { c25.failed[title] = String((error as Error)?.message ?? error).slice(0, 2000); }
  };
  for (const name of [W, P]) expect(await pages[name]!.run(registerTurnsChargeAddon), 'the fixture add-on registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(true)) }] });
  for (const page of [pages[W]!, pages[P]!])
    await expect.poll(() => page.run(`__partyHooks.enabled(${JSON.stringify(TURNS_CHARGE_ADDON)})`), { timeout: 30_000 }).toBe(true);
  const run = await survivalStart(live, survival);
  const from = {[W]: await clock(W), [P]: await clock(P)};
  if (red('c25report')) await pages[W]!.run(breakReportListener);
  // A pass follows each selection within one report interval of the warrior, and report.sent comes
  // once per interval (DESIGN.md 4.3 C25: the status report's own period, as the coordinator holds it).
  const reportMs = Number((await live.state()).characters[W]?.reportIntervalMs);
  if (!(reportMs > 0)) throw Error(`the warrior reports no report interval: ${reportMs}`);
  rows.reportMs = reportMs;
  await live.admin(serverHits(red('c25hit')));
  try {
    await hookRow('skills.request: the add-on asks Charge at task when its target is out of range', async () => {
      await expect.poll(async () => of(await heard(W, from[W]!), 'skills.sent').filter(n => n.payload.skill === 'charge').map(n => [n.payload.by, n.payload.rank]),
        { timeout: 120_000, intervals: [500] }).toContainEqual([TURNS_CHARGE_ADDON + '/charge', 'task']);
    });
    // SV1's plants put each fighter at 40% of its HP, under the 50% HP potion line
    // (survival/lines.ts POTION_DEFAULTS); C25's potion rows read the same plants.
    await sv1Play(run);
    await hookRow('skills.readied: the potion family readies after its 2000 ms', async () => {
      expect(of(await heard(W, from[W]!), 'skills.readied').filter(n => n.payload.family === 'potion').length, "the warrior's potion readies after SV1's plant").toBeGreaterThanOrEqual(1);
    });
    await hookRow("skills.ready: the add-on reads the potion family's readiness and cost", async () => {
      const read = of(await heard(W, from[W]!), 'skills.passed').at(-1)?.reads.potion as { ready?: unknown; cost?: unknown; margin?: unknown } | undefined;
      expect(read && typeof read.ready === 'boolean' && typeof read.cost === 'number' && typeof read.margin === 'number', JSON.stringify(read)).toBe(true);
    });
    await sv3Play(run);
    await hookRow("skills.dropped: at the plant the priest's attack is dropped, outranked by the heal", async () => {
      const at = await clock(P);
      // The heal shares the attack family (game data `heal.share: "attack"`), so a pass that asks
      // both ranks them, and the executor drops the attack "outranked by core:survival/heal"
      // (runtime/characters/turns/executor.ts `pass`). The executor sends that notice once per reason
      // and clears it only when the attack wins a pass. A low plant starts a heal streak that
      // outlasts the step: on a failed run the priest sent only heals after the step began and heard
      // no attack drop at all. The row first fills every HP until an attack goes out, then plants the
      // priest low, so the drop it hears is a new one.
      // The attack gate (runtime/characters/turns/rules.ts priestAttacks) withholds the attack while the priest's
      // MP is under partyheal's cost plus `mp_cost`, and the attack source asks only in range of its
      // selection: each plant fills the priest's MP and moves it onto a selection out of range.
      const selection = `(()=>{const t=get_targeted_monster();return t&&!is_in_range(t)?[character.map,Math.round(t.x),Math.round(t.y)]:null})()`;
      const plant = async (hp: number) => {
        const transport = (await pages[P]!.run(selection)) as [string, number, number] | null;
        await plantVitals(live, P, { hp, mp: 1, ...(transport ? { transport } : {}) });
      };
      let won = 0;
      try {
        await expect.poll(async () => {
          await plantVitals(live, W, { hp: 1 });
          await plant(1);
          won = of(await heard(P, at), 'skills.sent').find(n => n.payload.family === 'attack' && n.payload.by === 'core:turns/attack')?.at ?? 0;
          return won > 0;
        }, { timeout: 30_000, intervals: [250] }).toBe(true);
        await expect.poll(async () => {
          await plant(0.4);
          return of(await heard(P, won), 'skills.dropped').some(n => n.payload.family === 'attack' && /^outranked by core:survival\/heal$/.test(String(n.payload.reason)));
        }, { timeout: 30_000, intervals: [250] }).toBe(true);
      } finally {
        const list = await heard(P, at).catch(() => [] as HeardTurns[]);
        rows.dropped = { dropped: of(list, 'skills.dropped').slice(-10).map(n => n.payload), sent: of(list, 'skills.sent').slice(-10).map(n => [n.payload.skill, n.payload.rank, n.payload.by]) };
        await plantVitals(live, P, { hp: 1 }).catch(() => null);
      }
    });
    await hookRow("skills.refuses: the add-on refuses the warrior's damage casts while it holds a pull", async () => {
      const at = await clock(W);
      await pages[W]!.run('globalThis.__e2eHoldPull=true');
      try {
        await expect.poll(async () => of(await heard(W, at), 'skills.dropped').some(n => /turns-charge-fixture: holding a pull/.test(String(n.payload.reason))),
          { timeout: 30_000, intervals: [250] }).toBe(true);
        expect(of(await heard(W, at), 'skills.sent').filter(n => n.at > at + 1000 && n.payload.family === 'attack').length, 'no attack while it holds').toBe(0);
      } finally { await pages[W]!.run('globalThis.__e2eHoldPull=false'); }
    });
    await hookRow('skills.allows: on Manual with Combat off the add-on reads the H4 row', async () => {
      const at = await clock(W);
      // Manual's switches as the card sets them (e2e/user-holds-rows.ts).
      await live.post('/formation', { character: W, handControl: { on: true, combat: false } });
      try {
        await expect.poll(async () => of(await heard(W, at), 'skills.passed').some(n => (n.reads.allows as { row?: string } | undefined)?.row === 'H4'),
          { timeout: 30_000, intervals: [250] }).toBe(true);
        await hookRow("skills.released: Manual's Combat off holds every family but the potion, then releases", async () => {
          // The hold is in force from the warrior's first pass that reads the H4 row; a send before
          // it left on the switch's way to the character (run 1 and red2 read one attack 1250 ms
          // after the switch). The reading: that pass, then each send other than a potion after it.
          const list = await heard(W, at), heldAt = of(list, 'skills.passed').find(n => (n.reads.allows as { row?: string } | undefined)?.row === 'H4')!.at;
          const stray = of(list, 'skills.sent').filter(n => n.at > heldAt && n.payload.family !== 'potion');
          rows.released = { heldAfterMs: heldAt - at, sends: of(list, 'skills.sent').filter(n => n.payload.family !== 'potion').map(n => [n.at - at, n.payload.skill, n.payload.by]) };
          expect(stray.length, 'only potions while held').toBe(0);
        });
      } finally { await live.post('/formation', { character: W, handControl: { on: false, combat: true } }).catch(() => null); }
    });
    await hookRow('skills.waiting: an attack waits on the planted call figure, then goes', async () => {
      const at = await clock(W);
      await live.plantCallCost(W, 199);
      try {
        await expect.poll(async () => of(await heard(W, at), 'skills.waiting').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThanOrEqual(1);
      } finally { await live.plantCallCost(W, 0); }
      await expect.poll(async () => of(await heard(W, at), 'skills.sent').length, { timeout: 30_000, intervals: [250] }).toBeGreaterThanOrEqual(1);
    });
    await hookRow('skills.settled: the dropped reply settles lost after its cooldown and the margin', async () => {
      const at = await clock(P);
      // The server drops one accepted `attack` reply of the priest (the lost-reply fault).
      await live.admin(`output=(()=>{const p=get_player('${P}'),s=p.socket,emit=s.emit;let dropped=false;
        s.emit=function(event,data){if(event==='game_response'&&data&&data.place==='attack'&&!data.failed&&!dropped){dropped=true;s.emit=emit;return true;}return emit.apply(this,arguments);};return true;})()`);
      await expect.poll(async () => of(await heard(P, at), 'skills.settled').some(n => n.payload.outcome === 'lost'), { timeout: 60_000, intervals: [250] }).toBe(true);
    });
  } finally {
    rows.serverHits = await live.admin(serverHitsOff);
  }
  // The client hears each hit one trip after the server sent it; one report interval holds the
  // priest's last landings with room to spare.
  await waitForGameplay(reportMs);
  await hookRow('skills.shot: each own hit the server records is shot and lands once', async () => {
    await hookRow('skills.landed: each own hit the server records lands once', async () => {
      const server = (rows.serverHits as { list: { pid: string; gone: boolean; at: number }[] } | null)?.list ?? [];
      const all = await heard(P, 0), landed = of(all, 'skills.landed'), shot = new Set(of(all, 'skills.shot').map(n => String(n.payload.projectile)));
      const lands = new Set(landed.map(n => String(n.payload.projectile))), resolved = server.filter(h => !h.gone);
      rows.tc43 = { server: server.length, gone: server.length - resolved.length, landed: landed.length, shot: shot.size };
      // Each resolved hit the tracker did not land, with what the priest's client heard of it: the
      // hit packet itself and the selections between its shot and one report interval after it.
      const missed = resolved.filter(h => !lands.has(h.pid));
      if (missed.length) {
        const events = await pages[P]!.events().catch(() => [] as any[]), shots = of(all, 'skills.shot');
        rows.unlanded = missed.map(h => { const shotAt = shots.find(n => String(n.payload.projectile) === h.pid)?.at ?? h.at;
          return { ...h, shotAt, packets: events.filter((e: any) => e.event === 'hit' && String(e.data?.pid) === h.pid).map((e: any) => ({ at: e.at, data: e.data })),
            changes: of(all, 'targeting.changed').filter(n => n.at >= shotAt && n.at <= h.at + reportMs).map(n => [n.at - shotAt, n.payload.to]) }; });
      }
      expect(resolved.length, 'the server sent the priest hits').toBeGreaterThan(0);
      expect(new Set(landed.map(n => n.payload.projectile)).size, 'each projectile lands once').toBe(landed.length);
      expect(resolved.filter(h => !shot.has(h.pid)).map(h => h.pid), 'each hit the server sent was shot').toEqual([]);
      expect(resolved.filter(h => !lands.has(h.pid)).map(h => h.pid), 'the tracker hears every hit the server sent').toEqual([]);
    });
  });
  if (red('c25interval')) {
    // The plant: the warrior's executor stops, so no pass follows its selections and reports. An
    // install that publishes a new executor while the plant stands is stopped too (run red2 read
    // three reports with no pass, then passes again).
    const stop = '(()=>{const t=globalThis.__partyTurns;if(t){t.stop();globalThis.__e2eStopped=(globalThis.__e2eStopped||0)+1;}return globalThis.__e2eStopped||0;})()';
    await pages[W]!.run(stop);
    // The plant's window opens one report interval after the stop: a pass and a selection read in
    // the stop's own 250 ms game update belong to the executor before it (red3 read both at 0 ms).
    await waitForGameplay(reportMs);
    const at = await clock(W);
    // The stopped warrior kills nothing, so the plant removes its target and it selects another.
    const target = await pages[W]!.run('character.target??null') as string | null;
    if (target) await live.admin(`output=(()=>{const m=instances.main.monsters[${JSON.stringify(target)}];if(m)remove_monster(m,{method:'disappear'});return !!m;})()`);
    const reading = async () => { const l = await heard(W, at);
      return { target, stops: await pages[W]!.run(stop), changes: of(l, 'targeting.changed').filter(n => n.payload.character === W).map(n => [n.at - at, n.payload.to]),
        reports: of(l, 'report.sent').filter(n => n.payload.character === W).map(n => n.at - at), passes: of(l, 'skills.passed').map(n => n.at - at) }; };
    await expect.poll(async () => { const r = await reading(), now = await clock(W) - at;
      return r.changes.some(([t, to]) => !!to && Number(t) < now - reportMs) && r.reports.some(t => t < now - reportMs); },
    { timeout: 60_000, intervals: [500] }).toBe(true).finally(async () => { rows.interval = await reading(); });
  }
  // The role loop runs a pass on each selection.
  await hookRow('targeting.changed: a new target runs a pass before the next report', async () => {
    const list = await heard(W, from[W]!), passes = of(list, 'skills.passed').map(n => n.at);
    const changes = of(list, 'targeting.changed').filter(n => n.payload.character === W && n.payload.to);
    expect(changes.length, 'the warrior changed targets').toBeGreaterThan(0);
    const late = changes.filter(c => !passes.some(at => at >= c.at && at - c.at < reportMs));
    expect(late.map(c => c.at), 'a pass within one report interval of each selection').toEqual([]);
  });
  // The row reads the notices themselves: a pass runs on every packet too (turns/loop.ts `packets`),
  // so passes after a report hold whether or not report.sent was heard.
  await hookRow("report.sent: the add-on hears one report.sent per report, no gap over two report intervals", async () => {
    const now = await clock(W), list = await heard(W, from[W]!);
    const reports = of(list, 'report.sent').filter(n => n.payload.character === W && n.at <= now);
    const sequence = reports.map(n => Number(n.payload.sequence));
    // The gaps run from the window start to the first notice, between notices, and from the last to
    // the reading. Two intervals is the age past which the console reads a member's report as stale
    // (protocol/reports.ts `ageOf`, the walk reading).
    const edges = [from[W]!, ...reports.map(n => n.at), now], gaps = edges.slice(1).map((t, i) => t - edges[i]!);
    rows.reports = { count: reports.length, sequence: [sequence[0], sequence.at(-1)], spanMs: now - from[W]!, minGapMs: Math.min(...gaps), maxGapMs: Math.max(...gaps) };
    expect(reports.length).toBeGreaterThan(0);
    expect(sequence.filter((s, i) => i > 0 && s !== sequence[i - 1]! + 1), 'one report.sent per report, each sequence once and in order').toEqual([]);
    expect(gaps.filter(gap => gap > 2 * reportMs), 'no report.sent gap over two report intervals').toEqual([]);
    expect(reports.filter(n => n.payload.by !== 'core:lifecycle').length, 'each report.sent names core:lifecycle').toBe(0);
  });
  await hookRow("skills.incoming: the add-on reads the priest's own damage in flight on its target", async () => {
    const reads = of(await heard(P, from[P]!), 'skills.shot').map(n => n.reads.incoming);
    expect(reads.some(r => Number(r) > 0), `the incoming reads: ${reads.slice(-5)}`).toBe(true);
  });
  await hookRow("skills.passed: the fixture add-on's listener runs once per role loop pass", async () => {
    const passed = of(await heard(W, from[W]!), 'skills.passed');
    expect(passed.length).toBeGreaterThan(0);
    expect(passed.every(n => n.payload.by === 'core:turns')).toBe(true);
  });
  await hookRow('skills.sent: every accepted attack of the window has one sent notice', async () => {
    const list = await heard(P, from[P]!), accepted = of(list, 'skills.settled').filter(n => n.payload.family === 'attack' && n.payload.outcome === 'accepted');
    const sent = of(list, 'skills.sent').filter(n => n.payload.family === 'attack');
    rows.sent = { accepted: accepted.length, sent: sent.length };
    expect(accepted.length, "the priest's accepted attacks").toBeGreaterThanOrEqual(3);
    expect(sent.length, 'one sent notice per accepted attack').toBeGreaterThanOrEqual(accepted.length);
  });
  // Every event of the table came, and each names its `by`.
  await hookRow('every notice', async () => {
    const all = [...await heard(W, from[W]!), ...await heard(P, from[P]!)];
    expect(TURNS_NOTICES.filter(event => event !== 'skills.held' && of(all, event).length === 0), 'every live notice was heard').toEqual([]);
    expect(all.filter(n => !n.payload.by && n.event !== 'targeting.changed').map(n => n.event), 'every notice names its by').toEqual([]);
  });
  // The last step: the party Town with the priest planted below both lines; the play ends in town.
  await sv11Play(run);
  // The planted break of TC9's reads (E2E_TURNS_RED=tc9): the priest's page sends two potions
  // past the executor, and the server refuses the second not_ready (server.js `use`: one potion
  // per 4 s).
  if (red('tc9')) {
    await pages[P]!.run(`(parent.socket.emit('use',{item:'hp'}),parent.socket.emit('use',{item:'hp'}),true)`);
    await expect.poll(async () => (await spendsSince(live, P, from[P]!)).replies.some((r: any) => r.response === 'not_ready' && r.place === 'use'),
      { timeout: 10_000, message: 'TC9 plant: the second potion is refused' }).toBe(true);
  }
  // T44's TC9 fight half (DEVIATIONS.md): the priest's potion family calls and its failure lines
  // over the whole play, whose SV1 and SV3 plants put it under both potion lines in the fight.
  const log = await spendsSince(live, P, from[P]!);
  tc9.potionCalls = log.spends.filter((s: any) => s.method === 'use' || (s.method === 'equip' && /^[hm]pot/.test(String(s.item)))).length;
  tc9.notReady = log.replies.filter((r: any) => (r.response === 'not_ready' || r.reason === 'not_ready') && ['equip', 'use'].includes(String(r.place)));
  tc9.lines = log.lines;
}

liveWindow({
  id: 'W04', name: 'Goo farm under planted low vitals',
  // T45's row and C25's test took 1.9 min of wall time together (DESIGN.md 2.2 W04); C25's own
  // bound was 420 s (live-turns-hooks.spec.ts at 21fe30a2b) and T45's waits reach 180 s for the fight.
  timeoutMs: 900_000,
  async play({live}: LiveWorld) { await lowVitalsPlay(live); },
  observers: [
    {id: 'T45', owner: 'survival', behaviours: ['SRV-001', 'SRV-002'], start() {}, verdict() { sv1Verdict(survival); sv3Verdict(survival); sv11Verdict(survival); },
      reads: () => ({sv1: survival.sv1, sv3: survival.sv3, sv11: survival.sv11})},
    {id: 'T44', owner: 'turns', behaviours: [], start() {}, reads: () => tc9, verdict() {
      expect(tc9.potionCalls, "TC9: the priest's potion family calls in the fight, so the check fires").toBeGreaterThan(0);
      expect.soft(tc9.notReady, 'TC9: potion family calls refused not_ready').toEqual([]);
      expect.soft(tc9.lines, 'TC9: "Recovery failed" and "Potion failed" lines').toEqual([]);
    }},
    {id: 'C25', owner: 'turns', behaviours: ['TRN-031'], start() {},
      verdict() { expect(c25.failed, 'every turns hook row of the window passes').toEqual({}); }, reads: () => plain(c25)},
  ],
});
