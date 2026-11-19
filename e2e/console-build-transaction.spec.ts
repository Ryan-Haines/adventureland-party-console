import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import path from 'node:path';
import {ConsoleBuildController} from '../tools/console-build/controller';
import {ConsoleBuildStore} from '../tools/console-build/store';
import {stage} from './console-build-helpers';
import {consoleBuildRoutes} from '../tools/console-build/routes';
import {safeReload} from '../tools/console-build/safe-reload';
import {readJson} from '../tools/build-store';
import {LEASE_FILE} from '../runtime/lifecycle/rules';

test('deployment admission, duplicates and terminal cleanup use the durable operation',async({},info)=>{
  const root=info.outputPath('transaction'),store=new ConsoleBuildStore(root);
  const a=await stage(store,'first'),b=await stage(store,'next');await store.setReferences({active:a.manifest.id,latest:b.manifest.id});
  let verified!:()=>void,activated!:()=>void,cleaned!:()=>void;
  const verificationGate=new Promise<void>(resolve=>{verified=resolve;});
  const verify=store.verify.bind(store);let gate=true;
  store.verify=async(id,...args)=>{if(gate)await verificationGate;return verify(id,...args);};
  store.cleanup=()=>new Promise<void>(resolve=>{cleaned=resolve;});
  const controller=new ConsoleBuildController(store,{activate:()=>new Promise<void>(resolve=>{activated=resolve;}),restore:async()=>{}});
  const routes=consoleBuildRoutes(controller),server=createServer((req,res)=>void routes.route(req,res,new URL(req.url!,'http://localhost').pathname));
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw Error('No port');
  const base='http://127.0.0.1:'+address.port,post=(id:string)=>fetch(base+'/console-build/deploy',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buildId:id,mode:'now'})});
  const ledger=[];
  try{
    const response=await post(b.manifest.id);expect(response.status).toBe(202);const operation=await response.json();
    expect(operation.phase).toBe('preparing');
    const status=await (await fetch(base+'/console-build')).json();expect(status.operation.id).toBe(operation.id);expect(status.builds.every((build:any)=>!('files' in build))).toBe(true);
    const duplicate=await post(b.manifest.id);expect(duplicate.status).toBe(202);expect((await duplicate.json()).id).toBe(operation.id);
    const conflict=await post(a.manifest.id);expect(conflict.status).toBe(409);expect((await conflict.json()).operation.id).toBe(operation.id);
    ledger.push({operation,status});gate=false;verified();
    await expect.poll(()=>!!activated).toBe(true);activated();await expect.poll(async()=>(await store.journal())?.phase).toBe('complete');
    await expect.poll(()=>!!cleaned).toBe(true);
    const next=await post(a.manifest.id);expect(next.status).toBe(202);ledger.push({next:await next.json()});
    await expect.poll(async()=>(await store.journal())?.phase).toBe('activating');activated();
    await expect.poll(async()=>(await store.journal())?.phase).toBe('complete');
    await info.attach('durable-admission-ledger',{body:JSON.stringify(ledger),contentType:'application/json'});
  }finally{gate=false;verified?.();activated?.();cleaned?.();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

test('safe deployment renews its lease throughout delayed activation',async({},info)=>{
  const root=info.outputPath('renewal'),samples:any[]=[];
  const drain=safeReload(root,async()=>{const lease=await readJson<{id:string}>(path.join(root,LEASE_FILE));return {id:lease?.id,ready:true};},{leaseMs:2000,clearMs:100,pollMs:50});
  await drain.waitUntilSafe('long-activation',AbortSignal.timeout(10000));
  try{for(let sample=0;sample<8;sample++){await new Promise(resolve=>setTimeout(resolve,400));const lease=await readJson<{id:string;expires:number}>(path.join(root,LEASE_FILE));
    expect(lease?.id).toBe('long-activation');expect(lease!.expires).toBeGreaterThan(Date.now());samples.push({at:Date.now(),lease});}
  }finally{await drain.releaseSafeWait('long-activation');}
  expect(await readJson(path.join(root,LEASE_FILE))).toBeUndefined();
  await info.attach('renewed-activation-hold',{body:JSON.stringify(samples),contentType:'application/json'});
});
