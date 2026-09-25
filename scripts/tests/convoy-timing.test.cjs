const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {acceptTravelReport}=require('../../runtime/coordinator/status/travel-report.ts');
const {createCombatIngestion,preserveNewerCombat}=require('../../runtime/coordinator/status/combat-ingestion.ts');
const {createCombatChannel}=require('../../runtime/coordinator/status/combat-channel.ts');
const {classifyTravelDefense}=require('../../runtime/coordinator/navigation/travel-defense.ts');
const {createSharedConvoyNavigation}=require('../../runtime/coordinator/navigation/shared-navigation.ts');
const defense=require('../../runtime/coordinator/navigation/convoy-defense.ts');
const legacy=require('../convoy-navigation.cjs');
const {namedFunction}=require('./helpers/named-function.cjs');

function sample(name,sequence,at,offset=0){return {name,map:'main',in:'main',server:'USII',x:900,y:0,
 hp:100,max_hp:100,rip:false,moving:false,speed:60,convoyProtocol:4,combatSelection:{runtimeId:name},
 travelSample:{runtimeId:name,sequence,connected:true},
 groupedCombat:{reportedAt:at+offset,currentAttackersAt:at+offset,currentAttackers:[],sightings:[],evidence:[],deaths:[],travelCandidates:[]}};}
function party(){return {leader:'L',commands:{},nextCommandId:10,combatLogs:{},navigationIntents:{L:{revision:2},F:{revision:2}},
 monsterHunt:{convoyId:'c',stage:'mission-travel',participants:['L','F'],missions:[]},
 activeConvoy:{id:'c',epoch:1,routeProtocol:4,phase:'assemble',purpose:'monster-hunt',huntTarget:'minimush',
 leader:'L',participants:['L','F'],completed:[],location:{map:'halloween',x:8,y:631},rally:{map:'main',x:100,y:0},slowestSpeed:60},
 statuses:Object.fromEntries(['L','F'].map(n=>[n,acceptTravelReport(sample(n,1,1000),undefined,1000)]))};}
function report(p,at,phase='held',offset=0){for(const name of ['L','F']){
 const before=p.statuses[name],cmd=p.commands[name],c=p.activeConvoy;
 const raw=sample(name,before.travelSample.sequence+1,at,offset);
 raw.convoyNavigation={id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:cmd.navigationRevision,
   runtimeId:name,routeVersion:c.routeVersion,phase};
 p.statuses[name]=acceptTravelReport(raw,before,at);
}}

for(const offset of [-2000,-600,600,2000])test('clock offset '+offset+' cannot invalidate fresh reports during a long regroup',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy,defense.step);e.step(p,1000);
 for(let at=2000;at<=12000;at+=1000){report(p,at,'rendezvous',offset);e.step(p,at);
  assert.equal(classifyTravelDefense(p,['L','F'],at).state,'clear');assert.equal(p.activeConvoy.phase,'shared-prepare');
  assert.equal(p.activeConvoy.epoch,1);assert.equal(p.activeConvoy.routeVersion,1);}
});

test('reordered full report cannot replace fast movement fields or renew freshness',()=>{
 const first=sample('L',1,1000),fast=sample('L',2,1100,-2000);
 first.convoyNavigation={phase:'route-ready'};first.x=0;
 fast.x=100;fast.moving=true;fast.convoyNavigation={phase:'travelling',departedAt:1090};
 const statuses={L:acceptTravelReport(first,undefined,1000)};
 const ingestion=createCombatIngestion(statuses,{now:()=>1100,groupedCombat(){},response:()=>({})});
 ingestion.handle('L',fast,{json:x=>x});
 const late=preserveNewerCombat({...first,items:['new inventory'],seenAt:1200},statuses.L,1200);
 assert.equal(late.x,100);assert.equal(late.moving,true);assert.equal(late.convoyNavigation.phase,'travelling');
 assert.equal(late.seenAt,1100);assert.equal(late.groupedCombat.currentAttackersAt,1100);assert.deepEqual(late.items,['new inventory']);
 assert.equal(acceptTravelReport(fast,late,9000).seenAt,1100);
 const replacement=sample('replacement',1,10000);replacement.name='L';
 assert.equal(acceptTravelReport(replacement,late,10000).travelSample.sequence,1);
});

test('genuine report loss stops once and resumes at the stopped leader without old rally or fake loot',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy,defense.step);e.step(p,1000);
 p.activeConvoy.phase='travel';p.activeConvoy.rally={map:'main',x:100,y:0};report(p,1000,'travelling');
 e.step(p,4500);const epoch=p.activeConvoy.epoch,id=p.commands.L.id;
 assert.equal(p.activeConvoy.phase,'communication-hold');assert.equal(p.commands.L.phase,'shared-hold');
 assert.match(p.commands.L.reason,/L: character report age 3500 ms/);
 e.step(p,5000);assert.equal(p.commands.L.id,id);assert.equal(p.activeConvoy.epoch,epoch);
 for(let at=6000;at<=11000;at+=1000){report(p,at);e.step(p,at);}
 assert.equal(p.activeConvoy.phase,'shared-prepare');assert.equal(p.activeConvoy.rally.x,900);
 assert.equal(p.commands.L.phase,'shared-prepare');assert.equal(p.activeConvoy.loot,undefined);
 assert.equal(p.activeConvoy.recoveryAttempts,undefined);
 assert.ok(!p.combatLogs.L.some(x=>/defensive kill|encounter complete/.test(x.message)));
});

test('disconnected sampler cannot claim a clear observation even when HTTP is fresh',()=>{
 const p=party(),raw=sample('F',2,2000);raw.travelSample.connected=false;
 p.statuses.F=acceptTravelReport(raw,p.statuses.F,2000);
 assert.equal(classifyTravelDefense(p,['L','F'],2000).state,'waiting-for-observations');
});

test('fast responses retain lease ownership while renewal alone leaves combat revision unchanged',()=>{
 let now=1000;const channel=createCombatChannel(()=>({serverNow:now,convoySignal:{id:'c',epoch:1,phase:'travel',
  commandId:7,runtimeId:'L',navigationRevision:2,routeVersion:4,validUntil:now+3000}}));
 const first=channel.snapshot('L');now=2000;const next=channel.snapshot('L');
 assert.equal(next.convoySignal.commandId,7);assert.equal(next.convoySignal.validUntil,5000);
 assert.equal(first.combatRevision,next.combatRevision);
});

function transport(){let mono=0,wall=0;const source=fs.readFileSync('characters/shared.js','utf8');
 const context=vm.createContext({Date:{now:()=>wall},Number,Math,Object,root:{},convoySignal:null,coordinatorClockOffset:0,
  convoyRuntimeId:'L',convoyTraveling:{id:'c',epoch:1,commandId:7,routeVersion:4,navigationRevision:2},convoyDiagnosticClock:()=>mono});
 vm.runInContext(namedFunction(source,'acceptTravelResponse')+'\n'+namedFunction(source,'convoySignalExpired'),context);
 return {context,at(m,w=m){mono=m;wall=w;},reply(sentAt=12000){return {serverNow:sentAt,transportTiming:{receivedAt:10000,sentAt},
  convoySignal:{id:'c',epoch:1,commandId:7,runtimeId:'L',navigationRevision:2,routeVersion:4,validUntil:sentAt+3000}};}};
}
test('fast lease survives delayed full status work and wall-clock jumps; delayed full reply cannot roll it back',()=>{
 const t=transport(),c=t.context;t.at(2200);c.acceptTravelResponse(t.reply(),{mono:0,wall:0},true);
 assert.equal(c.coordinatorClockOffset,9900);assert.equal(c.convoySignal.localDeadline,5000);
 t.at(3000,200000);assert.equal(c.convoySignalExpired(c.convoySignal),false);
 c.acceptTravelResponse(t.reply(11000),{mono:0,wall:0},false);assert.equal(c.convoySignal.validUntil,15000);
 t.at(5000,1);assert.equal(c.convoySignalExpired(c.convoySignal),true);
});
for(const field of ['epoch','commandId','runtimeId','routeVersion','navigationRevision'])test('fast signal cannot authorize another '+field,()=>{
 const t=transport(),c=t.context,r=t.reply();r.convoySignal[field]='other';t.at(2200);
 c.acceptTravelResponse(r,{mono:0,wall:0},true);assert.equal(c.convoySignal,null);
});


test('transporting reports cannot release a communication hold',()=>{
 const p=party(),e=createSharedConvoyNavigation(legacy,defense.step);e.step(p,1000);e.step(p,4500);
 for(let at=6000;at<=12000;at+=1000){report(p,at);p.statuses.L.transporting=true;e.step(p,at);}
 assert.equal(p.activeConvoy.phase,'communication-hold');
 for(let at=13000;at<=18000;at+=1000){report(p,at);e.step(p,at);}
 assert.equal(p.activeConvoy.phase,'shared-prepare');
});
