// The plays of e2e/live-hunt-round2-recovery.spec.ts at 21fe30a2b, one exported function per old test.
// W37 runs them (e2e/event-session-rows.ts `anniversaryHostSessionPlay`).
import {test,expect} from './live-fixtures';
import {anniversaryStatusFaultSource} from './anniversary-status-fault';
import {killNativeCharacter} from './hunt-interruption-helpers';
import {W,P,M,world,beginAnniversary,endAnniversary} from './game/hunt-events';
import {escapeMembershipPlay} from './restart-walk-rows';
import type {TestInfo, Page} from '@playwright/test';
import type {LiveGame} from './live-fixtures';

export async function stagingSlicePlay({live}: {live: LiveGame}, info: TestInfo){
  // Historical stock/schedule read-boundary fixtures only; real Town calls,
  // walking, native live-round kiss and reward are observed unchanged.
  await live.post('/formation',{leader:W});await live.post('/formation',{character:P,follow:true});
  await live.admin(`output=(()=>{const p=get_player('${W}');p.items[20]={name:'slice_strawberry',q:1};resend(p,'u+cid');return true;})()`);
  await live.post('/command',{character:M,type:'bank'});
  await expect.poll(async()=>(await world(live)).players[M].map,{timeout:60_000}).toBe('bank');
  const next=Date.now()+50_000;
  const faultOwners=Object.keys(live.clients);
  const installed:Record<string,any>={};
  const readFaults=async()=>{
    const observations:Record<string,any>={};
    for(const name of faultOwners)observations[name]=await live.clients[name].run('globalThis.__e2eAnniversaryStatusFault');
    return observations;
  };
  const disableFaults=async()=>{
    for(const name of Object.keys(installed))await live.clients[name].run('if(globalThis.__e2eAnniversaryStatusFault)globalThis.__e2eAnniversaryStatusFault.enabled=false');
  };
  const samples:any[]=[];
  try{
  await live.admin(`output=(()=>{
    const original=broadcast_e;globalThis.__e2eStagingBroadcast=original;
    broadcast_e=function(dontSend){if(dontSend)return;broadcast('server_info',{...E,anniversary:{live:false,next:${next},target:'${P}',available:true}});};
    globalThis.__e2eStagingTimer=setInterval(()=>broadcast_e(),500);broadcast_e();return true;})()`);
    for(const name of faultOwners)installed[name]=await live.clients[name].run(anniversaryStatusFaultSource(W,M));
  await live.post('/formation',{character:W,eventSelections:['anniversary']});
    await expect.poll(async()=>{const p=(await world(live)).players[W];return p.map==='main'&&Math.hypot(p.x,p.y)<=100;},{timeout:60_000}).toBe(true);
    const faults=await readFaults();
    for(const name of faultOwners){
      expect(faults[name]?.count,`${name}: actual historical status JSON was transformed`).toBeGreaterThan(0);
      expect(faults[name]?.generation).toBe(installed[name].generation);
    }
    const started=Date.now();
    await expect.poll(async()=>{const native=await world(live);samples.push({at:Date.now(),players:native.players});
      expect(Math.hypot(native.players[W].x,native.players[W].y)).toBeLessThanOrEqual(110);
      return Date.now()-started>=30_000;},{timeout:40_000,intervals:[1000]}).toBe(true);
    // Player packets repeat the remaining cast condition; a late echo is not
    // a newly issued Town. Native CIDs fence duplicates/out-of-order echoes.
    const castStarts:any[]=[];let remaining=0,lastCid=-Infinity;
    for(const packet of await live.clients[W].events()){
      if(packet.event!=='player')continue;
      const data=packet.data||{},cid=Number(data.cid);
      if(Number.isFinite(cid)){if(cid<lastCid)continue;lastCid=cid;}
      if(!Object.prototype.hasOwnProperty.call(data,'c'))continue;
      const nextRemaining=Number(data.c?.town?.ms)||0;
      if(nextRemaining>0&&(remaining===0||nextRemaining>remaining+250))castStarts.push(packet);
      remaining=nextRemaining;
    }
    const casts=castStarts.filter(packet=>packet.at>=started);
    expect(casts.length).toBe(0);
    await disableFaults();
    await live.admin('clearInterval(globalThis.__e2eStagingTimer);delete globalThis.__e2eStagingTimer;broadcast_e=globalThis.__e2eStagingBroadcast;delete globalThis.__e2eStagingBroadcast;output=true');
    const seed=await beginAnniversary(live,P);
    await expect.poll(async()=>(await world(live)).players[W].conditions.anniversary_kiss,{timeout:90_000}).toBeTruthy();
    await info.attach('native-anniversary-staging-history',{body:JSON.stringify({next,installed,faults,samples,casts,seed,final:await world(live),state:await live.state()}),contentType:'application/json'});
  }finally{await disableFaults();
    await live.admin('clearInterval(globalThis.__e2eStagingTimer);delete globalThis.__e2eStagingTimer;if(globalThis.__e2eStagingBroadcast){broadcast_e=globalThis.__e2eStagingBroadcast;delete globalThis.__e2eStagingBroadcast;}output=true');
    await live.post('/formation',{character:W,eventSelections:[]});await endAnniversary(live);}
}
