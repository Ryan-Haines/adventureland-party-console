// Window edge. The server keeps a call entry until it is older than 4000 ms (get_call_cost,
// server_functions.js: 5481 at the game pin), and the budget books a call no later than the
// server dates it, so `used` holds every entry until it is older than the window and the latest
// round trip. Isolated: no live run places a call at the window's exact edge.
const test=require('node:test'),assert=require('node:assert/strict');
const {used}=require('../../runtime/characters/call-budget.ts');
const {CALL_WINDOW_MS}=require('../../runtime/characters/call-budget-limits.ts');
// The call budget's run scope handle over the test's socket and its own timers, read at each call so
// a row's planted timers hold.
const scope={on:(target,event,fn)=>target.on(event,fn),off:(target,event,fn)=>target.off(event,fn),setTimeout:(run,ms)=>globalThis.setTimeout(run,ms),clearTimeout:id=>globalThis.clearTimeout(id),setInterval:(run,ms)=>globalThis.setInterval(run,ms),clearInterval:id=>globalThis.clearInterval(id),queueMicrotask:run=>queueMicrotask(run)};
test('used holds an entry at the window and round trip edge, as the server holds one at 4000 ms',()=>{
  const latest=99,at=10_000,entry={at,method:'players',cost:12,seq:1};
  const edge=at+CALL_WINDOW_MS+latest;
  assert.equal(used({ledger:[entry],cc:null},edge,latest),12,'held at the edge');
  assert.equal(used({ledger:[entry],cc:null},edge+1,latest),0,'gone past it');
  // The same entry held by a server figure leaves at the same edge.
  const cc={value:12,at:at+50,seq:2,from:at,held:new Set([entry]),heldCost:12};
  assert.equal(used({ledger:[entry],cc},at+50+CALL_WINDOW_MS-1,latest),12,'a figure holds it to the edge');
  assert.equal(used({ledger:[entry],cc},edge,latest),12,'and at the edge');
});
// The install's own entries: the server dates a call when its handler runs, which a burst-slowed
// server does up to the largest round trip of the window after the send, not the latest one.
// Prune and the figure's `from` already keep that margin; `used` keeps it too, so an entry the
// server still counts stays in it.
test('the install counts an own entry for the window and the largest round trip within it',()=>{
  const p=plantedInstall();
  try{
    p.win.pings=[10];p.budget.view();
    const sentAt=p.at();
    // The install's own background read sends `players` at once; the test's call joins it.
    assert.equal(p.ask({band:'background',method:'players',data:{}}),'send');p.emit('players',{});
    const booked=p.budget.view().used;
    assert.ok(booked>=12,'the calls are booked');
    // A round trip of 99 measured after the send, then a latest of 10: the window's largest is 99.
    p.advance(1000);p.win.pings=[10,99];p.budget.view();
    p.advance(1000);p.win.pings=[10,99,10];p.budget.view();
    p.to(sentAt+CALL_WINDOW_MS+50);
    assert.equal(p.budget.view().used,booked,'an entry inside the window and the largest round trip counts');
    p.to(sentAt+CALL_WINDOW_MS+99);
    assert.equal(p.budget.view().used,booked,'and at that edge');
  }finally{p.stop();}
});
// The server runs a call's handler on its next clock step, so on ChronAL's 250 ms step it can date a
// call 250 ms after the budget booked it. The budget keeps each entry one clock step longer, the
// step read as the smallest gap between two different arrival times of the character's own player
// packets in the window. Isolated: no live row places a call at the window's edge on purpose; row
// A's stand burst met it in a live run.
test('an own entry stays one clock step past the window and the round trip, the step read from player packet arrivals',()=>{
  const {installCallBudget}=require('../../runtime/characters/call-budget.ts');
  const run=gap=>{
    const p=plantedInstall({pings:[10]});
    try{
      // Three packets with no server figure, `gap` apart: the character's clock step.
      for(let i=0;i<3;i++){p.fire('player',{hp:1});p.advance(gap);}
      p.budget.view();
      // The install's own background read went at the install, before this call.
      const sentAt=p.at(),before=p.budget.view().used;
      assert.equal(p.ask({band:'background',method:'players',data:{}}),'send');p.emit('players',{});
      const booked=p.budget.view().used-before;
      assert.equal(booked,12,'the call is booked');
      // Packets keep arriving on the step up to the edge, as the server's player packets do.
      while(p.at()+gap<sentAt+CALL_WINDOW_MS+10+gap){p.advance(gap);p.fire('player',{hp:1});}
      p.to(sentAt+CALL_WINDOW_MS+10+gap);
      const atStep=p.budget.view().used;
      p.to(sentAt+CALL_WINDOW_MS+10+gap+1);
      return {booked,atStep,after:p.budget.view().used};
    }finally{p.stop();}
  };
  const test250=run(250);
  assert.equal(test250.atStep,test250.booked,'on a 250 ms clock step the entry counts one step past the window and the round trip');
  assert.equal(test250.after,0,'and leaves after it');
  const test1=run(1);
  assert.equal(test1.atStep,test1.booked,'on a 1 ms step it counts to one millisecond past the round trip');
  assert.equal(test1.after,0,'and leaves after it');
});
// The live coat batch (e2e/live-economy.spec.ts 'upgrade purchase batch excludes an existing
// target-level coat'): the merchant walked on ChronAL's 250 ms step, then stood at the NPC with no
// player packet for over a window, and its buy reply came two steps after the send.
test('a window with no player packets keeps the last clock step measured in the margin',()=>{
  const p=plantedInstall({pings:[10]});
  try{
    for(let i=0;i<3;i++){p.fire('player',{hp:1});p.advance(250);}
    assert.equal(p.budget.margin(),260,'the ping and the 250 ms step');
    p.advance(CALL_WINDOW_MS+1000);
    assert.equal(p.budget.margin(),260,'the step holds once the packets stop');
  }finally{p.stop();}
  const fresh=plantedInstall({pings:[10]});
  try{assert.equal(fresh.budget.margin(),10,'no step before any two arrival times');}finally{fresh.stop();}
});
// Party chest. A party chest resends every member of `parties[player.party]`
// (server.js:11557-11585 at the game pin), merchants included, 0.1 each with no `nc`, and 0.4 more
// on another member's socket for a reopened bag (4664-4667). The game client's `party` drops
// merchants (server.js:1181 `party_to_client`) and `party_list` names every member. warrior read
// 0.9 charged and 0.6 booked with the merchant in the party (layer 7 run GB). Isolated: no live
// row chooses which member's bag the chest reopens.
test('a party chest books every member the server resends, merchants included',()=>{
  const {price}=require('../../runtime/characters/call-budget.ts');
  const character={name:'E2EWarrior',map:'main',real_x:0,real_y:0};
  const around={party:{E2EWarrior:{},E2EPriest:{}},party_list:['E2EWarrior','E2EPriest','E2EMerchant']};
  const booked=price('open_chest',{id:'c1'},character,{skills:{},maps:{}},around).cost;
  assert.ok(booked>=0.9-1e-9,`booked ${booked}: the opener's 0.1 and two other members' reopened bags, 0.4 each`);
  assert.equal(Math.round(booked*10)/10,1.1,'0.1 and 0.5 for each of the two other members, the largest charge');
});

// The rework's planted install: a fake game socket on a test clock. The reads' timers are the
// test's: each delay is kept with its run, so a row reads the wait a read set and runs it.
function plantedInstall({items=[],pings=[99],fields={},render,handle=scope}={}){
  const {installCallBudget}=require('../../runtime/characters/call-budget.ts');
  const {READ_PICKS}=require('../../runtime/characters/call-budget-limits.ts');
  const kept={},timers=[],intervals=[],handlers={},emitted=[],replies=[];
  for(const [field,value] of Object.entries(fields)){kept[field]=READ_PICKS[field];READ_PICKS[field]=value;}
  const realTimeout=globalThis.setTimeout,realInterval=globalThis.setInterval;
  const plantTimers=()=>{globalThis.setTimeout=(run,ms)=>{const t={run,ms};timers.push(t);return t;};globalThis.setInterval=(run,ms)=>{const t={run,ms};intervals.push(t);return t;};};
  const realTimers=()=>{globalThis.setTimeout=realTimeout;globalThis.setInterval=realInterval;};
  let now=500_000,budget;
  const socket={emit(method){emitted.push(method);return socket;},on(event,fn){(handlers[event]??=[]).push(fn);},off(event,fn){handlers[event]=(handlers[event]??[]).filter(f=>f!==fn);}};
  const win={socket,pings,render_tracker:render,setTimeout:()=>0,clearTimeout:()=>{},Date:{now:()=>now}};
  const host={parent:win,character:{name:'W',map:'main',items,slots:{}},G:{items:{},skills:{},maps:{},conditions:{}}};
  plantTimers();
  try{budget=installCallBudget(host,{now:()=>now,cpu:()=>0,scope:handle,held:()=>false,tracker:data=>replies.push(data)});}
  finally{realTimers();for(const [field,value] of Object.entries(kept))READ_PICKS[field]=value;}
  // Every turn of the planted install runs on the planted timers.
  const turn=run=>{plantTimers();try{return run();}finally{realTimers();}};
  return {budget,win,timers,intervals,emitted,replies,at:()=>now,advance:ms=>{now+=ms;},to:ms=>{now=ms;},
    fire:(event,data)=>turn(()=>{for(const fn of handlers[event]??[])fn(data);}),
    emit:(...args)=>turn(()=>socket.emit(...args)),
    ask:question=>turn(()=>budget.band(question)),
    run:t=>turn(()=>t.run()),
    stop(){const c=globalThis.clearTimeout,ci=globalThis.clearInterval;globalThis.clearTimeout=()=>{};globalThis.clearInterval=()=>{};try{budget.stop();}finally{globalThis.clearTimeout=c;globalThis.clearInterval=ci;}}};
}

// `calls.band` and `calls.margin` are answered by the install through the realm's
// registry. A reinstall on the same socket answers from the new install with one registration,
// and between a retired install and the next one a question waits. A CODE reload evaluates the
// module again on the same registry, so the registration a previous load left (planted here,
// retired) gives way to the new install's answers.
test('the registry answers from the current install, once registered, and not-now between installs',()=>{
  const {partyHooks}=require('../../runtime/hooks/index.ts');
  const {callsRegistration}=require('../../runtime/characters/call-budget.ts');
  assert.deepEqual(partyHooks().publish(callsRegistration({budget:{band:()=>'send',margin:()=>7},install:{retired:true}})),{ok:true});
  assert.equal(partyHooks().calls.band({band:'job',method:'players',data:{}}),'not-now','the previous load\'s retired install');
  const first=plantedInstall();
  const hooks=partyHooks(),named=()=>hooks.registrations().filter(r=>r.name==='core:calls').length;
  try{
    assert.equal(named(),1,'the install registers core:calls');
    assert.equal(hooks.calls.band({band:'job',method:'players',data:{}}),'send');first.emit('players',{});
    assert.equal(first.budget.view().answers.job.players?.send,1,'the question reached the install');
    assert.equal(hooks.calls.margin(),first.budget.view().margin,'the margin is the install answer');
    first.stop();
    assert.equal(hooks.calls.band({band:'survival',method:'move'}),'not-now','a retired install answers not-now until the next one');
    assert.equal(hooks.calls.margin(),99,'and its last margin');
  }finally{first.stop();}
  const second=plantedInstall();
  try{
    assert.equal(named(),1,'a reinstall registers nothing more');
    assert.equal(hooks.calls.band({band:'job',method:'players',data:{}}),'send');second.emit('players',{});
    assert.equal(second.budget.view().answers.job.players?.send,1,'the new install answers');
  }finally{second.stop();}
});

// Each read wait reads its named pick (call-budget-limits.ts `READ_PICKS`), no saved setting
// stands for one, and one status sample carries the largest `used` since the last sample, with
// when it held.
test('the reads wait their named picks, and a sample keeps the largest used since the last one',()=>{
  const {READ_PICKS}=require('../../runtime/characters/call-budget-limits.ts');
  assert.deepEqual(READ_PICKS,{callTrackerRefreshMs:30000,callPlayersEveryMs:10000,callTrackerQuietMs:60000,callTrackerManualMs:15000});
  const {settingsDeclarations}=require('../../runtime/settings/coordinator/declarations.ts');
  assert.equal(settingsDeclarations.some(d=>d.name==='core:calls'),false,'the call budget declares no setting');
  const fields={callTrackerRefreshMs:31_111,callPlayersEveryMs:12_345,callTrackerQuietMs:5_000,callTrackerManualMs:700};
  let shown=0;
  const p=plantedInstall({items:[{name:'tracker'}],fields,render:()=>{shown++;}});
  try{
    assert.deepEqual(p.intervals.map(t=>t.ms),[12_345],'the player list refreshes at callPlayersEveryMs');
    // The native tracker window: the install's automatic read shuts it for callTrackerQuietMs,
    // and the player's own request shows one render within callTrackerManualMs.
    p.win.render_tracker();
    assert.equal(shown,0,'shut after an automatic read');
    p.emit('tracker');p.win.render_tracker();p.win.render_tracker();
    assert.equal(shown,1,'the player request shows one render');
    p.emit('tracker');p.advance(701);p.win.render_tracker();
    assert.equal(shown,1,'not after callTrackerManualMs');
    p.advance(5_000-701);p.win.render_tracker();
    assert.equal(shown,2,'and open after callTrackerQuietMs');
    p.fire('tracker',{monsters:{}});
    assert.equal(p.timers.at(-1).ms,31_111,'a reply waits callTrackerRefreshMs');
    p.budget.sample();
    const from=p.at();
    p.advance(100);
    assert.equal(p.ask({band:'job',method:'equip_batch',data:[1,2,3]}),'send');p.emit('equip_batch',[1,2,3]);
    const peak=p.budget.view().used,peakAt=p.at();
    p.advance(CALL_WINDOW_MS*3);
    const s=p.budget.sample();
    assert.equal(s.used,peak,'the sample holds the largest used since the last one');
    assert.equal(s.at,peakAt,'with when it held');
    assert.equal(s.from,from);assert.equal(s.to,p.at());
    assert.ok(p.budget.sample().used<peak,'the next sample starts from the used the last one ended on');
  }finally{p.stop();}
});

// A lost tracker reply is asked again one margin after the request, once; each `kill_credit`
// raises its monster's count by 1 on the reply every reader holds; and a tracker read that waited a window rises
// to the job band like the other background reads.
test('the tracker retries one margin after a lost reply, kill credits raise the reply, and the read rises after a window',()=>{
  const p=plantedInstall({items:[{name:'tracker'}],pings:[99]});
  try{
    assert.equal(p.emitted.filter(m=>m==='tracker').length,1,'the install reads the tracker');
    const retry=p.timers.at(-1);
    assert.equal(retry.ms,p.budget.view().margin,'a reply not back one margin after the request is asked again');
    p.run(retry);
    assert.equal(p.emitted.filter(m=>m==='tracker').length,2,'asked again once');
    assert.equal(p.timers.at(-1).ms,30_000,'then the refresh');
    const reply={monsters:{goo:3}};
    p.fire('tracker',reply);
    p.fire('kill_credit',{mtype:'goo'});p.fire('kill_credit',{mtype:'bee'});
    assert.deepEqual(reply.monsters,{goo:4,bee:1},'each credit raises its count by 1');
    assert.equal(p.replies.at(-1),reply,'on the object the catalog holds');
  }finally{p.stop();}
  // A figure of 100: a tracker read (50) is over the background limit and under the job limit.
  const b=plantedInstall();
  try{
    const plant=()=>b.fire('player',{cc:100});
    plant();
    assert.equal(b.ask({band:'background',method:'tracker'}),'not-now');
    // The asker asks again each pass, which keeps its wait open.
    let answer='not-now';
    for(let waited=0;waited<=CALL_WINDOW_MS+1000&&answer==='not-now';waited+=250){b.advance(250);plant();answer=b.ask({band:'background',method:'tracker'});}
    assert.equal(answer,'send','a tracker read that waited a window is judged in the job band');
    assert.equal(b.budget.records().filter(r=>r.decision==='read-job'&&r.method==='tracker').length,1);
  }finally{b.stop();}
});

// A fight keeps the background band full: the figure stays above the background limit, so the
// tracker read it asks waits, and it goes out as a job-band read within two windows.
test('in a fight that keeps the background band full, a waiting tracker read goes out within two windows',()=>{
  const p=plantedInstall();
  try{
    const {limits}=p.budget.view(),fight=100,startedAt=p.at();
    p.fire('player',{cc:fight});
    assert.equal(p.ask({band:'background',method:'tracker'}),'not-now','the fight leaves no background room');
    let sent=false;
    while(!sent&&p.at()-startedAt<=2*CALL_WINDOW_MS){p.advance(250);p.fire('player',{cc:fight});sent=p.ask({band:'background',method:'tracker'})==='send';}
    assert.ok(sent,'the read went out');
    assert.ok(p.at()-startedAt<=2*CALL_WINDOW_MS,'within two windows');
    assert.equal(p.budget.records().filter(r=>r.decision==='read-job'&&r.method==='tracker').length,1);
  }finally{p.stop();}
});

// Each change the budget records sends its notice, once, with its fields: a hold, its
// release, a wait's close, a read's rise, an unmatched admission and a `limitdc`. A planted core
// listener on the realm's registry, which no run loads; the live hooks table runs the same six on
// the game (e2e/live-calls-hooks.spec.ts).
test('the budget sends one notice at each change it records',async()=>{
  const {partyHooks}=require('../../runtime/hooks/index.ts');
  const heard=[],hooks=partyHooks(),events=['calls.held','calls.released','calls.waited','calls.raised','calls.unmatched','calls.limitdc'];
  if(!hooks.registrations().some(r=>r.name==='core:planted-calls-notices'))
    assert.deepEqual(hooks.register({name:'core:planted-calls-notices',folder:'core',author:'test',summary:'test',
      hooks:Object.fromEntries(events.map(e=>[e,p=>{if(globalThis.__plantedCallNotices)heard.push([e,p]);}]))}),{ok:true});
  globalThis.__plantedCallNotices=true;
  const p=plantedInstall();
  try{
    const of=e=>heard.filter(([name])=>name===e).map(([,payload])=>payload);
    // A figure of 199: an untagged emit is held, and a job question waits.
    p.fire('player',{cc:199});
    p.emit('players',{});
    assert.deepEqual(of('calls.held').map(n=>[n.character,n.method,n.source,n.by]),[['W','players','untagged','core:calls']]);
    p.fire('player',{cc:0});p.advance(CALL_WINDOW_MS+500);p.fire('player',{cc:0});
    assert.deepEqual(of('calls.released').map(n=>[n.method,n.by]),[['players','core:calls']],'the held emit goes');
    p.fire('player',{cc:199});
    assert.equal(p.ask({band:'job',method:'equip_batch',data:[1]}),'not-now');
    assert.deepEqual(of('calls.waited'),[],'no notice while the question waits');
    // The asker asks again within one window and the margin, so its wait stays open.
    p.fire('player',{cc:0});p.advance(CALL_WINDOW_MS);p.fire('player',{cc:0});
    assert.equal(p.ask({band:'job',method:'equip_batch',data:[1]}),'send');p.emit('equip_batch',[1]);
    assert.deepEqual(of('calls.waited').map(n=>[n.band,n.method]),[['job','equip_batch']]);
    // A background read that waited one window goes in the job band.
    p.advance(CALL_WINDOW_MS+500);
    p.fire('player',{cc:150});
    assert.equal(p.ask({band:'background',method:'secondhands'}),'not-now');
    // The reader asks on each pass; once it has waited one window it goes in the job band.
    let answer='not-now',waited=0;
    while(answer==='not-now'){p.advance(250);waited+=250;p.fire('player',{cc:150});answer=p.ask({band:'background',method:'secondhands'});}
    assert.ok(waited>=CALL_WINDOW_MS,'it went after one window');p.emit('secondhands');
    assert.deepEqual(of('calls.raised').map(n=>n.method),['secondhands']);
    // A question with no emit after it.
    p.advance(CALL_WINDOW_MS+500);p.fire('player',{cc:0});
    assert.equal(p.ask({band:'job',method:'equip_batch',data:[1]}),'send');
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(of('calls.unmatched').map(n=>[n.method,n.band]),[['equip_batch','job']]);
    p.fire('limitdcreport',{calls:[[0,'players',150],[1,'attack',60]],climit:200});
    assert.deepEqual(of('calls.limitdc').map(n=>[n.total,n.limit]),[[210,200]]);
    assert.deepEqual(events.map(e=>of(e).length),[1,1,1,1,1,1],'each change sends one notice');
  }finally{globalThis.__plantedCallNotices=false;p.stop();}
});

// With and (3.4, 3.7): a waiting job question holds the background band only while its asker
// still asks, and a read the job wait refuses asks again when that wait can end, not every
// millisecond.
test('a job wait holds the background band while its asker asks, and a refused read waits for its end',()=>{
  const p=plantedInstall();
  try{
    p.fire('player',{cc:199});
    assert.equal(p.ask({band:'job',method:'equip_batch',data:[1]}),'not-now');
    p.fire('player',{cc:0});
    assert.equal(p.ask({band:'background',method:'secondhands'}),'not-now','a waiting job question holds the background band');
    p.run(p.intervals[0]);
    const wait=p.timers.at(-1).ms;
    assert.ok(wait>=CALL_WINDOW_MS,'the refused player list asks again when the job wait can end: '+wait);
    p.advance(CALL_WINDOW_MS+p.budget.view().margin+1);p.fire('player',{cc:0});
    assert.deepEqual(p.budget.view().waiting.filter(w=>w.band==='job'),[],'an asker that stopped asking leaves no wait');
    assert.equal(p.ask({band:'background',method:'secondhands'}),'send','and the background band is free again');
  }finally{p.stop();}
});

// The cadence (run.ts `afterUpdate`): a decision on the player packets waits for the game's state
// update, while the budget books each packet's call cost at once, so a send the decision makes is
// judged on the server's latest figure. Isolated: a live run cannot place packets inside one draw.
test('cadence: the budget books every player packet while the decision on them waits for the update',async()=>{
  const {createRunScope}=require('../../runtime/lifecycle/character/run.ts');
  const game={draws:0,in_draw:false},queued=[];
  game.draw_trigger=callback=>{if(game.in_draw)callback();else queued.push(callback);};
  const run=createRunScope({frame:globalThis,game,name:()=>'W',hold:()=>null,notify(){}});
  run.replied();
  const p=plantedInstall({handle:run.scope('09','observe')});
  try{
    let decisions=0;
    run.scope('03','act').on(p.win.socket,'player',()=>{decisions++;});
    for(const cc of [40,80,120]){p.fire('player',{cc});assert.equal(p.budget.view().cc,cc,'the budget missed the figure of a packet');}
    assert.equal(decisions,0,'the decision ran before the update landed');
    game.in_draw=true;game.draws++;for(const callback of queued.splice(0))callback();game.in_draw=false;
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(decisions,1,'the three packets ran more or fewer than one decision');
  }finally{p.stop();run.dispose();}
});

// The band wait has no cap of its own: it ends when the server's call cost lets the call go. A
// closed connection sends no more figures, so the wait ends on the connection's own state, a
// disconnect or a new socket, since no figure can come. Isolated: a live run
// cannot drop the socket inside one wait.
test('a band wait releases when the connection closes or the socket is replaced',async()=>{
  const {partyHooks}=require('../../runtime/hooks/index.ts');
  const hooks=partyHooks(),kept=globalThis.parent;
  hooks.publish({name:'core:calls',folder:'core',author:'test',summary:'Answers not now.',
    hooks:{'calls.band':()=>'not-now','calls.window':()=>5,'calls.margin':()=>0}});
  const act={sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))};
  const ended=wait=>Promise.race([wait.then(()=>'sent',error=>error?.reason),new Promise(resolve=>setTimeout(()=>resolve('still waiting'),200))]);
  try{
    for(const close of [socket=>{socket.connected=false;},()=>{globalThis.parent.socket={connected:true};}]){
      globalThis.parent={socket:{connected:true}};
      const wait=hooks.calls.wait({band:'job',method:'players',data:{}},act);
      await new Promise(resolve=>setTimeout(resolve,20));
      close(globalThis.parent.socket);
      assert.equal(await ended(wait),'disconnected','the wait outlived its connection');
    }
  }finally{globalThis.parent=kept;}
});

// A runtime stop leaves the game's own `code` call (2) to the bare emit, which no wrapper sees, so
// the stop books it and the server's sum never passes the ledger's by that call.
test('a runtime stop books the code call the game emits after it',()=>{
  const p=plantedInstall();
  try{
    const before=p.budget.view().ledger.length;
    p.stop();
    const entries=p.win.__partyCallBudget.ledger;
    assert.equal(entries.length,before+1,'one entry more');
    assert.deepEqual([entries.at(-1).method,entries.at(-1).cost],['code',2],'the code call at its price');
    p.stop();
    assert.equal(p.win.__partyCallBudget.ledger.length,before+1,'a second stop books nothing');
  }finally{p.stop();}
});
