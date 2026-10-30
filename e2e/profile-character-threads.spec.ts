// Character-thread profile on the disposable game stack: docs/efficiency.md,
// Character threads, How to rerun. Not part of the live project; run it with
// playwright.profile.config.ts and e2e/profiling/thread-profile-preload.cjs.
import {test,expect} from './live-fixtures';
import {readdirSync,readFileSync,readlinkSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {farmingAreas} from '../dashboard/lib/farming-areas';
const W='E2EWarrior',P='E2EPriest',M='E2EMerchant',X='E2EBankBoi';
const scenario=process.env.PROF_SCENARIO||'farm';
const warmup=Number(process.env.PROF_WARMUP_S||60),windowS=Number(process.env.PROF_WINDOW_S||180);
// The Steam primary (warrior) stays a browser client; priest, mage and merchant run headless.
test.use({liveHeadless:true,extraFighter:'mage',initialPosition:{map:'main',x:-32,y:787}});
function pids(directory:string){
  const out:{pid:number;role:string}[]=[];
  for(const entry of readdirSync('/proc')){
    if(!/^\d+$/.test(entry))continue;
    try{
      const argv=readFileSync(`/proc/${entry}/cmdline`,'utf8').split('\0');
      if(argv.some(a=>a.endsWith('CharacterThread.js'))&&readlinkSync(`/proc/${entry}/cwd`)===directory)out.push({pid:+entry,role:'thread'});
      else if(argv.some(a=>a.endsWith('live-coordinator.cjs'))&&readFileSync(`/proc/${entry}/environ`,'utf8').includes('E2E_DATA_DIR='+directory))out.push({pid:+entry,role:'coordinator'});
    }catch{}
  }
  return out;
}
test('profile headless character threads: '+scenario,async({live},info)=>{
  test.setTimeout((warmup+windowS)*1000+600000);
  const dir=process.env.PROF_DIR!;mkdirSync(dir,{recursive:true});
  await live.post('/merchant/force-stand',{enabled:scenario!=='merchant'});
  await live.post('/focus',{monsterFocus:['goo'],monsterPriorities:{},monsterSearchRadius:600});
  for(const name of [P,X,M]){
    await live.post('/steam/action',{character:name,action:'logout'});
    await expect.poll(async()=>{const s=await live.state();return !s.activeSlots.some((slot:any)=>slot.character===name)&&(!s.steamSwitch||s.steamSwitch.phase==='complete');},{timeout:60000}).toBe(true);
    await expect.poll(()=>live.admin(`output=!!get_player('${name}')`),{timeout:30000}).toBe(false);
    const s=await live.state(),slot=s.activeSlots.find((slot:any)=>!slot.character&&slot.kind!=='steam');
    await live.post('/slots/'+(slot?.slot??slot?.index)+'/spawn',{character:name});
    await expect.poll(async()=>(await live.state()).characters[name]?.runtime,{timeout:90000}).toBe('headless');
  }
  if(scenario==='merchant'){
    // Merchant collection work: marked cargo on each fighter (as seedCargo in
    // hunt-interruption-helpers.ts), party collection and bank deposit enabled.
    for(const name of [W,P,X]){
      await expect.poll(()=>live.admin(`output=(()=>{const p=get_player(${JSON.stringify(name)});if(!p)return false;p.items[10]={name:'leather',q:7};cache_player_items(p);resend(p,'u+cid+reopen');return true})()`),{timeout:30000}).toBe(true);
      await expect.poll(async()=>(await live.state()).characters[name]?.items?.[10]?.item?.q,{timeout:30000}).toBe(7);
      await live.post('/command',{character:name,type:'merchant-mark',slot:10,item:{name:'leather',q:7}});
    }
    await live.post('/config',{itemCollectionThreshold:1});
    await live.post('/merchant/routine-priorities',{priorities:{},enabled:{'party collection':true,'bank deposit':true}});
  }
  for(const name of [W,P,X])await live.post('/farming-mode',{character:name,mode:'default'});
  await live.post('/formation',{leader:W});
  for(const name of [P,X])await live.post('/formation',{character:name,follow:true});
  const area=farmingAreas((await live.state(true)).monsterChoices,['goo']).find((a:any)=>a.map==='main');
  if(area)await live.post('/navigate-to-monster',{monsterId:'goo',location:area});

  let seededIds:string[]=[];
  if(scenario==='combat'){
    // Controlled load: six stationary high-HP goos next to the party keep every fighter
    // attacking for the whole window. Natural spawns stay; the test removes the seeded goos
    // after the window.
    const seeded=await live.admin(`output=(()=>{const p=get_player('${W}');
      const made=[];for(let i=0;i<6;i++){const a=new_monster('main',{type:'goo',position:[p.x+60*Math.cos(i*Math.PI/3),p.y+60*Math.sin(i*Math.PI/3)],radius:0,count:1},{temp:1});a.hp=a.max_hp=50000000;made.push(String(a.id));}
      return {at:{x:p.x,y:p.y},made};})()`);
    seededIds=seeded.made;
    await info.attach('combat-seed',{body:JSON.stringify(seeded),contentType:'application/json'});
  }
  await new Promise(r=>setTimeout(r,warmup*1000));
  const brief=(s:any)=>Object.fromEntries([W,P,X,M].map(n=>{const c=s.characters[n]||{};return [n,{runtime:c.runtime,map:c.map,x:Math.round(c.x),y:Math.round(c.y),target:c.target,hp:c.hp,mode:c.farmingMode||c.mode,activity:c.activity||c.task||null}];}));
  const procs=pids(live.deploymentPaths.directory);
  expect(procs.filter(p=>p.role==='thread').length).toBe(3);
  const before=await live.state();
  for(const p of procs)process.kill(p.pid,'SIGUSR2');
  const startedAt=Date.now();
  if(scenario==='travel'){
    // Convoy travel: the leader alternates between the goo and crab farms every 30 s.
    const choices=(await live.state(true)).monsterChoices;
    const goo=farmingAreas(choices,['goo']).find((a:any)=>a.map==='main'),crab=farmingAreas(choices,['crab']).find((a:any)=>a.map==='main');
    const legs:any[]=[];
    for(let leg=0;Date.now()-startedAt<windowS*1000-1000;leg++){
      const [id,area]=leg%2?['goo',goo]:['crab',crab];
      legs.push({at:Date.now(),id,accepted:!!(await live.post('/navigate-to-monster',{monsterId:id,location:area}).catch(e=>({error:String(e)})))});
      await new Promise(r=>setTimeout(r,Math.min(30000,Math.max(0,windowS*1000-(Date.now()-startedAt)))));
    }
    await info.attach('travel-legs',{body:JSON.stringify(legs),contentType:'application/json'});
  } else if(scenario==='merchant'){
    // Bank visit: the party asks the merchant to collect the marked cargo every 50 s.
    const visits:any[]=[];
    while(Date.now()-startedAt<windowS*1000-1000){
      visits.push({at:Date.now(),result:await live.post('/bank-party',{group:W}).catch(e=>({error:String(e)}))});
      await new Promise(r=>setTimeout(r,Math.min(50000,Math.max(0,windowS*1000-(Date.now()-startedAt)))));
    }
    await info.attach('bank-visits',{body:JSON.stringify(visits),contentType:'application/json'});
  } else await new Promise(r=>setTimeout(r,windowS*1000));
  for(const p of procs)process.kill(p.pid,'SIGUSR2');
  const after=await live.state();
  await expect.poll(()=>procs.every(p=>readdirSync(dir).some(f=>f.endsWith('-'+p.pid+'.json'))),{timeout:60000}).toBe(true);
  // Report latency: a server-side inventory change on the headless priest until /party-api/state shows it.
  const latency:number[]=[];
  for(let i=1;i<=20;i++){
    await live.admin(`output=(()=>{const p=get_player('${P}');p.items[20]={name:'leather',q:${i}};cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
    const t1=Date.now();
    await expect.poll(async()=>(await live.state()).characters[P]?.items?.[20]?.item?.q,{timeout:10000,intervals:[20]}).toBe(i);
    latency.push(Date.now()-t1);
    await new Promise(r=>setTimeout(r,300+Math.random()*700));
  }
  await live.admin(`output=(()=>{const p=get_player('${P}');p.items[20]=null;cache_player_items(p);resend(p,'u+cid+reopen');return true})()`);
  const summary={scenario,atStart:brief(before),atEnd:brief(after),startedAt,windowS,procs,latency,
    kills:Object.fromEntries([W,P,X,M].map(n=>[n,{before:before.characters[n]?.kills??null,after:after.characters[n]?.kills??null}])),
    runtimes:Object.fromEntries([W,P,X,M].map(n=>[n,after.characters[n]?.runtime]))};
  writeFileSync(path.join(dir,'summary.json'),JSON.stringify(summary,null,1));
  if(seededIds.length)await live.admin(`output=(()=>{let n=0;for(const id of ${JSON.stringify(seededIds)}){const m=instances.main.monsters[id];if(m){remove_monster(m,{method:'disappear',nospawn:true});n++;}}return n;})()`);
  // A run whose fighters never fought measures nothing, so the test fails it.
  if(scenario!=='merchant')for(const p of procs.filter(p=>p.role==='thread')){
    const file=readdirSync(dir).find(f=>f.endsWith('-'+p.pid+'.json'))!,data=JSON.parse(readFileSync(path.join(dir,file),'utf8'));
    if(data.name!==M)expect(data.speed.attacksTotal+data.speed.heals,'attacks by '+data.name).toBeGreaterThan(20);
  }
  await info.attach('profile-summary',{body:JSON.stringify(summary),contentType:'application/json'});
});
