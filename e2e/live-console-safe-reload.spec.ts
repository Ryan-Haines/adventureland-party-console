import {test,expect} from './live-fixtures';
import {W,P,M,evidence} from './hunt-interruption-helpers';

test.use({loadout:'combat-range',initialPosition:{map:'main',x:1260,y:-70}});
test('safe console reload finishes the native fight without acquiring the next target',async({live},info)=>{
  test.setTimeout(180000);
  // Failure inventory: docs/testing-safe-console-reload.md.
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{goo:999},monsterSearchRadius:300});
  await live.post('/farming-mode',{character:W,mode:'default'});
  await live.post('/checkpoint',{});
  const seeded=await live.admin(`output=(()=>{
    const p=get_player('${W}'),saved=[];
    for(const m of Object.values(instances.main.monsters))if(Math.hypot(m.x-p.x,m.y-p.y)<800){saved.push(m.id);remove_monster(m,{method:'disappear',nospawn:true});}
    const a=new_monster('main',{type:'goo',position:[p.x+30,p.y],radius:0,count:1},{temp:1});
    a.hp=a.max_hp=15000;
    return {first:String(a.id),next:null,map:p.map,x:p.x,y:p.y,removed:saved};
  })()`);
  const hit=(events:any[],id:string)=>events.filter(e=>e.event==='hit'&&String(e.data?.id)===id&&e.data?.hid===W&&e.data?.source==='attack');
  const samples:any[]=[];
  try{
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.first).length,{timeout:45000}).toBeGreaterThan(0);
    const before=hit(await live.clients[W].events(),seeded.first).length;
    live.consoleDrainLease('native-safe-reload');
    await expect.poll(async()=>{const state=await live.state();return [W,P,M].every(name=>state.characters[name]?.consoleMaintenance?.id==='native-safe-reload');},{timeout:15000}).toBe(true);
    seeded.next=await live.admin(`output=(()=>{const m=new_monster('main',{type:'goo',position:[${seeded.x+85},${seeded.y}],radius:0,count:1},{temp:1});m.hp=m.max_hp=15000;return String(m.id);})()`);
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.first).length,{timeout:15000,
      message:'Native attacks must continue after the acquisition hold'}).toBeGreaterThan(before);
    await expect.poll(async()=>{
      const state=await live.state();
      const report=state.characters[W];
      samples.push({at:Date.now(),maintenance:report?.consoleMaintenance,target:report?.combatSelection?.id,position:report?.activeCombatTarget});
      return (await live.clients[W].events()).some((event:any)=>event.event==='death'&&String(event.data?.id)===seeded.first);
    },{timeout:90000,intervals:[250,500]}).toBe(true);
    await expect.poll(async()=>{const state=await live.state();return [W,P,M].every(name=>state.characters[name]?.consoleMaintenance?.ready===true);},
      {timeout:15000,message:'Fresh participants must report the finished fight as safe'}).toBe(true);
    await live.clients[W].page.waitForTimeout(1500);
    expect(hit(await live.clients[W].events(),seeded.next),'The pending reload must not acquire the next monster').toHaveLength(0);
    expect(await live.clients[W].run('sharedRoutine.queueMarkers().filter(m=>m.role==="current"&&m.visible).length')).toBe(0);
    await evidence(live,info,'safe-reload-native-combat-drain',{seeded,samples,firstHits:hit(await live.clients[W].events(),seeded.first),nextHits:hit(await live.clients[W].events(),seeded.next)});
    await info.attach('safe-reload-no-red-circle',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
    live.consoleDrainLease('native-safe-reload',Date.now()-1);
    await expect.poll(async()=>hit(await live.clients[W].events(),seeded.next).length,{timeout:30000,
      message:'An expired host hold must restore normal acquisition'}).toBeGreaterThan(0);
  }finally{live.consoleDrainLease(null);await live.admin(`output=(()=>{for(const id of ${JSON.stringify([seeded.first,seeded.next])}){const m=instances.main.monsters[id];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);}
});
