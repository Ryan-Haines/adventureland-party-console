import {build} from 'esbuild';
import {test,expect} from './fixtures';

test('metrics persists deduplicated native observations across coordinator restart',async({app,page},info)=>{
  const at=Math.floor(Date.now()/10000)*10000;
  const sample={at:at+100,gold:100,luck:100,ping:30,level:1,xp:0,maxXp:100};
  const frame={at,sequence:1,observedMs:1000,partial:false,damage:[{monster:'goo',skill:'attack',amount:23,hits:1}],credits:[],kills:[{id:'metrics-native-death',at:at+100,monster:'goo',actor:'W'}],loot:[],first:sample,last:sample};
  const batch={character:'W',server:'US I',runtime:'metrics-e2e',frames:[frame]};
  const receipts:Array<{status:number;body:string}>=[];
  const deliver=async()=>{
    const response=await page.request.post(app.url+'/party-api/metrics',{data:batch,headers:{origin:app.url}});
    const body=await response.text();receipts.push({status:response.status(),body});
    expect(response.ok(), 'Metrics ingest HTTP '+response.status()+': '+body).toBeTruthy();
  };
  await deliver();await deliver();
  await app.restartCoordinator();
  await deliver();
  const response=await page.request.get(app.url+'/party-api/metrics?from='+at+'&to='+(at+20000));
  expect(response.ok()).toBeTruthy();const history=await response.json();
  const points=history.points;expect(points.flatMap((p:any)=>p.kills).reduce((n:number,k:any)=>n+k.count,0)).toBe(1);
  expect(points.flatMap((p:any)=>p.values).flatMap((v:any)=>v.damage).reduce((n:number,d:any)=>n+d.amount,0)).toBe(23);
  await info.attach('metrics-restart-deduplication',{body:JSON.stringify({receipts,history}),contentType:'application/json'});
});


test('metrics collector retries persisted browser frames after CODE replacement',async({page},info)=>{
  // Failure inventory: a numeric ring-header loses queued frames on reload;
  // replacement CODE changes receipt identity or resamples old gold; legacy
  // frame content must remain immutable until coordinator acknowledgement.
  const built=await build({entryPoints:['runtime/characters/metrics.ts'],bundle:true,write:false,format:'iife',platform:'browser'});
  const script=built.outputFiles[0].text;
  await page.goto('/');
  const install=async(deliver:boolean)=>{
    await page.addScriptTag({content:script});
    await page.evaluate(deliver=>{
      const host=window as any;host.metricsReceived=[];
      host.installPartyMetrics({now:()=>Date.now(),current:()=>true,connected:()=>true,name:()=> 'BrowserMetricsE2E',own:()=>true,ownedCharacter:()=>true,
        context:()=>({server:'USII',map:'main',instance:'main',party:[]}),sample:()=>({gold:deliver?999:111,luck:1,ping:20,level:1,xp:0,maxXp:100}),
        storage:localStorage,send:async(batch:any)=>{if(!deliver)throw Error('Declared unavailable coordinator');host.metricsReceived.push(batch);return {ok:true};}});
    },deliver);
  };
  await install(false);
  const key='party-metrics-v1:BrowserMetricsE2E';
  await expect.poll(()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null')?.queue.length||0,key)).toBeGreaterThan(0);
  const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);
  const sequence=pending.queue[0];expect(typeof sequence).toBe('number');
  await page.reload();await install(true);
  await expect.poll(()=>page.evaluate(({runtime,sequence})=>(window as any).metricsReceived.some((b:any)=>b.runtime===runtime&&b.frames.some((f:any)=>f.sequence===sequence&&f.first.gold===111)),{runtime:pending.runtime,sequence})).toBe(true);
  const received=await page.evaluate(()=>(window as any).metricsReceived);
  const matching=received.flatMap((b:any)=>b.frames.filter((f:any)=>f.sequence===sequence));expect(matching).toHaveLength(1);expect(matching[0].last.gold).toBe(111);
  await info.attach('metrics-browser-replacement-retries',{body:JSON.stringify({pending,received}),contentType:'application/json'});
});
