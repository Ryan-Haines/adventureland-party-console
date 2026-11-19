import {test,expect} from './live-fixtures';
import type {CaveCommand} from '../runtime/hunting/api';
import {caveView,caveAct,voteAndSettle} from './cave-harness';

const W='E2EWarrior',P='E2EPriest';
// Each Cave repair kind climbs a ladder with no cap.
test.use({initialPosition:{map:'main',x:816,y:1180}});

test('Cave talk reopens a merchant after a later encounter, buys its item, and Retry starts the failed travel again',async({live,page},info)=>{
  test.setTimeout(900_000);
  await live.admin("Dev=true;Prod=false;G.events.dreams.disabled=false;G.events.dreams.encounters=G.events.dreams.encounters.filter(e=>['e11','e20','e31','e50'].includes(e.id));output=true");
  await live.post('/formation',{leader:W});
  await live.post('/formation',{character:P,follow:true});
  const view=caveView(live,page),act=caveAct(live);
  const native=(code:string)=>live.admin(`output=(()=>{const run=generated_entry(get_player('${W}')).record;${code}})()`);
  await expect.poll(async()=>{
    const v=await view();
    return v.members.length===2&&v.members.every((m:any)=>m.fresh&&m.observation?.ready&&m.observation?.visit?.available&&m.observation.leader===W&&m.observation.members.length===2);
  },{timeout:90_000}).toBe(true);
  // The entry seed places a live merchant at floor 0, as in live-cave.spec.ts "interface".
  await live.admin(`globalThis.__talkRandomBytes=crypto.randomBytes;
    crypto.randomBytes=function(size,...args){
      if(size===16&&!args.length&&new Error().stack.includes('open_generated_zone')){
        crypto.randomBytes=globalThis.__talkRandomBytes;
        return Buffer.from('00000000000000000000000000000001','hex');
      }
      return globalThis.__talkRandomBytes.call(this,size,...args);
    };output=true;`);
  try{
    await act({action:'enter'});
    await expect.poll(async()=>(await view()).state.phase,{timeout:90_000}).toBe('active');
  }finally{
    await live.admin('if(globalThis.__talkRandomBytes){crypto.randomBytes=globalThis.__talkRandomBytes;delete globalThis.__talkRandomBytes;}output=true');
  }
  const shopPoint=()=>view().then(v=>v.members[0].observation.cave.points.find((p:any)=>p.room==='0:shop'));
  const shopShown=(v:any)=>v.members.some((m:any)=>m.observation?.cave?.choice?.shop?.room==='0:shop');
  // Answer the merchant once, near it.
  await expect.poll(async()=>{
    const v=await view(),c=v.members[0].observation.cave;
    if(c.choice&&!c.choice.resolved)return shopShown(v)?(await voteAndSettle(view,act,v.members[0]?.observation?.cave),true):(await voteAndSettle(view,act,v.members[0]?.observation?.cave),false);
    if(shopShown(v))return true;
    if(!v.state.travel&&!Object.values(v.state.commands).some((x:any)=>x.action==='move'))await act({action:'move',run:c.run,target:(await shopPoint()).id});
    return false;
  },{timeout:180_000,message:'The party must reach and answer the merchant'}).toBe(true);
  // Another encounter becomes the run's current vote, as walking on does natively.
  const replaced=await native(`const other=run.cave.rooms.find(r=>r.encounter&&r.id!=='0:shop'&&r.floor===0);
    run.cave.vote={...run.cave.vote,id:run.key+':'+ ++run.cave.serial,room:other,resolved:true,votes:{}};
    for(const p of cave_players(run))delete p.cave_room;cave_publish(run,true);return {room:other.id,vote:run.cave.vote.id};`);
  await expect.poll(async()=>shopShown(await view()),{timeout:20_000,message:'The merchant shop must leave every snapshot'}).toBe(false);
  // The console reopens it with cave_talk from the member next to the merchant.
  const talkEvidence:any[]=[];
  let talk:{name:string;command:CaveCommand}|undefined,reopenedView:any;
  await expect.poll(async()=>{
    const v=await view();talkEvidence.push({at:Date.now(),commands:v.state.commands,error:v.state.error});
    const issuedTalk=talk,speaker=issuedTalk&&v.members.find((m:any)=>m.name===issuedTalk.name);
    if(talk&&speaker?.observation?.action?.id===talk.command.id&&
        speaker.observation.action.status==='complete'&&speaker.observation.cave?.choice?.shop?.room==='0:shop'){
      reopenedView=v;return true;
    }
    // Far from the merchant this travels there; next to it the coordinator talks.
    // Once talk is issued, a delayed shop observation must not click again:
    // that second selection can start a new walk and replace the completed talk.
    if(!v.state.travel&&!talk){
      const issued=await act({action:'move',run:v.state.run,target:(await shopPoint()).id});
      const commands=Object.entries<CaveCommand>(issued.state.commands).filter(([,c])=>c.action==='talk');
      expect(commands.length).toBeLessThanOrEqual(1);
      if(commands.length)talk={name:commands[0][0],command:commands[0][1]};
    }
    return false;
  },{timeout:120_000,intervals:[2_000],message:'Selecting the merchant room must reopen its shop'}).toBe(true);
  await info.attach('native-cave-talk-reopen',{body:JSON.stringify({replaced,talk,talkEvidence:talkEvidence.slice(-10),reopened:reopenedView}),contentType:'application/json'});
  const reopened=reopenedView.members.find((m:any)=>m.name===talk!.name).observation.cave.choice;
  expect(reopenedView.state.commands[talk!.name]).toMatchObject({id:talk!.command.id,action:'talk',room:'0:shop'});
  // Give the shared purse the price and buy from the reopened shop.
  await native(`run.cave.gold=Math.max(run.cave.gold,${reopened.shop.price});cave_publish(run,true);return run.cave.gold;`);
  await expect.poll(async()=>(await view()).members[0].observation.cave.gold,{timeout:20_000}).toBeGreaterThanOrEqual(reopened.shop.price);
  await act({action:'buy',run:(await view()).state.run,choice:reopened.id,cost:reopened.shop.price,confirmed:true});
  await expect.poll(()=>native(`return run.cave.rooms.find(r=>r.id==='0:shop').stock.sold;`),{timeout:30_000,message:'The reopened merchant must sell its item'}).toBe(true);
  // The native sale and the buyer's receipt are separate milestones.
  await expect.poll(async()=>{
    const v=await view();
    return Object.entries(v.state.commands).filter(([,c]:any)=>c.action==='buy').every(([name,c]:any)=>
      v.members.find((m:any)=>m.name===name)?.observation?.action?.id===c.id&&v.members.find((m:any)=>m.name===name).observation.action.status==='complete');
  },{timeout:30_000,message:'The buyer must report its completed purchase'}).toBe(true);
  // A destination inside solid rock fails every repair. The Cave repair ladder keeps no
  // count: each repair is a new travel command, and no count stops travel. Retry is one more attempt.
  await voteAndSettle(view,act);
  const rock=await native(`const p=get_player('${W}'),m=G.maps[p.map];const d=G.geometry[p.map];return {map:p.map,x:d.min_x+4,y:d.min_y+4};`);
  await act({action:'waypoint',run:(await view()).state.run,map:rock.map,x:rock.x,y:rock.y});
  const travelIds=new Set<string>();
  await expect.poll(async()=>{const v=await view();
    for(const c of Object.values(v.state.commands) as any[])if(/^cave-(assemble|travel):/.test(String(c?.id)))travelIds.add(String(c.id));
    await voteAndSettle(view,act);return travelIds.size-2;},
    {timeout:240_000,message:'Automatic repairs must go on past the old cap of 3 (the first gather and walk are not repairs)'}).toBeGreaterThan(3);
  await expect.poll(async()=>{
    const v=await view();
    return v.members.some((m:any)=>m.observation?.action?.id===v.state.commands[m.name]?.id&&m.observation.action.status==='failed');
  },{timeout:120_000}).toBe(true);
  // The ladder's 'same' and 'other' repairs also start travels and bump the serial. A travel with
  // waitAt set is waiting for the next report and starts none until it arrives, so Retry's
  // travel is the only serial bump after that read.
  await expect.poll(async()=>(await view()).state.travel?.waitAt!==undefined,
    {timeout:120_000,intervals:[250],message:'The repair ladder must wait for a report before Retry'}).toBe(true);
  const waiting=await view();
  const before=waiting.state.travel.serial;
  await act({action:'retry',run:waiting.state.run});
  const afterView=await view(),after=afterView.state.travel;
  expect(after.serial).toBe(before+1);
  // The coordinator issues one assembly command per participant, named run:serial:member.
  expect(Object.values(afterView.state.commands).some((c:any)=>String(c?.id).startsWith(`cave-assemble:${waiting.state.run}:${before+1}:`)),
    'Retry must issue its own assembly command').toBe(true);
  await expect.poll(async()=>(await view()).state.travel?.serial,{timeout:60_000}).toBe(before+1);
  await info.attach('native-cave-retry-repairs',{body:JSON.stringify({before,after,travelIds:[...travelIds],final:(await view()).state.travel}),contentType:'application/json'});
  await act({action:'progress',enabled:false});
});
