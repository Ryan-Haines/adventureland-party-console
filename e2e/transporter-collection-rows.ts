import type {TestInfo} from '@playwright/test';
import {expect, type LiveGame} from './live-fixtures';
import {W,M,seedCargo,totalLeather} from './hunt-interruption-helpers';
import {reportedWalkUntil} from './event-window-helpers';

// W59's one collection session (test-windows DESIGN.md 2.2 W59), the body of
// live-merchant-transporter-approach.spec.ts at 21fe30a2b. The headless merchant collects the warrior's
// leather from its desert start (M48); the player then sends it to the Winter Inn exit, from where its
// next collection takes the Winterland transporter to Main (M49). One collection walk has one start, so
// each start is a round (DEVIATIONS.md "Live B" W59).
type Departure = {label: string; map: string; x: number; y: number};
export const desert: Departure = {label:'Desert',map:'desertland',x:0,y:0};
export const winterInnExit: Departure = {label:'Winter Inn exit',map:'winterland',x:-280,y:-123};

export async function transporterSessionPlay(live: LiveGame, info: TestInfo) {
  await headlessAt(live, info, desert);
  await collectFrom(live, info, desert);
  await clearLeather(live);
  // The player's move (event-session-rows.ts sendTo) with collection off, so the walk is the move.
  // The player sends the merchant once its collection is done and it stands idle: a travel sent
  // while it walked back to its stand after the bank was replaced by that walk, and it never left
  // Main (liveb-step10-run3.log, "Returning to stand" 20 s before "At stand", no travel journey).
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':false}});
  await reportedWalkUntil(live,[M],async()=>{const s=await live.state(),c=s.characters[M];return !s.merchantCurrent&&!s.merchantQueue.length&&c?.activity?.phase==='idle'&&!c.moving&&!!c.movement?.done;},
    'The merchant must end its collection idle before the player\'s move');
  await live.post('/command',{character:M,type:'character-travel',location:{map:winterInnExit.map,x:winterInnExit.x,y:winterInnExit.y},label:'Player move to the Winter Inn exit'});
  await reportedWalkUntil(live,[M],async()=>live.admin(`output=(()=>{const p=get_player('${M}');return !!p&&!p.rip&&!p.moving&&p.map==='${winterInnExit.map}'&&Math.hypot(p.x-(${winterInnExit.x}),p.y-(${winterInnExit.y}))<15;})()`),
    'The player\'s move must bring the merchant to the Winter Inn exit');
  await collectFrom(live, info, winterInnExit);
}

// Round 1's 7 leather leave every bag and the bank, so round 2's total counts its own 7.
async function clearLeather(live: LiveGame) {
  await live.admin(`output=(async()=>{const ps=['E2EWarrior','E2EPriest','E2EMerchant'].map(get_player),owner=ps[0].owner,mounted=Object.values(players).find(p=>p.owner===owner&&p.user);
    const keep=items=>items.map(i=>i?.name==='leather'?null:i);for(const p of ps){p.items=keep(p.items);cache_player_items(p);resend(p,'reopen+cid');}
    if(mounted){for(const [k,v] of Object.entries(mounted.user))if(/^items[0-9]+$/.test(k)&&Array.isArray(v))mounted.user[k]=keep(v);}
    else{const user=await db.collection('user').findOne({_id:owner}),set={};for(const [k,v] of Object.entries(user.info))if(/^items[0-9]+$/.test(k)&&Array.isArray(v))set['info.'+k]=keep(v);await db.collection('user').updateOne({_id:owner},{$set:set});}
    return true})()`);
  expect(await totalLeather(live)).toBe(0);
}

// The merchant leaves its native window and spawns headless at the departure point.
async function headlessAt(live: LiveGame, info: TestInfo, departure: Departure) {
 await live.post('/focus',{monsterFocus:[],monsterPriorities:{}});
 await live.post('/merchant/force-stand',{enabled:true});
 // The roster refuses a Steam action while a Steam operation runs (lifecycle/roster/steam-group.ts:18),
 // and the start's group restore can still run here (liveb-step11-run3.log: 409 14 s into one), so
 // the logout waits on the same bound as its own switch below.
 await expect.poll(async()=>{const s=await live.state();return !s.steamSwitch||s.steamSwitch.phase==='complete';},
   {timeout:60000,message:'No Steam operation runs before the merchant logs out'}).toBe(true);
 await live.post('/steam/action',{character:M,action:'logout'});
 await expect.poll(async()=>{const s=await live.state();return !s.activeSlots.some((slot:any)=>slot.character===M)&&(!s.steamSwitch||s.steamSwitch.phase==='complete');},{timeout:60000}).toBe(true);
 await expect.poll(()=>live.admin(`output=!!get_player('${M}')||Object.values(dc_players).some(p=>p.name==='${M}')`),{timeout:30000}).toBe(false);
 const initial=await live.admin(`output=(async()=>{if(get_player('${M}')||Object.values(dc_players).some(p=>p.name==='${M}'))throw Error('Initial Merchant placement requires disconnected native player');const point=${JSON.stringify({map:departure.map,x:departure.x,y:departure.y})},body={type:'character',...point};set_base(body);if(!can_move({...body,going_x:point.x,going_y:point.y}))throw Error('Native geometry rejects Merchant initial point');const result=await db.collection('character').updateOne({name:'${M.toLowerCase()}'},{$set:{'info.map':point.map,'info.in':point.map,'info.x':point.x,'info.y':point.y}});if(result.matchedCount!==1)throw Error('Initial Merchant fixture character missing');return {point,base:body.base,disconnected:true,matchedCount:result.matchedCount};})()`);
 await info.attach('native-disconnected-headless-merchant-initial-position',{body:JSON.stringify(initial),contentType:'application/json'});
 const slots=(await live.state()).activeSlots,slot=slots.find((slot:any)=>!slot.character&&slot.kind!=='steam');
 await live.post('/slots/'+(slot?.slot??slot?.index??1)+'/spawn',{character:M});
 await expect.poll(async()=>{const c=(await live.state()).characters[M],actual=await live.admin(`output=(()=>{const p=get_player('${M}');return p&&{map:p.map,x:p.x,y:p.y,hp:p.hp,rip:p.rip,clear:can_move({...p,going_x:p.x,going_y:p.y})};})()`);return c?.runtime==='headless'&&Date.now()-c.seenAt<3000&&c.map===departure.map&&Math.hypot(c.x-departure.x,c.y-departure.y)<15&&actual?.map===departure.map&&Math.hypot(actual.x-departure.x,actual.y-departure.y)<15&&actual.hp>0&&!actual.rip&&actual.clear;},{timeout:90000}).toBe(true);
}

async function collectFrom(live: LiveGame, info: TestInfo, departure: Departure) {
 const samples:any[]=[];
 await live.post('/merchant/force-stand',{enabled:true});
 try{
  await live.post('/config',{itemCollectionThreshold:1});await seedCargo(live,W);expect(await totalLeather(live)).toBe(7);
  await live.admin(`output=(()=>{const p=get_player('${M}');if(!p||typeof p.socket.prependListener!=='function')throw Error('Native transport socket observer unavailable');const observation={socket:p.socket,samples:[],listener:null};observation.listener=function(packet){if(observation.samples.length>=16)return;const npc=G.maps.${departure.map}.npcs.find(n=>n.id==='transporter').position;observation.samples.push({at:Date.now(),from:{map:p.map,x:p.x,y:p.y},range:Math.hypot(p.x-npc[0],p.y-npc[1]),clear:can_move({...p,going_x:p.x,going_y:p.y}),legalRange:B.transporter_dist,to:packet?.to,spawn:packet?.s});};p.socket.prependListener('transport',observation.listener);globalThis.__e2eMerchantTransportObservation=observation;return true;})()`);
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true}});
  await live.post('/merchant/force-stand',{enabled:false});
  let approached=false,crossed=false;
  await expect.poll(async()=>{
   const s=await live.state(),actual=await live.admin(`output=(()=>{const m=get_player('${M}'),w=get_player('${W}'),npc=G.maps.${departure.map}.npcs.find(n=>n.id==='transporter').position;return {merchant:m&&{map:m.map,x:m.x,y:m.y,hp:m.hp,rip:m.rip,range:Math.hypot(m.x-npc[0],m.y-npc[1]),clear:can_move({...m,going_x:m.x,going_y:m.y})},stock:w.items.reduce((n,i)=>n+(i?.name==='leather'?i.q||1:0),0),transports:globalThis.__e2eMerchantTransportObservation?.samples||[]};})()`);
   approached ||= actual.transports.some((packet:any)=>packet.from.map===departure.map&&Number.isFinite(packet.legalRange)&&packet.legalRange>0&&packet.range<packet.legalRange&&packet.clear&&packet.to==='main');
   crossed ||= actual.merchant?.map==='main';
   if(samples.length<200)samples.push({at:Date.now(),actual,movement:s.characters[M]?.movement,current:s.merchantCurrent,queue:s.merchantQueue});
   // Desert: the merchant keeps the shortest route (v1.5.0's), which need not use the transporter, so
   // any route that ends in range of the fighter passes, and a transport it does use must be a legal
   // one (the user's decision of 2026-11-17).
   const illegal=actual.transports.some((packet:any)=>packet.from.map===departure.map&&Number.isFinite(packet.legalRange)&&packet.legalRange>0&&!(packet.range<packet.legalRange&&packet.clear));
   if(departure.map==='desertland')return !illegal&&crossed&&actual.stock===0;
   return approached&&crossed&&actual.stock===0;
  },{timeout:120000,intervals:[200,500],message:'Native transporter approach, actual transport and real cargo receipt'}).toBe(true);
  expect(await totalLeather(live)).toBe(7);
 }finally{const transports=await live.admin(`output=(()=>{const o=globalThis.__e2eMerchantTransportObservation;if(!o)return [];o.socket.removeListener('transport',o.listener);delete globalThis.__e2eMerchantTransportObservation;return o.samples;})()`);await info.attach('native-merchant-transporter-collection',{body:JSON.stringify({samples,transports,final:await live.state(),total:await totalLeather(live)}),contentType:'application/json'});}
}
