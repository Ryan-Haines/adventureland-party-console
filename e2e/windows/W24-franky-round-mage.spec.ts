import {expect} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {killNativeCharacter} from '../hunt-interruption-helpers';
import {groupOf} from '../task-records';

// W24 Franky round with a mage (test-windows DESIGN.md 2.2 W24; C60 joins by DESIGN.md 6 Q6 (a)).
// One play from the default fixture's start with the warrior, the priest and the extra mage
// (E2EBankBoi), the priest and the mage following the warrior:
//   the start: Franky goes live weakened (attack 1, no adds, aggro 0) and pinned to one corner of
//   level2w; the warrior selects it and the followers inherit it; all three join.
//   C60: five passive goos stand on the mage's side between it and the boss; the mage takes the
//   event approach into its range of Franky; the goos go.
//   M20 (first half): the party's combat damages the boss and a fighter owns boss combat.
//   M21: each member's own stunned nerfedmummy targets it; each selects and damages its own; the
//   mummies die and all three return to the boss; the warrior gets a waxe and two nerfedmummies
//   beside it and Cleaves both; the mummies go.
//   M20 (second half): completed goo quests and a Hunt suspend under the attendance task; the
//   warrior dies and its respawn rejoins with no Daisy walk; deselecting Franky puts all three in
//   one event return with its exit convoy, and they walk to Main with the boss alive.
// The window's undo ends the event, removes the boss and restores Franky's definition and the
// level2w boundary; C60's old test left the event live (DESIGN.md 4.3 C60).
// Failure modes: C60, the mage holds behind the adds outside its range; M21, a member assists
// another's mummy, keeps a dead one selected or Franky blocks Cleave; M20, the respawn walks to
// Daisy, the deselection leaves a member behind or the exit waits for the boss to die.
// Each check's assertions are its old test's, with their messages, so the coverage ledger matches
// them. A failed step records its message under its check and the play goes on.
// Every old spec this window cites is at 21fe30a2b.
const W = 'E2EWarrior', P = 'E2EPriest', M = 'E2EBankBoi', members = [W, P, M];
// M21's members are every member of the visit.
const names = members;
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (ids: string[], run: () => Promise<unknown>) => {
  try { await run(); return true; } catch (error) { for (const id of ids) failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); return false; }
};
function cleaveLanded(events: any[], ids: string[]): boolean {
  return events.some(e => e.event === 'game_response' && e.data?.place === 'cleave' &&
    e.data.success === true && e.data.attacker === W && ids.every(id => e.data.targets?.includes(id))) &&
    ids.every(id => events.some(e => e.event === 'hit' && e.data?.source === 'cleave' &&
      e.data.hid === W && String(e.data.id) === id && e.data.damage > 0));
}
async function removeOwnedMummies(live: LiveWorld['live'], ids: string[]) {
  if (!ids.length) return;
  await live.admin(`output=(()=>{for(const id of ${JSON.stringify(ids)}){
    const matches=Object.values(instances).map(i=>i.monsters[id]).filter(Boolean);
    if(matches.length>1||matches.some(m=>!['mummy','nerfedmummy'].includes(m.type)))throw Error('Owned mummy identity mismatch');
    for(const m of matches)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
}

async function frankyRoundPlay({live, info}: LiveWorld) {
  // M20's world read, with the boss's position for C60.
  const world = () => live.admin(`output={live:!!E.franky?.live,boss:!!get_monster('franky'),bossHp:get_monster('franky')?.hp,bossTarget:get_monster('franky')?.target,
    bossAt:get_monster('franky')&&{x:get_monster('franky').x,y:get_monster('franky').y},
    players:Object.fromEntries(${JSON.stringify(members)}.map(name=>{const p=get_player(name);
      return [name,{map:p.map,x:p.x,y:p.y,rip:!!p.rip}]}))}`);
  await live.post('/formation', { leader: W });
  for (const name of [P, M]) await live.post('/formation', { character: name, follow: true });
  // The event, the boss and the patched definition and boundary outlive the play, so the next
  // window's reset proof would see a live Franky.
  live.undo('the live Franky event', () => live.admin(`output=(()=>{events.franky=false;const m=get_monster('franky');if(m)remove_monster(m,{method:'disappear',nospawn:true});
    if(globalThis.__e2eFrankyDefinition)Object.assign(G.monsters.franky,globalThis.__e2eFrankyDefinition);
    if(globalThis.__e2eFrankyBoundary)G.maps.level2w.monsters[0].boundary=globalThis.__e2eFrankyBoundary;
    delete globalThis.__e2eFrankyDefinition;delete globalThis.__e2eFrankyBoundary;return true;})()`));

  // The start: one live weakened Franky that all three join.
  let initialBossHp = 0;
  const joined = await step(['M20', 'C60', 'M21'], async () => {
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
  await expect.poll(async () => !!(await world()).boss, { timeout: 30_000 }).toBe(true);
  initialBossHp=(await world()).bossHp;
  // The followers inherit the warrior's selection, which M20's deselection revokes for all three.
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
  await expect.poll(async () => {
    const state = await live.state();
    return members.every(name => state.characters[name]?.map === 'level2w' && state.characters[name]?.joinedEvent === 'franky');
  }, { timeout: 180_000, message: 'The warrior, the priest and the mage must join the living Franky' }).toBe(true);
  await expect.poll(async () => {
    const s=await live.state();return names.every(n=>s.characters[n]?.joinedEvent==='franky'&&s.characters[n]?.map==='level2w');
  }, { timeout: 120_000 }).toBe(true);
  reads.start = {seed: seed.initialBoundary, initialBossHp};
  });
  if (!joined) return;

  // C60 (live-movement-bug7.spec.ts, D.BUG7): the adds, passive goos on the mage's side of the
  // boss, between it and every formation corner its local detour could take.
  await step(['C60'], async () => {
    let planted: any;
    try {
    planted = await live.admin(`output=(()=>{const m=get_player('${M}'),b=get_monster('franky'),dx=m.x-b.x,dy=m.y-b.y,d=Math.hypot(dx,dy)||1;
      const ids=[];for(const [along,side] of [[0.5,0],[0.5,30],[0.5,-30],[0.7,15],[0.7,-15]]){
        const x=b.x+dx*along-dy/d*side,y=b.y+dy*along+dx/d*side;
        const a=new_monster(m.in,{type:'goo',position:[x,y],radius:0,count:1},{temp:1});ids.push(a&&a.id);}
      return {ids,mage:{x:m.x,y:m.y},boss:{x:b.x,y:b.y}};})()`);
    await info.attach('bug7-adds', { body: JSON.stringify(planted), contentType: 'application/json' });
    const range = await live.clients[M].run('character.range');
    await expect.poll(async () => {
      const server = await world(), mage = server.players[M];
      return !!server.boss && !mage.rip && Math.hypot(mage.x - server.bossAt.x, mage.y - server.bossAt.y) <= Number(range);
    }, { timeout: 90_000, message: 'The blocked mage must take the event approach into its range of Franky' }).toBe(true);
    reads.C60 = {planted, range};
    await info.attach('bug7-in-range', { body: JSON.stringify({ server: await world(), coordinator: await live.state() }), contentType: 'application/json' });
    } finally {
      // The goos stand between the mage and the boss for C60 only.
      if (planted?.ids?.length) await live.admin(`output=(()=>{for(const id of ${JSON.stringify(planted.ids.filter(Boolean).map(String))}){
        for(const i of Object.values(instances)){const m=i.monsters[id];if(m&&m.type==='goo')remove_monster(m,{method:'disappear',nospawn:true});}}return true;})()`);
    }
  });

  // M20's boss damage (live-franky-party.spec.ts) before M21 raises the boss's HP.
  await step(['M20'], async () => {
  await expect.poll(async()=>(await world()).bossHp,{timeout:90_000,message:'Real visible Franky combat must damage the living boss before deselection'}).toBeLessThan(initialBossHp);
  await expect.poll(async()=>{
    const state=await live.state();
    return members.some(name=>state.characters[name]?.target?.mtype==='franky'&&state.characters[name]?.activeCombatTarget);
  },{timeout:15_000,message:'At least one native fighter must still own active boss combat'}).toBeTruthy();
  });

  // M21 (live-franky.spec.ts, Franky personal defense and Cleave). Failure inventory: group assist
  // steals personal defense; sticky boss hides attackers; a dead mummy remains selected; Franky
  // still blocks Cleave. Franky's attackers are the boss's own spawn type in the game data
  // (`nerfedmummy`).
  await step(['M21'], async () => {
    const owned: string[] = [];
    try {
    const seeded = await live.admin(`output=(()=>{const boss=get_monster('franky');boss.hp=boss.max_hp=100000000;
      const mummies=${JSON.stringify(names)}.map(name=>{const p=get_player(name);
        const m=new_monster(p.in,{type:'nerfedmummy',position:[p.x+12,p.y],radius:0,count:1},{temp:1});
        m.hp=m.max_hp=100000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);
        return {name,id:String(m.id),hp:m.hp,in:m.in};});return {boss:String(boss.id),mummies};})()`);
    owned.push(...seeded.mummies.map((m:any)=>m.id));
    await expect.poll(async () => {
      const state=await live.state();return seeded.mummies.every((m:any)=>String(state.characters[m.name]?.target?.id)===m.id);
    }, { timeout: 30_000, message: 'Each member must select its own mummy rather than assist another member' }).toBe(true);
    await expect.poll(async () => live.admin(`output=${JSON.stringify(seeded.mummies)}.every(e=>instances[e.in].monsters[e.id]?.hp<e.hp)`),
      { timeout: 30_000, message: 'Both selected mummies receive real native damage' }).toBe(true);
    await info.attach('personal-mummy-defense', { body: JSON.stringify({seeded,state:await live.state()}), contentType:'application/json' });
    await live.admin(`output=${JSON.stringify(seeded.mummies)}.map(e=>{const m=instances[e.in].monsters[e.id];if(m){m.hp=1;m.s={};}return true;})`);
    await expect.poll(async () => live.admin(`output=${JSON.stringify(seeded.mummies)}.every(e=>!instances[e.in].monsters[e.id]||instances[e.in].monsters[e.id].dead)`),
      { timeout: 30_000 }).toBe(true);
    await expect.poll(async () => {
      const s=await live.state();return names.every(n=>String(s.characters[n]?.target?.id)===seeded.boss);
    }, { timeout: 30_000 }).toBe(true);
    const cleaveSeed = await live.admin(`output=(()=>{const p=get_player('${W}');p.slots.mainhand={name:'waxe',level:0};p.slots.offhand=null;p.cslots.mainhand=cache_item(p.slots.mainhand);p.cslots.offhand=null;calculate_player_stats(p);p.mp=p.max_mp;
      const ids=[];for(const dx of [-15,15]){const m=new_monster(p.in,{type:'nerfedmummy',position:[p.x+dx,p.y],radius:0,count:1},{temp:1});
        m.hp=m.max_hp=100000;m.attack=1;m.s.stunned={ms:600000};target_player(m,p);ids.push(String(m.id));}
      resend(p,'u+cid+reopen');return {ids,mp:p.mp};})()`);
    owned.push(...cleaveSeed.ids);
    reads.M21 = {seeded, cleave: cleaveSeed.ids};
    try { await expect.poll(async () => cleaveLanded(await live.clients[W].events(), cleaveSeed.ids),
      { timeout: 30_000, message:'Native Cleave must hit both declared nearby enemies' }).toBe(true); }
    finally {
      const frame=await live.clients[W].run(`(()=>({actor:{level:character.level,mp:character.mp,x:character.x,y:character.y,slots:character.slots},skill:G.skills.cleave,
        weapon:G.items[character.slots.mainhand.name]?.wtype,franky:__partyEventFacts.frankyActive(),cooldown:is_on_cooldown('cleave'),
        monsters:Object.values(parent.entities).filter(t=>t.type==='monster').map(t=>({id:t.id,type:t.mtype,target:t.target,distance:distance(character,t)}))}))()`);
      await info.attach('cleave-runtime-observation',{body:JSON.stringify({...frame,turns:(await live.state()).characters[W]?.turns??null}),contentType:'application/json'}); }
    await info.attach('franky-native-cleave', { body:JSON.stringify({cleaveSeed,events:await live.clients[W].events(),state:await live.state()}),contentType:'application/json' });
    } finally { await removeOwnedMummies(live, owned); }
  });

  // M20's death, deselection and evacuation (live-franky-party.spec.ts).
  await step(['M20'], async () => {
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
  // final-gate-closing10: the exit's route begins with a Town warp inside level2w, and each
  // fighter's own attack on Franky ended its channel (server.js:3519 `attacker.c = {}`) while the
  // convoy declared no defence. The end read is each fighter's attack decisions: its combat state,
  // its game target and channel, and the targeting and turns rings that hold each gate's answer.
  try {
    await expect.poll(async()=>{
      const server=await world();
      return members.every(name=>server.players[name].map!=='level2w'&&!server.players[name].rip);
    },{timeout:90_000,message:'Both native fighters must leave the living Franky instance'}).toBe(true);
  } catch (error) {
    const decisions=await Promise.all(members.map(name=>live.clients[name].run(`(()=>{const h=globalThis.__partyHooks;
      return {name:character.name,target:character.target,channel:character.c??null,combat:globalThis.partyCombatState??null,
        targetingRing:(h?.ask('targeting.records')??[]).slice(-40),turnsRing:(h?.ask('skills.records')??[]).slice(-40)};})()`)));
    const s=await live.state();
    await info.attach('franky-exit-attack-decisions',{body:JSON.stringify({decisions,convoy:s.activeConvoy,
      walks:Object.fromEntries(members.map(name=>[name,{movement:s.characters[name]?.movement,convoyNavigation:s.characters[name]?.convoyNavigation,combat:s.characters[name]?.combat}]))}),contentType:'application/json'});
    throw error;
  }
  await expect.poll(async()=>{
    const server=await world();
    return members.every(name=>server.players[name].map==='main'&&!server.players[name].rip);
  },{timeout:180_000,message:'Both native fighters must finish the cross-map Mainland evacuation while Franky remains alive'}).toBe(true);
  const evacuated={server:await world(),coordinator:await live.state()};
  expect(evacuated.server.live&&evacuated.server.boss&&evacuated.server.bossHp>0).toBe(true);
  reads.M20 = {death: {attempts: death.attempts}, recovery: {cycleId: recovery.cycleId, participants: recovery.participants, exitConvoyId: recovery.exitConvoyId}};
  await info.attach('franky-party-native-evacuation-complete',{body:JSON.stringify(evacuated),contentType:'application/json'});
  });
}

// M21 is one more check of the same Franky visit (DESIGN.md 4.2 M21), with its own observer.
const own = (id: string, owner: string, behaviours: string[]) => ({
  owner, behaviours, start() {}, reads: () => ({failed: failed[id] ?? null, start: reads.start ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); },
});

liveWindow({
  id: 'W24', name: 'Franky round with a mage',
  // M20's old test bound, 480 s, plus C60's 90 s range poll and M21's five 30 s polls.
  timeoutMs: 720_000,
  use: {loadout: 'fragile', extraFighter: 'mage'},
  play: frankyRoundPlay,
  observers: [
    {id: 'C60', ...own('C60', 'movement', ['MOV-131'])},
    {id: 'M21', ...own('M21', 'events', ['EVT-048', 'TRN-010', 'TRN-020'])},
    {id: 'M20', ...own('M20', 'events', ['EVT-031', 'EVT-050', 'EVT-048'])},
  ],
});
