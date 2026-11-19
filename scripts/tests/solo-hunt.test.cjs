const test = require('node:test'), assert = require('node:assert/strict');
const {createInitialCoordinatorState} = require('../../runtime/settings/coordinator/initial.ts');
const {createFarmingScopes: scopesOf, reconcileFarmingMembership, coordinatorHuntParticipants} = require('../../runtime/tasks/coordinator/groups.ts');
const createFarmingScopes = (root, now) => scopesOf(root, require('../../runtime/settings/coordinator/table.ts').coordinatorSettings().lists, now);
const {createHunt} = require('../../runtime/hunting/coordinator/hunt.ts');
const {createCoordinatorPartyConvoys} = require('../../runtime/movement/coordinator/arrivals.ts');
const {clearCoordinatorHunt, completeHuntInteraction} = require('../../runtime/hunting/coordinator/hunt.ts');
const {selection} = require('../../runtime/hunting/coordinator/hunt.ts');
const {priority} = require('../../runtime/tasks/api.ts');
require('./fixtures/coordinator-core.cjs');
const {recordHuntFailure} = require('../../runtime/hunting/coordinator/hunt.ts');
const navigation = require('./helpers/farming-navigation.cjs');
const NOW = 100000, farm = {map:'cave',x:500,y:100}, daisy = {map:'main',x:0,y:0};
function initial(saved={}) {
 return createInitialCoordinatorState({persistedSettings:{leader:'W',followers:{P:true},monsterFocus:['rat'],location:farm,...saved},persistedSelections:{},persistedHistory:{},persistedBankState:{},persistedRoster:{},persistedALData:{},initialHeadless:['W','P','R'],configuredRealm:'II'}, {now:()=>NOW,loadBankVaultDefinitions:()=>[]});
}
// The Hunt's clock; a row that steps past a release moves it.
const clock={now:NOW};
function fixture(saved={}) {
 clock.now=NOW;
 const root=initial(saved);
 root.statuses={};
 for (const name of ['W','P','R','S']) root.statuses[name]={name,seenAt:NOW,server:'II',ctype:name==='W'?'warrior':'rogue',hp:500,map:'main',x:0,y:0,convoyProtocol:4,monsterHunt:{id:name==='R'?'bee':'rat',count:10,remainingMs:900000}};
 require("./helpers/travel-observations.cjs").observeTravel(root.statuses);
 root.monsterHunterLocation=daisy;
 // The Hunt's spawns are the catalog's (hunt.ts `coordinatorHuntDestination`).
 root.monsterChoices=['rat','bee'].map(id=>({id,locations:[farm]}));
 const scopes=createFarmingScopes(root,()=>NOW);
 return {root,scopes};
}
function service(state) {
 const active=()=>Object.keys(state.statuses);
 const participants=()=>coordinatorHuntParticipants(state,()=>NOW,active);
 let convoys;
 const nav=navigation(state,{now:()=>NOW,names:active,activeNames:active,cancelConvoy:()=>convoys.cancel(),startConvoy:(...args)=>convoys.start(...args),persist(){},log(){}});
 convoys=createCoordinatorPartyConvoys(state,{now:()=>NOW,activeNames:active,intent:nav.intent,resolveArea:(_c,_f,l)=>l,persist(){},
  live:()=>({kind:'hunt-mission',tier:'hunt-mission',owner:'hunt'})});
 const hunt=createHunt(state,{now:()=>clock.now,participants,online:()=>true,cancelConvoy:convoys.cancel,persist(){},selectedDestination:()=>({location:farm}),start:convoys.start,navigation:nav,ownsTravel:priority});
 return {...hunt,convoys,nav};
}
// A departing member's walk ends through movement's `walks.end`, which `end` answers as
// movement's endWalk does: the keyed group's convoys cancel the walk.
function follow(root,scopes,name,value,end=key=>(root.endedWalks||=[]).push(key)) {
 const before={leader:root.leader,followers:{...root.followers}};
 root.followers[name]=value;
 reconcileFarmingMembership(root,scopes,before,end,()=>NOW);
}
test('joining an event leader follows its current position without replacing the shared return checkpoint',()=>{
 const {root,scopes}=fixture();root.followers.P=false;
 Object.assign(root.statuses.W,{map:'halloween',x:-298,y:676});
 root.location={map:'halloween',x:-550,y:-290};
 follow(root,scopes,'P',true);
 assert.equal(root.commands.P.type,'return-leader');
 assert.equal(root.characterLocations.P,undefined,'Transient event rendezvous must not become a personal farming checkpoint');
 const nav=service(root).nav;
 assert.deepEqual(nav.capture(['P']).P.location,root.location);
 assert.equal(scopes.owner('P'),'W');
});

test('legacy leader migrates once; personal defaults and blacklists remain independent after restart',()=>{
 const {root,scopes}=fixture({targetMode:'hunt',huntBlacklist:{rat:{monsterId:'rat',at:1,deaths:1}}});
 const solo=scopes.view('R');
 assert.equal(root.targetMode,'hunt'); assert.equal(solo.targetMode,'farming');
 assert.deepEqual(solo.huntBlacklist,{}); assert.equal(scopes.owner('P'),'W');
 solo.targetMode='hunt'; recordHuntFailure(solo,'bee','deaths',1,NOW,null);
 assert.equal(root.huntBlacklist.bee,undefined); assert.equal(solo.huntBlacklist.rat,undefined);
 const restored=initial({farmingProfiles:JSON.parse(JSON.stringify(root.farmingProfiles))});
 const next=createFarmingScopes(restored,()=>NOW+1);
 assert.equal(next.view('R').targetMode,'hunt'); assert.ok(next.view('R').huntBlacklist.bee); assert.ok(restored.huntBlacklist.rat);
});
test('concurrent Hunts select their own quests and clearing solo travel leaves the group running',()=>{
 const {root,scopes}=fixture(); const solo=scopes.view('R');
 root.targetMode=solo.targetMode='hunt';
 const group=service(root), single=service(solo);
 group.begin('auto',farm); single.begin('auto',farm);
 assert.deepEqual(root.monsterHunt.participants,['W','P']); assert.deepEqual(solo.monsterHunt.participants,['R']);
 assert.equal(root.monsterHunt.target,'rat'); assert.equal(solo.monsterHunt.target,'bee');
 assert.notEqual(root.activeConvoy.id,solo.activeConvoy.id);
 assert.deepEqual(root.activeConvoy.participants,['W','P']); assert.deepEqual(solo.activeConvoy.participants,['R']);
 assert.notEqual(root.commands.W.id,root.commands.R.id);
 const route=root.activeConvoy, command=root.commands.W;
 clearCoordinatorHunt(solo,()=>{});
 assert.equal(root.activeConvoy,route); assert.equal(root.commands.W,command); assert.equal(root.commands.R,undefined);
});
test('simultaneous pickups use separate cycle IDs and commands; unrelated quests cannot bypass solo blacklist',()=>{
 const {root,scopes}=fixture(); const solo=scopes.view('R');
 root.statuses.W.monsterHunt=null; root.statuses.P.monsterHunt=null; root.statuses.R.monsterHunt=null; root.targetMode=solo.targetMode='hunt';
 // The checked rewards hold the next pickup until each member reports after the release (hunt.ts `eventsPending`).
 const reportAfterRelease=()=>{clock.now+=1;for(const s of Object.values(root.statuses))s.seenAt=clock.now;};
 const group=service(root), single=service(solo);
 group.begin('auto',farm); single.begin('auto',farm);
 for (const [state,controller] of [[root,group],[solo,single]]) { controller.convoys.cancel(); Object.assign(state.monsterHunt,{stage:'at-daisy',convoyId:null}); controller.tick(); reportAfterRelease(); controller.tick(); }
 assert.equal(root.commands.W.type,'monster-hunt-interact'); assert.equal(root.commands.R.type,'monster-hunt-interact');
 assert.notEqual(root.commands.W.cycleId,root.commands.R.cycleId);
 root.statuses.R.monsterHunt={id:'bee',count:10,remainingMs:900000}; root.statuses.P.monsterHunt={id:'rat',count:10,remainingMs:900000};
 solo.huntBlacklist.bee={monsterId:'bee',at:NOW,deaths:1};
 assert.equal(selection(solo.monsterHunt,'R',root.statuses,solo.huntBlacklist),null);
 root.statuses.R.monsterHunt.count=0;
 assert.equal(selection(solo.monsterHunt,'R',root.statuses,solo.huntBlacklist).action,'claim');
});
test('Hunt -> Follow -> leader Auto -> Follow off restores personal Hunt without an obsolete route',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 root.targetMode=solo.targetMode='hunt';
 const group=service(root), single=service(solo);
 group.begin('auto',farm); single.begin('auto',farm);
 const groupHunt=root.monsterHunt, groupRoute=root.activeConvoy;
 const quest=root.statuses.R.monsterHunt;
 const groups={'party:W':group,'solo:R':single};
 follow(root,scopes,'R',true,key=>groups[key].convoys.cancel("a member left the walk's group",'membership'));
 assert.equal(solo.targetMode,'hunt'); assert.equal(scopes.effective('R').leader,'W');
 assert.equal(root.monsterHunt,groupHunt); assert.equal(root.activeConvoy,groupRoute);
 assert.equal(root.monsterHunt.target,'rat'); assert.ok(root.monsterHunt.participants.includes('R'));
 assert.equal(solo.activeConvoy,null); assert.equal(solo.monsterHunt,null); assert.equal(root.statuses.R.monsterHunt,quest);
 assert.equal(root.commands.R.type,'return-leader');
 root.targetMode='farming';
 assert.equal(scopes.effective('R').targetMode,'farming'); assert.equal(solo.targetMode,'hunt');
 follow(root,scopes,'R',false); single.tick();
 assert.equal(scopes.effective('R'),solo); assert.equal(solo.targetMode,'hunt');
 assert.deepEqual(solo.monsterHunt.participants,['R']); assert.equal(solo.monsterHunt.target,'bee');
 assert.equal(root.monsterHunt.target,'rat');
});
test('Follow off for a non-leader mid-walk keeps the walk for the leader',()=>{
 const {root,scopes}=fixture();
 root.targetMode='hunt';
 const group=service(root); group.begin('auto',farm);
 const id=root.activeConvoy.id;
 assert.deepEqual(root.activeConvoy.participants,['W','P']);
 const {endWalk}=require('../../runtime/movement/coordinator/runtime.ts');
 const lookup=key=>key==='party:W'?{partyConvoys:group.convoys,state:root}:undefined;
 follow(root,scopes,'P',false,(key,member)=>endWalk(lookup,key,'membership',member));
 assert.equal(root.activeConvoy?.id,id);
 assert.deepEqual(root.activeConvoy.participants,['W']);
});
test('second singleton and leader change never merge profiles or retain a previous group convoy',()=>{
 const {root,scopes}=fixture(); const r=scopes.view('R'), s=scopes.view('S');
 r.targetMode='hunt'; s.combatMode='scatter'; r.huntSettings.deathThreshold=3;
 assert.equal(s.huntSettings.deathThreshold,1);
 root.targetMode='hunt'; service(root).begin('auto',farm);
 const before={leader:root.leader,followers:{...root.followers}},ended=[];
 // The old party walk lives in W's scope, W's own after the change, and ends through
 // movement's `walks.end` under W's solo key.
 root.leader='R'; reconcileFarmingMembership(root,scopes,before,key=>{ended.push(key);service(scopes.view(key.slice('solo:'.length))).convoys.cancel("a member left the walk's group",'membership');},()=>NOW);
 assert.deepEqual([...new Set(ended)],['solo:W']);
 assert.equal(root.targetMode,'hunt'); assert.equal(root.huntSettings.deathThreshold,3);
 assert.equal(scopes.owner('P'),'R'); assert.equal(scopes.owner('W'),'W');
 assert.equal(scopes.view('W').activeConvoy,null); assert.equal(s.combatMode,'scatter');
});
test('scope-owned event recovery does not pause the other Hunt',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 root.targetMode=solo.targetMode='hunt';
 const group=service(root), single=service(solo);
 group.begin('auto',farm); single.begin('auto',farm);
 const stage=root.monsterHunt.stage, convoy=root.activeConvoy, convoyId=root.monsterHunt.convoyId;
 solo.eventReturn={cycleId:'solo-event',participants:['R']};
 solo.eventSessions.R={event:'goobrawl'};
 group.tick(); single.tick();
 assert.equal(root.eventReturn,null); assert.equal(root.eventSessions.R,undefined);
 assert.equal(root.monsterHunt.stage,stage,"the solo scope's event return leaves the group Hunt's stage");
 assert.equal(root.activeConvoy,convoy); assert.equal(root.monsterHunt.convoyId,convoyId);
 root.eventReturn={cycleId:'group-event',participants:['W','P']};
 assert.equal(solo.eventReturn.cycleId,'solo-event');
});


test('all-blacklisted fallback contains only the singleton',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 solo.targetMode='hunt'; solo.monsterFocus=['rat']; solo.location=farm;
 solo.huntBlacklist.bee={monsterId:'bee',at:NOW,deaths:1};
 const single=service(solo); single.begin('auto',farm);
 assert.deepEqual(solo.monsterHunt.participants,['R']);
 // The status line sits beside the record (record.ts `huntMessage`).
 assert.match(require('../../runtime/hunting/coordinator/record.ts').huntMessage(solo.monsterHunt),/blacklisted|backup/i);
 assert.equal(root.monsterHunt,null);
});
test('restart invalidates both routes separately and never recovers an old runtime command',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 root.targetMode=solo.targetMode='hunt'; service(root).begin('auto',farm); service(solo).begin('auto',farm);
 const restored=initial({farmingProfiles:JSON.parse(JSON.stringify(root.farmingProfiles))});
 const next=createFarmingScopes(restored,()=>NOW+1000), r=next.view('R');
 assert.equal(restored.activeConvoy.phase,'communication-hold'); assert.equal(r.activeConvoy.phase,'communication-hold');
 assert.equal(r.activeConvoy.restartRecovery,true); assert.notEqual(r.activeConvoy.id,restored.activeConvoy.id);
 assert.deepEqual(restored.commands,{}); assert.deepEqual(r.monsterHunt.participants,['R']);
});
test('a late solo interaction acknowledgement cannot modify the group after Follow is enabled',()=>{
 const {root,scopes}=fixture(), solo=scopes.view('R');
 root.targetMode=solo.targetMode='hunt';
 service(root).begin('auto',farm);
 solo.monsterHunt={cycleId:'old-solo',participants:['R'],stage:'assigning',missions:[],currentIndex:-1,target:null};
 root.commands.R={id:41,type:'monster-hunt-interact',purpose:'monster-hunt',cycleId:'old-solo',action:'assign'};
 const cycle=root.monsterHunt;
 follow(root,scopes,'R',true);
 const response=completeHuntInteraction(root,'R',{commandId:41,cycleId:'old-solo',success:false,error:''});
 assert.equal(response.status,409); assert.equal(root.monsterHunt,cycle); assert.equal(root.monsterHunt.target,'rat');
});
test('a departing selected quest owner cannot leave the group pursuing that character’s quest',()=>{
 const {root,scopes}=fixture(); root.followers.R=true;
 root.monsterHunt={cycleId:'group',owner:'R',selectionLeader:'W',policyVersion:3,participants:['W','P','R'],stage:'returning',turnIn:{owner:'R',phase:'returning'},missions:[{target:'bee',owners:['R']}],currentIndex:0,target:'bee'};
 follow(root,scopes,'R',false);
 assert.deepEqual(root.monsterHunt.participants,['W','P']); assert.equal(root.monsterHunt.turnIn,undefined);
 assert.equal(root.monsterHunt.target,null); assert.equal(root.monsterHunt.stage,'checking-quests');
 assert.equal(selection(root.monsterHunt,'W',root.statuses,{}).owner,'W');
});
