// Waits on the code under test by its state, never by a count of turns. A fixed count of
// microtasks or setImmediate turns follows the code's await depth, so one added await fails the
// row or lets it pass on a state the code has not reached (AGENTS.md "Testing").
const {performance}=require('node:perf_hooks');
const {ROW_TIMEOUT_MS}=require('../fixtures/scenarios.cjs');

const turn=()=>new Promise(resolve=>setImmediate(resolve));

// Node runs every queued microtask before the check phase, so one setImmediate turn has run each
// promise chain that waits only on promises, at any depth. Code that waits on a timer or an
// immediate of its own needs `until`.
function settle(){return turn();}

// Polls `check` once per setImmediate turn and returns its first truthy answer. ROW_TIMEOUT_MS,
// the scenario tables' hang guard, bounds it: a check that never holds fails with `what` instead of
// hanging the file. It reads performance.now, which t.mock.timers leaves running.
async function until(check,what=String(check)){
 const end=performance.now()+ROW_TIMEOUT_MS;
 for(;;){
  const answer=await check();
  if(answer)return answer;
  if(performance.now()>end)throw Error(`until: the state never held: ${what}`);
  await turn();
 }
}

// TanStack Query's notifyManager flushes its batched notices on a zero timer (query-core
// notifyManager.js defaultScheduler, systemSetTimeoutZero). `notified` waits for that flush, after
// the promise chains settle, so an observer has its new state when it returns.
function notified(){return new Promise(resolve=>setTimeout(resolve,0));}

module.exports={settle,until,notified};
