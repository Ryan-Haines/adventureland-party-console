import { test, expect, type LiveGame } from './live-fixtures';
import { party } from './game/hunt-lifecycle';
import { targetingRetireRow } from './targeting-rows';
import { addonSwitches, answer, characterAsked, characterHeard, registerCharacterHalf, TARGETING_HOOKS_ADDON, type Answers, type Heard } from './fixtures/targeting-hooks-addon';

// The targeting owner's hooks table. One fixture add-on answers the targeting owner's four decision hooks and hears every 04 notice on
// both realms, reading the published reads at each; each row is one hook, event or read on one shared
// run of the default fixture: two pinkgoos planted by the warrior, then the walled goo
// (e2e/targeting-rows.ts `targetingRetireRow`) for the retire, the clear and movement's notice. Each
// step's title is the `fixture` its `HOOKS` row names (runtime/hooks/registry.ts). The unit rows
// (`U:`) sit in scripts/tests/successor-handoff.test.cjs (the grant and its revoke, which the live table
// cannot run out on demand) and hook-registry.test.cjs.
const W = 'E2EWarrior', P = 'E2EPriest';
const coordinator = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-targeting-hooks', body);
const heardC = async (live: LiveGame, since: number) => await coordinator(live, { op: 'heard', since }) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);

test('targeting hooks: one fixture add-on registers every hook and event', async ({ live }, info) => {
  test.setTimeout(900_000);
  const pages: Record<string, NonNullable<(typeof live.clients)[string]>> = { [W]: live.clients[W]!, [P]: live.clients[P]! };
  const clock = (name: string) => pages[name]!.run('Date.now()') as Promise<number>;
  const heard = async (name: string, since: number) => await pages[name]!.run(characterHeard(since)) as Heard[];
  // Each realm's half answers the same: the pages' selections and the grouped queue's choice.
  const set = async (answers: Answers) => {
    for (const page of Object.values(pages)) await page.run(answer(answers));
    await coordinator(live, { op: 'answers', answers });
  };
  const own = () => pages[W]!.run('character.target?String(character.target):null') as Promise<string | null>;
  await party(live);
  // The add-on's candidates answer narrows only while the view holds a party, and the view reads
  // the game's party list. `party` returns once the coordinator holds the formation, before the
  // warrior's invite reaches the game: one run sent the invite in the same update as the first
  // attack on the nearer goo, the answer let that attack through, and the queue kept the engaged fight.
  for (const page of Object.values(pages))
    await expect.poll(() => page.run('[...(parent.party_list||[])].sort().join()'), { timeout: 60_000, intervals: [500] }).toBe([P, W].sort().join());
  // The shipped tank-hold add-on answers targeting.aggroOwner, a one-answer hook; switched off in the
  // add-on manager it leaves the hook to the fixture.
  await live.post('/addons', { name: 'tank-hold', enabled: false });
  expect(await coordinator(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
  for (const page of Object.values(pages)) expect(await page.run(registerCharacterHalf), 'the character half registers').toEqual({ ok: true });
  await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(true)) }] });
  for (const page of Object.values(pages))
    await expect.poll(() => page.run(`__partyHooks.enabled(${JSON.stringify(TARGETING_HOOKS_ADDON)})`), { timeout: 30_000 }).toBe(true);
  const since = Date.now(), from = { [W]: await clock(W), [P]: await clock(P) }, rows: Record<string, unknown> = {};
  // Two pinkgoos by the warrior, 60 and 160 units off, peaceful and slow to die, with the focus on
  // pinkgoo alone, so the candidates of the top priority are the two plants.
  const here = async () => await pages[W]!.run('({map:character.map,x:character.real_x,y:character.real_y})') as { map: string; x: number; y: number };
  let at = await here();
  const plant = async (dx: number) => String(await live.admin(`output=(()=>{const m=new_monster(${JSON.stringify(at.map)},{type:'pinkgoo',position:[${at.x + dx},${at.y}],radius:0,count:1},{temp:1});
    m.hp=m.max_hp=400000;m.aggro=0;m.peaceful=true;return m.id;})()`));
  let near = await plant(60), far = await plant(160);
  // The goos the prefers row steered the warrior to, which the changed row reads.
  const taken: string[] = [];
  // Fresh plants beside where the warrior stands now, the old pair removed.
  const replant = async () => {
    await live.admin(`output=(()=>{for(const id of ${JSON.stringify([near, far])}){const m=instances[${JSON.stringify(at.map)}].monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
    at = await here(); near = await plant(60); far = await plant(160);
  };
  await live.post('/focus', { monsterFocus: ['pinkgoo'], monsterPriorities: {}, monsterSearchRadius: 400 });
  try {
    await test.step("targeting.candidates: the add-on narrows the goos to the ones it names, reading the view's party", async () => {
      await set({ keep: [far] });
      await expect.poll(own, { timeout: 60_000, intervals: [500] }).toBe(far);
      expect((await pages[W]!.run(characterAsked) as Record<string, number>)['targeting.candidates'], 'the hook was asked').toBeGreaterThan(0);
    });
    // In grouped farming the warrior keeps the queue's choice, which the add-on's preference
    // steers among planned pulls. A goo the party fights keeps the queue until it dies, so each
    // preference gets a fresh pair: the nearer goo, then the farther one.
    await test.step('targeting.prefers: the add-on prefers the farther goo and the warrior takes it', async () => {
      await set({ prefer: 'near' });
      await replant();
      await expect.poll(own, { timeout: 60_000, intervals: [500] }).toBe(near);
      taken.push(near);
      await set({ prefer: 'far' });
      await replant();
      await expect.poll(own, { timeout: 60_000, intervals: [500] }).toBe(far);
      taken.push(far);
    });
    await test.step("targeting.refuses: the add-on refuses the warrior's attack on the planted goo", async () => {
      const mark = await clock(W);
      await set({ refuse: far, prefer: 'far' });
      await expect.poll(async () => of(await heard(W, mark), 'targeting.refused').filter(h => h.payload.target === far).map(h => [h.payload.row, h.payload.by]),
        { timeout: 30_000, intervals: [250] }).toContainEqual(['G13', TARGETING_HOOKS_ADDON]);
    });
    await test.step('targeting.refused: the planted refusal sends one refused notice', async () => {
      const refusals = of(await heard(W, from[W]!), 'targeting.refused').filter(h => h.payload.target === far && h.payload.skill === 'attack' && h.payload.by === TARGETING_HOOKS_ADDON);
      rows.refused = refusals.length;
      expect(refusals.length, 'one notice while the reason holds').toBe(1);
      await set({});
    });
    await test.step("targeting.aggroOwner: the add-on names the priest as aggro owner and the warrior's Taunt waits", async () => {
      await set({ aggroOwner: P });
      await expect.poll(async () => (await pages[W]!.run(characterAsked) as Record<string, number>)['targeting.aggroOwner'] ?? 0,
        { timeout: 60_000, intervals: [500] }).toBeGreaterThan(0);
      await set({});
    });
    await test.step("targeting.target: the add-on reads the warrior's target, its due flag and the threat", async () => {
      const reads = of(await heard(W, from[W]!), 'targeting.passed').map(h => h.reads);
      expect(reads.some(r => typeof r.target === 'string'), 'a pass reads a target').toBe(true);
      expect(reads.every(r => typeof r.due === 'boolean' && typeof (r.threat as { attacking?: unknown })?.attacking === 'boolean'), 'the due flag and the threat answer').toBe(true);
    });
    await test.step('targeting.allows: the add-on asks whether the planted goo is allowed and reads the refusal', async () => {
      const reads = of(await heard(W, from[W]!), 'targeting.refused').map(h => h.reads.allows);
      expect(reads.some(r => typeof r === 'string'), 'the read names the refusal').toBe(true);
    });
    await test.step('targeting.changed: every selection change of the window has one changed notice', async () => {
      const changes = of(await heard(W, from[W]!), 'targeting.changed').filter(h => h.payload.from !== h.payload.to);
      expect(changes.map(h => h.payload.to), 'the warrior took each goo the add-on preferred').toEqual(expect.arrayContaining(taken));
    });
    await test.step('targeting.passed: each selection pass of the window sends one passed notice, with none while no goo is in view', async () => {
      const passes = of(await heard(W, from[W]!), 'targeting.passed');
      rows.passed = passes.length;
      expect(passes.length, 'the 1 s pass sends a notice each time').toBeGreaterThan(10);
      expect(passes.every(h => h.payload.by === 'core:targeting' && 'row' in h.payload), 'each names its row').toBe(true);
    });
    await test.step('targeting.nominated: each group nomination of the window has one notice', async () => {
      const nominations = of(await heardC(live, since), 'targeting.nominated');
      expect(nominations.length).toBeGreaterThan(0);
      // The revision is the fight's identity (queue.ts `fightSelection`), so a group that goes back to
      // a planned goo it nominated before sends that revision again. A notice repeats its group's last
      // revision only when one nomination sent two notices.
      const last = new Map<unknown, unknown>(), repeats: unknown[] = [];
      for (const h of nominations) {
        if (last.get(h.payload.group) === h.payload.revision) repeats.push(h.payload.revision);
        last.set(h.payload.group, h.payload.revision);
      }
      expect(repeats, 'one notice per nomination').toEqual([]);
    });
    await test.step("targeting.fightState: the killed goo's fight goes engaged then retired", async () => {
      const phases = async () => of(await heardC(live, since), 'targeting.fightState').filter(h => h.payload.target === near).map(h => h.payload.to);
      // The far goo stays the engaged fight once a hit lands on it, since queue.ts `releaseResetFights`
      // releases only a goo at full HP, and the add-on keeps the warrior off it. Removing it lets the
      // queue lose it and engage the near goo.
      await live.admin(`output=(()=>{const m=instances[${JSON.stringify(at.map)}].monsters[${JSON.stringify(far)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
      await set({ keep: [near] });
      // The goo keeps its planted HP until its fight is engaged, so the queue engages it before it dies.
      await expect.poll(async () => (await phases()).at(-1), { timeout: 60_000, intervals: [500] }).toBe('engaged');
      // A pinkgoo has 98 avoidance and takes 1 damage per landed hit (`1hp`). Zero avoidance and 1 HP
      // let the next hit kill it (the cutebee plant in e2e/game/hunt-events.ts zeroes avoidance the
      // same way).
      await live.admin(`output=(()=>{const m=instances[${JSON.stringify(at.map)}].monsters[${JSON.stringify(near)}];if(m){m.zone_stats={...G.monsters.pinkgoo,avoidance:0};calculate_monster_stats(m);m.hp=1;}return !!m;})()`);
      await expect.poll(phases, { timeout: 90_000, intervals: [500] }).toEqual(expect.arrayContaining(['engaged', 'retired']));
      await set({});
    });
    // Row G1's walled goo: the warrior's approach ends unreachable, movement tells it, targeting retires
    // it and the next fight's start clears its mark.
    await live.admin(`output=(()=>{const m=instances[${JSON.stringify(at.map)}].monsters[${JSON.stringify(far)}];if(m)m.hp=0;return true;})()`);
    await targetingRetireRow(live, info);
    await test.step("targeting.unreachable: movement's notice reaches the add-on", async () => {
      expect(of(await heard(W, from[W]!), 'targeting.unreachable').length + of(await heard(P, from[P]!), 'targeting.unreachable').length).toBeGreaterThan(0);
    });
    await test.step('targeting.retired: the walled goo is retired once', async () => {
      const retired = [...of(await heard(W, from[W]!), 'targeting.retired'), ...of(await heard(P, from[P]!), 'targeting.retired')];
      expect(retired.length).toBeGreaterThan(0);
      expect(retired.every(h => h.payload.by === 'core:targeting'), 'each names its by').toBe(true);
      expect(new Set(retired.map(h => `${h.payload.character}|${h.payload.target}`)).size, 'once per character and goo').toBe(retired.length);
    });
    // retire.ts `pass` clears the marks when survival's fight fact turns true after a pass where it
    // was false. The fact holds while the party stands at its farm (needs.ts `partyUnderAttack`), and
    // the row ends with the party at the bee field and the walled goo removed, so its mark lapses with
    // no fight start. The step takes the party off the farm to town, renews the walled goo's mark with
    // movement's notice (the row's own way of sending it), and brings the party back to a planted bee
    // inside the mark's 10 s, which starts the next fight.
    await test.step("targeting.cleared: the next fight's start clears the walled goo's mark", async () => {
      const fighting = () => pages[W]!.run('!!globalThis.__partySurvival?.fighting()') as Promise<boolean>;
      await expect.poll(fighting, { timeout: 30_000, intervals: [500], message: 'the party stands at its farm after the row' }).toBe(true);
      const back = await here();
      const walled = await pages[W]!.run(`(globalThis.__partyTargeting.records()||[]).filter(e=>e.kind==='retired').map(e=>e.target).at(-1)??null`) as string | null;
      expect(walled, 'the warrior retired the walled goo').not.toBeNull();
      const bee = String(await live.admin(`output=(()=>{const m=new_monster(${JSON.stringify(back.map)},{type:'bee',position:[${back.x},${back.y}],radius:0,count:1},{temp:1});
        m.hp=m.max_hp=400000;m.aggro=0;m.peaceful=true;return m.id;})()`));
      try {
        await live.admin(`output=(()=>{for(const n of ${JSON.stringify([W, P])})transport_player_to(get_player(n),${JSON.stringify(back.map)},[0,0]);return true;})()`);
        // The retire reads the fight fact as the notice lands, and a mark set inside a fight holds
        // through that fight. One run read the fact false and sent the notice in a later call; the bee
        // fight started inside the mark and nothing cleared it, so the fact read true again at the
        // notice. The page sends the notice in the same call that reads the fact false.
        await expect.poll(() => pages[W]!.run(`(()=>{if(globalThis.__partySurvival.fighting())return false;
          globalThis.__partyHooks.notify('targeting.unreachable',{character:character.name,target:${JSON.stringify(walled)},why:'approach'});return true;})()`),
        { timeout: 30_000, intervals: [250], message: 'off the farm the party is in no fight' }).toBe(true);
        await live.admin(`output=(()=>{for(const n of ${JSON.stringify([W, P])})transport_player_to(get_player(n),${JSON.stringify(back.map)},[${back.x},${back.y}]);return true;})()`);
        await expect.poll(async () => [...of(await heard(W, from[W]!), 'targeting.cleared'), ...of(await heard(P, from[P]!), 'targeting.cleared')].length,
          { timeout: 120_000, intervals: [1000] }).toBeGreaterThan(0);
      } finally {
        await live.admin(`output=(()=>{const m=instances[${JSON.stringify(back.map)}].monsters[${JSON.stringify(bee)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`).catch(() => {});
      }
    });
    await test.step("targeting.skipped: the priest's covered goo is skipped once", async () => {
      const skipped = of(await heard(P, from[P]!), 'targeting.skipped');
      rows.skipped = skipped.map(h => h.payload);
      expect(skipped.length, 'the priest skips a goo its own hit in flight covers').toBeGreaterThan(0);
      expect(new Set(skipped.map(h => h.payload.target)).size, 'once per goo').toBe(skipped.length);
    });
    await test.step('targeting.passing: the add-on asks whether a passing goo may interrupt a farm walk', async () => {
      const reads = (await heardC(live, since)).map(h => h.reads.passing);
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every(r => r === true), 'a farm walk lets a passing goo interrupt it').toBe(true);
    });
  } finally {
    await info.attach('targeting-hooks', { body: JSON.stringify({ rows, coordinator: await heardC(live, since).catch(() => []) }), contentType: 'application/json' });
    await set({}).catch(() => {});
    await live.post('/settings', { changes: [{ field: 'addons', value: await pages[W]!.run(addonSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
});
