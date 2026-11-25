// The plays of e2e/live-merchant-anniversary-availability.spec.ts at 21fe30a2b, one exported function
// per old test. W38b runs them.
import {test,expect,logoutNative} from './live-fixtures';
import {M,P,beginAnniversary,endAnniversary,holdHalloweenSeason,world,quantity} from './game/hunt-events';
import {location} from './game/hunt-lifecycle';
import type {TestInfo, Page} from '@playwright/test';
import type {LiveGame} from './live-fixtures';

export async function cipherDoorHandoffPlay({live}: {live: LiveGame}, info: TestInfo){
    // The saved return predates a new native door tour. The merchant must use
    // coordinator admission without becoming a Hunt participant, finish native
    // doors, acknowledge its Main exit and resume its already queued sales.
    await live.post('/formation',{leader:'E2EWarrior'});
    // In W38 this play follows the party's door tour, before the catalog may list goo; the wait
    // is the Hunt plays' own discovery wait (game/hunt-lifecycle.ts `location`).
    await location(live,'goo');
    const goo=(await live.state(true)).monsterChoices.find((m:any)=>m.id==='goo');
    await live.post('/farming-mode',{mode:'hunt',backup:{monsterFocus:['goo'],location:goo.locations[0]}});
    await live.clients[M].run(`(()=>{globalThis.__merchantEventMoves=[];const service=globalThis.__partyMovement,move=service.move;service.move=function(destination,...args){globalThis.__merchantEventMoves.push({at:Date.now(),destination,job:globalThis.__merchantActiveJob?.jobId,stack:new Error().stack});if(globalThis.__merchantEventMoves.length>128)globalThis.__merchantEventMoves.shift();return move.call(this,destination,...args);};return true;})()`);
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':false}});
    // The server closes Halloween once its clock passes the season's end, so the door tour that
    // waits out the full bag found no season left; the row holds the season open.
    await holdHalloweenSeason(live);
    await live.admin(`output=(()=>{const p=get_player('${M}');p.items=[{name:'stand0'},{name:'hpot1',q:9999},{name:'mpot1',q:9999},...Array.from({length:39},()=>({name:'helmet',level:0}))];p.p.trickortreat=null;p.trickortreat=trick_or_treat_status(p);cache_player_items(p);resend(p,'u+reopen+cid');broadcast_e();return true;})()`);
    await expect.poll(async()=>(await live.state()).characters[M].items.filter((e:any)=>e?.item?.name==='helmet').length).toBe(39);
    await live.post('/merchant/auto-npc-sale',{item:{name:'helmet',level:0},keep:0});
    await live.restoreHistoricalSettings(()=>({deferredEventReturns:{[M]:{cycleId:'merchant-cipher-before-doors',event:'witchcipher',checkpoint:null,navigationRevision:0,deferredAt:Date.now()-60000,phase:'awaiting-event-handoff'}}}));
    const samples:any[]=[];
    try{
      await live.post('/formation',{character:M,eventSelections:['trickortreat']});
      await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'auto npc sales':true}});
      await expect.poll(async()=>{
        const s=await live.state(),doors=await live.clients[M].run('character.trickortreat?.doors?.length??0');
        // The merchant's own door reads: the game's door status, its October journal and its free slots.
        const native=await live.clients[M].run(`({status:character.trickortreat??null,journal:get('party-october-${M}')??null,free:character.esize})`);
        samples.push({at:Date.now(),doors,native,deferred:s.deferredEventReturns,return:s.eventReturn,merchant:{map:s.characters[M]?.map,joined:s.characters[M]?.joinedEvent,reserved:s.characters[M]?.merchantEventReserved},current:s.merchantCurrent});
        if(samples.length>128)samples.shift();
        return doors===7&&!s.deferredEventReturns[M]&&!s.eventReturn?.participants.includes(M)&&!s.characters[M]?.merchantEventReserved&&
          s.merchantActivity.filter((a:any)=>a.message.startsWith('Sold 1 × helmet to NPC')).length===39;
      },{timeout:300_000,intervals:[250,500]}).toBe(true);
      expect((await live.state()).monsterHunt.participants).not.toContain(M);
    }finally{await info.attach('merchant-cipher-door-handoff',{body:JSON.stringify({samples,state:await live.state(),events:await live.clients[M].events(),moves:await live.clients[M].run('globalThis.__merchantEventMoves')}),contentType:'application/json'});}
  }

// `duringVisit` runs after the gift with the round still live (W37: the player's Hunt off, H11).
export async function hostOfflinePlay({live}: {live: LiveGame}, info: TestInfo, duringVisit?: () => Promise<void>){
  try {
    const before=await world(live);
    const seed=await beginAnniversary(live,P);
    await expect.poll(async()=>await live.admin('output=E.anniversary?.live')).toBe(true);
    await logoutNative(live,P);
    await expect.poll(async()=>await live.admin('output=E.anniversary?.available'),{timeout:30_000}).toBe(false);
    await live.post('/formation',{character:M,eventSelections:['anniversary']});
    // Native initial stock, not a fabricated withdrawal/deposit result.
    await live.admin(`output=(()=>{const p=get_player('${M}');p.items[10]={name:'leather',q:3};cache_player_items(p);resend(p,'reopen+cid');return true})()`);
    await expect.poll(async()=>(await live.clients[M].snapshot()).items[10]?.q).toBe(3);
    // The client bag update and coordinator inventory publication are separate
    // milestones. An older report can otherwise retire the newly created mark.
    await expect.poll(async()=>{
      const entry=(await live.state()).characters[M].items.find((entry:any)=>entry?.slot===10);
      return {name:entry?.item?.name,q:entry?.item?.q};
    },{timeout:30_000}).toEqual({name:'leather',q:3});
    await live.post('/command',{character:M,type:'mark',slot:10,item:{name:'leather',q:3}});
    await expect.poll(async()=>(await live.state()).marked[M].filter((mark:any)=>mark.slot===10&&mark.item?.name==='leather').length).toBe(1);
    await live.post('/command',{character:M,type:'bank'});
    await expect.poll(async()=>await live.admin(`output=get_player('${M}').items.some(i=>i&&i.name==='leather')`),{timeout:120_000}).toBe(false);
    const banked=await live.state();
    expect(await live.admin('output=E.anniversary?.available')).toBe(false);
    const nativeBank=await live.admin(`output=(async()=>{const p=get_player('${M}'),user=await db.collection('user').findOne({_id:p.owner});return Object.entries(p.user||user.info).filter(([k,v])=>/^items[0-9]+$/.test(k)&&Array.isArray(v)).flatMap(([,v])=>v).filter(i=>i?.name==='leather')})()`);
    expect(quantity(nativeBank,'leather')).toBe(3);
    await info.attach('anniversary-unavailable-native-bank-work',{body:JSON.stringify({seed,before,banked,nativeBank,events:await live.clients[M].events()}),contentType:'application/json'});
    // The native deposit receipt precedes completion of its coordinator inventory
    // handoff. Login resumes once the real banking operation reports finished.
    await expect.poll(async()=>{
      const state=await live.state(), merchant=state.characters[M];
      return !state.merchantCurrent && !state.bankboiTransaction &&
        !merchant.banking && !merchant.stocking && !merchant.upgrading;
    },{timeout:30_000}).toBe(true);
    await live.post('/steam/action',{character:P,action:'login'});
    await expect.poll(async()=>await live.admin(`output=!!get_player('${P}')`),{timeout:90_000}).toBe(true);
    await expect.poll(async()=>await live.admin('output=E.anniversary?.available'),{timeout:30_000}).toBe(true);
    await expect.poll(async()=>quantity((await world(live)).players[M].items,'anniversarygift'),{timeout:120_000}).toBe(quantity(before.players[M].items,'anniversarygift')+1);
    await info.attach('anniversary-availability-native-visit-resumed',{body:JSON.stringify({before,after:await world(live),state:await live.state(),events:await live.clients[M].events()}),contentType:'application/json'});
    await duringVisit?.();
  } finally {await endAnniversary(live);}
}
