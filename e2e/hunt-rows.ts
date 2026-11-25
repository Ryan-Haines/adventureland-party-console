import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {groupOf,taskTrail} from './task-records';
import {prepareHunt,start} from './game/hunt-lifecycle';
import {W,M,fighters,hunt,observed,reward,seedCargo,totalLeather,evidence,quantity,killNativeCharacter} from './hunt-interruption-helpers';

// The Hunt rows, moved in the tasks owner step 8 (the test cut) from live-hunt-controls.spec.ts,
// live-hunt-events.spec.ts and live-hunt-merchant.spec.ts, all at 21fe30a2b. W07b plays
// `merchantCollection`, which seeds its own quests and starts its own Hunt.

// The two hold variants put the warrior on Manual before the
// collection. Under Carries on the visit waits until the hold ends; under Follows me the merchant
// delivers where the warrior stands. The escape, death recovery, Cave and turn-in refusals
// are the rule table's column (movement-rules "task failure 4"): /bank-party is a player
// command, which ends an escape or a death recovery first, so no live setup queues a visit
// into one.
const merchantFaults=['coordinator restart','queued merchant death','active merchant death','a member on Manual that carries on','a member on Manual that follows me'] as const;
// W07b plays both hold variants on one collection (test-windows DESIGN.md 2.2 W07): the visit
// queues on the warrior on Manual that carries on, then the player switches it to Follows me and
// the merchant delivers where it stands. Each variant's readings go to its half of the record and
// its verdict asserts them, so a failure in one still lets the other report.
export type ManualRecord={carries:{queued?:unknown;holdStands?:boolean;leather?:number};follows:{moved?:number}};
export const manualRecord=():ManualRecord=>({carries:{},follows:{}});
export function carriesVerdict(record:ManualRecord){
  if(record.carries.queued!==true)throw record.carries.queued??Error('the play never sent the visit into the warrior on Manual');
  expect(record.carries.holdStands,'the Manual hold still stands').toBe(true);
  expect(record.carries.leather,'no visit into a member on Manual that carries on').toBeGreaterThan(0);
}
export function followsVerdict(record:ManualRecord){
  expect(record.follows.moved,'the warrior on Manual stays where it stood').toBeLessThan(1);
}
export async function merchantCollection(live:LiveGame,info:TestInfo,fault:typeof merchantFaults[number]|'a member on Manual that carries on, then follows me',record=manualRecord()){
  const then=fault==='a member on Manual that carries on, then follows me'?'follows-me':null;
  const setup={...await prepareHunt(live,{monster:'armadillo',count:1}),before:await observed(live)};await seedCargo(live);
  const total=await totalLeather(live);
  if(fault==='queued merchant death')await live.post('/merchant/force-stand',{enabled:true});
  await start(live,W,setup.monster,setup.location);
  await expect.poll(async()=>{const s=await live.state();return hunt(s)?.stage==='mission-travel'&&!!s.activeConvoy;},{timeout:90000}).toBe(true);
  const cycle=hunt(await live.state()).cycleId;
  const held=fault==='a member on Manual that carries on'||then?'carries-on':fault==='a member on Manual that follows me'?'follows-me':null;
  if(held){
    await live.post('/formation',{character:W,handControl:{on:true,party:held}});
    await expect.poll(async()=>(await live.tasks()).groups.some((g:any)=>g.holds.some((h:any)=>h.member===W&&h.by==='manual'&&h.party===held)),
      {timeout:30000,message:'The warrior goes on Manual'}).toBe(true);
    await expect.poll(async()=>await live.clients[W].run('globalThis.partyTasks.holds.handControl()?.by')==='manual'&&!(await observed(live))[W].moving,
      {timeout:30000,message:'The warrior on Manual stops'}).toBe(true);
  }
  const heldAt=held&&(await observed(live))[W];
  await live.post('/bank-party',{});
  if(held==='carries-on'){
    // The visit queues and waits: the merchant holds a job naming the warrior while
    // the warrior keeps its marked stack and its Manual hold; releasing the hold lets it run below.
    record.carries.queued=await expect.poll(async()=>{const s=await live.state();return [s.merchantCurrent,...(s.merchantQueue||[])].some((job:any)=>job?.target===W);},
      {timeout:90000,message:'The merchant queues the visit into the warrior on Manual'}).toBe(true).then(()=>true,error=>error);
    record.carries.holdStands=groupOf(await live.tasks(),W).holds.some((h:any)=>h.member===W&&h.by==='manual'&&h.party==='carries-on');
    record.carries.leather=quantity((await observed(live))[W].items,'leather');
  }
  if(held==='carries-on')await live.post('/formation',{character:W,handControl:then?{on:true,party:then}:{on:false}});
  if(fault==='queued merchant death') {
    await expect.poll(async()=>(await live.state()).merchantQueue.length,{timeout:20000}).toBeGreaterThan(0);
  } else if(held) {
    await expect.poll(async()=>!!(await live.state()).merchantCurrent||quantity((await observed(live))[W].items,'leather')===0,{timeout:90000}).toBe(true);
  } else {
    await expect.poll(async()=>!!(await live.state()).merchantCurrent,{timeout:90000}).toBe(true);
    await expect.poll(async()=>{const s=await live.state();return !!s.activeConvoy?.merchantInterruption||s.commands?.[W]?.type==='merchant-handoff';},
      {timeout:90000,intervals:[100,250],message:'Native collection must actually interrupt the owned Hunt convoy before fault injection'}).toBe(true);
  }
  await evidence(live,info,'hunt-merchant-owned-before-fault',{fault,total,cycle,destination:setup.location});
  if(fault==='coordinator restart')await live.restartCoordinator();
  else if(held) { /* the hold is the fault */ }
  else {
    const death=await killNativeCharacter(live,M);
    await info.attach('native-merchant-death',{body:JSON.stringify(death,null,2),contentType:'application/json'});
    await expect.poll(async()=>(await observed(live))[M].rip,{timeout:15000}).toBe(true);
    await expect.poll(async()=>{const m=(await observed(live))[M];return !m.rip&&m.hp>0;},{timeout:120000}).toBe(true);
    if(fault==='queued merchant death')await live.post('/merchant/force-stand',{enabled:false});
  }
  const continued=hunt(await live.state());
  if(fault==='queued merchant death'&&continued?.cycleId!==cycle) {
    const completed=await observed(live);
    expect(fighters.every(name=>quantity(completed[name].items,'monstertoken')===quantity(setup.before[name].items,'monstertoken')+1),
      'A queued merchant may outlive this Hunt only after both original owners actually received their rewards').toBe(true);
    await live.post('/farming-mode',{character:W,mode:'default'});
  } else expect(continued?.cycleId).toBe(cycle);
  const rendezvousSamples:any[]=[];let lastRendezvousSample=0;
  // The merchant is never in a party convoy, and its job is the merchant
  // group's own task.
  const merchantInConvoy:any[]=[];let jobTask=false;
  try{await expect.poll(async()=>{
    const native=await observed(live),coordinator=await live.state();
    if(coordinator.activeConvoy?.participants?.includes(M))merchantInConvoy.push({at:Date.now(),convoy:coordinator.activeConvoy.purpose});
    jobTask||=(await taskTrail(live,`merchant:${M}`,0)).trail.some(([,k])=>k==='merchant-job');
    if(fault==='active merchant death'&&Date.now()-lastRendezvousSample>=1000){
      lastRendezvousSample=Date.now();let client:any;
      try{client=await live.clients[M].frame.evaluate(()=>{
        const game=window as any,root=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        const merchant=game.character,target=game.get_player?.('E2EWarrior'),smart=root?.smart;
        return {character:merchant&&{name:merchant.name,map:merchant.map,in:merchant.in,x:merchant.real_x??merchant.x,y:merchant.real_y??merchant.y,rip:merchant.rip,moving:merchant.moving},
          target:target&&{name:target.name,map:target.map,in:target.in,x:target.real_x??target.x,y:target.real_y??target.y,rip:target.rip,visible:target.visible},
          distance:merchant&&target?Math.hypot((target.real_x??target.x)-(merchant.real_x??merchant.x),(target.real_y??target.y)-(merchant.real_y??merchant.y)):null,
          directClear:target&&root?.can_move_to?.(target.real_x??target.x,target.real_y??target.y),realm:String(game.server_region)+String(game.server_identifier),
          commandId:root?.__partyLastCommand,activeJob:root?.__merchantHolder,
          navigationIntent:root?.__partyNavigationIntent,route:smart&&{moving:smart.moving,found:smart.found,map:smart.map,x:smart.x,y:smart.y,remaining:smart.plot?.length}};
      });}catch(error){client={observationError:String(error)};}
      if(rendezvousSamples.length===96)rendezvousSamples.splice(64,1);
      rendezvousSamples.push({at:lastRendezvousSample,server:Object.fromEntries([W,M].map(name=>[name,{...native[name],items:undefined}])),client});
    }
    return quantity(native[W].items,'leather');
  },{timeout:180000,message:'The native merchant must actually collect the marked stack'}).toBe(0);}
  finally{if(fault==='active merchant death')await info.attach('native-merchant-recovery-rendezvous-samples',{body:JSON.stringify({fault,cycle,total,rendezvousSamples}),contentType:'application/json'});}
  if(held==='follows-me'||then){
    // The merchant delivered where the warrior on Manual stands; only the merchant moved.
    const at=(await observed(live))[W];
    record.follows.moved=Math.hypot(at.x-heldAt.x,at.y-heldAt.y);
    await live.post('/formation',{character:W,handControl:{on:false}});
  }
  expect(merchantInConvoy,'the merchant in a party convoy').toEqual([]);
  expect(jobTask,'the collection is a merchant group job task').toBe(true);
  await expect.poll(async()=>{const s=await live.state();return !s.merchantCurrent&&!s.merchantQueue.length&&!s.merchantMarked?.[W]?.length;},{timeout:180000}).toBe(true);
  expect(await totalLeather(live)).toBe(total);
  await reward(live,setup.before);
  await live.restartCoordinator();
  expect(await totalLeather(live)).toBe(total);
  await evidence(live,info,'hunt-merchant-recovered-and-rewarded',{fault,total,cycle});
}
