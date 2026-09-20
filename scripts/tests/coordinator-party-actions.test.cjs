const test=require('node:test'),assert=require('node:assert/strict');
const {createPartyActionRoutes}=require('../../runtime/coordinator/http/party-actions.ts');
function fixture(){
 const state={leader:'L',followers:{F:true},merchantCharacter:'M',statuses:{L:{seenAt:100000,map:'main',x:2,y:3}},commands:{},merchantCurrent:null,merchantQueue:[],
  upgrades:{L:[{}]},purchases:{},compounds:{F:[{items:[1,2]}]},autoCompounds:{M:[{}]},escape:{stage:'active'}};
 const calls=[];let next=1;
 const routes=createPartyActionRoutes(state,{now:()=>100000,nextCommand:()=>next++,release:()=>calls.push('release'),members:()=>['L','F'],active:()=>['L','F','M'],
  authorize:(names,location)=>{calls.push(['authorize',names]);state.location=location;},invalidate:(...args)=>calls.push(args),persist:()=>calls.push('persist'),dispatch:()=>calls.push('dispatch'),
  escape:()=>({stage:'started'}),queue:(...args)=>calls.push(args),
  convoy:(location,label,names,purpose)=>{for(const name of names)state.commands[name]={id:next++,type:'party-monster-travel',location,purpose};return true;}});
 function send(route,body={}){const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},res);return res;}
 return {state,calls,send};
}
test('manual collection queues every group member without a radius and does not duplicate work',()=>{
 const t=fixture();assert.deepEqual(t.send('bank').body.queued,['L','F']);t.send('bank');assert.equal(t.state.merchantQueue.length,2);
 assert.equal(t.state.merchantQueue[0].expandLeaderCluster,undefined);assert.deepEqual(t.calls,['persist','dispatch']);
});
test('unselected leader cannot save a checkpoint or dispatch collection, even with a null-key report',()=>{
 const t=fixture();t.state.leader=null;t.state.statuses.null=t.state.statuses.L;
 assert.equal(t.send('checkpoint').code,409);assert.equal(t.send('bank').code,409);
 assert.deepEqual(t.calls,[]);assert.deepEqual(t.state.merchantQueue,[]);
});

test('send to party explicitly queues marked delivery recipients outside the leader cluster',()=>{
 const t=fixture();
 t.state.merchantDeliveries={F:[{slot:24,item:{name:'wattire',level:8,stat_type:'int'},equipOnDelivery:true}],M:[{}],Other:[{}]};
 t.state.statuses.F={seenAt:100000,map:'winterland',x:999,y:999};
 assert.deepEqual(t.send('bank').body.queued,['L','F']);
 assert.deepEqual(t.state.merchantQueue.map(job=>job.target),['L','F']);
 assert.equal(t.state.merchantQueue[1].expandLeaderCluster,undefined);
 t.send('bank');assert.equal(t.state.merchantQueue.length,2);
 assert.equal(t.state.merchantDeliveries.F[0].equipOnDelivery,true);
});

test('repeated send does not duplicate the in-progress leader or queued follower',()=>{
 const t=fixture();t.send('bank');t.state.merchantCurrent=t.state.merchantQueue.shift();
 t.state.merchantDeliveries={F:[{item:{name:'wattire',level:8},equipOnDelivery:true}]};
 t.send('bank');assert.deepEqual(t.state.merchantQueue.map(job=>job.target),['F']);
 assert.deepEqual(t.calls,['persist','dispatch']);
});

test('independent parties require selection and queue only the selected group',()=>{
 const t=fixture();t.state.followers.F=false;
 assert.equal(t.send('bank').code,409);assert.deepEqual(t.state.merchantQueue,[]);
 assert.equal(t.send('bank',{group:'missing'}).code,409);
 assert.deepEqual(t.send('bank',{group:'F'}).body.queued,['F']);
 assert.deepEqual(t.state.merchantQueue.map(job=>job.target),['F']);
});
test('party upgrade action queues only actionable owners and preserves manual immediate semantics',()=>{
 const t=fixture();assert.deepEqual(t.send('upgrades').body.queued,['L','M']);assert.deepEqual(t.calls,[[['L','M'],'upgrades and compounds']]);
});
test('travel authorizes the shared checkpoint and sends one forced convoy to the combat party',()=>{
 const t=fixture();assert.equal(t.send('travel',{map:'main',x:8,y:9,force:true}).body.partyLocation.x,8);
 assert.deepEqual(Object.keys(t.state.commands),['L','F']);assert.equal(t.state.commands.F.type,'party-monster-travel');assert.equal(t.state.commands.F.purpose,'party-force-travel');
 const before=t.state.location;assert.equal(t.send('travel',{map:'not a map',x:8,y:9}).code,400);assert.equal(t.state.location,before);
});
