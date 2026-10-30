import type {Browser} from '@playwright/test';
import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';

type ProcessCpu = {id:number;type:string;cpuTime:number};

/** Native-wall CPU accounting for a focused real-game rendering comparison. */
export async function measureBrowserRendering(browser:Browser,gameplayNow:()=>number) {
  const session=await browser.newBrowserCDPSession();
  try {
    const {gpu}=await session.send('SystemInfo.getInfo');
    const renderer=String(gpu.auxAttributes?.glRenderer||'');
    const expected=process.env.E2E_EXPECT_GPU;
    if(expected&&(!renderer.toLowerCase().includes(expected.toLowerCase())||/swiftshader|llvmpipe|software/i.test(renderer)))
      throw Error(`Expected GPU ${expected}; actual renderer: ${renderer}`);
    const before=(await session.send('SystemInfo.getProcessInfo')).processInfo as ProcessCpu[];
    const started=performance.now();
    const gameplayStarted=gameplayNow();
    return async()=>{
      try {
        const after=(await session.send('SystemInfo.getProcessInfo')).processInfo as ProcessCpu[];
        const wallSeconds=(performance.now()-started)/1000;
        const gameplaySeconds=(gameplayNow()-gameplayStarted)/1000;
        const previous=new Map(before.map(row=>[row.id,row]));
        const current=new Set(after.map(row=>row.id));
        const exited=before.filter(row=>!current.has(row.id));
        const deltas=after.map(row=>({...row,cpuSeconds:row.cpuTime-(previous.get(row.id)?.cpuTime||0)}));
        if(deltas.some(row=>!Number.isFinite(row.cpuSeconds)||row.cpuSeconds<0))throw Error('Invalid native browser CPU counters');
        const cpuSeconds=deltas.reduce((sum,row)=>sum+row.cpuSeconds,0);
        const logicalProcessors=cpus().length;
        return {requestedMode:process.env.E2E_BROWSER_RENDERING||(process.env.CI?'software':'hardware'),renderer,
          gpu,wallSeconds,gameplaySeconds,achievedClockRate:gameplaySeconds/wallSeconds,
          requestedClockRate:Number(process.env.E2E_CLOCK_RATE||1),cpuSeconds,logicalProcessors,averageCorePercent:cpuSeconds/wallSeconds*100,
          averageMachinePercent:cpuSeconds/wallSeconds/logicalProcessors*100,
          accountingComplete:exited.length===0,exited,before,after,deltas};
      } finally {await session.detach();}
    };
  } catch(error) {await session.detach();throw error;}
}
