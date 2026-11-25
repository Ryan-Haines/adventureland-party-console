import {build} from 'esbuild';
import {test,expect} from './fixtures';
import type {Page} from '@playwright/test';

// installCollector loads the bundled character telemetry into the page and installs its metrics
// collector for `name` with the planted sample. With deliver false every send fails as an
// unavailable coordinator; with deliver true each batch lands in window.metricsReceived.
async function installCollector(page:Page,script:string,name:string,sample:Record<string,number>,deliver:boolean){
  await page.addScriptTag({content:script});
  await page.evaluate(({name,sample,deliver})=>{
    const host=window as any;host.metricsReceived=[];
    // The lifecycle owner's report timer drives the collector's pulse in the character (character/telemetry.ts).
    const metrics=host.Telemetry.installPartyMetrics({now:()=>Date.now(),current:()=>true,connected:()=>true,name:()=>name,own:()=>true,ownedCharacter:()=>true,
      context:()=>({server:'USII',map:'main',instance:'main',party:[]}),sample:()=>sample,
      storage:localStorage,send:async(batch:any)=>{if(!deliver)throw Error('Declared unavailable coordinator');host.metricsReceived.push(batch);return {ok:true};}});
    setInterval(metrics.pulse,1000);
  },{name,sample,deliver});
}
const SAMPLE={luck:1,ping:20,level:1,xp:0,maxXp:100};

// The kills, damage, items and loot views count days from the browser's midnight,
// daylight saving included, and say so. Run in New York, where 2026-03-08 is 23 hours long.
test.describe('metric days',()=>{
  test.use({timezoneId:'America/New_York'});
  test("a metric day starts at the browser's midnight and says so",async({page})=>{
    const built=await build({entryPoints:['dashboard/features/party/metrics-days.ts'],bundle:true,write:false,format:'iife',platform:'browser',globalName:'MetricDays'});
    await page.goto('/');
    await page.addScriptTag({content:built.outputFiles[0].text});
    const days=await page.evaluate(()=>{const d=(window as any).MetricDays;
      return {start:d.metricDayStart('2026-03-08'),next:d.metricDayStart('2026-03-09'),midnight:new Date(2026,2,8).getTime(),
        late:d.metricDay(new Date(2026,2,8,23,30).getTime()),shifted:d.shiftMetricDay('2026-03-08',1),note:d.METRIC_DAY_NOTE};});
    expect(days.start).toBe(days.midnight);
    expect(days.next-days.start).toBe(23*3600_000);
    expect([days.late,days.shifted]).toEqual(['2026-03-08','2026-03-09']);
    expect(days.note).toBe("Days start at this browser's midnight.");
  });
});

test('metrics outbox keeps ring keys only for unconfirmed frames across a reload',async({page},info)=>{
  // Failure inventory: docs/efficiency.md, Persistence, P11. A confirmed frame keeps its
  // ring key; a reload loses or changes an unconfirmed frame; the cleanup removes the slot
  // of a queued frame or a key that is not the collector's.
  const built=await build({entryPoints:['runtime/status/character/telemetry.ts'],bundle:true,write:false,format:'iife',platform:'browser',globalName:'Telemetry'});
  const script=built.outputFiles[0].text,key='party-metrics-v1:BrowserOutboxE2E';
  const at=Math.floor(Date.now()/10000)*10000,sample={at,gold:4242,luck:1,ping:20,level:1,xp:0,maxXp:100};
  const queued={at,sequence:41,observedMs:1000,partial:false,damage:[{monster:'goo',skill:'attack',amount:7,hits:1}],credits:[],kills:[],loot:[],first:sample,last:sample,server:'USII'};
  await page.goto('/');
  // The 1.5 collector kept every confirmed frame's ring key until the ring wrapped.
  await page.evaluate(({key,queued})=>{
    for(let sequence=1;sequence<=40;sequence++)localStorage.setItem(key+':frame:'+sequence,JSON.stringify({...queued,sequence}));
    localStorage.setItem(key+':frame:41',JSON.stringify(queued));
    localStorage.setItem(key,JSON.stringify({runtime:'outbox-e2e',sequence:41,queue:[41],lost:false,goldMovement:0}));
    localStorage.setItem('cm_BrowserOutboxE2E_other','["fixture"]');
  },{key,queued});
  // The collector may append a frame between separate browser evaluations.
  // Compare its header and ring from one synchronous storage snapshot.
  const snapshot=()=>page.evaluate(key=>({
    header:JSON.parse(localStorage.getItem(key)||'null'),
    ringKeys:Object.keys(localStorage).filter(name=>name.startsWith(key+':frame:')).sort(),
  }),key);
  const ringKeys=async()=>(await snapshot()).ringKeys;
  const header=async()=>(await snapshot()).header;
  // The replacement CODE samples another gold, so a resent frame shows it kept its first content.
  const install=(deliver:boolean)=>installCollector(page,script,'BrowserOutboxE2E',{gold:deliver?999:1,...SAMPLE},deliver);
  await install(false);
  expect(await ringKeys(),'install removes the confirmed 1.5 frame keys and keeps the queued frame').toEqual([key+':frame:41']);
  // The undelivered collector queues new frames behind 41; one of them is enough to check a resend.
  await expect.poll(async()=>(await header()).queue.some((sequence:number)=>sequence!==41)).toBe(true);
  const pendingSnapshot=await snapshot(),pending=pendingSnapshot.header;
  expect(pendingSnapshot.ringKeys).toEqual(pending.queue.map((sequence:number)=>key+':frame:'+sequence).sort());
  await page.reload();await install(true);
  await expect.poll(()=>page.evaluate(sequences=>{
    const sent=(window as any).metricsReceived.flatMap((batch:any)=>batch.frames.map((frame:any)=>frame.sequence));
    return sequences.every((sequence:number)=>sent.includes(sequence));
  },pending.queue)).toBe(true);
  const received=await page.evaluate(()=>(window as any).metricsReceived);
  const frames=received.flatMap((batch:any)=>batch.frames);
  for(const sequence of pending.queue)expect(frames.filter((frame:any)=>frame.sequence===sequence),'frame '+sequence+' sent once').toHaveLength(1);
  for(const sequence of pending.queue.filter((sequence:number)=>sequence!==41))
    expect(frames.find((frame:any)=>frame.sequence===sequence).last.gold,'frame '+sequence+' keeps its first gold').toBe(1);
  const original=frames.find((frame:any)=>frame.sequence===41);
  expect(original.first.gold).toBe(4242);expect(original.damage).toEqual(queued.damage);
  expect(received.every((batch:any)=>batch.runtime==='outbox-e2e')).toBe(true);
  // Every confirmed frame leaves the queue and the store; only the frames still queued keep a key.
  await expect.poll(async()=>{const current=await snapshot(),queue=current.header.queue;return JSON.stringify(current.ringKeys)===JSON.stringify(queue.map((sequence:number)=>key+':frame:'+sequence).sort())&&!queue.some((sequence:number)=>pending.queue.includes(sequence));}).toBe(true);
  expect(await page.evaluate(()=>localStorage.getItem('cm_BrowserOutboxE2E_other'))).toBe('["fixture"]');
  await info.attach('metrics-outbox-ring-keys',{body:JSON.stringify({pending,received,ringKeys:await ringKeys()}),contentType:'application/json'});
});
