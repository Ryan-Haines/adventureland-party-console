const test=require('node:test'),assert=require('node:assert/strict');
const {createRegistry}=require('../../runtime/hooks/registry.ts');
const {coordinatorTargetingRegistration}=require('../../runtime/coordinator/targeting/install.ts');
const {passingAllows}=require('../../runtime/characters/targeting/passing.ts');

// One column of the rank table decides which travel a passive stop may interrupt, keyed
// by the walk's tier.: the column is targeting's (passing-rules.ts), answered on the coordinator as
// `targeting.passing` by `core:targeting`. The column reads the walk and the encounter's cause, so
// no walk flag decides outside it. A passive rule set to "stop" is answered by the tier alone, so it
// stops the walk to Daisy and backup travel as it stops the other Hunt and farming walks. A rare
// reads the Hunt target as well: it cancels a Hunt walk with no target, and the Hunt restarts it
// (rare-hunting.ts `retainTravelConvoy`). The rows run with the coordinator registration installed,
// and the ask fails with none, since a missing answer would change the rare and travel-defense
// interrupts.
const walk=(purpose,tier,extra={})=>({purpose,requester:{kind:'group-walk',tier},...extra});
// [walk, passive answer, rare answer, why]
const rows=[
 [walk('farm-relocation','farming'),true,true],
 [walk('party-travel','manual'),false,false,'a trip started by hand finishes'],
 [walk('party-force-travel','manual',{force:true}),false,false,'a forced walk is a trip started by hand'],
 [walk('shared-walk','event-attendance'),false,false],
 [walk('monster-hunt','hunt-mission',{huntTarget:'bee'}),true,true],
 [walk('monster-hunt','hunt-mission'),true,false,'the walk to Daisy (daisy-sync-travel): a passive stop stops it, a rare cancels it'],
 [walk('monster-hunt','hunt-turn-in',{nonPreemptible:true,continuousReturn:1}),false,false,'the turn-in walk finishes'],
 [walk('rare-hunt','rare'),false,false],
 [walk('shared-walk-return','event-return',{navigationExempt:true}),false,false],
 [walk('monster-hunt','farming'),true,false,'backup travel: a passive stop stops it, a rare cancels it'],
 [{purpose:'farm-relocation'},false,false,'a walk saved before walks named their tier is not interrupted'],
];
test('ranked interruptions read the rank table column by tier and cause',()=>{
 const r=createRegistry();assert.deepEqual(r.register(coordinatorTargetingRegistration),{ok:true});
 // The character side reads the same column through targeting's install port (shared.js's
 // passing encounter), with the same answers.
 for(const [c,passive,rare,why] of rows)for(const [cause,expected] of [['passive',passive],['rare',rare]]){
  assert.equal(r.targeting.passing(c,cause),expected,cause+': '+(why||c.purpose));assert.equal(passingAllows(c,cause),expected,cause+': '+(why||c.purpose));
 }
 assert.throws(()=>createRegistry().targeting.passing(walk('farm-relocation','farming'),'passive'),/targeting.passing has no answer/);
});

// On the coordinator, huntSwitchAllows, targeting's one copy, is the rule reconcileStops asks before a passive stop
// stops a walk. A Hunt mission walk keeps going past a rare whose "May interrupt Hunt" switch is off; the switch on, or a rule
// with no switch, lets the stop through, and any other tier never reads the switch.
test('a Hunt mission walk keeps going past a passive rule that may not interrupt the Hunt (A31)',()=>{
 const {huntSwitchAllows}=require('../../runtime/characters/targeting/api.ts');
 const hunt=walk('monster-hunt','hunt-mission',{huntTarget:'bee'}),farm=walk('farm-relocation','farming');
 const settings=interruptsHunt=>({rules:{phoenix:{enabled:true,interruptsHunt}}});
 assert.equal(huntSwitchAllows(hunt,settings(false),'phoenix'),false,'red: the switch off still stops the Hunt walk');
 assert.equal(huntSwitchAllows(hunt,settings(true),'phoenix'),true);
 assert.equal(huntSwitchAllows(hunt,{rules:{}},'phoenix'),true,'a rule with no switch stops it');
 assert.equal(huntSwitchAllows(farm,settings(false),'phoenix'),true,'a farming walk never reads the switch');
});

// (pm-04 answer A): a rare 07 rejected still stops Hunt travel as any passing monster does, as the
// earlier console's walk did, since nothing there wrote huntTravel.rejected. The extra argument is
// the rejection read the walk took before (red: the walk dropped the rare as a stop). Targeting
// holds updateHuntTravel and movement asks it through targeting's coordinator door.
test('a rare 07 rejected still stops Hunt travel as a passive stop',()=>{
 const {updateHuntTravel}=require('../../runtime/coordinator/targeting/api.ts');
 const rare={id:'r1',mtype:'snowman',map:'main',in:'main',hp:100,x:10,y:0};
 const member=name=>({name,ctype:'',revision:0,status:{name,seenAt:1000,map:'main',in:'main',server:'USII',x:0,y:0,hp:100,
  groupedCombat:{currentAttackersAt:1000,currentAttackers:[],travelCandidates:[rare],deaths:[]}}});
 const c={id:'w',epoch:1,phase:'travel',purpose:'monster-hunt',participants:['A','B'],requester:{kind:'group-walk',tier:'hunt-mission'}};
 const settings={rules:{snowman:{enabled:true,keepMoving:false,interruptsHunt:true,priority:1}}};
 const control=updateHuntTravel(c,[member('A'),member('B')],1000,undefined,settings,()=>true,()=>true);
 assert.deepEqual(control?.committed?.map(t=>t.id),['r1']);
});

// Rows the tightening record kept as rows of "Hunt travel admits one passing proposal" and the
// audit marked needed cut them with no removal line. A Hunt mission walk two members take
// through the tunnel, with survival's walk verdict (defense.ts walkOn) answering fight.
function huntWalk(){
 require('./fixtures/coordinator-core.cjs');
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 partyHooks().publish({name:'core:test-verdict',folder:'core',author:'test',summary:"05's walk verdict: the party wins the fight.",hooks:{'survival.verdict':()=>'fight'}});
 const now=10000,members=['W','P'].map(name=>({name,ctype:'warrior',revision:1,status:{seenAt:now,hp:100,map:'tunnel',in:'tunnel',server:'USII',x:0,y:0,combatSelection:{runtimeId:name},
  groupedCombat:{currentAttackersAt:now,currentAttackers:[],passingEncounters:[],sightings:[],observationAt:now}}}));
 const c={id:'C',epoch:1,purpose:'monster-hunt',huntTarget:'mole',phase:'travel',participants:['W','P'],leader:'W',completed:[],location:{map:'tunnel',x:14,y:-1072},
  requester:{kind:'group-walk',tier:'hunt-mission'}};
 const party={activeConvoy:c,statuses:Object.fromEntries(members.map(m=>[m.name,m.status])),commands:{W:{type:'party-monster-travel',convoyId:'C'},P:{type:'party-monster-travel',convoyId:'C'}}};
 require('./helpers/requesters.cjs').publishPresence(()=>party.statuses);
 const {updateHuntTravel}=require('../../runtime/coordinator/targeting/api.ts');
 const control=(at=now)=>updateHuntTravel(c,members,at,'C:1',party.passiveHunting,walk=>partyHooks().targeting.passing(walk,'passive'));
 const monster=(id,target=null)=>({id,mtype:'mole',type:'monster',visible:true,hp:100,x:20,y:0,map:'tunnel',in:'tunnel',server:'USII',target});
 const fresh=at=>members.forEach(m=>{m.status.seenAt=at;m.status.groupedCombat.observationAt=at;m.status.groupedCombat.currentAttackersAt=at;});
 return {now,members,c,party,control,monster,fresh,defense:require('../../runtime/movement/coordinator/defense.ts'),
  issue:(_p,walk,phase,name)=>({type:'party-monster-travel',convoyId:walk.id,phase,name})};
}
const {scenarioTable}=require('./fixtures/scenarios.cjs');
scenarioTable('Hunt travel walks on past one attacker and defends from a second', huntWalk, [
 ['natural attacker wins the primary; one travels, extra aggro defends', ({now,members,party,control,monster,defense})=>{
  members[1].status.groupedCombat.currentAttackers=[monster('first','P')];
  assert.equal(control().primary.id,'first');
  assert.equal(defense.classifyTravelDefense(party,['W','P'],now).state,'clear');
  members[0].status.groupedCombat.currentAttackers=[monster('first','P'),{...monster('second','W'),mtype:'goo'}];
  assert.equal(defense.classifyTravelDefense(party,['W','P'],now).state,'defending');
 }],
 ['a second attacker interrupts while the primary travels with the walk', ({now,members,party,control,monster,defense})=>{
  members[1].status.groupedCombat.currentAttackers=[monster('first','P')];control();
  members[1].status.groupedCombat.currentAttackers=[monster('first','P'),monster('second','P')];
  assert.equal(defense.classifyTravelDefense(party,['W','P'],now).state,'defending');
 }],
 // defense.ts `resume`: a walk past the barrier holds in shared-hold under the same
 // epoch, where v1.5.0 reassembled under a new one.
 ['defense stays latched for one survivor and resumes the same destination after loot', ({now,members,c,party,monster,fresh,defense,issue})=>{
  const destination=c.location;
  members[0].status.groupedCombat.currentAttackers=[monster('a','W'),monster('b','P')];
  defense.step(party,now,issue);assert.equal(c.phase,'defending');
  members[0].status.groupedCombat.currentAttackers=[monster('b','P')];party.groupedCombat={deaths:[{...monster('a'),at:now}]};
  defense.step(party,now,issue);assert.equal(c.phase,'defending','one survivor keeps the defense');
  members[0].status.groupedCombat.currentAttackers=[];party.groupedCombat.deaths.push({...monster('b'),at:now});
  defense.step(party,now,issue);assert.equal(c.phase,'defending');assert.ok(c.loot);
  members[0].status.convoyLoot={...c.loot,complete:true,observedAt:now+1};fresh(now+1);
  defense.step(party,now+1,issue);assert.equal(c.phase,'shared-hold');assert.equal(c.location,destination);assert.equal(c.epoch,1);
 }],
 ['fresh bounded absence retires the primary', ({now,members,c,control,monster,fresh})=>{
  members[1].status.groupedCombat.currentAttackers=[monster('a','P')];control();
  members[1].status.groupedCombat.currentAttackers=[];
  for(const at of [now+1,now+1001,now+9001]){fresh(at);control(at);}
  assert.equal(c.huntTravel.primary,null);
 }],
]);
