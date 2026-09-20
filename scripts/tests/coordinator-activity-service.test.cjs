const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorActivity}=require('../../runtime/coordinator/telemetry/activity-service.ts');

test('merchant activity persists only accepted cooldown messages and reads replacement history',()=>{
 const state={merchantActivity:[],anniversary:{activity:[]}};let at=100000,writes=0;
 const service=createCoordinatorActivity(state,{now:()=>at,persistHistory:()=>writes++});
 const message='Fishing cooling down; will resume automatically';
 service.merchant(message);service.merchant(message);assert.equal(writes,1);assert.equal(state.merchantActivity.length,1);
 assert.deepEqual(state.merchantActivity[0],{at:100000,level:'info',message,details:null});
 at+=300000;service.merchant(message);assert.equal(writes,2);
 state.merchantActivity=[];service.merchant(message,null,{job:'new'});
 assert.equal(writes,3);assert.deepEqual(state.merchantActivity,[{at,level:null,message,details:{job:'new'}}]);
});

test('anniversary activity uses current state, retains 500 entries and does not persist merchant history',()=>{
 const state={merchantActivity:[],anniversary:{activity:[]}};
 const service=createCoordinatorActivity(state,{now:()=>1,persistHistory:()=>assert.fail('anniversary must not persist merchant history')});
 state.anniversary={activity:Array.from({length:500},(_,i)=>({at:i,level:'info',message:String(i),details:null}))};
 const current=state.anniversary.activity;service.anniversary('new',undefined,0);
 assert.equal(state.anniversary.activity,current);assert.equal(current.length,500);assert.equal(current[0].message,'1');
 assert.deepEqual(current.at(-1),{at:1,level:'info',message:'new',details:null});
});
