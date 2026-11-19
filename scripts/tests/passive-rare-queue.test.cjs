const test=require('node:test'),assert=require('node:assert/strict');
const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
require('./fixtures/coordinator-core.cjs');
test('client reports enabled out-of-area rares from followers but excludes disabled, dead and claimed monsters',()=>{
 const entities={};for(const mtype of ['phoenix','tinyp','goldenbat','cutebee','hen','rooster','boar'])entities[mtype]={id:mtype,mtype,type:'monster',visible:true,x:20,y:0,hp:100};
 const hunts={phoenix:true,tinyp:true,goldenbat:false,cutebee:true,hen:true,rooster:true};
 const c=require('./helpers/rare-client.cjs').rareQueueContext({entities,character:{name:'M'},focus:['boar'],hunts,
  values:{isPassingEncounter:()=>false,passiveHunting:{rules:{}},monsterPriorities:{},groupedEntityReport:e=>({...e,map:'main',in:'main'}),isExternallyClaimedMonster:e=>e.claimed}});
 assert.deepEqual(Array.from(c.queueCandidates(),t=>[t.id,t.priority]),[['phoenix',100],['tinyp',101],['cutebee',100],['hen',100],['rooster',100]]);
 entities.phoenix.claimed=true;entities.cutebee.dead=true;entities.hen.dead=true;entities.rooster.claimed=true;assert.deepEqual(Array.from(c.queueCandidates(),t=>t.id),['tinyp']);
 hunts.tinyp=false;assert.equal(c.queueCandidates().length,0);
});
test('actual coordinator snapshot retains a rare-owned queue and all clients derive its targeting rings',()=>{
 // The coordinator's snapshot as the one group composition builds it for the party (application.ts
 // `composeCombatGroup`): no member is at an event (the events owner's `event.presence`), no
 // Follows me task and no user hold holds this party.
 const rare={id:'R',mtype:'phoenix',map:'main',in:'main',x:20,y:0,priority:100,passiveRare:true};
 const party={leader:'W',partyFarmingMode:'default',headlessSlots:['W','P','M'],steamMembers:[],followers:{P:true,M:true},statuses:{},combatLogs:{}};
 for(const name of ['W','P','M'])party.statuses[name]={name,ctype:name==='P'?'priest':'warrior',seenAt:1000,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,range:200,
  combatSelection:{runtimeId:name},groupedCombat:{protocol:4,anchorVisible:true,candidates:name==='M'?[rare]:[]}};
 require('../../runtime/events/api.ts').publishEventAnswers({presence:()=>null});
 const {coordinatorGroupedSnapshot}=require('../../runtime/coordinator/targeting/snapshot.ts');
 const snapshot=()=>coordinatorGroupedSnapshot(party,{now:()=>1000,passing:()=>false,recoveryGroup:()=>null,
  intent:()=>({revision:1}),owned:()=>null,prepare:m=>m,evaluate:evaluateGroup,pullsHeld:()=>false,patrolAcquisitionAllowed:()=>false,rareRejections:()=>[]});
 const group=snapshot();assert.equal(group.target.id,'R');assert.equal(group.queue.length,1);
 const client=require('./helpers/shared-context.cjs').createSharedContext({groupedCombat:group,navigationIntent:{},character:{map:'main',in:'main'},reunionRealm:()=> 'USII',get_entity:()=>({...rare,visible:true})},
  {hunting:{farm:{grouped:()=>true}}});
 require('./helpers/queue-markers.cjs').installQueueMarkers(client);assert.equal(client.queueMarkers()[0].visible,true);
});

test('claim reports preserve cooperative bosses and are completely disabled during events',()=>{
 const entities={};for(const mtype of ['franky','icegolem','crabxx','phoenix','boar'])entities[mtype]={id:mtype,mtype,type:'monster',visible:true,x:0,y:0,hp:100,target:'Stranger'};
 let grouped=true;
 const c=require('./helpers/client-dependencies.cjs').passingContext({parent:{entities},character:{map:'main',in:'main'},Date:{now:()=>1000},coordinatorClockOffset:0,
  groupedCombat:{queue:Object.keys(entities).map(id=>({id,map:'main',in:'main',server:'USII'}))},reunionRealm:()=> 'USII',get_entity:id=>entities[id],
  G:{monsters:Object.fromEntries(['franky','icegolem','crabxx','phoenix'].map(id=>[id,{cooperative:true}]))},eventTargetTypes:[]},
  {hunting:{farm:{grouped:()=>grouped}},tasks:{partyList:()=>['W','M','P']}});
 assert.deepEqual(Array.from(c.queueClaims(),t=>[t.id,t.external]),[['franky',false],['icegolem',false],['crabxx',false],['phoenix',true],['boar',true]]);
 grouped=false;assert.equal(c.queueClaims().length,0);
});

test('rare retry expiry allows fresh nominations while rejecting delayed abandoned attack evidence',()=>{
 const {reconcileQueue}=require('../../runtime/coordinator/targeting/queue.ts');
 const rare={id:'R',mtype:'goldenbat',map:'main',in:'main',x:20,y:0,server:'USII',priority:100,passiveRare:true};
 const party={leader:'W',statuses:{W:{server:'USII'}},groupedCombat:{queue:[],fights:[],evidence:[]}};
 // The rejection the hunting owner's rare service holds after releasing the rare until 4000 (rares.ts `release`),
 // which the queue reads through the snapshot's `rareRejections` port.
 const rejections=[{...rare,server:'USII',until:4000,rejectedAt:1000,expiresAt:Number.MAX_SAFE_INTEGER}];
 const member={name:'W',ctype:'warrior',status:{seenAt:3999,server:'USII',map:'main',in:'main',x:0,y:0,hp:100,groupedCombat:{protocol:4,candidates:[rare],evidence:[]}}};
 let result=reconcileQueue(party.groupedCombat,[member],'W',3999,'test',0,false,null,rejections);
 assert.equal(result.target,null);
 member.status.seenAt=4001;
 member.status.groupedCombat.evidence=[{...rare,at:4001,startedAt:999,action:'old',state:'engaged'}];
 result=reconcileQueue({...party.groupedCombat,...result},[member],'W',4001,'test',0,false,null,rejections);
 assert.equal(result.target.id,'R');assert.equal(result.target.state,'planned');assert.equal(result.fights.length,0);
 member.status.groupedCombat.evidence.push({...rare,at:4002,startedAt:4002,action:'new',state:'engaged'});
 member.status.seenAt=4002;result=reconcileQueue({...party.groupedCombat,...result},[member],'W',4002,'test',0,false,null,rejections);
 assert.equal(result.target.state,'engaged');assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].action,'new');
});
