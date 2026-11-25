const test=require('node:test'),assert=require('node:assert/strict');
const {createFocusRoute,createSavedFarmingModeRoute}=require('../../runtime/hunting/coordinator/routes.ts');
const {createFormationRoute}=require('../../runtime/settings/coordinator/routes/formation.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
function fixture(){
 const state={leader:'L',merchantCharacter:'M',followers:{F:true},monsterFocus:['bat'],monsterFocusByCharacter:{F:['goo']},monsterPrioritiesByCharacter:{},monsterSearchRadiusByCharacter:{},
  scatterMonsterTypes:['bat'],scatterEpoch:1,partyFarmingMode:'scatter',partyFarmingMonsterType:'bat',scatterBreakTarget:{id:1},eventsByCharacter:{},eventSelectionsByCharacter:{},
  eventPrioritiesByCharacter:{},eventLimitsByCharacter:{},handControlByCharacter:{}};
 const calls=[],ports={owned:name=>['L','F','M'].includes(name),members:()=>['L','F'],invalidate:(...args)=>calls.push(args),persist:()=>calls.push('persist'),
  managed:name=>['L','F','M'].includes(name),inherited:name=>name==='F',selected:()=>['anniversary']};
 ports.write=settingsWriter(state,{owned:ports.owned}).write;
 const routes={focus:createFocusRoute(state,ports),formation:createFormationRoute(state,ports)};
 function send(route,body){const r={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};routes[route]({body},r);return r;}
 return {state,calls,ports,send};
}

test('clearing merchant focus during another character Hunt invalidates merchant navigation',()=>{
 const t=fixture();t.state.targetMode='hunt';t.state.monsterHunt={participants:['L','F']};
 t.send('focus',{character:'M',monsterFocus:[]});assert.ok(t.calls.some(c=>Array.isArray(c)&&c[1]==='monster focus cleared'));
});
test('leader selection clears follower overrides and resets scatter only when focus changes',()=>{
 const t=fixture();const r=t.send('focus',{character:'L',monsterFocus:['goo','goo'],monsterPriorities:{goo:2.6},monsterSearchRadius:901.2});
 assert.deepEqual(t.state.monsterFocus,['goo']);assert.equal(t.state.monsterFocusByCharacter.F,undefined);assert.equal(t.state.scatterEpoch,2);
 assert.deepEqual(r.body.monsterPriorities,{goo:3});assert.equal(r.body.monsterSearchRadius,901);
 t.send('focus',{character:'L',monsterFocus:['goo']});assert.equal(t.state.scatterEpoch,2);assert.equal(t.state.monsterSearchRadiusByCharacter.L,901);
});
test('focus validation rejects invalid priorities and radius before mutation',()=>{
 const t=fixture();for(const body of [{monsterFocus:['tinyp']},{monsterFocus:['goo'],monsterPriorities:[]},{monsterFocus:['goo'],monsterSearchRadius:0}])assert.equal(t.send('focus',body).code,400);
 assert.deepEqual(t.state.monsterFocus,['bat']);assert.equal(t.calls.length,0);
});
test('clearing independent focus invalidates only its checkpoint while a global clear invalidates party members',()=>{
 const t=fixture();t.send('focus',{character:'F',monsterFocus:[]});assert.deepEqual(t.calls[0],[['F'],'monster focus cleared',false]);
 t.send('focus',{monsterFocus:[]});assert.deepEqual(t.calls[2],[['L','F'],'monster focus cleared',true]);
});
test('formation preserves inherited event restrictions and independent merchant selection',()=>{
 const t=fixture();assert.equal(t.send('formation',{character:'F',eventSelections:['franky']}).code,409);
 assert.equal(t.send('formation',{character:'M',eventSelections:['franky']}).code,200);
 assert.equal(t.send('formation',{character:'M',eventSelections:['anniversary','anniversary']}).code,200);
 assert.deepEqual(t.state.eventSelectionsByCharacter.M,['anniversary']);
 t.send('formation',{character:'L',events:true});assert.deepEqual(t.state.eventSelectionsByCharacter.L,require('../../runtime/events/api.ts').supportedEvents,'the older flag selects every K1 event');
});

// SF29: each route of the settings owner refuses exactly
// what its fields' declarations refuse, through the one writer, with the declaration's own words
// and writes nothing. The thresholds route shares the table.
test('SF29: the formation and threshold routes refuse by the declarations, in their own words',()=>{
 const {state,send}=fixture();
 const before=JSON.stringify(state);
 const refused=[[{character:'L',follow:'yes'},'invalid follower'],[{character:'L',events:'on'},'invalid events setting'],
  [{character:'L',handControl:{on:'yes'}},'handControl takes on, usePotions and combat as booleans and party as follows-me or carries-on']];
 for(const [body,error] of refused){const r=send('formation',body);assert.equal(r.code,400,error);assert.deepEqual(r.body,{error});}
 assert.equal(JSON.stringify(state),before,'a refused request writes nothing');
 assert.equal(send('formation',{character:'L',handControl:{on:true}}).code,200);
 assert.equal(state.handControlByCharacter.L.on,true);
 const {createThresholdRoute}=require('../../runtime/settings/coordinator/routes/thresholds.ts');
 const t={threshold:1,itemCollectionThreshold:1},route=createThresholdRoute(t,{collectionChanged(){},write:settingsWriter(t).write});
 const post=body=>{const r={code:200,status(code){this.code=code;return this;},json(b){this.body=b;return this;}};route({body},r);return r;};
 assert.deepEqual(post({itemCollectionThreshold:99}).body,{error:'invalid item collection threshold'});
 assert.deepEqual(post({buyUpgradeBatchSize:0}).body,{error:'invalid upgrade batch size (1–42)'});
 assert.deepEqual(post({threshold:-1}).body,{error:'invalid threshold'});
});

// The hunting owner's saved mode route (routes.ts `createSavedFarmingModeRoute`): a follower's Hunt save needs a backup
// focus and a farming area from the monster catalog, and it writes only the follower's own profile.
test('follower preference saves validate Hunt backup and never start active work',()=>{
 const profile={combatMode:'auto',location:null,monsterFocus:[]};
 let saved=0;
 const route=createSavedFarmingModeRoute({monsterChoices:[{id:'rat',locations:[{id:'a',map:'cave',x:1,y:2}]}]},{profile:()=>profile,persist(){saved++},
  write:settingsWriter({},{scope:name=>name==='P'?profile:{}}).write});
 const call=body=>{const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return body}};route({body:{character:'P',...body}},res);return res};
 assert.equal(call({mode:'invalid'}).code,400);
 assert.equal(call({mode:'hunt'}).body.code,'backup_required');
 assert.equal(profile.targetMode,undefined);assert.equal(saved,0);
 assert.equal(call({mode:'hunt',backup:{monsterFocus:['rat'],location:{map:'cave',x:1,y:2}}}).body.savedOnly,true);
 assert.equal(profile.targetMode,'hunt');assert.deepEqual(profile.monsterFocus,['rat']);
 assert.equal(profile.monsterHunt,undefined);
 assert.equal(call({mode:'default'}).code,200);assert.equal(profile.location.map,'cave');
});

// B36: b9b5c91e's formation route wrote the leader and `follow`
// before it read the later fields (http/formation.ts:91-96, 82-84), so a body refused on a later
// field still changed them. The route edits a draft and writes only a body it accepts.
test('B36: a formation body refused on a later field leaves the leader and the followers as they were',()=>{
 const {state,send}=fixture();
 const before=JSON.stringify({leader:state.leader,followers:state.followers});
 const r=send('formation',{leader:'F',character:'L',follow:true,events:'on'});
 assert.equal(r.code,400);assert.deepEqual(r.body,{error:'invalid events setting'});
 assert.equal(JSON.stringify({leader:state.leader,followers:state.followers}),before);
});
