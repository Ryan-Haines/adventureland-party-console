const assert=require('node:assert/strict');
const {acceptTravelReport}=require('../../runtime/movement/coordinator/routes.ts');
const {createCombatIntake,preserveNewerCombat}=require('../../runtime/status/coordinator/channel.ts');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {sample}=require('./fixtures/convoy-timing-scenario.cjs');
scenarioTable('convoy reports keep their order and only fresh connected samples clear travel (MOV-163, MOV-130)', ()=>undefined, [
 ['reordered full report cannot replace fast movement fields or renew freshness', ()=>{
 const first=sample('L',1,1000),fast=sample('L',2,1100,-2000);
 first.convoyNavigation={phase:'route-ready'};first.x=0;
 fast.x=100;fast.moving=true;fast.convoyNavigation={phase:'travelling',departedAt:1090};
 const statuses={L:acceptTravelReport(first,undefined,1000)};
 const ingestion=createCombatIntake(statuses,{now:()=>1100,groupedCombat(){},rareTick(){},reply:{read:()=>({}),send:()=>({})}});
 ingestion.handle('L',fast,{json:x=>x});
 const late=preserveNewerCombat({...first,items:['new inventory'],seenAt:1200},statuses.L,1200);
 assert.equal(late.x,100);assert.equal(late.moving,true);assert.equal(late.convoyNavigation.phase,'travelling');
 assert.equal(late.seenAt,1100);assert.equal(late.groupedCombat.currentAttackersAt,1100);assert.deepEqual(late.items,['new inventory']);
 assert.equal(acceptTravelReport(fast,late,9000).seenAt,1100);
 const replacement=sample('replacement',1,10000);replacement.name='L';
 assert.equal(acceptTravelReport(replacement,late,10000).travelSample.sequence,1);
 }],
]);

const test=require('node:test');
test('disconnected sampler cannot claim a clear observation even when HTTP is fresh',()=>{
 require('./helpers/requesters.cjs').publishPresence();
 const {classifyTravelDefense}=require('../../runtime/movement/coordinator/defense.ts');
 const p={statuses:{L:acceptTravelReport(sample('L',1,2000),undefined,2000)}};
 const raw=sample('F',2,2000);raw.travelSample.connected=false;
 p.statuses.F=acceptTravelReport(raw,undefined,2000);
 assert.equal(classifyTravelDefense(p,['L','F'],2000).state,'waiting-for-observations');
});
test('fast responses retain lease ownership while renewal alone leaves combat revision unchanged',()=>{
 const {createCombatChannel}=require('../../runtime/status/coordinator/channel.ts');
 let now=1000;const read=()=>({serverNow:now,convoySignal:{id:'c',epoch:1,phase:'travel',
  commandId:7,runtimeId:'L',navigationRevision:2,routeVersion:4,validUntil:now+3000}});
 const channel=createCombatChannel({read,send:read});
 const first=channel.snapshot('L');now=2000;const next=channel.snapshot('L');
 assert.equal(next.convoySignal.commandId,7);assert.equal(next.convoySignal.validUntil,5000);
 assert.equal(first.combatRevision,next.combatRevision);
});
test('a parked combat poll stays parked through its own combat report and answers at the next report or at a change',()=>{
 const {createCombatChannel}=require('../../runtime/status/coordinator/channel.ts');
 let queue='q1';const read=()=>({serverNow:1,groupedCombat:{queueRevision:queue}});
 const channel=createCombatChannel({read,send:read});
 const answers=[],res=()=>({json:x=>answers.push(x)});
 channel.wait('W',channel.snapshot('W').combatRevision,res());
 queue='q2';channel.flush('W',true);
 assert.equal(answers.length,0,'the report reply carries q2, so the poll takes it and stays parked');
 channel.flush('P');
 assert.equal(answers.length,0,'another report with no change leaves it parked');
 channel.flush('W',true);
 assert.equal(answers.length,1,'the next own combat report answers it');
 channel.wait('W',channel.snapshot('W').combatRevision,res());
 queue='q3';channel.flush('P');
 assert.equal(answers.length,2,'a change from another report answers at once');assert.equal(answers[1].groupedCombat.queueRevision,'q3');
 channel.wait('W',channel.snapshot('W').combatRevision,res());
 channel.flush('W');
 assert.equal(answers.length,3,'its own full report answers it, since that reply carries no combat revision');
});
test('genuine report loss stops once and resumes at the stopped leader without old rally or fake loot',()=>{
 const {fixture}=require('./fixtures/convoy-communication-scenario.cjs');
 const f=fixture(),p=f.p;
 p.activeConvoy.rally={map:'main',x:100,y:0};f.report(1000,'travelling');
 f.step(4500);const epoch=p.activeConvoy.epoch,id=p.commands.L.id;
 assert.equal(p.activeConvoy.phase,'communication-hold');assert.equal(p.commands.L.phase,'shared-hold');
 f.step(5000);assert.equal(p.commands.L.id,id);assert.equal(p.activeConvoy.epoch,epoch);
 for(let at=6000;at<=11000;at+=1000){f.report(at);f.step(at);}
 assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(p.activeConvoy.rally.x,0,'the rally is where the leader stopped, not its old 100');
 assert.equal(p.commands.L.phase,'shared-prepare');assert.equal(p.activeConvoy.loot,undefined);
 assert.ok(!(p.combatLogs.L||[]).some(x=>/defensive kill|encounter complete/.test(x.message)));
});
test('transporting reports cannot release a communication hold',()=>{
 const {fixture}=require('./fixtures/convoy-communication-scenario.cjs');
 const f=fixture(),p=f.p;f.step(4500);
 for(let at=6000;at<=12000;at+=1000){f.report(at);p.statuses.L.transporting=true;f.step(at);}
 assert.equal(p.activeConvoy.phase,'communication-hold');
 p.statuses.L.transporting=false;
 for(let at=13000;at<=18000;at+=1000){f.report(at);f.step(at);}
 assert.equal(p.activeConvoy.phase,'shared-prepare');
});
