import type {CDPSession,Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {observerRecords,startCdpProfile} from './native-observer-kit';
import {partyNames} from './game/hunt-lifecycle';
// Runs in the page, so it takes the names and keys as its argument. A delivery the binding
// refuses counts under `${key}_failed`, which finish() reads back.
function installLongTasks({binding,key,names}:{binding:string;key:string;names:string[]}) {
  const game=window as any;
  if(typeof PerformanceObserver!=='function'||!PerformanceObserver.supportedEntryTypes.includes('longtask'))return;
  if(game[key])return;
  const failed=()=>{game[key+'_failed']=(game[key+'_failed']||0)+1;};
  const observer=new PerformanceObserver(list=>{
    const name=game.character?.name;
    if(!names.includes(name))return;
    const rows=list.getEntries().map((entry:any)=>({name,at:(game.__e2eChronalClock?.nativeTimeOrigin??performance.timeOrigin)+entry.startTime,gameplayObservedAt:Date.now(),
      startTime:entry.startTime,duration:entry.duration,context:game.sharedRoutine?'code':'native',
      path:location.pathname,generation:game.__e2eObserverGeneration||game.parent?.__e2eObserverGeneration,
      attribution:(entry.attribution||[]).slice(0,3).map((a:any)=>({name:a.name,containerType:a.containerType,containerName:a.containerName,containerId:a.containerId}))}));
    try{Promise.resolve(game[binding](rows)).catch(failed);}catch{failed();}
  });
  observer.observe({entryTypes:['longtask']});game[key]=observer;
}
/** Bounded observations only: no pause, interception, game timers or video edits. */
export async function observeNativeRenderer(page:Page,session:CDPSession) {
  const binding='rendererTasks_'+randomUUID().replaceAll('-',''),key='__e2eLongTasks_'+randomUUID().replaceAll('-','');
  const tasks=observerRecords<Record<string,unknown>>();
  let active=true,trigger:Record<string,unknown>|undefined,profile:unknown,profileWork:Promise<void>|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined,stopProfile:(()=>Promise<void>)|undefined,deliveryFailures=0;
  await page.exposeBinding(binding,(_source,rows:Array<Record<string,unknown>>)=>{
    if(!active||!Array.isArray(rows))return;
    for(const row of rows)tasks.push(row);
  });
  await page.addInitScript(installLongTasks,{binding,key,names:partyNames});
  for(const frame of page.frames()){
    if(frame.isDetached())continue;
    await tasks.guard('longtask-install',()=>frame.evaluate(installLongTasks,{binding,key,names:partyNames}));
  }
  function start(details:Record<string,unknown>) {
    if(trigger)return;trigger=details;
    profileWork=tasks.guard('profile-start',async()=>{
      const cpu=await startCdpProfile(session,1000);
      stopProfile=async()=>{
        clearTimeout(timer);
        const value=await cpu.stop();
        profile={startTime:value.startTime,endTime:value.endTime,nodesTruncated:value.nodes.length>2048,samplesTruncated:(value.samples?.length||0)>20000,
          nodes:value.nodes.slice(0,2048).map(node=>({...node,children:node.children?.slice(0,2048)})),
          samples:value.samples?.slice(0,20000),timeDeltas:value.timeDeltas?.slice(0,20000)};
      };
      timer=setTimeout(()=>{void tasks.guard('profile-stop',stopProfile!);},10000);
    });
  }
  return {start,async finish(){
    active=false;await profileWork;
    if(stopProfile)await tasks.guard('profile-stop',stopProfile);
    clearTimeout(timer);
    for(const frame of page.frames())if(!frame.isDetached()){
      deliveryFailures+=await tasks.guard('longtask-cleanup',()=>frame.evaluate(key=>{const g=window as any,failed=g[key+'_failed']||0;
        g[key]?.disconnect();delete g[key];delete g[key+'_failed'];return failed;},key))??0;
    }
    const {records,dropped,failures}=tasks.report();
    return {trigger,profile,longTasks:records,droppedLongTasks:dropped,deliveryFailures,failures};
  }};
}
