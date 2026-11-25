import {observeNativeRenderer} from './native-renderer-observer.ts';
import {observerRecords} from './native-observer-kit';
import {partyNames} from './game/hunt-lifecycle';
import type {Page} from '@playwright/test';
interface Entry {requestId:string;actor:string;kind:string;endpoint:string;sequence:number|null;at:number;start:number;[key:string]:unknown}
const endpoints=new Set(['/party-api/status','/party-api/shared-travel','/party-api/convoy-route','/party-api/movement-barrier']);
const actors=new Set(partyNames);
const timingFields=['requestTime','proxyStart','proxyEnd','dnsStart','dnsEnd','connectStart','connectEnd','sslStart','sslEnd','sendStart','sendEnd','receiveHeadersStart','receiveHeadersEnd'] as const;
/** Passive real HTTP metadata; never enables interception or fetches bodies. */
export async function observeNativeTransport(page:Page) {
  const session=await page.context().newCDPSession(page);
  const renderer=await observeNativeRenderer(page,session);
  const pending=new Map<string,Entry>(),entries=observerRecords<Entry>();
  const counts:Record<string,number>={},connections=new Set<number>();
  let peakPending=0,droppedPending=0;
  session.on('Network.requestWillBeSent',event=>{
    let url:URL,body:Record<string,any>={};
    try{url=new URL(event.request.url);}catch(error){entries.fail('request-url',error);return;}
    if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!endpoints.has(url.pathname))return;
    try{body=JSON.parse(event.request.postData||'{}');}catch(error){entries.fail('request-body',error);return;}
    const actor=String(body.name||body.character||url.searchParams.get('character')||'');if(!actors.has(actor))return;
    const kind=url.pathname==='/party-api/status'?(body.combatWait===true?'combatWait':body.combatOnly===true?'combatOnly':'full'):url.pathname.slice('/party-api/'.length);
    const sequence=Number(body.travelSample?.sequence);
    pending.set(event.requestId,{requestId:event.requestId,actor,kind,endpoint:url.pathname,sequence:Number.isFinite(sequence)?sequence:null,at:event.wallTime*1000,start:event.timestamp});
    counts[kind]=(counts[kind]||0)+1;peakPending=Math.max(peakPending,pending.size);
    if(pending.size>128){pending.delete(pending.keys().next().value!);droppedPending++;}
  });
  session.on('Network.responseReceived',event=>{
    const entry=pending.get(event.requestId);if(!entry)return;const response=event.response,t=response.timing;
    const timing=t&&Object.fromEntries(timingFields.filter(key=>Number.isFinite(t[key])).map(key=>[key,t[key]]));
    Object.assign(entry,{responseAt:event.timestamp,status:response.status,protocol:response.protocol,connectionId:response.connectionId,reused:response.connectionReused,timing,
      sendAfterRequestMs:t?Math.max(0,(t.requestTime-entry.start)*1000+t.sendStart):null});
    if(Number.isFinite(response.connectionId)&&connections.size<128)connections.add(response.connectionId);
    if(t&&t.receiveHeadersEnd>=0){
      const headersAt=t.requestTime+t.receiveHeadersEnd/1000;
      const notificationLagMs=Math.max(0,(event.timestamp-headersAt)*1000);
      entry.headersAt=headersAt;entry.notificationLagMs=notificationLagMs;
      if(notificationLagMs>500)renderer.start({actor:entry.actor,kind:entry.kind,sequence:entry.sequence,
        at:entry.at,start:entry.start,headersAt,notificationAt:event.timestamp,notificationLagMs});
    }
  });
  session.on('Network.loadingFinished',event=>{const entry=pending.get(event.requestId);if(!entry)return;pending.delete(event.requestId);
    entries.push({...entry,end:event.timestamp,durationMs:(event.timestamp-entry.start)*1000,encodedBytes:event.encodedDataLength});});
  session.on('Network.loadingFailed',event=>{const entry=pending.get(event.requestId);if(!entry)return;pending.delete(event.requestId);
    entries.push({...entry,end:event.timestamp,durationMs:(event.timestamp-entry.start)*1000,cancelled:!!event.canceled,failure:/^net::ERR_[A-Z_]+$/.test(event.errorText)?event.errorText:'network-failure'});});
  await session.send('Network.enable');
  return {async finish(){
    const {records,dropped,failures}=entries.report();
    const result={counts,peakPending,droppedPending,connectionIds:[...connections],records,droppedRecords:dropped,failures,pending:[...pending.values()],renderer:await renderer.finish()};
    await session.detach();return result;
  }};
}
