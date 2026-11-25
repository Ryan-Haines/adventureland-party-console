import {type Frame,type CDPSession} from '@playwright/test';
import {describeError,startCdpProfile} from './native-observer-kit';
// Passive, case-owned diagnostics. Poll callers supply the clock; no timers.
export function nativePlannerCpuProfile(frame:Frame){
  let session:CDPSession|undefined,cpu:Awaited<ReturnType<typeof startCdpProfile>>|undefined,used=false,startedAt=0,stopped=false;
  let pending:Promise<void>|undefined;
  const evidence:any={errors:[],probes:[]};
  const record=(error:unknown)=>{evidence.errors.push(describeError(error));};
  async function stop(){
    if(stopped||!session||!cpu||!startedAt)return;
    stopped=true;
    try{
      evidence.after=await session.send('Performance.getMetrics');
      evidence.profile=await cpu.stop();
      evidence.stoppedAt=Date.now();
      const before=new Map<string,number>((evidence.before.metrics||[]).map((m:any)=>[m.name,m.value]));
      evidence.deltas=Object.fromEntries((evidence.after.metrics||[]).filter((m:any)=>['TaskDuration','ScriptDuration','LayoutDuration','RecalcStyleDuration'].includes(m.name)).map((m:any)=>[m.name,m.value-(before.get(m.name)||0)]));
      const nodes=new Map<number,any>(evidence.profile.nodes.map((n:any)=>[n.id,n.callFrame]));
      const counts=new Map<number,number>();for(const id of evidence.profile.samples||[])counts.set(id,(counts.get(id)||0)+1);
      evidence.dominant=[...counts].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([id,samples])=>({samples,frame:nodes.get(id)}));
    }catch(error){record(error);}
    finally{await session.detach().catch(record);}
  }
  return {
    observe(sample:any){
      if(evidence.probes.length<3)evidence.probes.push(sample);
      if(sample?.error)record(sample.error);
      if(used||!sample?.active||sample?.nativeMoving||sample?.transporting||sample?.nativePlanning?.calls<8||!sample?.nativePlanning)return;
      used=true;evidence.trigger=sample;
      pending=(async()=>{
        try{
          session=await frame.page().context().newCDPSession(frame);
          await session.send('Performance.enable');
          evidence.before=await session.send('Performance.getMetrics');
          cpu=await startCdpProfile(session,10000);startedAt=Date.now();evidence.startedAt=startedAt;
        }catch(error){record(error);await session?.detach().catch(record);session=undefined;}
      })();
    },
    poll(){if(startedAt&&!stopped&&Date.now()-startedAt>=10000&&!pending)pending=stop();},
    async settle(){if(pending){await pending;pending=undefined;}},
    async finish(){await this.settle();await stop();return evidence;},
  };
}
