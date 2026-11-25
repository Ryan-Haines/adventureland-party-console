import {expect,type LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';

// The merchant realm hop plays, moved from live-merchant-realm-recovery.spec.ts at 21fe30a2b. W50
// runs them as one session.

export async function merchantHopPlay(live:LiveGame,info:TestInfo){
  // Failure modes: native page never changes; CODE does not reconnect; saved
  // work stays current forever; idle stand return strands the merchant away.
  // Seed an interrupted Ponty itinerary whose one listing is on US II and gone
  // from Ponty there. No purchase is made: this journey verifies real realm
  // login, redispatch and return.
  const merchant='E2EMerchant',id='steam-realm-86';
  const before=await live.state();
  const completionCount=before.merchantActivity.filter((entry:any)=>entry.message===`Merchant job completed for ${merchant}`).length;
  expect(before.characters[merchant].runtime).toBe('native');
  await live.admin("const m=get_player('E2EMerchant');m.items[10]={name:'stand0'};cache_player_items(m);resend(m,'reopen+cid');output=m.items[10]");
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'manual marketplace purchases':true}});
  await live.restoreHistoricalSettings(()=>({merchantCurrent:null,merchantQueue:[{
    id,reason:'Ponty purchases',target:merchant,queuedAt:Date.now(),priority:100,
    listings:[goneUSIIListing(id)],completedListingKeys:[],
  }]}));
  let nativeAway:any=null;
  await expect.poll(async()=>{
    nativeAway=await live.adminRealm('USII',"output=(()=>{const p=get_player('E2EMerchant');return p?{name:p.name,map:p.map,x:p.x,y:p.y}:null})()");
    return !!nativeAway;
  },{timeout:120_000,intervals:[100]}).toBe(true);
  // Force stand sends the away Steam merchant home at once, with no arrival window
  // first; releasing it lets the paused Ponty job redispatch and hop again.
  const forcedAt=Date.now();
  await live.post('/merchant/force-stand',{enabled:true});
  await expect.poll(async()=>(await live.state()).characters[merchant]?.server,{timeout:45_000,intervals:[250]}).toBe(before.characters[merchant].server);
  const forcedHome=Date.now()-forcedAt;
  expect(forcedHome).toBeLessThan(60_000);
  await live.post('/merchant/force-stand',{enabled:false});
  const arrived=await live.state();
  await expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((job:any)=>job?.id===id)
      && state.merchantActivity.filter((entry:any)=>entry.message===`Merchant job completed for ${merchant}`).length>completionCount;
  },{timeout:120_000}).toBe(true);
  await expect.poll(async()=>{
    const frame=live.clients[merchant].page.frames().find(frame=>frame.url().includes('/character/'+merchant+'/'));
    if(!frame)return false;
    try{return await frame.evaluate(()=>!!(window as any).character?.stand);}
    catch(error){if(/Execution context was destroyed|Cannot find context|Frame was detached/.test(String(error)))return false;throw error;}
  },{timeout:120_000}).toBe(true);
  await expect.poll(async()=>(await live.state()).characters[merchant]?.standOpen,{timeout:20_000}).toBe(true);
  const after=await live.state();
  expect(after.characters[merchant].runtime).toBe('native');
  expect(after.characters[merchant].server).toEqual(before.characters[merchant].server);
  await info.attach('native-steam-merchant-realm-redispatch',{body:JSON.stringify({before,arrived,nativeAway,forcedHome,after}),contentType:'application/json'});
}

// A Ponty job hops to its open listing's realm, and its home is the party realm when its command is
// built, so a job's saved homeRealm moves nothing. A listing on US II whose rid Ponty does not hold
// takes the merchant there, and the runner skips it and completes with no purchase.
export function goneUSIIListing(key:string){
  return goneListing(key,'USII');
}
// A Ponty listing gone from `server` (a bare server name such as USI): the merchant hops there, finds
// it gone and buys nothing.
export function goneListing(key:string,server:string){
  return {key,serverRegion:server.slice(0,2),serverIdentifier:server.slice(2),rid:'e2e-gone-'+key,item:{name:'leather'},quantity:1,price:0,unitPrice:0};
}

// IT20: after a job on another realm ends, the merchant stays there while a
// ready job on that realm is as urgent as home's, and hops home when home's is more urgent. Two
// realms: the native home and USII. A Ponty job runs on its listing's realm
// (merchant-jobs/coordinator/dispatch.ts `jobRealm`), so home's job carries a listing on home; a
// Ponty job with no listing has nothing to buy and runs wherever the merchant stands.
export async function realmStayPlay(live:LiveGame,info:TestInfo,homeFirst:boolean){
  const merchant='E2EMerchant',home=(await live.state()).characters[merchant].server;
  await live.admin("const m=get_player('E2EMerchant');m.items[10]={name:'stand0'};cache_player_items(m);resend(m,'reopen+cid');output=m.items[10]");
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'manual marketplace purchases':true}});
  // A job's own urgency is its priorityOverride (rules.ts `merchantJobPriority`); every job here has
  // one reason, so its routine priority alone cannot order them.
  const job=(id:string,server:string,priority:number)=>({id,reason:'Ponty purchases',target:merchant,queuedAt:Date.now(),priorityOverride:priority,
    listings:[goneListing(id,server)],completedListingKeys:[]});
  await live.restoreHistoricalSettings(()=>({merchantCurrent:null,merchantQueue:[job('it20-away','USII',100),
    job('it20-away-next','USII',50),job('it20-home',home,homeFirst?90:50)]}));
  await expect.poll(async()=>(await live.state()).characters[merchant]?.server,{timeout:120_000,intervals:[250]}).not.toBe(home);
  await expect.poll(async()=>{
    const state=await live.state();
    return ![state.merchantCurrent,...state.merchantQueue].some((entry:any)=>entry?.id==='it20-away');
  },{timeout:120_000}).toBe(true);
  // Each job counts once, at the realm the merchant last reported from while it ran: a job's listing
  // hop happens inside the job, after it starts.
  const order:string[]=[];let running:{id:string;realm:string}|null=null;
  await expect.poll(async()=>{
    const state=await live.state(),current=state.merchantCurrent?.id,realm=state.characters[merchant]?.server===home?'home':'away';
    if(running&&running.id!==current){order.push(running.id+'@'+running.realm);running=null;}
    if(current&&!order.some(entry=>entry.startsWith(current+'@')))running={id:current,realm};
    return order.length;
  },{timeout:180_000,intervals:[250]}).toBeGreaterThanOrEqual(2);
  expect(order.slice(0,2)).toEqual(homeFirst?['it20-home@home','it20-away-next@away']:['it20-away-next@away','it20-home@home']);
  await info.attach('IT20 order',{body:JSON.stringify(order),contentType:'application/json'});
}
