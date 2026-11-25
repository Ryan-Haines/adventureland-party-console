import {expect} from '../live-fixtures';
import {poll} from '../gameplay-clock';
import {liveWindow, type LiveWorld} from '../windows';
import {warrior as W,priest as P,party,quests,location,start,hunt,profile,observed,evidence} from '../game/hunt-lifecycle';

// W62 A Hunt target the party cannot reach (test-windows DESIGN.md 2.2 W62, 2.3: the quest's
// target stays unreachable for the whole play, and every other Hunt window's checks read a target
// the party reaches and kills). HN46e (party-console-plan docs/specs/07-fix-hunt-unreachable-target.md):
// the 2026-11-24 harpy Hunt. winter_cove's harpy spawn is `random` and `roam`, and on that day every
// harpy stood where ALClient found no route from the box [135, -311]. The play plants that: the
// map's own harpies go, and three planted ones stand near (-190, -1350), where the planner refuses a
// route from the box. Planted monsters neither roam nor respawn.
// Failure mode: the party idles at the box until the quest ends. It must search the map's routed
// points, then farm the backup goo field while the harpy quest still runs, with no blacklist entry
// and no setting change.
// H46e's checks are the play's own steps: a failed step ends the play and the runner marks H46e
// not observed, with that step's message.
async function harpyUnreachablePlay({live, info}: LiveWorld) {
  await party(live);
  // The play's finally puts back winter_cove's held respawns and removes the planted harpies.
  const planted=await live.admin(`output=(()=>{const map='winter_cove';
    for(const m of Object.values(instances[map].monsters))remove_monster(m,{method:'disappear',nospawn:true});
    globalThis.__e2eHarpyRespawns=[];
    for(let i=monster_respawns.length-1;i>=0;i--)if(monster_respawns[i][0]?.map===map)globalThis.__e2eHarpyRespawns.push(...monster_respawns.splice(i,1));
    return [[-190,-1350],[-160,-1330],[-200,-1300]].map(([x,y])=>{const m=new_monster(map,{type:'harpy',__e2eAmbientExempt:true,position:[x,y],radius:0,count:1},{temp:1});return {id:m.id,x:m.x,y:m.y};});})()`);
  const trail:unknown[]=[];
  try{
    await info.attach('planted-harpies',{body:JSON.stringify(planted),contentType:'application/json'});
    expect(planted).toHaveLength(3);
    const settingsBefore=JSON.stringify(profile(await live.state()).huntSettings??null);
    await quests(live,info,{[W]:{id:'harpy',count:3,ms:1_800_000},[P]:{id:'harpy',count:3,ms:1_800_000}});
    const goo=await location(live,'goo');
    await start(live,W,'goo',goo);
    // Each distinct search record and stage the coordinator shows, in order.
    let last='';
    const look=async()=>{
      const state=await live.state(),h=hunt(state),mission=h?.missions?.[h.currentIndex];
      const key=JSON.stringify([h?.stage,h?.search,h?.released,mission?.destination]);
      if(key!==last){last=key;trail.push({at:Date.now(),stage:h?.stage,target:h?.target,search:h?.search,released:h?.released,
        destination:mission?.destination,sightings:Object.fromEntries([W,P].map(n=>[n,state.characters?.[n]?.huntSightings??null]))});}
      return h;
    };
    await poll(live,async()=>(await look())?.search?.target==='harpy',
      {timeout:420_000,intervals:[1000,2000],message:'The harpy mission must start its search at winter_cove'}).toBe(true);
    await poll(live,async()=>{const h=await look();return !!h?.backup&&h.released?.harpy!==undefined;},
      {timeout:420_000,intervals:[1000,2000],message:'A search with no routed harpy must release the Hunt to backup farming'}).toBe(true);
    const released=await observed(live);
    // The quest still runs: the release came from the search, not the quest's deadline.
    for(const name of [W,P])expect(released[name].quest?.id).toBe('harpy');
    expect(profile(await live.state()).huntBlacklist?.harpy).toBeUndefined();
    expect(JSON.stringify(profile(await live.state()).huntSettings??null)).toBe(settingsBefore);
    // The party farms the backup goo field instead of standing at the harpy box.
    await poll(live,async()=>{await look();return live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)}),t=p&&p.target&&instances[p.in].monsters[p.target];return !!t&&t.type==='goo'&&p.map===${JSON.stringify(goo.map)}})()`);},
      {timeout:300_000,intervals:[1000,2000],message:'The released party must fight on the backup goo field'}).toBe(true);
    const after=await observed(live);
    for(const name of [W,P])expect(after[name].quest?.id).toBe('harpy');
    await evidence(live,info,'hunt-unreachable-released-to-backup',{planted,goo});
  }finally{
    await info.attach('hunt-search-trail',{body:JSON.stringify(trail,null,1),contentType:'application/json'});
    await live.admin(`output=(()=>{for(const p of ${JSON.stringify(planted??[])}){const m=instances.winter_cove.monsters[p.id];if(m)remove_monster(m,{silent:true});}
      monster_respawns.push(...(globalThis.__e2eHarpyRespawns||[]));delete globalThis.__e2eHarpyRespawns;return true;})()`);
  }
}

liveWindow({
  id: 'W62', name: 'A Hunt target the party cannot reach',
  // The old test's bound: 900 s (e2e/live-hunt-unreachable.spec.ts at c55ef2863); it took 5.2, 3.2
  // and 1.8 min in its three runs (07-fix-hunt-unreachable-target.md, live-2026-11-25/harpy-run2.log).
  timeoutMs: 900_000,
  play: harpyUnreachablePlay,
  observers: [{id: 'H46e', owner: 'hunting', behaviours: [], start() {}, verdict() {}}],
});
