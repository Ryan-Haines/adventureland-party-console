const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {observeReturnTown}=require('../../runtime/coordinator/navigation/return-town.ts');
const {createSharedConvoyNavigation,sharedCommand}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {namedFunction}=require('./helpers/named-function.cjs');
const legacy=require('../convoy-navigation.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
function party(activity){
 const c={id:'home',epoch:1,routeVersion:1,routeProtocol:4,continuousReturn:1,phase:'shared-prepare',purpose:activity?'shared-walk':'monster-hunt',walkingActivity:activity,leader:'L',participants:['L','F'],completed:[],location:{map:'main',x:0,y:0},rally:{map:'spookytown',x:415,y:-702},slowestSpeed:60,runtimes:{L:'L',F:'F'}};
 const p={activeConvoy:c,nextCommandId:1,commands:{},navigationIntents:{},statuses:{},monsterHunt:{stage:'returning'}};
 for(const name of c.participants){p.statuses[name]={name,seenAt:1000,hp:100,map:'spookytown',in:'spookytown',x:415,y:-702,server:'USII',convoyProtocol:4,huntReturnProtocol:2,returnTownReady:true,combatSelection:{runtimeId:name},groupedCombat:{currentAttackersAt:1000,currentAttackers:[]}};const cmd=p.commands[name]=sharedCommand(p,c,c.phase,name);p.statuses[name].convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:0,runtimeId:name,phase:'route-ready'};}
 return p;
}
const boo={id:'boo',mtype:'booboo',map:'spookytown',in:'spookytown',hp:500,target:'F'};
for(const activity of [undefined,'anniversary-staging'])test('booboo return walks while attacked and restores Town when aggro disengages: '+activity,()=>{
 const p=party(activity),c=p.activeConvoy;
 p.statuses.F.groupedCombat.currentAttackers=[boo,{...boo,id:'boo2'}];
 assert.equal(observeReturnTown(p,c,1000),true);assert.equal(c.disableTown,true);
 assert.equal(observeReturnTown(p,c,1000),false,'unchanged aggro never restarts planning');
 p.statuses.F.groupedCombat.currentAttackers=[];
 assert.equal(observeReturnTown(p,c,1000),true);assert.equal(c.disableTown,false);
 assert.equal(c.recoveryAttempts,undefined);
});
test('new map still under aggro stays walking; missing observations never mean clear',()=>{
 const p=party(),c=p.activeConvoy;p.statuses.F.groupedCombat.currentAttackers=[boo];observeReturnTown(p,c,1000);
 for(const s of Object.values(p.statuses)){s.map='main';s.in='main';s.convoyNavigation.transitionMap='main';}
 p.statuses.F.groupedCombat.currentAttackers=[{...boo,map:'main',in:'main'}];observeReturnTown(p,c,1000);assert.equal(c.disableTown,true);
 p.statuses.F.groupedCombat.currentAttackers=[];p.statuses.F.groupedCombat.currentAttackersAt=0;
 observeReturnTown(p,c,10000);assert.equal(c.disableTown,true);
});
test('an in-flight healthy Town cast is not cancelled by its temporary unavailable status',()=>{
 const p=party(),c=p.activeConvoy;
 for(const s of Object.values(p.statuses)){s.returnTownReady=false;s.convoyNavigation.townAttempt={round:'1:1:0',map:'spookytown',state:'casting',destination:{map:'spookytown',x:0,y:0}};}
 assert.equal(observeReturnTown(p,c,1000),false);assert.equal(c.disableTown,false);
});
test('one fresh planning retry then durable hold, without losing the original cause',()=>{
 const p=party(),c=p.activeConvoy,e=createSharedConvoyNavigation(legacy);c.routeServer='USII';
 e.hold(p,'Native planning timed out (30 seconds)','route-failed');assert.equal(c.recoveryAttempts,1);
 c.phase='shared-prepare';e.hold(p,'No walkable door','route-failed');
 assert.equal(c.phase,'failed');assert.equal(c.retryExhausted,true);assert.match(c.failure,/Native planning timed out.*No walkable door/);
 const saved=JSON.parse(JSON.stringify(p));observeReturnTown(saved,saved.activeConvoy,1000);assert.equal(saved.activeConvoy.recoveryAttempts,1);
});
function client(phase){
 const entities={passive:{id:'passive',type:'monster',hp:100,visible:true,target:null},boo:{...boo,type:'monster',visible:true},far:{...boo,id:'far',type:'monster',visible:true}};
 const c=vm.createContext({root:{},character:{name:'L',map:'spookytown',in:'spookytown'},navigationIntent:{revision:0},escapeOwns:()=>false,combatRecoveryActive:()=>false,convoyTraveling:{continuousReturn:1,phase},parent:{entities},isAttackingPartyMember:t=>['L','F'].includes(t.target),is_in_range:t=>t.id==='boo',reunionRealm:()=> 'USII'});
 vm.runInContext(['returnCombatActive','returnAttacker','returnDefenseTarget','cancelReturnTownUnderAttack','queueMarkers'].map(n=>namedFunction(source,n)).join('\n'),c);
 return {c,entities};
}
for(const phase of ['taking-control','preparing-route','travelling','held','failed'])test('attacker selection and markers remain available during '+phase,()=>{
 const {c,entities}=client(phase);assert.equal(c.returnCombatActive(),true);assert.equal(c.returnDefenseTarget().id,'boo');
 assert.deepEqual(Array.from(c.queueMarkers(),t=>[t.id,t.role]),[['boo','current']]);
 entities.boo.target=null;assert.equal(c.returnDefenseTarget().id,'far');entities.far.target=null;
 assert.equal(c.returnDefenseTarget(),null);assert.equal(c.queueMarkers().length,0);
});
test('local aggro cancels an active Town cast immediately, not ordinary walking',()=>{
 const {c}=client('travelling');let failed=0;c.convoyTraveling.fail=()=>failed++;
 c.cancelReturnTownUnderAttack();assert.equal(failed,0);
 c.convoyTraveling.townAttempt={state:'casting'};c.cancelReturnTownUnderAttack();assert.equal(failed,1);assert.equal(c.convoyTraveling.townAttempt.state,'interrupted');
});
