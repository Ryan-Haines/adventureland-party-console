// Coordinator profile on the disposable game stack: docs/efficiency.md,
// Coordinator, How to rerun. Not part of the live project; run it with
// playwright.coordinator-profile.config.ts and
// e2e/profiling/thread-profile-preload.cjs.
import {test,expect} from './live-fixtures';
import {readdirSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {farmingAreas} from '../runtime/hunting/areas';
import {respawnHeadless,reportLatency,bankVisits} from './profile-helpers';
import {seedCargo} from './hunt-interruption-helpers';
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
  await respawnHeadless(live,[P,X,M]);
  if(scenario==='bank'){
    // Merchant collection work: marked cargo on each fighter, party collection and bank deposit enabled.
    for(const name of [W,P,X])await seedCargo(live,name);
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
    await bankVisits(live,info,W,startedAt,windowS);
  } else await new Promise(r=>setTimeout(r,windowS*1000));
  process.kill(pid,'SIGUSR2');
  const after=await live.state();
  await expect.poll(()=>readdirSync(dir).some(f=>f==='coordinator-'+pid+'.json'),{timeout:60000}).toBe(true);
  const brief=(s:any)=>({merchantCurrent:s.merchantCurrent&&{reason:s.merchantCurrent.reason,phase:s.merchantCurrent.phase},
    queue:(s.merchantQueue||[]).map((job:any)=>job.reason),
    characters:Object.fromEntries([W,P,X,M].map(n=>{const c=s.characters[n]||{};return [n,{runtime:c.runtime,map:c.map,x:Math.round(c.x),y:Math.round(c.y),gold:c.gold,kills:c.kills}];}))});
  const latency=await reportLatency(live,P);
  // Merchant reaction: a fighter's gold crosses the threshold until the merchant queues the gold run.
  const reactions:any={gold:[]};
  if(scenario==='farm'){
    // The headless fighters only: the browser warrior's reported gold does not follow a server-side change.
    for(let i=0;i<8;i++){
      const name=[P,X][i%2]!;
      // Start from a queue with no work for this fighter, so the probe sees a new job and not a promotion.
      const clear=await expect.poll(async()=>{const s=await live.state();return [s.merchantCurrent,...(s.merchantQueue||[])].every((job:any)=>!job||job.target!==name);},{timeout:90000}).toBe(true).then(()=>true,()=>false);
      // A queue that still holds this fighter's job would read a promotion as a reaction.
      if(!clear){reactions.gold.push({name,ms:null,skipped:'queue held a job for this fighter'});continue;}
      // A fighter between realms or reconnecting has no native player; the probe skips it.
      if(!await live.admin(`output=(()=>{const p=get_player('${name}');if(!p)return false;p.gold=60000000;resend(p,'reopen');return true})()`)){reactions.gold.push({name,ms:null,skipped:'no native player'});continue;}
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
