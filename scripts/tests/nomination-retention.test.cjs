const test=require('node:test'),assert=require('node:assert/strict');
const {retainNominations}=require('../../runtime/combat/nomination-retention.ts');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
test('client retains a visible admitted fringe target when an inside-zone monster appears',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync('characters/shared.js','utf8');
 const entity={id:'A',mtype:'wolfie',x:450,y:0,visible:true};
 const c=vm.createContext({root:{__partyEntitiesObservedAt:1000,__partyNomination:{}},character:{map:'winterland',in:'winterland'},
  groupedCombat:{queue:[{...target}]},get_entity:()=>entity,reunionRealm:()=> 'USII',isExternallyClaimedMonster:()=>false,
  farmApproach:{failed:{}},passiveRareCandidate:()=>false,monsterFocus:['wolfie'],partyLocation:{map:'winterland',x:0,y:0},monsterSearchRadius:400,
  inFarmArea:()=>false,groupedEntityReport:e=>({...e,map:'winterland',in:'winterland'})});
 vm.runInContext(source.slice(source.indexOf('  function queueRetentions('),source.indexOf('  function queueReport(')),c);
 assert.equal(c.queueRetentions()[0].eligible,true);entity.x=551;
 assert.equal(c.queueRetentions()[0].reason,'retention boundary');entity.visible=false;
 assert.equal(c.queueRetentions()[0].reason,'not visible');
});
const target={id:'A',mtype:'wolfie',map:'winterland',in:'winterland',server:'USII',x:10,y:0,state:'planned',fighter:'W',startedAt:100};
function members(){return ['W','P','M'].map(name=>({name,ctype:'warrior',revision:1,status:{server:'USII',map:'winterland',in:'winterland',seenAt:1000,hp:100,x:0,y:0,
 groupedCombat:{epoch:0,retentions:[{...target,at:1000,eligible:false,reason:'not visible'}],candidates:[]}}}));}
test('one party observer preserves an admitted target and primary identity despite new inside-zone candidates',()=>{
 const m=members();m[1].status.groupedCombat.retentions[0].eligible=true;
 m[0].status.groupedCombat.candidates=[{...target,id:'B',x:0}];
 const g=reconcileQueue({queue:[target],target,fights:[]},m,'W',1000,'key');
 assert.equal(g.target.id,'A');assert.deepEqual(g.queue.map(t=>t.id),['A','B']);
});

test('retained nominations wait safely while the leader has no heartbeat after restart',()=>{
 const m=members();delete m[0].status;
 m[1].status.groupedCombat.retentions[0].eligible=true;
 const g=reconcileQueue({queue:[target],target,fights:[]},m,'W',1000,'key');
 assert.equal(g.target,null);assert.deepEqual(g.queue,[]);
});
test('neutral visibility retirement requires every party member; stale observer prevents removal',()=>{
 const m=members();m[2].status.seenAt=0;
 assert.equal(retainNominations([target],m,4000).length,1);
 for(const member of m){member.status.seenAt=4000;member.status.groupedCombat.retentions[0].at=4000;}
 assert.equal(retainNominations([target],m,4000).length,0);
});
test('explicit retention rejection removes the neutral; positive sighting wins over another missing observer',()=>{
 for(const reason of ['retention boundary','failed approach','focus changed','external claim','confirmed death']){
  const m=members();m[0].status.groupedCombat.retentions[0].reason=reason;
  assert.equal(retainNominations([target],m,1000).length,0);
 }
 const m=members();m[0].status.groupedCombat.retentions[0].eligible=true;
 assert.equal(retainNominations([target],m,1000).length,1);
 m[1].status.groupedCombat.retentionPaused=true;assert.equal(retainNominations([target],m,1000).length,0);
});
