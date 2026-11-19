const assert=require('node:assert/strict');
const{createNativeProgressBudget}=require('../../e2e/native-progress-budget.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
// Each row gets a budget over a clock the row moves: quiet at 300 s, absolute at 600 s.
const budget=()=>{const clock={now:0};return {clock,b:createNativeProgressBudget(()=>clock.now,300000,600000)};};
scenarioTable('the native progress budget credits distinct evidence and enforces the quiet and absolute limits',budget,[
 ['duplicate native progress cannot renew the quiet completion budget',({clock,b})=>{
  b.observe(['room:already-done','choice:already-resolved']);
  clock.now=299999;b.observe(['room:already-done','choice:already-resolved']);b.check();
  clock.now=300000;assert.throws(()=>b.check(),/no new native progress/);
 }],
 ['a distinct native completion permits the observed 303-second finish',({clock,b})=>{
  b.observe(['room:boss']);clock.now=250000;b.observe(['room:boss','room:guards']);
  clock.now=303300;b.observe(['room:boss','room:guards','room:chest']);b.check();
  assert.equal(b.snapshot().lastProgressAt,303300);
  assert.equal(b.snapshot().markers.length,3);
 }],
 ['native progress never bypasses the absolute completion cap',({clock,b})=>{
  b.observe([]);
  for(clock.now=100000;clock.now<600000;clock.now+=100000){b.observe(['choice:'+clock.now]);b.check();}
  assert.throws(()=>{b.observe(['choice:600000']);b.check();},/absolute completion budget/);
 }],
 ['fresh evidence returned across quiet expiry is credited before checking quiet time',({clock,b})=>{
  b.observe(['room:boss']);clock.now=304679;
  b.observe(['room:boss','choice:new-native-vote']);
  assert.equal(b.snapshot().lastProgressAt,304679);
  clock.now=604679;assert.throws(()=>b.observe(['choice:another']),/absolute completion budget/);
 }],
 ['late duplicate evidence cannot revive an idle journey',({clock,b})=>{
  b.observe(['death:123']);clock.now=304679;
  assert.throws(()=>b.observe(['death:123']),/no new native progress/);
 }],
]);
