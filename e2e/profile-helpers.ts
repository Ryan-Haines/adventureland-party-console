import type {TestInfo} from '@playwright/test';
import {expect,logoutNative,type LiveGame} from './live-fixtures';

// The setup and probes the two profile specs share (profile-character-threads.spec.ts,
// profile-coordinator.spec.ts; docs/efficiency.md, How to rerun).

// Each character leaves its native window for the first free headless slot.
export async function respawnHeadless(live:LiveGame,names:string[]){
  for(const name of names){
    await logoutNative(live,name);
    const slot=(await live.state()).activeSlots.find((slot:any)=>!slot.character&&slot.kind!=='steam');
    await live.post('/slots/'+(slot?.slot??slot?.index)+'/spawn',{character:name});
    await expect.poll(async()=>(await live.state()).characters[name]?.runtime,{timeout:90000}).toBe('headless');
  }
}
// The dashboard data path: 20 server-side inventory changes on one character, each timed until
// /party-api/state shows it.
export async function reportLatency(live:LiveGame,name:string){
  const latency:number[]=[];
  for(let i=1;i<=20;i++){
    await live.admin(`output=(()=>{const p=get_player('${name}');p.items[20]={name:'leather',q:${i}};cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
    const t1=Date.now();
    await expect.poll(async()=>(await live.state()).characters[name]?.items?.[20]?.item?.q,{timeout:10000,intervals:[20]}).toBe(i);
    latency.push(Date.now()-t1);
    await new Promise(r=>setTimeout(r,300+Math.random()*700));
  }
  await live.admin(`output=(()=>{const p=get_player('${name}');p.items[20]=null;cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  return latency;
}
// Bank visit: the party asks the merchant to collect the marked cargo every 50 s until the window
// ends.
export async function bankVisits(live:LiveGame,info:TestInfo,group:string,startedAt:number,windowS:number){
  const visits:any[]=[];
  while(Date.now()-startedAt<windowS*1000-1000){
    visits.push({at:Date.now(),result:await live.post('/bank-party',{group}).catch(e=>({error:String(e)}))});
    await new Promise(r=>setTimeout(r,Math.min(50000,Math.max(0,windowS*1000-(Date.now()-startedAt)))));
  }
  await info.attach('bank-visits',{body:JSON.stringify(visits),contentType:'application/json'});
}
