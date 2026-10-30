import {test,expect} from './live-fixtures';
import {startNetworkClock} from '../tools/sim/network-clock-broker.mts';
import {createServer,request} from 'node:http';
import {connect,type Socket} from 'node:net';
import {readFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {performance as nativePerformance} from 'node:perf_hooks';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {environment} from './fixtures';
import {waitForBrowserClockStartup} from './chronal-browser-startup';

test('ChronAL browser clock recovers an initial rejected handshake without losing virtual progress',async({page},info)=>{
 test.skip(process.env.E2E_GAMEPLAY_BACKEND==='native','This regression exercises only the ChronAL transport; native parity uses its native clock.');
 const clock=await startNetworkClock(4),sockets=new Set<Socket>();
 const attempts:Array<{at:number;rejected:boolean}>=[];
 const reads:Array<{at:number;rejected:boolean}>=[];
 let rejectAllReads=false;
 const proxy=createServer((req,res)=>{
  if(new URL(req.url||'/','http://localhost').pathname!=='/observe'){res.end('<html><body>Clock handshake boundary</body></html>');return;}
  const rejected=reads.length===0||rejectAllReads;
  reads.push({at:Date.now(),rejected});
  if(rejected){req.socket.destroy();return;}
  const upstream=request({hostname:'127.0.0.1',port:clock.port,path:req.url},reply=>{res.writeHead(reply.statusCode!);reply.pipe(res);});
  upstream.on('error',()=>res.destroy());req.pipe(upstream);
 });
 proxy.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 proxy.on('upgrade',(req,socket,head)=>{
  attempts.push({at:Date.now(),rejected:attempts.length===0});
  if(attempts.length===1){socket.destroy();return;}
  const upstream=connect(clock.port,'127.0.0.1',()=>{
   const headers=req.rawHeaders.reduce((s,value,index)=>s+value+(index%2?'\r\n':': '),'');
   upstream.write(`GET ${req.url} HTTP/1.1\r\n${headers}\r\n`);
   if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);
  });
  sockets.add(upstream);upstream.on('close',()=>{sockets.delete(upstream);socket.destroy();});
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
 });
 await new Promise<void>(resolve=>proxy.listen(0,'127.0.0.1',resolve));
 const address=proxy.address();if(!address||typeof address==='string')throw Error('Clock proxy unavailable');
 const origin=`http://127.0.0.1:${address.port}`;
 try{
  const config={rate:4,epoch:clock.epoch,wall:clock.epoch,broker:origin,token:clock.token,scope:'initial-clock-handshake'};
  await page.addInitScript({content:`globalThis.__e2eClockConfiguration=${JSON.stringify(config)};\n`+readFileSync('.build/sim/browser-clock.js','utf8')});
  await page.goto(origin);
  await page.waitForFunction(()=>(window as any).__e2eChronalClock.state.ticks>=3,undefined,{timeout:10_000});
  const observed=await page.evaluate(()=>{const c=(window as any).__e2eChronalClock;return {now:c.now(),epoch:c.epoch,errors:c.errors,state:c.state};});
  expect(attempts).toHaveLength(2);expect(attempts[0].rejected).toBe(true);expect(attempts[1].rejected).toBe(false);
  expect(observed.errors).toEqual([]);expect(observed.now).toBeGreaterThan(observed.epoch);
  await info.attach('native-clock-handshake-recovery',{body:JSON.stringify({attempts,observed}),contentType:'application/json'});
  const script=`const clock=require(${JSON.stringify(path.resolve('tools/sim/network-clock.cjs'))}).install({dateOnly:true});
    const keepAlive=setInterval(()=>{},1000);const finish=ready=>{clearInterval(keepAlive);console.log(JSON.stringify({ready,now:clock.now(),epoch:clock.epoch,errors:clock.errors,observations:clock.observations}));process.exit(0);};clock.ready.then(()=>finish(true),()=>finish(false));`;
  const observe=()=>promisify(execFile)(process.execPath,['-e',script],{timeout:10_000,windowsHide:true,
    env:environment({E2E_CLOCK_RATE:'4',E2E_CLOCK_WALL_EPOCH:String(clock.epoch),E2E_CLOCK_VIRTUAL_EPOCH:String(clock.epoch),E2E_CLOCK_BROKER:origin,E2E_CLOCK_TOKEN:clock.token,E2E_CLOCK_SCOPE:'observer-reset-regression'})});
  const child=await observe();
  const observer=JSON.parse(child.stdout);
  expect(reads).toHaveLength(2);expect(reads.map(r=>r.rejected)).toEqual([true,false]);
  expect(observer.ready).toBe(true);expect(observer.errors).toEqual([]);expect(observer.observations.requests).toBe(2);
  expect(observer.observations.consecutiveFailures).toBe(0);
  expect(observer.observations.retries).toHaveLength(1);
  expect(observer.observations.retries[0].recoveredAt).toBeGreaterThanOrEqual(observer.observations.retries[0].at);
  expect(observer.now).toBeGreaterThan(observer.epoch);
  await info.attach('native-clock-observer-reset-recovery',{body:JSON.stringify({reads,observer}),contentType:'application/json'});
  rejectAllReads=true;
  const permanent=JSON.parse((await observe()).stdout);
  expect(permanent.ready).toBe(false);expect(permanent.errors).toHaveLength(1);
  expect(permanent.observations.requests).toBe(3);expect(permanent.observations.consecutiveFailures).toBe(3);
  expect(permanent.observations.retries.every((r:{recoveredAt?:number})=>!r.recoveredAt)).toBe(true);
  expect(permanent.now).toBe(permanent.epoch);
  expect(reads.slice(2).map(r=>r.rejected)).toEqual([true,true,true]);
  await info.attach('native-clock-observer-permanent-failure',{body:JSON.stringify({reads:reads.slice(2),observer:permanent}),contentType:'application/json'});
 }finally{await page.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>proxy.close(()=>resolve()));await clock.close();}
});

test('ChronAL late joining actors preserve relative startup timers',async({page,browser:browserHost},info)=>{
 test.skip(process.env.E2E_GAMEPLAY_BACKEND==='native','ChronAL-only transport initialization regression.');
 const ioReceipts:Array<{started:number;finished?:number;closedBeforeReply?:boolean}>=[];
 const nativeWall=()=>Math.floor(nativePerformance.timeOrigin+nativePerformance.now());
 // The caller may already use another pool's observation Date. Its private
 // broker must pace actual network deadlines independently of that clock.
 const callerDate=Date,nativeBefore=nativeWall();
 let clock:Awaited<ReturnType<typeof startNetworkClock>>,callerNow:number;
 try{
  globalThis.Date=new Proxy(callerDate,{get(target,key,receiver){return key==='now'?()=>callerDate.now()+60_000:Reflect.get(target,key,receiver);}});
  callerNow=Date.now();clock=await startNetworkClock(16);
 }finally{globalThis.Date=callerDate;}
 const nativeAfter=nativeWall();
 let waiting:import('node:http').ServerResponse|undefined;
 const server=createServer((req,res)=>{
  if(req.url==='/jquery.js'){res.setHeader('Content-Type','text/javascript');res.end(readFileSync('.caracal/node_modules/jquery/dist/jquery.js','utf8'));}
  else if(req.url==='/application.js'){res.setHeader('Content-Type','text/javascript');res.end('globalThis.applicationStartedAt=Date.now();');}
  else if(req.url==='/party-api/io-probe'){
   const receipt:{started:number;finished?:number;closedBeforeReply?:boolean}={started:nativeWall()};ioReceipts.push(receipt);
   res.on('close',()=>{if(!res.writableFinished)receipt.closedBeforeReply=true;});
   setTimeout(()=>{receipt.finished=nativeWall();res.setHeader('Content-Type','application/json');res.end('{"ok":true}');},200);
  }else if(req.url==='/party-api/status'){waiting=res;}
  else if(req.url==='/release-clock-longpoll'){waiting?.setHeader('Content-Type','application/json');waiting?.end('{"ok":true}');waiting=undefined;res.end('released');}
  else res.end('<html><body>Late clock join<script src="/jquery.js"></script><script src="/application.js"></script></body></html>');
 });
 const sockets=new Set<Socket>();server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw Error('Late-join HTTP fixture missing');
 const origin=`http://127.0.0.1:${address.port}`,broker=`http://127.0.0.1:${clock.port}`;
 const config={rate:16,epoch:clock.epoch,wall:clock.epoch,broker,token:clock.token,scope:'late-join-witness'};
 const bundle=readFileSync('.build/sim/browser-clock.js','utf8');
 let late:import('@playwright/test').Page|undefined,nativeContext:import('@playwright/test').BrowserContext|undefined;
 try{
  await info.attach('broker-independent-native-wall',{body:JSON.stringify({callerNow,nativeBefore,nativeAfter,epoch:clock.epoch}),contentType:'application/json'});
  expect(clock.epoch).toBeGreaterThanOrEqual(nativeBefore);expect(clock.epoch).toBeLessThanOrEqual(nativeAfter);
  await page.addInitScript({content:`globalThis.__e2eClockConfiguration=${JSON.stringify(config)};\n`+bundle+`\nglobalThis.initialStartupAt=Date.now();`});
  await page.goto(origin);
  await page.waitForFunction(()=>(window as any).__e2eChronalClock.now()>=(window as any).__e2eChronalClock.epoch+8000,undefined,{timeout:10_000});
  const parentBeforeFrame=await page.evaluate(()=>Date.now());
  await page.evaluate(origin=>{const frame=document.createElement('iframe');frame.id='late-code';frame.src=origin+'?late-code';document.body.append(frame);},origin);
  const element=await page.$('#late-code'),frame=await element?.contentFrame();await element?.dispose();
  if(!frame)throw Error('Late CODE iframe missing');
  await frame.waitForLoadState('domcontentloaded');
  const startup=await frame.evaluate(()=>({initialAt:(window as any).initialStartupAt,parentNow:(parent as Window & typeof globalThis).Date.now(),now:Date.now(),join:(window as any).__e2eChronalClock.join}));
  await info.attach('late-iframe-synchronous-startup-date',{body:JSON.stringify({parentBeforeFrame,...startup}),contentType:'application/json'});
  expect(startup.initialAt,'Synchronous CODE initialization must not capture the old pool epoch').toBeGreaterThanOrEqual(parentBeforeFrame);
  let delayStartupFrames=true;
  await page.context().exposeBinding('__e2eChronalFrame',()=>delayStartupFrames?new Promise(resolve=>setTimeout(resolve,100)):undefined);
  const beforeApplication=await page.evaluate(()=>Date.now());
  await waitForBrowserClockStartup(page.context());
  late=await page.context().newPage();
  await late.addInitScript({content:`globalThis.__e2eClockConfiguration=${JSON.stringify({...config,scope:'late-browser'})};\n`+bundle+`
    globalThis.startupTimeouts=[];globalThis.startupIntervals=[];
    setTimeout(()=>startupTimeouts.push(Date.now()),5000);
    const interval=setInterval(()=>{startupIntervals.push(Date.now());if(startupIntervals.length===3)clearInterval(interval);},1000);`});
  await late.goto(origin);
  await late.waitForFunction(()=>(window as any).__e2eChronalClock.state.ticks>=3,undefined,{timeout:10_000});
  const early=await late.evaluate(()=>({now:Date.now(),applicationStartedAt:(window as any).applicationStartedAt,join:(window as any).__e2eChronalClock.join,timeouts:(window as any).startupTimeouts,intervals:(window as any).startupIntervals}));
  await info.attach('late-browser-initial-observation',{body:JSON.stringify(early),contentType:'application/json'});
  expect(early.timeouts,'A startup deadline must not expire just because the pool is older than its actor').toEqual([]);
  expect(early.applicationStartedAt,'Application scripts must start after their authenticated clock join').toBeGreaterThanOrEqual(beforeApplication);
  expect(early.join.at).toBeGreaterThanOrEqual(clock.epoch+8000);
  await late.waitForFunction(()=>Date.now()>=(window as any).__e2eChronalClock.join.at+6000,undefined,{timeout:10_000});
  const browser=await late.evaluate(()=>({join:(window as any).__e2eChronalClock.join,timeouts:(window as any).startupTimeouts,intervals:(window as any).startupIntervals,errors:(window as any).__e2eChronalClock.errors}));
  expect(browser.timeouts).toHaveLength(1);expect(browser.intervals).toHaveLength(3);expect(browser.errors).toEqual([]);
  expect(browser.timeouts[0]-browser.join.at).toBeGreaterThanOrEqual(5000);
  browser.intervals.forEach((at:number,index:number)=>expect(at-browser.join.at).toBeGreaterThanOrEqual((index+1)*1000));
  // The declared startup delay has served its assertions. Do not throttle the
  // shared barrier during the separate native I/O and child startup checks.
  delayStartupFrames=false;
  const probe=()=>new Promise<any>(resolve=>{
   const host=window as any,c=host.__e2eChronalClock,wall=()=>c?c.cpuNow():performance.now(),began=wall(),at=Date.now();
   host.$.ajax({url:'/party-api/io-probe',timeout:1000}).done((value:unknown)=>resolve({ok:true,value,wallMs:wall()-began,virtualMs:Date.now()-at}))
    .fail((_xhr:unknown,status:string,error:unknown)=>resolve({ok:false,status,error:String(error),wallMs:wall()-began,virtualMs:Date.now()-at}));
  });
  nativeContext=await browserHost.newContext();const nativePage=await nativeContext.newPage();await nativePage.goto(origin);
  const nativeIo=await nativePage.evaluate(probe),acceleratedIo=await late.evaluate(probe);
  const beforeFork=await page.evaluate(()=>Date.now());
  const script=`const clock=globalThis.__e2eChronalClock,startupAt=Date.now(),timeouts=[],intervals=[];
    setTimeout(()=>timeouts.push(Date.now()),5000);const timer=setInterval(()=>{intervals.push(Date.now());if(intervals.length===3)clearInterval(timer);},1000);
    setTimeout(async()=>{
      const {JSDOM}=require(${JSON.stringify(path.resolve('.caracal/node_modules/jsdom'))}),window=new JSDOM('<html></html>',{url:${JSON.stringify(origin)}}).window;
      require('node:vm').createContext(window);const $=require(${JSON.stringify(path.resolve('.caracal/node_modules/jquery'))})(window);
      const began=clock.cpuNow(),io=await new Promise(resolve=>$.ajax({url:'/party-api/io-probe',timeout:1000}).done(value=>resolve({ok:true,value,wallMs:clock.cpuNow()-began})).fail((_xhr,status,error)=>resolve({ok:false,status,error:String(error),wallMs:clock.cpuNow()-began})));
      window.close();globalThis.__delayClockImmediate=true;const turnBegan=clock.cpuNow(),turnAt=Date.now();
      setTimeout(()=>{globalThis.__delayClockImmediate=false;console.log(JSON.stringify({startupAt,join:clock.join,timeouts,intervals,errors:clock.errors,io,nativeIo:clock.nativeIo,nativeTurn:{wallMs:clock.cpuNow()-turnBegan,virtualMs:Date.now()-turnAt}}));process.exit(0);},2000);
    },6000);`;
  const delayedImmediate=`const immediate=globalThis.setImmediate,timeout=globalThis.setTimeout;globalThis.setImmediate=(fn,...args)=>globalThis.__delayClockImmediate?immediate(()=>timeout(fn,100,...args)):immediate(fn,...args);`;
  let child;
  try{
    child=await promisify(execFile)(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(delayedImmediate),'--import',pathToFileURL(path.resolve('tools/sim/network-clock-preload.mjs')).href,'-e',script],{timeout:15_000,windowsHide:true,
      env:environment({NODE_OPTIONS:'',E2E_CLOCK_PRELOAD:'1',E2E_CLOCK_RATE:'16',E2E_CLOCK_WALL_EPOCH:String(clock.epoch),E2E_CLOCK_VIRTUAL_EPOCH:String(clock.epoch),E2E_CLOCK_BROKER:broker,E2E_CLOCK_TOKEN:clock.token,E2E_CLOCK_SCOPE:'late-node'})});
  }catch(error){
    const failure=error as Error&{stdout?:string;stderr?:string;code?:unknown;signal?:unknown;killed?:boolean};
    const response=await page.request.get(broker+'/diagnostics?token='+clock.token);
    await info.attach('late-node-startup-failure',{body:JSON.stringify({at:nativeWall(),message:failure.message,
      code:failure.code,signal:failure.signal,killed:failure.killed,stdout:failure.stdout,stderr:failure.stderr,
      broker:await response.json(),ioReceipts}),contentType:'application/json'});
    throw error;
  }
  const node=JSON.parse(child.stdout);
  expect(node.startupAt).toBeGreaterThanOrEqual(beforeFork);expect(node.errors).toEqual([]);
  expect(node.timeouts).toHaveLength(1);expect(node.intervals).toHaveLength(3);
  expect(node.timeouts[0]-node.startupAt).toBeGreaterThanOrEqual(5000);
  node.intervals.forEach((at:number,index:number)=>expect(at-node.startupAt).toBeGreaterThanOrEqual((index+1)*1000));
  await info.attach('late-actor-startup-timers',{body:JSON.stringify({beforeFork,browser,node}),contentType:'application/json'});
  await info.attach('native-and-accelerated-http-deadlines',{body:JSON.stringify({nativeIo,acceleratedIo,nodeIo:node.io,ioReceipts}),contentType:'application/json'});
  expect(nativeIo.ok).toBe(true);expect(acceleratedIo.ok).toBe(true);expect(node.io.ok).toBe(true);
  await info.attach('native-clock-turn-under-deferred-immediate',{body:JSON.stringify(node.nativeTurn),contentType:'application/json'});
  expect(node.nativeTurn.virtualMs).toBeGreaterThanOrEqual(2000);expect(node.nativeTurn.wallMs).toBeLessThan(1000);
  const longpoll=await late.evaluate(async()=>{
   const host=window as any,began=Date.now();
   const reply=new Promise(resolve=>host.$.ajax({url:'/party-api/status',method:'POST',data:JSON.stringify({combatWait:true}),timeout:10000}).done(()=>resolve(true)).fail(()=>resolve(false)));
   await new Promise(resolve=>setTimeout(resolve,1000));
   const nativeIoActive=host.__e2eChronalClock.nativeIo?.active;
   await fetch('/release-clock-longpoll');return {ok:await reply,virtualMs:Date.now()-began,nativeIoActive};
  });
  await info.attach('native-longpoll-does-not-block-future-virtual-events',{body:JSON.stringify(longpoll),contentType:'application/json'});
  expect(longpoll.ok).toBe(true);expect(longpoll.virtualMs).toBeGreaterThanOrEqual(1000);expect(longpoll.nativeIoActive).toBe(false);
  const wait=async()=>{const clock=(window as any).__e2eChronalClock,wall=()=>clock?clock.cpuNow():performance.now(),began=wall(),at=Date.now();await new Promise(resolve=>setTimeout(resolve,2000));return {wallMs:wall()-began,virtualMs:Date.now()-at};};
  const nativeWait=await nativePage.evaluate(wait),acceleratedWait=await late.evaluate(wait);
  await info.attach('native-io-retains-gameplay-timer-speedup',{body:JSON.stringify({nativeWait,acceleratedWait}),contentType:'application/json'});
  expect(acceleratedWait.virtualMs).toBeGreaterThanOrEqual(2000);expect(acceleratedWait.wallMs).toBeLessThan(nativeWait.wallMs);
 }finally{await nativeContext?.close();await late?.close();await page.close();for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await clock.close();}
});
