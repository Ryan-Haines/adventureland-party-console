// The call budget's Tracktrix read and its stop with no next install (call-budget-reads.ts
// `installBudgetReads`, call-budget.ts `stopCallBudget`), on the planted install. These rows hold the
// planted-reply checks of live row A (test-windows DESIGN.md 4.3, T40): CB16 and CB30 plant a lost
// or gained Tracktrix and a kill credit, CB26 plants a figure and a stop, and none needs a game.
const test=require('node:test'),assert=require('node:assert/strict');
const {plantedInstall}=require('./helpers/live-moves-planted-install.cjs');
const {CALL_WINDOW_MS}=require('../../runtime/characters/call-budget-limits.ts');
const asks=p=>p.emitted.filter(m=>m==='tracker').length;

// CB16: the server answers `tracker` only while a Tracktrix sits in the bag, and the read follows
// the bag the player packet carries. Each step starts one window on, so the read has room.
test('CB16: a lost Tracktrix asks nothing, and a gained one asks at once',()=>{
  const p=plantedInstall({items:[{name:'tracker'}]});
  try{
    p.fire('tracker',{monsters:{}});
    p.advance(CALL_WINDOW_MS+1000);
    p.fire('player',{items:[]});
    const lost=asks(p);
    for(const t of p.timers.splice(0))p.run(t);
    assert.equal(asks(p),lost,'a lost Tracktrix asks nothing, its retry and refresh included');
    p.advance(CALL_WINDOW_MS+1000);
    p.fire('player',{items:[{name:'tracker'}]});
    assert.equal(asks(p),lost+1,'a gained Tracktrix asks at once, in the packet that carries it');
  }finally{p.stop();}
});

// CB30: each `kill_credit` raises the count on the reply the game client holds, so the count stays
// current with no read.
test('CB30: a kill credit raises the held reply with no tracker read',()=>{
  const p=plantedInstall({items:[{name:'tracker'}]});
  try{
    const reply={monsters:{goo:3}};
    p.fire('tracker',reply);
    const before=asks(p);
    p.fire('kill_credit',{mtype:'goo'});
    assert.equal(reply.monsters.goo,4,'the credit raises the count by 1');
    assert.equal(asks(p),before,'with no tracker read');
  }finally{p.stop();}
});

// CB26: a stop with no next install takes the install off the socket and leaves the held queue to
// the record's drain on the game window's timer, which sends the held read once the window frees.
test('CB26: a stop retires the install, takes its listeners off the socket and drains the held read within one window',()=>{
  const winTimers=[],p=plantedInstall({winTimers});
  const record=p.win.__partyCallBudget,install=record.install;
  const own={};
  for(const [event] of install.listeners)own[event]=(own[event]??0)+1;
  const count=()=>Object.fromEntries(Object.keys(own).map(event=>[event,(p.handlers[event]??[]).length]));
  try{
    p.fire('player',{cc:199});
    p.emit('players',{});
    assert.equal(record.held.length,1,'the planted figure holds the players read');
    const before=count(),margin=p.budget.view().margin,stoppedAt=p.at();
    p.stop();
    const after=count();
    assert.equal(record.install,undefined,'the stop retires the install');
    assert.equal(install.retired,true,'the stopped wrapper passes every emit on');
    assert.deepEqual(Object.keys(own).filter(event=>after[event]>before[event]-own[event]),[],"the stopped install's listeners leave the socket");
    assert.notEqual(p.socket.emit,install.wrapper,"the stopped wrapper is not the socket's emit");
    assert.equal(winTimers.length,1,'the drain waits on the game window timer');
    assert.ok(winTimers[0].ms<=CALL_WINDOW_MS+margin+1,`the drain is due within one window and the margin of the stop: ${winTimers[0].ms}`);
    p.advance(winTimers[0].ms);
    const sent=p.sent.length;
    for(const t of winTimers.splice(0))t.run();
    assert.deepEqual(p.sent.slice(sent).map(s=>s.method),['players'],'the held read goes after the stop with no install');
    assert.ok(p.at()-stoppedAt<=CALL_WINDOW_MS+margin+1,'within one window and the margin of the stop');
    assert.equal(record.held.length,0);
  }finally{p.stop();}
});
