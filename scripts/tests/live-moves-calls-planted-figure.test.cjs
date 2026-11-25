// The call budget's answers under a planted server figure, and the turns executor's wait on them
// (call-budget.ts `band`, the hold queue's drain; turns/executor.ts `send`). These rows hold the
// planted-figure checks of live row B (test-windows DESIGN.md 4.3, T41): every check there plants
// the figure it judges, so the rule reads the same on the planted install. Live W05 keeps CB6 on a
// real fight and CB24's tracker age.
const test=require('node:test'),assert=require('node:assert/strict');
const {plantedInstall}=require('./helpers/live-moves-planted-install.cjs');
const {turnsWorld}=require('./fixtures/turns-world.cjs');
const {CALL_WINDOW_MS,CROSSING}=require('../../runtime/characters/call-budget-limits.ts');

// CB5 and CB23's band half: a figure of 199 holds a survival question until a newer packet comes or
// the figure is one window old, and holds job questions while it is fresh. A figure of 190 passes
// the job limit (bandLimits: 188), so a travel step waits for the figure to go.
test('CB5: a fresh figure holds survival until a newer packet or one window, and job while it is fresh',()=>{
  const p=plantedInstall();
  try{
    p.fire('player',{cc:199});
    const margin=p.budget.view().margin,from=p.at();
    let survival=null;
    for(let waited=0;waited<=CALL_WINDOW_MS+margin;waited+=50){
      const fresh=p.budget.view().ccAge<=CALL_WINDOW_MS;
      const job=p.ask({band:'job',method:'players',data:{}});
      if(fresh)assert.equal(job,'not-now',`a job question at ${waited} ms while the planted figure is fresh`);
      if(p.ask({band:'survival',method:'attack'})==='send'){survival={ms:p.at()-from,fresh};break;}
      p.advance(50);
    }
    assert.ok(survival,'a survival question goes once the figure is old');
    assert.equal(survival.fresh,false,'no survival question goes while the planted figure is the fresh one');
    assert.ok(survival.ms<=CALL_WINDOW_MS+margin,`the longest survival wait: ${survival.ms}`);
  }finally{p.stop();}
  const q=plantedInstall();
  try{
    q.fire('player',{cc:199});
    assert.equal(q.ask({band:'survival',method:'attack'}),'not-now');
    q.advance(250);q.fire('player',{cc:0});
    assert.equal(q.ask({band:'survival',method:'attack'}),'send','a newer packet ends the hold');
  }finally{q.stop();}
  const r=plantedInstall();
  try{
    r.fire('player',{cc:190});
    assert.equal(r.ask({band:'job',method:'move',data:{x:10,y:0}}),'not-now','CB23: a fresh figure of 190 holds a travel send');
    r.advance(250);r.fire('player',{cc:0});
    assert.equal(r.ask({band:'job',method:'move',data:{x:10,y:0}}),'send','and the next figure lets it go');
  }finally{r.stop();}
});

// CB9: two untagged potion uses under a figure of 199 wait in the hold queue; a survival stop asked
// after them waits too, and an untagged move joins the queue behind them. The queue goes in the
// order the calls were made, so the server walks no point the client left.
test('CB9: held uses keep their order, and a stop or move after them waits behind them',()=>{
  const p=plantedInstall();
  try{
    p.fire('player',{cc:199});
    p.emit('equip',{num:1});p.emit('equip',{num:2});
    assert.equal(p.budget.view().held,2,'the two uses wait in the hold queue');
    assert.equal(p.ask({band:'survival',method:'move'}),'not-now','the stop asked after them waits');
    p.emit('move',{x:5,y:0});
    assert.equal(p.budget.view().heldHead,'equip','the move waits behind the uses');
    const sent=p.sent.length;
    p.advance(250);p.fire('player',{cc:0});
    assert.deepEqual(p.sent.slice(sent).map(s=>[s.method,s.data]),[['equip',{num:1}],['equip',{num:2}],['move',{x:5,y:0}]],'each call goes in the order it was made');
    assert.equal(p.ask({band:'survival',method:'move'}),'send','the owed stop goes once the queue is empty');
  }finally{p.stop();}
});

// CB24's band half: a background question that waits one window and the margin under a fresh
// figure is judged in the job band, and its send writes one `read-job` record.
test('CB24: a background question under a fresh figure rises to the job band after one window with one read-job record',()=>{
  const p=plantedInstall();
  try{
    let first=null,sent=null;
    for(let ms=0;ms<=3*CALL_WINDOW_MS;ms+=100){
      // The figure drops under the job limit once the question has waited one window and the
      // margin the budget holds then: room for the read in the job band.
      const risen=first!==null&&p.at()-first>=CALL_WINDOW_MS+p.budget.view().margin;
      p.fire('player',{cc:risen?150:199});
      const answer=p.ask({band:'background',method:'secondhands'});
      if(answer==='send'){sent=p.at();p.emit('secondhands');break;}
      first??=p.at();
      p.advance(100);
    }
    assert.equal(typeof first,'number','a background question waits under the planted figure');
    assert.equal(typeof sent,'number','the waiting background question goes in the job band');
    assert.ok(sent-first>=CALL_WINDOW_MS,`it rises after one window: ${sent-first}`);
    assert.equal(p.budget.records().filter(r=>r.decision==='read-job'&&r.method==='secondhands').length,1,'the rise writes one read-job entry');
  }finally{p.stop();}
});

// TC14's executor half: while the budget answers `not-now` the attack family sends nothing, and the
// send that follows closes the wait in the turns ring with its waited time.
test('TC14: the executor sends nothing while the budget answers not-now, and closes the wait with its send',()=>{
  let answer='not-now';
  const actor={name:'P',ctype:'priest',mp:1000,max_mp:1000,mp_cost:10,frequency:1,rip:false,items:[],level:80};
  const w=turnsWorld({actor,skills:{attack:{}},selected:()=>'goo1',band:()=>answer,
    asks:()=>[{skill:'attack',targets:[{id:'goo1'}],rank:'damage',category:'damage',reason:'target'}]});
  try{
    global.parent.next_skill={};
    w.turns.pass('tick');w.advance(500);w.turns.pass('tick');
    assert.equal(w.sent.length,0,"the priest's attack sent while the figure holds survival");
    answer='send';w.advance(250);w.turns.pass('tick');
    assert.deepEqual(w.sent.map(s=>s[0]),['attack'],'the next attack goes once the hold ends');
    const waits=w.turns.records().filter(r=>r.kind==='wait');
    assert.equal(waits.length,1,'the wait closes with its send');
    assert.ok(waits[0].waitedMs>=750&&waits[0].waitedMs<=CALL_WINDOW_MS,`a turns wait left open past one window: ${waits[0].waitedMs}`);
  }finally{w.restore();}
});

// SV46's booking half: the respawn asks survival's band and books its price, a crossing and the
// `u+cid` resend (call-budget.ts `price`, server.js lines it cites). The server's own charge of it is
// a game reading, which no planted install can make.
test('SV46: the respawn books its crossing price in the survival band',()=>{
  const p=plantedInstall();
  try{
    const before=p.budget.view().ledger.length;
    assert.equal(p.ask({band:'survival',method:'respawn'}),'send');p.emit('respawn');
    const entries=p.budget.view().ledger.slice(before);
    assert.deepEqual(entries.map(e=>[e.method,e.cost]),[['respawn',CROSSING+2]],'the respawn at CROSSING + 2');
    assert.equal(p.budget.view().spent.survival,CROSSING+2,"in survival's spend");
  }finally{p.stop();}
});
