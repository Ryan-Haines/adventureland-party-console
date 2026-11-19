// What the native observers and profilers share (e2e/native-renderer-observer.ts,
// native-transport-observer.ts, native-planner-observation.ts, native-planner-cpu-profile.ts,
// movement-climbs.ts). Each observer returns its records together with the records it dropped and
// the deliveries or reads that failed, so a row reading an empty or short buffer can tell a quiet
// run from a broken observer.
import type {CDPSession} from '@playwright/test';

export interface ObserverFailure {stage:string;error:string}
export const describeError=(error:unknown)=>error instanceof Error?`${error.name}: ${error.message}`:String(error);

/** A record buffer that keeps the first `first` records and the latest `latest` after them. */
export function observerRecords<T>(first=32,latest=168) {
  const head:T[]=[],tail:T[]=[],failures:ObserverFailure[]=[];
  let dropped=0;
  const fail=(stage:string,error:unknown)=>{failures.push({stage,error:describeError(error)});};
  return {
    push(record:T){
      if(head.length<first){head.push(record);return;}
      tail.push(record);
      if(tail.length>latest){tail.shift();dropped++;}
    },
    fail,
    /** Runs one read or delivery; a throw or a rejection becomes a failure under `stage`. */
    async guard<R>(stage:string,work:()=>R|Promise<R>):Promise<R|undefined>{
      try{return await work();}catch(error){fail(stage,error);return undefined;}
    },
    report(){return {records:[...head,...tail],dropped,failures:[...failures]};},
  };
}

/**
 * Counts the records a ring lost between two reads. A read whose oldest sequence sits past the
 * last sequence seen plus one means the ring wrapped over records no read saw. A runtime reload
 * starts the sequence again, so an oldest sequence at or below the last seen one is no gap.
 */
export function sequenceGaps() {
  const last=new Map<string,number>(),gaps=new Map<string,number>();
  return {
    read(name:string,sequences:number[]){
      if(!sequences.length)return;
      const oldest=Math.min(...sequences),newest=Math.max(...sequences),seen=last.get(name);
      if(seen!==undefined&&oldest>seen+1)gaps.set(name,(gaps.get(name)??0)+1);
      last.set(name,newest);
    },
    gaps:(name:string)=>gaps.get(name)??0,
  };
}

/** A profile URL keeps only its http, https or file path; anything else reads as ''. */
export function profilePath(value:string):string {
  try{const url=new URL(value);return ['http:','https:','file:'].includes(url.protocol)?url.pathname.slice(0,512):'';}catch{return '';}
}

/** Starts one V8 CPU profile over a CDP session; `stop` returns it with its call frame URLs cut to their path. */
export async function startCdpProfile(session:CDPSession,intervalUs:number) {
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval',{interval:intervalUs});
  await session.send('Profiler.start');
  const stopOnce=async()=>{
    const profile=(await session.send('Profiler.stop')).profile;
    for(const node of profile.nodes)node.callFrame.url=profilePath(node.callFrame.url);
    return profile;
  };
  let stopping:ReturnType<typeof stopOnce>|undefined;
  return {stop:()=>stopping||=stopOnce()};
}
