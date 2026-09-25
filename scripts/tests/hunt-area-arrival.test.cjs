const test=require('node:test'),assert=require('node:assert/strict');
const {stepHuntArrival}=require('../../runtime/coordinator/navigation/hunt-arrival.ts');
const {sharedCommand}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const {reconcileQueue}=require('../../runtime/combat/queue.ts');
function fixture(stage='mission-travel') {
 const names=['W','P','M'], now=10000, area={map:'spookytown',x:677,y:129,boundary:[501,61,852,197]};
 const h={cycleId:'H',stage,target:'stoneworm',currentIndex:0,missionRevision:2,missions:[{target:'stoneworm',destination:area}],participants:names,convoyId:'C'};
 const c={id:'C',epoch:5,phase:'travel',routeProtocol:4,purpose:'monster-hunt',huntTarget:'stoneworm',participants:names,leader:'W',location:area,rally:{map:area.map,x:0,y:0},completed:[],expected:{},runtimes:{}};
 const s={monsterHunt:h,activeConvoy:c,commands:{},statuses:{},navigationIntents:{},nextCommandId:10};
 for(const n of names){s.navigationIntents[n]={revision:1};s.statuses[n]={name:n,map:area.map,in:area.map,server:'USII',x:510,y:70,hp:100,seenAt:now,moving:true,convoyProtocol:4,combatSelection:{runtimeId:n},groupedCombat:{currentAttackersAt:now,currentAttackers:[]}};c.runtimes[n]=n;s.commands[n]=sharedCommand(s,c,'shared-travel',n);}
 const step=()=>stepHuntArrival(s,c,now,sharedCommand);
 function ack(){for(const n of names){const cmd=s.commands[n];s.statuses[n].moving=false;s.statuses[n].convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:1,runtimeId:n,phase:'held'};}}
 return {s,c,h,names,now,step,ack};
}
test('spawn edge stops once, requires matching stopped acknowledgements, releases ownership without center rally',()=>{
 const f=fixture();assert.equal(f.step(),true);assert.equal(f.c.phase,'hunt-arrival');assert.equal(f.h.stage,'mission-travel');const epoch=f.c.epoch;
 assert.equal(f.step(),false);assert.equal(f.c.epoch,epoch);f.ack();f.s.statuses.W.convoyNavigation.commandId--;
 assert.equal(f.step(),false);f.ack();assert.equal(f.step(),true);assert.equal(f.s.activeConvoy,null);assert.equal(f.h.stage,'farming');assert.deepEqual(f.s.commands,{});assert.equal(f.s.statuses.W.x,510);
});
for(const [label,change] of Object.entries({outside:f=>f.s.statuses.P.x=499,stale:f=>f.s.statuses.P.seenAt=1,transporting:f=>f.s.statuses.P.transporting=true,instance:f=>f.s.statuses.P.in='other',server:f=>f.s.statuses.P.server='EUI',event:f=>f.s.statuses.P.activeEvent='franky',escape:f=>f.s.escape={stage:'walking'},replacement:f=>f.s.commands.P.convoyId='other'}))test(label+' cannot hand off',()=>{const f=fixture();change(f);assert.equal(f.step(),null);assert.equal(f.s.activeConvoy,f.c);});
test('persisted farming convoy is stopped and released using the same barrier',()=>{const f=fixture('farming');f.step();f.ack();f.step();assert.equal(f.s.activeConvoy,null);});
test('existing loot is retained until its original barrier completes',()=>{const f=fixture();const loot=f.c.loot={id:'drop',complete:false};assert.equal(f.step(),null);assert.equal(f.c.loot,loot);loot.complete=true;assert.equal(f.step(),true);});
test('new runtime must acknowledge a newly issued hold',()=>{const f=fixture();f.step();f.ack();f.s.statuses.P.combatSelection.runtimeId='P2';const epoch=f.c.epoch;assert.equal(f.step(),true);assert.equal(f.c.epoch,epoch+1);assert.equal(f.step(),false);});
test('handoff preserves evidence and normal queue prioritizes existing fight before two nominations',()=>{
 const f=fixture();const target=id=>({id,mtype:'stoneworm',map:'spookytown',in:'spookytown',server:'USII',x:520,y:80});
 const members=f.names.map(name=>({name,ctype:'warrior',revision:1,status:f.s.statuses[name]}));
 for(const m of members)m.status.groupedCombat={epoch:0,currentAttackersAt:f.now,currentAttackers:[{...target('a'),target:'W'}],threats:[target('a')],sightings:[target('a')],candidates:['b','c'].map(target),evidence:[{...target('a'),at:f.now,action:'attack-a',state:'pending'}]};
 f.step();f.ack();f.step();const q=reconcileQueue(null,members,'W',f.now,'key',0,false,'stoneworm');
 assert.deepEqual(q.queue.map(t=>t.id),['a','b','c']);assert.equal(q.target.id,'a');assert.deepEqual(q.queue.map(t=>t.state),['engaged','planned','planned']);assert.equal(q.evidence.length,1);
});
const fs=require('node:fs'),vm=require('node:vm');
const {namedFunction}=require('./helpers/named-function.cjs');
test('three visible nominations authorize only the current target; incidental aggro blocks the next pull',()=>{
 const a={id:'a'},b={id:'b'},c={id:'c'}, group={protocol:4,committed:true,target:{id:'a',map:'spookytown',in:'spookytown',server:'USII',state:'planned'}};
 const context={root:{},groupedCombat:group,character:{map:'spookytown',in:'spookytown'},parent:{entities:{}},travelCombatActive:()=>false,groupedFarming:()=>true,groupedFresh:()=>true,reunionRealm:()=> 'USII',isAttackingPartyMember:e=>e.target==='W'};
 vm.createContext(context);vm.runInContext(namedFunction(fs.readFileSync('characters/shared.js','utf8'),'groupedAttackAllowed'),context);
 assert.equal(context.groupedAttackAllowed(a),true);assert.equal(context.groupedAttackAllowed(b),false);assert.equal(context.groupedAttackAllowed(c),false);
 context.parent.entities.extra={id:'extra',type:'monster',visible:true,target:'W'};
 assert.equal(context.groupedAttackAllowed(a),false);
 group.target.state='engaged';assert.equal(context.groupedAttackAllowed(a),true);assert.equal(context.groupedAttackAllowed(b),false);
 delete context.parent.entities.extra;group.target={...group.target,id:'b',state:'planned'};
 assert.equal(context.groupedAttackAllowed(b),true);assert.equal(context.groupedAttackAllowed(c),false);
});
test('late pre-release local reports cannot reinstate travel restrictions after farming handoff',()=>{
 const {travelCombatFor}=require('../../runtime/coordinator/navigation/travel-defense.ts');
 const f=fixture();f.step();f.ack();const cmd={id:f.s.commands.W.id,revision:1};f.step();
 f.s.statuses.W.seenAt=Date.now();f.s.statuses.W.groupedCombat.currentAttackersAt=Date.now();f.s.statuses.W.groupedCombat.travelCommand=cmd;
 assert.equal(travelCombatFor(f.s,'W'),null);
 f.s.statuses.W.groupedCombat.travelCommand={id:cmd.id+100,revision:1};
 assert.ok(travelCombatFor(f.s,'W'),'new movement retains its own restrictions');
});
