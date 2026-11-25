const {test}=require('node:test');
const assert=require('node:assert/strict');
const {recordConnections,characterConnections,parseObservations}=require('../../runtime/lifecycle/roster/connection-status.ts');
const {steamObservations}=require('../../runtime/lifecycle/roster/observations.ts');
const {ageOf}=require('../../runtime/protocol/reports.ts');

test('Steam reports primary and companions before their character heartbeats',()=>{
 const errors=new Map([['Failed','Launch failed']]);
 const active={Mage:'loading',Healer:'code'};
 const entries=steamObservations({character:{name:'Warrior'},socket:{connected:true},code_active:true,get_active_characters:()=>active},name=>name==='Healer',new Set(['Starting']),errors);
 assert.deepEqual(entries.map(({name,state,primary})=>({name,state,primary})),[
  {name:'Mage',state:'loading',primary:false},{name:'Healer',state:'stopped',primary:false},
  {name:'Starting',state:'loading',primary:false},{name:'Failed',state:'waiting',primary:false},
  {name:'Warrior',state:'code',primary:true}]);
 assert.equal(entries.find(entry=>entry.name==='Failed').error,'Launch failed');
 assert.deepEqual(active,{Mage:'loading',Healer:'code'});
});

test('observations accept only owned characters and support older Steam bridges',()=>{
 const owned=name=>['Warrior','Mage'].includes(name);
 assert.deepEqual(parseObservations({character:'Warrior',observations:[{name:'Warrior',state:'code',primary:false},{name:'Mage',state:'unknown',primary:true},{name:'Stranger',state:'code'}]},owned),[
  {name:'Warrior',state:'code',primary:true},{name:'Mage',state:'waiting',primary:false}]);
 assert.deepEqual(parseObservations({character:'Warrior',running:['Mage','Stranger']},owned),[
  {name:'Warrior',state:'waiting',primary:true},{name:'Mage',state:'waiting',primary:false}]);
});

test('only a live heartbeat makes a character connected; observations expire without altering ownership',()=>{
 const owner={native:'Warrior',slots:[]};
 const entries=[{name:'Mage',primary:false,state:'loading'}];
 recordConnections(owner,entries,1000);
 const lost=1000+ageOf('presence');
 assert.equal(characterConnections(owner,lost-1,()=>false)[0].status,'loading');
 assert.equal(characterConnections(owner,lost,()=>false)[0].status,'lost');
 recordConnections(owner,entries,31000);
 assert.equal(characterConnections(owner,31000,()=>false)[0].delayed,true);
 assert.equal(characterConnections(owner,31000,()=>true)[0].status,'connected');
 assert.equal(characterConnections(owner,31000,()=>true)[0].delayed,false);
 recordConnections(owner,[{...entries[0],state:'code'}],32000);
 assert.equal(characterConnections(owner,32000,()=>false)[0].since,32000);
 assert.deepEqual(owner,{native:'Warrior',slots:[]});
 assert.deepEqual(characterConnections({},32000,()=>false),[]);
});

// DF13: the card's online flag and the connection list read one presence rule, so they agree
// at every age, the presence age itself included.
test('DF13: the card and the connection list agree on online at every report age',()=>{
 const {online,diagnosticCharacters}=require('../../runtime/status/coordinator/state.ts');
 const {ageOf}=require('../../runtime/protocol/reports.ts');
 const limit=ageOf('presence'),now=100000;
 for(const age of [0,limit-1,limit,limit+1]){
  const status={name:'W',seenAt:now-age,runtime:'native'},owner={};
  recordConnections(owner,[{name:'W',primary:true,state:'code'}],now);
  const listed=characterConnections(owner,now,()=>online(status,now))[0].status==='connected';
  assert.equal(diagnosticCharacters({W:status},now,()=>null).W.online,listed,`age ${age}`);
 }
});

test("L: the add-on's report reaches the card's diagnostics section while the live stream is up",()=>{
 const {diagnosticCharacters}=require('../../runtime/status/coordinator/state.ts');
 const reports={roles:{tank:'W'}};
 assert.deepEqual(diagnosticCharacters({W:{name:'W',seenAt:Date.now(),addonReports:reports}},Date.now(),()=>null).W.addonReports,reports);
});
