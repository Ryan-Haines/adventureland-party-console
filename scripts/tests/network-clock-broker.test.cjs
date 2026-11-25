// The ChronAL broker's pacing (tools/sim/network-clock-broker.mts). The broker runs at 1x while a
// participant reports a /party-api XHR in flight (tools/sim/native-io.cjs), and at the requested
// rate otherwise. In the live stall every participant sat acknowledged and idle (the coordinator's
// "[ChronAL pending acknowledgement]" lines), so only the broker's own pacing held the clock.
const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'../..');
const WebSocket=require(require.resolve('ws',{paths:[path.join(root,'.build/sim/chronal'),path.join(root,'.caracal')]}));
const wall=()=>performance.now();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

// One participant that acknowledges every window at once, as an idle CODE frame does.
async function join(clock){
  const url=new URL(`ws://127.0.0.1:${clock.port}/clock`);
  url.searchParams.set('token',clock.token);url.searchParams.set('id','frame');url.searchParams.set('label','frame');
  const socket=new WebSocket(url);
  const member={socket,now:0,send:value=>socket.send(JSON.stringify(value))};
  socket.on('message',bytes=>{const next=JSON.parse(bytes.toString());member.now=next.now;member.send({now:next.now});});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject);});
  return member;
}

// A frame's reply handler sends its next report as the previous one lands, so one in-flight XHR
// follows another with no virtual timer between them. Each change of the in-flight state starts a
// new pacing mode; the clock still owes the chain at least the 1x it gives one long XHR.
test('a chain of short native XHRs still advances the clock at least at 1x',async()=>{
  const {startNetworkClock}=await import(pathToFileURL(path.join(root,'tools/sim/network-clock-broker.mts')).href);
  const clock=await startNetworkClock(4);
  const frame=await join(clock);
  try{
    const windowMs=250,started=frame.now||clock.epoch,began=wall();
    // Each XHR lands before one window of wall time passes at 1x, and the next starts within the
    // same native turn's few milliseconds, as a reply-driven report does.
    while(wall()-began<4*windowMs){
      frame.send({kind:'native-io',active:true});await pause(windowMs/2);
      frame.send({kind:'native-io',active:false});await pause(2);
    }
    const elapsed=wall()-began,advanced=frame.now-started;
    // Over four windows of wall time, 1x owes at least three whole windows.
    assert.ok(advanced>=Math.floor(elapsed/windowMs)*windowMs-windowMs,
      `virtual ${advanced} ms over ${Math.round(elapsed)} ms of wall time`);
  }finally{frame.socket.terminate();await clock.close();}
});

// A participant joins in its preload (tools/sim/network-clock-preload.mjs), then its main module
// loads synchronously. A character process's jsdom require took 36 s under load and froze every
// participant past the live poll's 30 s stall check (liveb-step11-run10.log, W54 A16).
function startChild(clock,script){
  const {spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os');
  const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'chronal-starter-')),'starter.cjs');
  fs.writeFileSync(file,script);
  const child=spawn(process.execPath,['--import',pathToFileURL(path.join(root,'tools/sim/network-clock-preload.mjs')).href,file],{
    windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,NODE_OPTIONS:'',E2E_CLOCK_PRELOAD:'1',E2E_CLOCK_RATE:'4',E2E_CLOCK_WALL_EPOCH:String(clock.epoch),
      E2E_CLOCK_VIRTUAL_EPOCH:String(clock.epoch),E2E_CLOCK_BROKER:`http://127.0.0.1:${clock.port}`,E2E_CLOCK_TOKEN:clock.token,E2E_CLOCK_SCOPE:'starter'}});
  let stdout='',stderr='';
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data);
  const exited=new Promise(resolve=>child.on('exit',code=>resolve({code,stdout,stderr})));
  return {child,exited};
}
const busy=ms=>`const began=process.hrtime.bigint();while(process.hrtime.bigint()-began<${ms}n*1000000n);`;

test("a starting participant's synchronous load does not hold the shared clock",async()=>{
  const {startNetworkClock}=await import(pathToFileURL(path.join(root,'tools/sim/network-clock-broker.mts')).href);
  const clock=await startNetworkClock(4);
  const frame=await join(clock);
  const loadMs=2000;
  try{
    // The starter marks its load's start and end on stdout, which a busy thread still writes.
    const {child,exited}=startChild(clock,`const fs=require('node:fs');fs.writeSync(1,'load ');${busy(loadMs)}fs.writeSync(1,'loaded ');process.exit(0);`);
    const marks={};
    child.stdout.on('data',data=>{for(const mark of String(data).trim().split(' '))marks[mark]=frame.now;});
    const result=await exited;
    assert.equal(result.code,0,result.stderr);
    // Held by the starter, the frame gets at most the one window in flight at the load's start.
    // The clock owes the frame at least 1x across the load.
    assert.ok(marks.loaded-marks.load>=loadMs,`virtual ${marks.loaded-marks.load} ms over a ${loadMs} ms load`);
  }finally{frame.socket.terminate();await clock.close();}
});

// The starter misses the windows the others ran during its load, and a message another participant
// stamps with its virtual time can reach it before the window that carries that time. Every stamp
// from those windows must find the starter's clock at or past it. After the resume the starter is
// in lockstep again, where a peer's message from window T can arrive before the starter's own turn
// for T, so a later stamp is at most one window ahead.
test('a starter that catches up never reads a time behind a message it received',async()=>{
  const {startNetworkClock}=await import(pathToFileURL(path.join(root,'tools/sim/network-clock-broker.mts')).href);
  const net=require('node:net');
  const clock=await startNetworkClock(4);
  const frame=await join(clock);
  const peers=new Set();
  frame.socket.on('message',bytes=>{const {now}=JSON.parse(bytes.toString());for(const peer of peers)peer.write(now+'\n');});
  try{
    // The starter binds its port before its load, and the kernel accepts the frame's connection
    // during it, so the frame's stamps queue beside the windows the starter misses. The starter
    // reads stamps for one virtual second after its first.
    const {child,exited}=startChild(clock,`const fs=require('node:fs'),reads=[];let buffered='',finish;
      const server=require('node:net').createServer(socket=>socket.on('data',data=>{
        buffered+=data;const lines=buffered.split(String.fromCharCode(10));buffered=lines.pop();
        for(const line of lines)reads.push({stamp:Number(line),now:Date.now()});
        finish??=setTimeout(()=>{fs.writeSync(1,JSON.stringify({resumed:globalThis.__e2eChronalClock.transport.resumed,reads}));process.exit(0);},1000);
      })).listen(0);
      fs.writeSync(1,server.address().port+' ');
      ${busy(2000)}`);
    let stdout='';
    child.stdout.once('data',data=>{
      const peer=net.connect(Number(String(data).trim().split(' ')[0]),'127.0.0.1');
      peer.on('error',()=>{});peers.add(peer);
    });
    child.stdout.on('data',data=>stdout+=data);
    const result=await exited;
    assert.equal(result.code,0,result.stderr);
    const {resumed,reads}=JSON.parse(stdout.slice(stdout.indexOf(' ')+1)),windowMs=250;
    const missed=reads.filter(read=>read.stamp<=resumed);
    assert.ok(missed.length>0,'the starter read no stamp from the windows it missed');
    assert.deepEqual(missed.filter(read=>read.now<read.stamp),[]);
    assert.deepEqual(reads.filter(read=>read.now<read.stamp-windowMs),[]);
  }finally{for(const peer of peers)peer.destroy();frame.socket.terminate();await clock.close();}
});
