const test = require('node:test');
const assert = require('node:assert/strict');
const { createDeathRecovery } = require('../../runtime/characters/roles/death-recovery.ts');
function setup() {
  const state = { dead: true, attempts: 0, reunions: 0, working: true }, timers = [];
  const recover = createDeathRecovery({
    isDead: () => state.dead,
    respawn: () => { state.attempts++; return new Promise(() => {}); },
    releaseCombat: () => { state.working = false; }, publish() {},
    rejoinEvent: async () => ({status:"not-applicable"}), rejoinFarm: () => { state.reunions++; }, log() {},
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
  });
  return { state, timers, recover };
}
test('an unanswered respawn releases its latch and retries without concurrent attempts', async () => {
  const { state, timers, recover } = setup();
  const first = recover(); await recover();
  assert.equal(state.attempts, 1);
  timers.shift()(); await first;
  const second = recover(); assert.equal(state.attempts, 2);
  timers.shift()(); await second;
});
test('live respawn state starts farm reunion even if the response promise was lost', async () => {
  const { state, timers, recover } = setup();
  const attempt = recover(); state.dead = false; timers.shift()(); await attempt;
  assert.equal(state.working, false); assert.equal(state.reunions, 1);
  await recover(); assert.equal(state.reunions, 1);
});


test('respawn finishing after the timeout still triggers exactly one reunion',async()=>{
 const {state,timers,recover}=setup();const attempt=recover();timers.shift()();await attempt;
 assert.equal(state.reunions,0);state.dead=false;await recover();
 assert.equal(state.reunions,1);assert.equal(state.attempts,1);await recover();assert.equal(state.reunions,1);
});


test('failed event travel retries without another respawn or an accidental farm return',async()=>{
 let dead=true,respawns=0,joins=0,farms=0,now=10000;const published=[],logs=[];const original=Date.now;Date.now=()=>now;
 try {
 const recover=createDeathRecovery({isDead:()=>dead,respawn:async()=>{respawns++;dead=false;},releaseCombat(){},publish:s=>published.push(s),
 rejoinEvent:async()=>++joins===1?{status:'retryable',phase:'event-travel',reason:'route blocked'}:{status:'recovered'},
 rejoinFarm:()=>farms++,log:s=>logs.push(s),setTimeout,clearTimeout});
 await recover();assert.equal(published.at(-1).recovery.phase,'event-travel');assert.equal(published.at(-1).recovery.lastError,'route blocked');
 await recover();assert.equal(joins,1);now+=1001;await recover();await recover();
 assert.equal(respawns,1);assert.equal(joins,2);assert.equal(farms,0);assert.equal(published.at(-1).stage,'recovery-complete');assert.equal(logs.length,0);
 } finally {Date.now=original;}
});
test('cancelled event continuation ends recovery without farming; thrown errors identify their phase',async()=>{
 for(const cancel of [true,false]) {
 const logs=[],states=[];let dead=true;
 const recover=createDeathRecovery({isDead:()=>dead,respawn:async()=>{dead=false;},releaseCombat(){},publish:s=>states.push(s),
 rejoinEvent:async()=>{if(cancel)return {status:'cancelled'};throw Error('join rejected');},rejoinFarm:()=>assert.fail('no farm return'),log:s=>logs.push(s),setTimeout,clearTimeout});
 await recover();assert.equal(states.at(-1).stage,cancel?'recovery-cancelled':'recovery-retry');
 if(!cancel)assert.match(logs[0],/^event-reentry failed: join rejected/);
 }
});
