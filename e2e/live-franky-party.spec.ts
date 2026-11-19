import { test, expect } from './live-fixtures';
import { killNativeCharacter } from './hunt-interruption-helpers';
import { groupOf } from './task-records';

const W = 'E2EWarrior', P = 'E2EPriest', members = [W, P];

// Failure inventory: deselection must revoke voluntary boss combat, install
// both exit owners, and leave the map without waiting for the living boss to die.
test.use({ loadout: 'fragile' });

test('disabling inherited Franky interrupts native boss combat and evacuates both participants', async ({ live }, info) => {
  test.setTimeout(480_000);
  const world = () => live.admin(`output={live:!!E.franky?.live,boss:!!get_monster('franky'),bossHp:get_monster('franky')?.hp,bossTarget:get_monster('franky')?.target,
    players:Object.fromEntries(${JSON.stringify(members)}.map(name=>{const p=get_player(name);
      return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))}`);
  await live.post('/formation', { leader: W });
  await live.post('/formation', { character: P, follow: true });
  const seed = await live.admin(`output=(()=>{
    if(events.franky || get_monster('franky')) throw Error('Franky needs a clean baseline');
    // Keep native reach and pursuit so a living attacker remains during evacuation.
    const initial={attack:1,spawns:[],aggro:0};
    globalThis.__e2eFrankyDefinition=Object.fromEntries(Object.keys(initial).map(key=>[key,G.monsters.franky[key]]));
    Object.assign(G.monsters.franky,initial);
    globalThis.__e2eFrankyBoundary=G.maps.level2w.monsters[0].boundary.slice();
    G.maps.level2w.monsters[0].boundary=[-529,-185,-527,-183];
    events.franky=true;delete timers.franky;
    return {original:globalThis.__e2eFrankyDefinition,initial,
      nativeCombat:{range:G.monsters.franky.range,speed:G.monsters.franky.speed,charge:G.monsters.franky.charge},
      originalBoundary:globalThis.__e2eFrankyBoundary,initialBoundary:G.maps.level2w.monsters[0].boundary,
      scope:'native visible-boss combat, deselection, exit ownership and actual Mainland evacuation'};
  })()`);
  await info.attach('franky-party-initial-encounter', { body: JSON.stringify(seed), contentType: 'application/json' });
  await expect.poll(async () => (await world()).boss, { timeout: 30_000 }).toBe(true);
  const initialBossHp=(await world()).bossHp;
  await live.post('/formation', { character: W, eventSelections: ['franky'] });
  await expect.poll(async () => {
    const server = await world();
    return server.live && server.boss && members.every(name => server.players[name].map === 'level2w');
  }, { timeout: 120_000, message: 'Both actual game clients must enter the living Franky instance' }).toBe(true);
  await expect.poll(async () => {
    const state = await live.state();
    return members.every(name => state.characters[name]?.map === 'level2w' &&
      state.characters[name]?.joinedEvent === 'franky');
  }, { timeout: 30_000, message: 'Both native participation reports must reach the coordinator' }).toBe(true);
  await expect.poll(async()=>(await world()).bossHp,{timeout:90_000,message:'Real visible Franky combat must damage the living boss before deselection'}).toBeLessThan(initialBossHp);
  await expect.poll(async()=>{
    const state=await live.state();
    return members.some(name=>state.characters[name]?.target?.mtype==='franky'&&state.characters[name]?.activeCombatTarget);
  },{timeout:15_000,message:'At least one native fighter must still own active boss combat'}).toBeTruthy();
  // Initial completed native quests reproduce enabling/resuming Hunt during a
  // living event. Quest preparation must not seize protected Daisy travel.
  await live.admin(`output=${JSON.stringify(members)}.map(name=>{const p=get_player(name);p.s.monsterhunt={sn:region+' '+server_name,id:'goo',c:0,ms:1800000};resend(p,'u+cid+reopen');return p.s.monsterhunt})`);
  await expect.poll(async () => (await live.state()).characters[W]?.monsterHunt?.count).toBe(0);
  await expect.poll(async () => (await live.state(true)).monsterChoices?.some((choice: any) => choice.id === 'goo')).toBe(true);
  const goo = (await live.state(true)).monsterChoices.find((choice: any) => choice.id === 'goo');
  await live.post('/farming-mode', { character: W, mode: 'hunt', backup: { monsterFocus: ['goo'], location: goo.locations.find((location: any) => location.map === 'main') } });
  // The task owner suspends the Hunt under the attendance task (01 design 2.2); the Hunt keeps its stage.
  await expect.poll(async () => groupOf(await live.tasks(), W)?.live?.kind, { timeout: 15_000 }).toBe('event-attendance');
  // The coordinator admits the event on each report (the events owner's ingest), so the native death
  // leaves no request to lose: the respawn rejoins on the admission its next reply carries.
  const death = await killNativeCharacter(live, W);
  await expect.poll(async () => {
    const server = await world(), state = await live.state();
    return !server.players[W].rip && server.players[W].map === 'level2w' &&
      // The hand-in that came due yields while the party attends; no Daisy walk runs.
      state.characters[W]?.joinedEvent === 'franky' && groupOf(await live.tasks(), W)?.live?.kind === 'event-attendance' &&
      state.activeConvoy?.purpose !== 'monster-hunt';
  }, { timeout: 120_000, message: 'Native respawn must rejoin the living boss without a Daisy return or manual retry' }).toBe(true);
  await info.attach('hunt-event-native-death-reentry', { body: JSON.stringify({ death, server: await world(), coordinator: await live.state() }), contentType: 'application/json' });
  await live.post('/farming-mode', { character: W, mode: 'default' });
  await expect.poll(async()=>members.includes((await world()).bossTarget),
    {timeout:30_000,message:'A real living Franky must target a party member before evacuation'}).toBe(true);
  const before = { server: await world(), coordinator: await live.state() };
  expect(before.server.bossHp).toBeGreaterThan(0);
  await info.attach('franky-party-before-disable', { body: JSON.stringify(before), contentType: 'application/json' });
  await live.post('/formation', { character: W, eventSelections: [] });
  await expect.poll(async () => [...((await live.state()).eventReturn?.participants || [])].sort(),
    { timeout: 15_000, message: 'One deselection must admit both real participants into the same recovery' }).toEqual([...members].sort());
  const recovery = (await live.state()).eventReturn;
  expect([...recovery.pending].sort()).toEqual([...members].sort());
  expect(recovery.event).toBe('franky');
  expect(recovery.exitConvoyId).toBeTruthy();
  // These are native runtime reports received through the normal /status route,
  // not coordinator command labels or fixture acknowledgements.
  await expect.poll(async () => {
    const state = await live.state(), convoy = state.activeConvoy;
    if (state.eventReturn?.cycleId !== recovery.cycleId ||
      convoy?.id !== state.eventReturn.exitConvoyId || convoy.purpose !== 'franky-exit') return false;
    return members.every(name => {
      const report = state.characters[name]?.convoyNavigation, expected = convoy.expected?.[name];
      return report?.id === convoy.id && report.epoch === convoy.epoch &&
        Number(report.commandId) > 0 && report.navigationRevision === expected?.revision &&
        !!report.runtimeId;
    });
  }, { timeout: 30_000, message: 'Both maintained native clients must report the issued exit convoy ownership' }).toBe(true);
  const admitted = { server: await world(), coordinator: await live.state() };
  expect(admitted.server.live && admitted.server.boss).toBe(true);
  expect(admitted.coordinator.eventSelectionsByCharacter[W]).not.toContain('franky');
  expect(admitted.coordinator.followers[P]).toBe(true);
  await info.attach('franky-party-native-evacuation-admission', {
    body: JSON.stringify({ recovery, admitted }, null, 2), contentType: 'application/json',
  });
  // This fragile party walks through multiple native maps at speed 54. Require
  // departure promptly, then budget the cross-map trip and bounded recovery
  // separately; a single 120-second clock conflated both on loaded runners.
  await expect.poll(async()=>{
    const server=await world();
    return members.every(name=>server.players[name].map!=='level2w'&&!server.players[name].rip);
  },{timeout:90_000,message:'Both native fighters must leave the living Franky instance'}).toBe(true);
  await expect.poll(async()=>{
    const server=await world();
    return members.every(name=>server.players[name].map==='main'&&!server.players[name].rip);
  },{timeout:180_000,message:'Both native fighters must finish the cross-map Mainland evacuation while Franky remains alive'}).toBe(true);
  const evacuated={server:await world(),coordinator:await live.state()};
  expect(evacuated.server.live&&evacuated.server.boss&&evacuated.server.bossHp>0).toBe(true);
  await info.attach('franky-party-native-evacuation-complete',{body:JSON.stringify(evacuated),contentType:'application/json'});
});
