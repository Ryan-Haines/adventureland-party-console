const test=require('node:test'),assert=require('node:assert/strict');
const {engageFarming}=require('../../runtime/coordinator/navigation/farming-engagement.ts');
const {sharedCommand}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {step}=require('../../runtime/coordinator/navigation/convoy-defense.ts');
const {travelCombatFor}=require('../../runtime/coordinator/navigation/travel-defense.ts');
const legacy=require('../convoy-navigation.cjs');
function fixture(){
 const c={id:'C',epoch:1,phase:'travel',departAt:1000,purpose:null,combatHandoffAllowed:true,routeProtocol:4,
  leader:'W',participants:['W','P'],completed:[],location:{map:'cave',x:900,y:0},rally:{map:'main',x:0,y:0},runtimes:{W:'w',P:'p'}};
 const p={activeConvoy:c,nextCommandId:10,commands:{},navigationIntents:{W:{revision:1},P:{revision:1}},statuses:{},groupedCombat:{deaths:[]}};
 for(const n of c.participants){p.commands[n]=sharedCommand(p,c,'prepare',n);p.statuses[n]={hp:100,seenAt:2000,map:'main',in:'main',server:'USII',x:0,y:0,groupedCombat:{currentAttackersAt:2000,currentAttackers:[]}};}
 const body={character:'W',convoyId:'C',epoch:1,commandId:p.commands.W.id,runtimeId:'w',navigationRevision:1,target:{id:'B',mtype:'goo',map:'main',in:'main',x:80,y:0}};
 const options={revisions:{W:1,P:1},focus:['goo'],radius:100};
 return {p,c,body,options};
}
test('early farming handoff preserves destination, authorizes neutral combat and resumes after death and loot',()=>{
 const {p,c,body,options}=fixture();const destination={...c.location};
 assert.ok(travelCombatFor(p,'W'));
 assert.equal(engageFarming(p,body,options,legacy,sharedCommand,2000),true);
 assert.equal(travelCombatFor(p,'W'),null);assert.equal(p.commands.P.phase,'defending');
 assert.equal(step(p,2100,sharedCommand),true);assert.equal(c.phase,'defending','neutral monster must not release pause');
 assert.deepEqual(c.location,destination);
 p.groupedCombat.deaths=[{...body.target,server:'USII'}];step(p,2200,sharedCommand);
 assert.equal(c.phase,'defending','loot barrier remains');
 assert.ok(c.loot);p.statuses.W.convoyLoot={...c.loot,observedAt:2300,complete:true};
 step(p,2300,sharedCommand);
 assert.equal(c.phase,'assemble');assert.equal(c.farmingEngagement,undefined);assert.deepEqual(c.location,destination);
 assert.equal(p.commands.W.navigationRevision,1);assert.ok(travelCombatFor(p,'W'));
 assert.equal(engageFarming(p,body,options,legacy,sharedCommand,2400),false,'old handoff cannot cancel resumed route');
});

test('monster picker convoy authorizes wild boar combat while still travelling',()=>{
 const {p,c,body,options}=fixture();c.purpose='manual-monster-override';
 body.target.mtype='boar';options.focus=['boar'];
 assert.equal(engageFarming(p,body,options,legacy,sharedCommand,2000),true);
 assert.equal(c.phase,'defending');assert.equal(c.farmingEngagement.target.id,body.target.id);
 assert.equal(travelCombatFor(p,'W'),null);
});
test('handoff rejects stale commands, revisions, runtime, remote targets, wrong focus and protected routes',()=>{
 for(const change of [r=>r.body.commandId++,r=>r.body.navigationRevision++,r=>r.body.runtimeId='old',
  r=>r.p.navigationIntents.P.cancelled=true,r=>r.p.navigationIntents.P.revision++,r=>r.body.target.x=101,
  r=>r.body.target.in='other',r=>r.body.target.mtype='bat',r=>r.c.force=true,r=>r.c.purpose='event-return']){
  const r=fixture();change(r);assert.equal(engageFarming(r.p,r.body,r.options,legacy,sharedCommand,2000),false);
  assert.equal(r.c.phase,'travel');
 }
});

for (const phase of ['shared-prepare','scheduled','travel']) test('nearby farming targets can engage during '+phase,()=>{
 const {p,c,body,options}=fixture();c.phase=phase;c.departAt=phase==='travel'?1000:null;
 assert.equal(engageFarming(p,body,options,legacy,sharedCommand,2000),true);
 assert.equal(c.phase,'defending');assert.equal(travelCombatFor(p,'W'),null);
});

test('engaging inside the selected farming area releases travel for the whole party',()=>{
 const {p,c,body,options}=fixture();
 c.location={map:'main',x:80,y:0,boundary:[-100,-100,200,100]};
 assert.equal(engageFarming(p,body,options,legacy,sharedCommand,2000),true);
 assert.equal(p.activeConvoy,null);
 assert.deepEqual(p.commands,{});
 assert.equal(travelCombatFor(p,'W'),null);assert.equal(travelCombatFor(p,'P'),null);
 assert.equal(step(p,2300,sharedCommand),false,'no route can reassemble after this kill');
});

test('a member outside the destination keeps the early encounter temporary',()=>{
 const {p,c,body,options}=fixture();
 c.location={map:'main',x:80,y:0,boundary:[-100,-100,200,100]};p.statuses.P.x=-500;
 assert.equal(engageFarming(p,body,options,legacy,sharedCommand,2000),true);
 assert.equal(p.activeConvoy,c);assert.equal(c.phase,'defending');
});
