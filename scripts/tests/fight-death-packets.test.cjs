const { targetingContext } = require('./helpers/targeting-module.cjs');
const assert=require('node:assert/strict'),vm=require('node:vm');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {deathFixture}=require('./fixtures/targeting-scenario.cjs');
// The death listeners are targeting's own:
// runtime/characters/targeting/death.ts, which shared.js installs on the game window's socket.
// TG21: a monster's death releases its id, reports it once, and a reload leaves one
// listener of each kind. One table over targeting's death ports (fixtures/targeting-scenario.cjs).
scenarioTable("a monster's death releases its id once, on one listener of each kind (TG21)",deathFixture,[
 ['only explicitly lethal disappearance releases an ID, not visibility or teleport',({c,deaths})=>{
  for(const data of [{id:'a',reason:'vision'},{id:'b',teleport:true},{id:'c'}])c.disappear(data);
  assert.deepEqual(deaths,[]);c.disappear({id:'d',death:true});assert.deepEqual(deaths,['d']);
 }],
 ['server entity tombstone confirms death only within its instance',({c,deaths})=>{
  c.entities({in:'other',monsters:[{id:'a',dead:true}]});
  c.entities({in:'cave',monsters:[{id:'b',hp:0},{id:'c',dead:true},{id:'d',hp:100}]});
  assert.deepEqual(deaths,['b','c']);
 }],
 // One `death` packet for another entity makes one `reportFightDeath` and one
 // target reset, the shape of the `disappear` and `entities` listeners above. b9b5c91e ran the
 // packet through shared.js's `combatDeathListener`, which reported it twice; layer 6 carried both
 // calls into survival's handler. Targeting's own handler makes one call.
 ["TG21: a death packet for another entity reports the death once and resets the target once",({ports,deaths,invalidations})=>{
  const {EventEmitter}=require('node:events');const socket=new EventEmitter();
  const {installTargetingDeath}=require('../../runtime/characters/targeting/death.ts');
  // Each CODE load is a new generation of the lifecycle owner's run scope on the game window, which disposes the last
  // one's listeners (runtime/lifecycle/character/run.ts).
  const {createRunScope}=require('../../runtime/lifecycle/character/run.ts');
  const game={},generation=()=>{const run=createRunScope({frame:globalThis,game,name:()=>'W',hold:()=>null,notify(){}});run.replied();return run.scope('04','observe');};
  installTargetingDeath(generation(),socket,ports);
  socket.emit('death',{id:'goo1'});socket.emit('death',{id:'W'});
  assert.deepEqual({deaths,invalidations},{deaths:['goo1'],invalidations:['goo1']});
  installTargetingDeath(generation(),socket,ports);
  assert.deepEqual(['death','disappear','entities'].map(e=>socket.listeners(e).length),[1,1,1],'a reinstall leaves one listener of each kind');
 }],
 // TG21's live half: a goo's death comes to the client as a `death` packet and a lethal
 // `disappear`, and each listener reports it (in the live run, every goo of one window reached
 // the priest's queue twice with the step 3 handler), so `reportFightDeath` sends the queue
 // client a death only the first time it records one.
 ['TG21: a second packet for a death already recorded sends the queue client nothing',({source})=>{
  const start=source.indexOf('  function reportFightDeath(id) {'),end=source.indexOf('  function groupedEntityReport(',start);
  // The module's own queue client (state.queueClient, which installQueueClient sets).
  const queue=[],flushes=[],queueClient={timing:{death(){}},reportEvidence(){},death:id=>queue.push(id),flush:()=>flushes.push(1)};
  const c=targetingContext({root:{},queueClient,fightDeaths:[],groupedCombat:null,character:{map:'main',in:'main'},reunionRealm:()=>'US I',coordinatorClockOffset:0,Date,get_player:()=>null});
  vm.runInContext(source.slice(start,end),c);
  c.reportFightDeath('goo1');c.reportFightDeath('goo1');c.reportFightDeath('goo2');
  assert.deepEqual(queue,['goo1','goo2'],'one queue death per death');
  assert.equal(c.fightDeaths.length,2);
 }],
 // The farm death escape's cases C and B kill the warrior twice in the Arena 34 s apart, inside
 // the record's 60 s memory: the priest's queue client heard only the first.
 ["TG21: a character's second death in the same place reaches the queue client again",()=>{
  const queue=[],queueClient={timing:{death(){}},reportEvidence(){},death:id=>queue.push(id),flush(){}};
  const c=targetingContext({root:{},queueClient,fightDeaths:[],groupedCombat:null,character:{map:'arena',in:'arena'},reunionRealm:()=>'US I',coordinatorClockOffset:0,Date,
    get_player:name=>name==='W'?{name:'W',type:'character',rip:true}:null});
  c.reportFightDeath('W');c.reportFightDeath('goo1');c.reportFightDeath('W');c.reportFightDeath('goo1');
  assert.deepEqual(queue,['W','goo1','W'],'each character death, one report per monster death');
  assert.equal(c.fightDeaths.length,2);
 }],
]);

// SV57: "Killed by" names the monster the server's
// `defeated_by_a_monster` response names, sent before `rip` on a monster's killing blow; a death
// with no response (a burn, PvP, a generated map) names the last monster that hit the character in
// this life, and "unknown monster" when none did, never a player. One survival death install
// (runtime/characters/survival/death.ts) on a planted socket; each row replays its packets.
function survivalDeath(){
  const {EventEmitter}=require('node:events'),socket=new EventEmitter(),records=[];
  const entities={g1:{type:'monster',mtype:'goo'},b1:{type:'monster',mtype:'bat'},p1:{type:'character',name:'Rival'}};
  const character={name:'Me',map:'main',x:0,y:0,rip:false},names={goo:'Goo',bat:'Bat',franky:'Franky'};
  const {createDeath}=require('../../runtime/characters/survival/death.ts');
  const death=createDeath({socket:()=>socket,character:()=>character,monsterName:mtype=>names[mtype],entity:id=>entities[id]||null,ownActor:id=>id==='Me',
    notify:(hook,p)=>{if(hook==='survival.died')records.push(p.cause);},escapeHit(){},held:()=>false,calls:{band:()=>'send'},margin:()=>0,
    scope:{setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id),on:(t,e,l)=>t.on(e,l),off:(t,e,l)=>t.off(e,l)}});
  death.listen();
  const die=()=>{character.rip=true;socket.emit('death',{id:'Me'});character.rip=false;death.seen(false);};
  return {socket,records,death,die,character,hit:hid=>socket.emit('hit',{id:'Me',hid,damage:10}),respond:monster=>socket.emit('game_response',{response:'defeated_by_a_monster',monster}),stop:()=>death.stop()};
}
scenarioTable('SV57: "Killed by" names the server\'s killer, else the last monster hit in this life',survivalDeath,[
 ['the server\'s response names the killer over the last hit',f=>{
  f.hit('g1');f.respond('franky');f.die();
  assert.deepEqual(f.records,['Killed by Franky']);f.stop();
 }],
 ['a burn names the last monster that hit in this life, with no window',f=>{
  f.hit('b1');f.die();
  assert.deepEqual(f.records,['Killed by Bat'],'a burn tick carries no response');f.stop();
 }],
 ['a PvP death names no player, and a hit in an earlier life names nothing',f=>{
  f.hit('g1');f.die();f.hit('p1');f.die();
  assert.deepEqual(f.records,['Killed by Goo','Killed by unknown monster']);f.stop();
 }],
 // respawnLostReply (bigcheck/bounds.md): a respawn whose reply the network lost, with the character
 // still dead, ends `lost reply` past the margin and queues its firing for the next report.
 ['a respawn reply that never comes ends lost and tells the bound record',async f=>{
  const {boundsPending,boundsSent}=require('../../runtime/status/api.ts');
  boundsSent(boundsPending().length);
  globalThis.respawn=()=>new Promise(()=>{});f.character.rip=true;
  try{
   await assert.rejects(f.death.respawn('test'),error=>error.reason==='lost reply');
   assert.deepEqual(boundsPending().map(x=>[x.bound,x.owner,x.state.by]),[['respawnLostReply','05','test']]);
  }finally{boundsSent(1);delete globalThis.respawn;f.stop();}
 }],
]);
