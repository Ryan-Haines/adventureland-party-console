import type {CDPSession,Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
function installLongTasks({binding,key}:{binding:string;key:string}) {
  const game=window as any;
  if(typeof PerformanceObserver!=='function'||!PerformanceObserver.supportedEntryTypes.includes('longtask'))return;
  if(game[key])return;
  const observer=new PerformanceObserver(list=>{
    const name=game.character?.name;
    if(!['E2EWarrior','E2EPriest','E2EMerchant'].includes(name))return;
    const rows=list.getEntries().map((entry:any)=>({name,at:(game.__e2eChronalClock?.nativeTimeOrigin??performance.timeOrigin)+entry.startTime,gameplayObservedAt:Date.now(),
      startTime:entry.startTime,duration:entry.duration,context:game.sharedRoutine?'code':'native',
      path:location.pathname,generation:game.__e2eObserverGeneration||game.parent?.__e2eObserverGeneration,
      attribution:(entry.attribution||[]).slice(0,3).map((a:any)=>({name:a.name,containerType:a.containerType,containerName:a.containerName,containerId:a.containerId}))}));
    try{Promise.resolve(game[binding](rows)).catch(()=>{});}catch{}
  });
  observer.observe({entryTypes:['longtask']});game[key]=observer;
}
function pathname(value:string):string {try{const url=new URL(value);return ['http:','https:','file:'].includes(url.protocol)?url.pathname.slice(0,512):'';}catch{return '';}}
/** Bounded observations only: no pause, interception, game timers or video edits. */
export async function observeNativeRenderer(page:Page,session:CDPSession) {
  const binding='rendererTasks_'+randomUUID().replaceAll('-',''),key='__e2eLongTasks_'+randomUUID().replaceAll('-','');
  const first:Array<Record<string,unknown>>=[],latest:Array<Record<string,unknown>>=[];
  const errors:Array<{stage:string;kind:string}>=[];
  let active=true,trigger:Record<string,unknown>|undefined,profile:unknown,profileWork:Promise<void>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined,stopProfile:(()=>Promise<void>)|undefined;
  await page.exposeBinding(binding,(_source,rows:Array<Record<string,unknown>>)=>{
    if(!active||!Array.isArray(rows))return;
    for(const row of rows){if(first.length<32)first.push(row);else{latest.push(row);if(latest.length>168)latest.shift();}}
  });
  await page.addInitScript(installLongTasks,{binding,key});
  for(const frame of page.frames()){
    if(frame.isDetached())continue;
    try{await frame.evaluate(installLongTasks,{binding,key});}catch(error){errors.push({stage:'longtask-install',kind:error instanceof Error?error.name:'unknown'});}
  }
  function start(details:Record<string,unknown>) {
    if(trigger)return;trigger=details;
    profileWork=(async()=>{
      try{
        await session.send('Profiler.enable');await session.send('Profiler.setSamplingInterval',{interval:1000});await session.send('Profiler.start');
        let stopping:Promise<void>|undefined;
        stopProfile=()=>stopping||=(async()=>{
          clearTimeout(timer);
          const value=(await session.send('Profiler.stop')).profile;
          profile={startTime:value.startTime,endTime:value.endTime,nodesTruncated:value.nodes.length>2048,samplesTruncated:(value.samples?.length||0)>20000,
            nodes:value.nodes.slice(0,2048).map(node=>({...node,children:node.children?.slice(0,2048),callFrame:{...node.callFrame,url:pathname(node.callFrame.url)}})),
            samples:value.samples?.slice(0,20000),timeDeltas:value.timeDeltas?.slice(0,20000)};
        })();
        timer=setTimeout(()=>{void stopProfile!().catch(error=>errors.push({stage:'profile-stop',kind:error instanceof Error?error.name:'unknown'}));},10000);
      }catch(error){errors.push({stage:'profile-start',kind:error instanceof Error?error.name:'unknown'});}
    })();
  }
  return {start,async finish(){
    active=false;await profileWork;
    if(stopProfile)try{await stopProfile();}catch(error){errors.push({stage:'profile-stop',kind:error instanceof Error?error.name:'unknown'});}
    clearTimeout(timer);
    for(const frame of page.frames())if(!frame.isDetached()){
      try{await frame.evaluate(key=>{const g=window as any;g[key]?.disconnect();delete g[key];},key);}catch(error){errors.push({stage:'longtask-cleanup',kind:error instanceof Error?error.name:'unknown'});}
    }
    return {trigger,profile,longTasks:[...first,...latest],errors:errors.slice(-16)};
  }};
}
