// Coordinator profile on the disposable game stack: docs/efficiency.md,
// Coordinator, How to rerun. Not part of the live project; run it with
// playwright.coordinator-profile.config.ts and
// e2e/profiling/coordinator-profile-preload.cjs.
import {test,expect} from './live-fixtures';
import {readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {farmingAreas} from '../dashboard/lib/farming-areas';
const W='E2EWarrior',P='E2EPriest',M='E2EMerchant',X='E2EBankBoi';
const scenario=process.env.PROF_SCENARIO||'farm';
const warmup=Number(process.env.PROF_WARMUP_S||60),windowS=Number(process.env.PROF_WINDOW_S||180);
// The Steam primary (warrior) stays a browser client; priest, mage and merchant run headless.
test.use({liveHeadless:true,extraFighter:'mage',initialPosition:{map:'main',x:-32,y:787}});
function coordinatorPid(directory:string){
  for(const entry of readdirSync('/proc')){
    if(!/^\d+$/.test(entry))continue;
    try{
      const argv=readFileSync(`/proc/${entry}/cmdline`,'utf8').split('\0');
      if(argv.some(a=>a.endsWith('live-coordinator.cjs'))&&readFileSync(`/proc/${entry}/environ`,'utf8').includes('E2E_DATA_DIR='+directory))return +entry;
    }catch{}
  }
  throw Error('Coordinator process not found');
}
const queued=(state:any,reason:string,target?:string)=>[state.merchantCurrent,...(state.merchantQueue||[])]
  .some((job:any)=>job&&job.reason===reason&&(!target||job.target===target||(job.targets||[]).includes(target)));
test('profile coordinator: '+scenario,async({live},info)=>{
  test.setTimeout((warmup+windowS)*1000+900000);
  const dir=process.env.PROF_DIR!;mkdirSync(dir,{recursive:true});
  await live.post('/merchant/force-stand',{enabled:scenario==='farm'});
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:600});
  // The fixture's 10M starting gold is above the 100k default, so the gold run would never end.
  await live.post('/config',{threshold:50_000_000});
  for(const name of [P,X,M]){
    await live.post('/steam/action',{character:name,action:'logout'});
    await expect.poll(async()=>{const s=await live.state();return !s.activeSlots.some((slot:any)=>slot.character===name)&&(!s.steamSwitch||s.steamSwitch.phase==='complete');},{timeout:60000}).toBe(true);
    await expect.poll(()=>live.admin(`output=!!get_player('${name}')`),{timeout:30000}).toBe(false);
    const s=await live.state(),slot=s.activeSlots.find((slot:any)=>!slot.character&&slot.kind!=='steam');
    await live.post('/slots/'+(slot?.slot??slot?.index)+'/spawn',{character:name});
    await expect.poll(async()=>(await live.state()).characters[name]?.runtime,{timeout:90000}).toBe('headless');
  }
  if(scenario==='bank'){
    // Merchant collection work: marked cargo on each fighter, party collection and bank deposit enabled.
    for(const name of [W,P,X]){
      await expect.poll(()=>live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)});if(!p)return false;p.items[10]={name:'leather',q:7};cache_player_items(p);resend(p,'u+cid+reopen');return true})()`),{timeout:30000}).toBe(true);
      await expect.poll(async()=>(await live.state()).characters[name]?.items?.[10]?.item?.q,{timeout:30000}).toBe(7);
      await live.post('/command',{character:name,type:'merchant-mark',slot:10,item:{name:'leather',q:7}});
    }
    await live.post('/config',{itemCollectionThreshold:1});
  }
  // The live fixture disables every merchant automation; a console runs with the defaults on.
  const automations=['deliveries','withdrawals','merchant luck','party collection','auto npc sales','restock','gold threshold',
    'inventory cleanout','auto compound','auto upgrade','automatic exchange','stand bid purchases','join giveaway'];
  await live.post('/merchant/routine-priorities',{priorities:{},enabled:Object.fromEntries([...automations,...(scenario==='bank'?['bank deposit']:[])].map(key=>[key,true]))});
  for(const name of [W,P,X])await live.post('/farming-mode',{character:name,mode:'default'});
  await live.post('/formation',{leader:W});
  for(const name of [P,X])await live.post('/formation',{character:name,follow:true});
  const area=farmingAreas((await live.state(true)).monsterChoices,['goo']).find((a:any)=>a.map==='main');
  if(area)await live.post('/navigate-to-monster',{monsterId:'goo',location:area});
  let order:any=null;
  if(scenario==='production'){
    // Merchant production: buy helmets and upgrade each one, enough work to outlast the window.
    order=await live.post('/merchant/order',{buys:[{id:'helmet',quantity:30,level:6}],crafts:[]});
    await info.attach('production-order',{body:JSON.stringify(order),contentType:'application/json'});
  }
  await new Promise(r=>setTimeout(r,warmup*1000));
  const pid=coordinatorPid(live.deploymentPaths.directory);
  const before=await live.state();
  process.kill(pid,'SIGUSR2');
  const startedAt=Date.now();
  if(scenario==='bank'){
    // Bank visit: the party asks the merchant to collect the marked cargo every 50 s.
    const visits:any[]=[];
    while(Date.now()-startedAt<windowS*1000-1000){
      visits.push({at:Date.now(),result:await live.post('/bank-party',{group:W}).catch(e=>({error:String(e)}))});
      await new Promise(r=>setTimeout(r,Math.min(50000,Math.max(0,windowS*1000-(Date.now()-startedAt)))));
    }
    await info.attach('bank-visits',{body:JSON.stringify(visits),contentType:'application/json'});
  } else await new Promise(r=>setTimeout(r,windowS*1000));
  process.kill(pid,'SIGUSR2');
  const after=await live.state();
  await expect.poll(()=>readdirSync(dir).some(f=>f==='coordinator-'+pid+'.json'),{timeout:60000}).toBe(true);
  const brief=(s:any)=>({merchantCurrent:s.merchantCurrent&&{reason:s.merchantCurrent.reason,phase:s.merchantCurrent.phase},
    queue:(s.merchantQueue||[]).map((job:any)=>job.reason),
    characters:Object.fromEntries([W,P,X,M].map(n=>{const c=s.characters[n]||{};return [n,{runtime:c.runtime,map:c.map,x:Math.round(c.x),y:Math.round(c.y),gold:c.gold,kills:c.kills}];}))});
  // Dashboard data path: a server-side inventory change on the headless priest until /party-api/state shows it.
  const latency:number[]=[];
  for(let i=1;i<=20;i++){
    await live.admin(`output=(()=>{const p=get_player('${P}');p.items[20]={name:'leather',q:${i}};cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
    const t1=Date.now();
    await expect.poll(async()=>(await live.state()).characters[P]?.items?.[20]?.item?.q,{timeout:10000,intervals:[20]}).toBe(i);
    latency.push(Date.now()-t1);
    await new Promise(r=>setTimeout(r,300+Math.random()*700));
  }
  await live.admin(`output=(()=>{const p=get_player('${P}');p.items[20]=null;cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  // Merchant reaction: a fighter's gold crosses the threshold until the merchant queues the gold run.
  const reactions:any={gold:[]};
  if(scenario==='farm'){
    // The headless fighters only: the browser warrior's reported gold does not follow a server-side change.
    for(let i=0;i<8;i++){
      const name=[P,X][i%2]!;
      // Start from a queue with no work for this fighter, so the probe sees a new job and not a promotion.
      await expect.poll(async()=>{const s=await live.state();return [s.merchantCurrent,...(s.merchantQueue||[])].every((job:any)=>!job||job.target!==name);},{timeout:90000}).toBe(true).catch(()=>{});
      // A fighter between realms or reconnecting has no native player; the probe skips it.
      if(!await live.admin(`output=(()=>{const p=get_player('${name}');if(!p)return false;p.gold=60000000;resend(p,'reopen');return true})()`)){reactions.gold.push({name,ms:null,skipped:true});continue;}
      const t1=Date.now();
      const seen=await expect.poll(async()=>queued(await live.state(),'gold threshold',name),{timeout:30000,intervals:[20]}).toBe(true).then(()=>true,()=>false);
      reactions.gold.push({name,ms:seen?Date.now()-t1:null});
      await live.admin(`output=(()=>{const p=get_player('${name}');if(!p)return false;p.gold=1000;resend(p,'reopen');return true})()`);
    }
  }
  const summary={scenario,atStart:brief(before),atEnd:brief(after),startedAt,windowS,pid,latency,reactions,order};
  writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,1));
  await info.attach('profile-summary',{body:JSON.stringify(summary),contentType:'application/json'});
});
