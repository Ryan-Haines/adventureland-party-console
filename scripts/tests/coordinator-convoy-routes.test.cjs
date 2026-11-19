const test=require('node:test'),assert=require('node:assert/strict');
const {createConvoyAcknowledgementRoutes,createConvoyEngagementRoutes}=require('../../runtime/movement/coordinator/routes.ts');
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('convoy failure validates ownership before recording a held route and preserves known failure codes',()=>{
 const state={activeConvoy:{id:'c'},commands:{},combatLogs:{}},calls=[];let valid=false;
 const routes=createConvoyAcknowledgementRoutes(state,{now:()=>100,owned:()=>true,valid:()=>valid,nextCommand:()=>7,persist:()=>calls.push('persist'),history:()=>calls.push('history'),hold:(...args)=>calls.push(args),error:()=>{}});
 const body={character:'L',reason:'stuck',failureCode:'owner-lost',details:{map:'main'}};
 let res=response();routes.failed({body},res);assert.equal(res.code,409);assert.equal(state.combatLogs.L,undefined);
 valid=true;res=response();routes.failed({body},res);assert.equal(res.code,200);assert.deepEqual(calls,[['L: stuck','owner-lost',100],'history','persist']);assert.equal(state.activeConvoy.failureDetails,body.details);
});
test('grouped approach requires matching arrival generation, a valid area and no unfinished fight',()=>{
 const group={ready:true,key:'key',selection:'goo',members:['L','F']},state={leader:'L',activeConvoy:null,monsterSearchRadiusByCharacter:{},statuses:{L:{},F:{threats:[{target:'L'}]}}};
 let starts=0;const routes=createConvoyEngagementRoutes(state,{group:()=>group,intent:()=>({revision:1}),huntOwns:()=>false,waypoint:()=>({map:'cave'}),contains:()=>true,now:()=>10000,start:()=>{starts++;return true;}});
 const body={character:'L',key:'key',selection:'goo',navigationRevision:1,location:{map:'cave',x:1,y:2}};
 let res=response();routes.approach({body:{...body,key:'stale'}},res);assert.equal(res.code,409);
 res=response();routes.approach({body},res);assert.equal(res.body.error,'finish the current fight before group travel');assert.equal(starts,0);
 state.statuses.F.threats=[{}];res=response();routes.approach({body},res);assert.equal(res.body.ok,true);assert.equal(starts,1);
});
// B127: a continuous return keeps its interrupted Town cast (`town-interrupted`), so
// that /convoy-failed records only the Town attempt. b9b5c91e convoy-acknowledgements.ts:12, :138
// wrote "!!! CONVOY STOPPED !!!" and the failure details before the hold decided, so the member's
// log showed a stop the walk never made.
test('B127: a kept Town interruption writes no stop line, and a route failure writes one',()=>{
 const state={activeConvoy:{id:'c',continuousReturn:1},commands:{},combatLogs:{}},holds=[];
 const routes=createConvoyAcknowledgementRoutes(state,{now:()=>100,owned:()=>true,valid:()=>true,nextCommand:()=>7,persist(){},history(){},hold:(...args)=>holds.push(args),error(){}});
 const town={character:'L',epoch:2,routeVersion:0,reason:'Town interrupted',details:{map:'main'},
  townAttempt:{state:'interrupted',map:'main',round:'2:0:1',destination:{map:'main',x:0,y:0}}};
 routes.failed({body:town},response());
 assert.equal(state.combatLogs.L,undefined,'no stop line');
 assert.deepEqual([holds,state.activeConvoy.failureDetails,state.activeConvoy.returnTown.interruptions],[[],undefined,1]);
 routes.failed({body:{character:'L',reason:'stuck'}},response());
 assert.match(state.combatLogs.L.at(-1).message,/^!!! CONVOY STOPPED !!! stuck$/);
 assert.deepEqual(holds,[['L: stuck','route-failed',100]]);
});
