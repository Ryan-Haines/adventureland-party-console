import {expect} from '../live-fixtures';
import {liveWindow, type LiveWorld} from '../windows';
import {W,P,hunt,observed,reward,spawnGoo,killedByParty,evidence} from '../hunt-interruption-helpers';
import {prepareHunt,start} from '../game/hunt-lifecycle';

// W17a Armadillo Hunt on foot with passing goos (test-windows DESIGN.md 2.2 W17, split in
// DEVIATIONS.md). One play from the default fixture's start: both fighters take a one-kill
// armadillo quest and put Town on a 600 s cooldown, goo becomes a keep-moving rare, and the party
// Hunts armadillo on Main on foot. A goo is planted 400 ahead on the outbound walk and the party
// kills it while travelling; after the armadillo kill a second goo is planted 400 ahead on the
// return walk and killed the same way; both fighters claim at Daisy.
// Failure modes (H3): a reachable low-HP encounter is passed without a proposal, a cohort
// acknowledgement or an admitted native attack; the kill lands while the convoy is not
// travelling or on another convoy; the armadillo quest is lost to the passing kill; a token is
// lost or claimed twice.
// The play records H3's failure and its observations; the verdict asserts the record.
const record: {failed?: string; outboundConvoyId?: string; returningConvoyId?: string; kills: unknown[]} = {kills: []};

async function armadilloPlay({live, info}: LiveWorld) {
  // A planted goo the party never kills stays on the map, and the Town cooldown stays on the
  // client page, which the next window may reuse.
  live.undo('the planted passing goos', () => live.admin(`output=(()=>{for(const i of Object.values(instances))for(const m of Object.values(i.monsters||{}))if(m.e2eHunt)remove_monster(m,{silent:true});return true;})()`));
  live.undo('the planted Town cooldown', async () => { for (const name of [W,P]) await live.clients[name].run('(delete parent.next_skill.use_town,true)').catch(() => null); });
  // Failure inventory: a reachable low-HP encounter can be passed without
  // proposal, cohort acknowledgement, or an admitted native attack. Preserve
  // bounded real client observations even when the existing kill check fails.
  const passingObservations:unknown[]=[];
  let outboundConvoyId:string|undefined,returningConvoyId:string|undefined;
  const setup={...await prepareHunt(live,{monster:'armadillo',count:1}),before:await observed(live)};
  try {
    const townCooldown=await Promise.all([W,P].map(name=>live.clients[name].run("(()=>{parent.skill_timeout_singular('use_town',600000);return {name:character.name,until:+parent.next_skill.use_town,now:Date.now()};})()")));
    expect(townCooldown.every(value=>Number.isFinite(value.until)&&value.until-value.now>=590000)).toBe(true);
    const townReadiness=await Promise.all([W,P].map(name=>live.clients[name].run("can_use('use_town')&&!is_on_cooldown('use_town')")));
    expect(townReadiness.every(ready=>ready===false),'Passing encounters require genuine walking without a Town shortcut').toBe(true);
    await info.attach('declared-passing-native-town-cooldown',{body:JSON.stringify({townCooldown,townReadiness}),contentType:'application/json'});
    await live.post('/rare-hunting',{rules:{goo:{enabled:true,keepMoving:true,priority:100}},useFieldGenerators:false});
    await start(live,W,setup.monster,setup.location);
    await expect.poll(async()=>{
      const s=await live.state();
      const ready=hunt(s)?.stage==='mission-travel'&&s.activeConvoy?.phase==='travel'&&
        await live.clients[W].run('!!character.moving && !(character.c && character.c.town)');
      if(ready)outboundConvoyId=s.activeConvoy.id;return ready;
    },{timeout:90000,intervals:[100,250],message:'Introduce the outbound Goo during native walking, after any Town cast'}).toBe(true);
    // Seed ahead on the actual walking leg so native visibility and the party's
    // reservation exchange can precede reaching melee range on slower hosts.
    const outboundStartedAt=Date.now();
    const outbound=await spawnGoo(live,W,0,400);
    await info.attach('outbound-passing-goo-seed',{body:JSON.stringify(outbound),contentType:'application/json'});
    const outboundKill=await killedByParty(live,String(outbound.id),45000,passingObservations,{passingGoo:true,startedAt:outboundStartedAt,convoyId:outboundConvoyId});
    record.kills.push(outboundKill);
    expect((await observed(live))[W].quest?.id).toBe('armadillo');
    await evidence(live,info,'outbound-passing-goo-killed',{outbound,outboundKill});
    await expect.poll(async()=>{const p=(await observed(live))[W];return p.quest?.id==='armadillo'&&p.quest.c===0;},{timeout:240000,intervals:[100,250]}).toBe(true);
    await expect.poll(async()=>{
      const s=await live.state();
      const ready=hunt(s)?.stage==='returning'&&s.activeConvoy?.phase==='travel'&&
        await live.clients[W].run('!!character.moving && !(character.c && character.c.town)');
      if(ready)returningConvoyId=s.activeConvoy.id;return ready;
    },{timeout:90000,intervals:[100,250],message:'Introduce the return Goo during native walking, after any Town cast'}).toBe(true);
    const returningStartedAt=Date.now();
    const returning=await spawnGoo(live,W,0,400);
    await info.attach('returning-passing-goo-seed',{body:JSON.stringify(returning),contentType:'application/json'});
    const returningKill=await killedByParty(live,String(returning.id),45000,passingObservations,{passingGoo:true,startedAt:returningStartedAt,convoyId:returningConvoyId});
    record.kills.push(returningKill);
    await reward(live,setup.before);
    await evidence(live,info,'armadillo-return-goo-and-daisy-reward',{outbound,outboundKill,returning,returningKill});
  } catch (error) {
    record.failed = String((error as Error)?.message ?? error).slice(0, 2000);
  } finally {
    Object.assign(record, {outboundConvoyId, returningConvoyId});
    await info.attach('native-passing-admission-observations',{body:JSON.stringify(passingObservations),contentType:'application/json'});
  }
}

liveWindow({
  id: 'W17a', name: 'Armadillo Hunt on foot with passing goos',
  // H3's old test bound (live-hunt-combat.spec.ts describe at 21fe30a2b, 480 s).
  timeoutMs: 480_000,
  play: armadilloPlay,
  observers: [{
    id: 'H3', owner: 'targeting', behaviours: [], start() {},
    verdict() { expect(record.failed, 'H3: every step of the play passes').toBeUndefined(); },
    reads: () => record,
  }],
});
