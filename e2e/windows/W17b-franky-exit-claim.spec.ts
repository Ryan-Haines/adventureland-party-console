import {expect} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import history from '../game/franky-recovery-history.json' with { type: 'json' };

// W17b Desert gscorpion claim after a Franky exit (test-windows DESIGN.md 2.2 W17, split in
// DEVIATIONS.md). One play from the default fixture's start: the warrior leads alone and walks to
// desertland; it carries a completed gscorpion quest while Franky is live; one historical
// settings write (a coordinator start) restores the Hunt and the acknowledged Franky exit captured
// on 2026-09-28 (game/franky-recovery-history.json); the warrior resumes that Hunt from desertland
// and claims its token at Daisy while the boss stays alive.
// Failure modes (M24): the restored exit waits for another Main arrival; the Hunt never resumes
// or claims twice; the claim ends Franky or puts it back in the warrior's event selections.
// The play records M24's failure; the verdict asserts the record.
const W = 'E2EWarrior';
const tokens = (player: any) => player.items.reduce((sum: number, item: any) => sum + (item?.name === 'monstertoken' ? item.q || 1 : 0), 0);
const record: {failed?: string; initial?: unknown; handoff?: unknown; final?: unknown} = {};

async function frankyExitPlay({live, info}: LiveWorld) {
  await live.post('/formation', { leader: W });
  await live.post('/command', { character: W, type: 'character-travel', location: { map: 'desertland', x: 0, y: 0 }, label: 'Historical recovery starting position' });
  try {
  await expect.poll(async () => { const c=(await live.state()).characters[W];return c?.map==='desertland' && !c.moving; }, { timeout: 120_000 }).toBe(true);
  // Franky goes live for the window; its undo ends the event and removes the boss, so the next
  // window's reset proof sees no event.
  live.undo('the live Franky event', () => live.admin(`output=(()=>{events.franky=false;const m=get_monster('franky');if(m)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`));
  await live.admin(`output=(()=>{const p=get_player('${W}');p.s.monsterhunt={sn:region+' '+server_name,id:'gscorpion',c:0,ms:1800000};resend(p,'u+cid+reopen');events.franky=true;delete timers.franky;return p.s.monsterhunt})()`);
  const observed = () => live.admin(`output=(()=>{const p=get_player('${W}');return {franky:!!E.franky?.live,boss:!!get_monster('franky'),map:p.map,quest:p.s.monsterhunt||null,items:p.items}})()`);
  await expect.poll(async () => {const world=await observed();return world.franky&&world.boss;}, { timeout: 30_000 }).toBe(true);
  const initial = await observed(), beforeTokens=tokens(initial);
  record.initial = {map: initial.map, tokens: beforeTokens};
  expect(initial.map).toBe('desertland');
  await live.restoreHistoricalSettings(settings => {
    const now=Date.now(), intent=settings.navigationIntents[W];
    if (!intent || !Number.isFinite(intent.revision)) throw Error('Native travel must persist a navigation revision');
    const location=structuredClone(history.location);
    const monsterHunt={...structuredClone(history.monsterHunt),cycleId:'historical-hunt-'+now,startedAt:now-120_000,
      message:'Restored captured completed quest after acknowledged Franky exit',eventTrips:{[W]:[{event:'franky',startedAt:now-90_000}]}};
    const eventReturn={...structuredClone(history.eventReturn),cycleId:'historical-franky-'+now,startedAt:now-60_000,
      waypoints:{[W]:{revision:intent.revision,location}},exitConvoyId:'historical-completed-exit'};
    return {
      characterLocations:{...settings.characterLocations,[W]:location},location,farmingPolicy:'hunt',
      farmingProfiles:{...settings.farmingProfiles,[W]:{...settings.farmingProfiles?.[W],farmingPolicy:'hunt',monsterHunt,eventReturn,location,monsterFocus:['gscorpion'],activeConvoy:null}},
      eventSelectionsByCharacter:{...settings.eventSelectionsByCharacter,[W]:[]},activeConvoy:null,deferredEventReturns:{},
      eventReturn,
      monsterHunt
    };
  });
  await info.attach('historical-recovery-provenance', { body: JSON.stringify({provenance:history.provenance,initial}), contentType:'application/json' });
  await expect.poll(async () => { const state=await live.state();return !state.eventReturn && Date.now()-state.characters[W]?.seenAt<3000; }, { timeout:30_000, intervals:[100], message:'An acknowledged historical exit must resume Hunt without another Main arrival' }).toBe(true);
  const handoff=await observed();
  record.handoff = {map: handoff.map};
  await info.attach('franky-handoff-position', { body:JSON.stringify({observedAt:Date.now(),handoff,state:await live.state()}),contentType:'application/json' });
  expect(handoff.map).toBe('desertland');
  await expect.poll(async () => tokens(await observed()), { timeout:180_000, message:'Native Hunt must claim the actual completed gscorpion reward at Daisy' }).toBe(beforeTokens+1);
  const final=await observed();
  record.final = {map: final.map, franky: final.franky, boss: final.boss};
  expect(final.map).toBe('main');
  expect(final.franky&&final.boss).toBe(true);
  expect((await live.state()).eventSelectionsByCharacter[W]).not.toContain('franky');
  await info.attach('franky-restored-hunt-reward', { body:JSON.stringify({final,state:await live.state()}),contentType:'application/json' });
  } catch (error) {
    record.failed = String((error as Error)?.message ?? error).slice(0, 2000);
  }
}

liveWindow({
  id: 'W17b', name: 'Desert gscorpion claim after a Franky exit',
  // M24's old test bound (live-franky.spec.ts at 21fe30a2b, 360 s).
  timeoutMs: 360_000,
  play: frankyExitPlay,
  observers: [{
    id: 'M24', owner: 'events', behaviours: [], start() {},
    verdict() { expect(record.failed, 'M24: every step of the play passes').toBeUndefined(); },
    reads: () => record,
  }],
});
