import type {Frame} from '@playwright/test';
import type {LiveClient} from './live-game-client';

/** Passive metadata from the real CODE jQuery; never a replacement transport. */
export async function observeNativeStatus(clients:Record<string,LiveClient>,names:string[]){
  const key='__e2eEventStatus',frames:Frame[]=[];
  const games=Object.fromEntries(names.map(name=>[name,clients[name].frame]));
  async function refresh(name:string){
    const element=await clients[name].frame.$('#maincode');
    const frame=await element?.contentFrame();await element?.dispose();
    if(!frame)throw Error('Native status observer requires the actual CODE frame');
    if(frames.includes(frame))return;
    await frame.evaluate(({key,name})=>{
      const host=window as any,game=parent as any;
      const ledger=(game[key] ||= {name,samples:[],errors:[],counts:{},maxReportGap:null,lastReport:null});
      host.$(document).on('ajaxComplete.e2eEventStatus',(_event:any,xhr:any,settings:any)=>{
        if(String(settings.url).endsWith('/convoy-complete')){
          const completions=(ledger.completions ||= []);
          completions.push({at:Date.now(),status:xhr.status,request:settings.data,response:xhr.responseJSON});
          if(completions.length>32)completions.splice(16,1);
        }
        if(!String(settings.url).endsWith('/status'))return;
        try{
          const request=typeof settings.data==='string'?JSON.parse(settings.data):{},value=xhr.responseJSON||{},owner=host.__partyEventExitOwner;
          const kind=request.combatWait?'wait':request.combatOnly?'report':'full';
          ledger.counts[kind]=(ledger.counts[kind]||0)+1;
          const sample={at:Date.now(),status:xhr.status,kind,
            sequence:request.travelSample?.sequence,runtime:request.travelSample?.runtimeId,
            receipt:value.combatReportReceipt?{sequence:value.combatReportReceipt.sequence,receivedAt:value.combatReportReceipt.receivedAt,evaluatedAt:value.combatReportReceipt.evaluatedAt}:undefined,serverNow:value.serverNow,sentAt:value.transportTiming?.sentAt,
            eventReturnCycleId:value.eventReturnCycleId,selectedCycle:host.__partyEventRecoveryCycleId,
            ownerAt:host.__partyEventRecoveryOwnerAt,generation:host.__partyRuntimeGeneration,
            owner:owner?{cycleId:owner.cycleId,commandId:owner.commandId,cancelled:!!owner.cancelled}:null};
          ledger.samples.push(sample);
          if(ledger.samples.length>96)ledger.samples.splice(32,1);
          if(kind==='report'){
            const gap=ledger.lastReport?sample.at-ledger.lastReport.at:0;
            if(gap>(ledger.maxReportGap?.ms||0))ledger.maxReportGap={ms:gap,before:ledger.lastReport,after:sample};
            ledger.lastReport=sample;
          }
        }catch(error){ledger.errors.push(String(error));if(ledger.errors.length>8)ledger.errors.shift();}
      });
    },{key,name});
    frames.push(frame);
  }
  for(const name of names)await refresh(name);
  return {refresh,async finish(){
    const output:Record<string,unknown>={};
    for(const [name,game]of Object.entries(games)){
      try{output[name]=await game.evaluate(key=>(window as any)[key],key);}
      catch(error){output[name]={observationError:String(error),detached:game.isDetached()};}
    }
    for(const frame of frames)if(!frame.isDetached()){
      try{await frame.evaluate(()=>{(window as any).$(document).off('.e2eEventStatus');});}
      catch(error){output.cleanupError=String(error);}
    }
    return output;
  }};
}
