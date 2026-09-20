const test=require('node:test'),assert=require('node:assert/strict');
const {createPublicationScheduler}=require('../../runtime/coordinator/commerce/publication-scheduler.ts');
test('publication batches updates without resetting the first five-second timer',()=>{
 const state={publishTimer:null},timers=[];let publishes=0;
 const scheduler=createPublicationScheduler(state,{later:(callback,delay)=>{const timer={callback,delay};timers.push(timer);return timer;},publish:()=>{assert.equal(state.publishTimer,null);publishes++;}});
 scheduler.schedule();scheduler.schedule();assert.equal(timers.length,1);assert.equal(timers[0].delay,5000);assert.equal(state.publishTimer,timers[0]);
 timers[0].callback();assert.equal(publishes,1);scheduler.schedule();assert.equal(timers.length,2);
});
test('publication releases the timer before invoking a failing publisher',()=>{
 const state={publishTimer:null};let callback;
 const scheduler=createPublicationScheduler(state,{later:fn=>{callback=fn;return {};},publish:()=>{throw Error('publish failed');}});
 scheduler.schedule();assert.throws(()=>callback(),/publish failed/);assert.equal(state.publishTimer,null);
});
