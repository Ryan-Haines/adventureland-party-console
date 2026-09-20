const test=require('node:test'),assert=require('node:assert/strict');
const {createConvoyAcknowledgementRoutes}=require('../../runtime/coordinator/http/convoy-acknowledgements.ts');
const {createConvoyEngagementRoutes}=require('../../runtime/coordinator/http/convoy-engagement.ts');
const {createFarmingReturnRoute}=require('../../runtime/coordinator/http/farming-return.ts');
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('unselected farming leader rejects recovery before querying navigation or authorizing travel',()=>{
 const unexpected=()=>assert.fail('unselected leader must not invoke navigation ports');
 const route=createFarmingReturnRoute({leader:null,location:null},new Proxy({},{get:()=>unexpected}));
 for(const character of ['L','null',null]){
  const res=response();route({body:{character}},res);assert.equal(res.code,403);
 }
});
test('convoy failure validates ownership before recording a held route and preserves known failure codes',()=>{
 const state={activeConvoy:{id:'c'},commands:{},combatLogs:{}},calls=[];let valid=false;
 const routes=createConvoyAcknowledgementRoutes(state,{now:()=>100,owned:()=>true,valid:()=>valid,nextCommand:()=>7,persist:()=>calls.push('persist'),history:()=>calls.push('history'),hold:(...args)=>calls.push(args),error:()=>{}});
 const body={character:'L',reason:'stuck',failureCode:'owner-lost',details:{map:'main'}};
 let res=response();routes.failed({body},res);assert.equal(res.code,409);assert.equal(state.combatLogs.L,undefined);
 valid=true;res=response();routes.failed({body},res);assert.equal(res.code,200);assert.deepEqual(calls,[['L: stuck','owner-lost'],'history','persist']);assert.equal(state.activeConvoy.failureDetails,body.details);
});
test('grouped approach requires matching arrival generation, a valid area and no unfinished fight',()=>{
 const group={ready:true,key:'key',selection:'goo',members:['L','F']},state={leader:'L',activeConvoy:null,monsterSearchRadiusByCharacter:{},statuses:{L:{},F:{threats:[{target:'L'}]}}};
 let starts=0;const routes=createConvoyEngagementRoutes(state,{group:()=>group,intent:()=>({revision:1}),huntOwns:()=>false,waypoint:()=>({map:'cave'}),contains:()=>true,now:()=>10000,start:()=>{starts++;return true;}});
 const body={character:'L',key:'key',selection:'goo',navigationRevision:1,location:{map:'cave',x:1,y:2}};
 let res=response();routes.approach({body:{...body,key:'stale'}},res);assert.equal(res.code,409);
 res=response();routes.approach({body},res);assert.equal(res.body.error,'finish the current fight before group travel');assert.equal(starts,0);
 state.statuses.F.threats=[{}];res=response();routes.approach({body},res);assert.equal(res.body.ok,true);assert.equal(starts,1);
});
