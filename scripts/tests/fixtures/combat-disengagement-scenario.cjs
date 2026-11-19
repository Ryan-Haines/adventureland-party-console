// A grouped farming fight in which members die (a shared setup lives in the harness).
// The survival owner's party death recovery (runtime/coordinator/survival/recovery.ts) over its
// own registry: the targeting owner's coordinator registration answers `targeting.fight` and resets its grouped
// fight at survival's notices, and a recorder hears every survival notice with the
// three fields the targeting owner keeps, read at the notice after its listener ran.
const {createRegistry}=require('../../../runtime/hooks/registry.ts');
const {installCoordinatorTargeting}=require('../../../runtime/coordinator/targeting/install.ts');
const {createPartyRecovery}=require('../../../runtime/coordinator/survival/recovery.ts');
const {survivalLog,recoveryReads}=require('../../../runtime/coordinator/survival/install.ts');
const {evaluateGroup}=require('../../../runtime/coordinator/targeting/queue.ts');
// The targeting owner's queue asks movement's terrain recovery round on the realm's registry (queue.ts
// `evaluateGroup`), which the application's core answers fill (coordinator-core.cjs).
require('./coordinator-core.cjs');
const {isSafeAt}=require('../../../runtime/movement/rules.ts');
const {deathRecoveryAllows}=require('../../../runtime/tasks/rules.ts');
const {publishTasks}=require('../../../runtime/tasks/api.ts');
const NOTICES=['survival.died','survival.escaped','survival.recoveryStarted','survival.recoveryPhase','survival.recovered','survival.judged'];
function fixture(){
 let now=1000,escapes=0,returns=0;const names=['W','M','P'];
 const target={id:'mole',mtype:'mole',map:'cave',in:'cave',server:'USII',x:0,y:0,hp:25,max_hp:100,state:'engaged',startedAt:800,fighter:'W'};
 const party={leader:'W',followers:{M:true,P:true},partyFarmingMode:'default',combatMode:'auto',monsterFocus:['mole'],location:{map:'cave',x:10,y:10},statuses:{},commands:{},combatLogs:{},groupedCombat:{target,queue:[target],fights:[target],deaths:[]}};
 for(const [i,n] of names.entries())party.statuses[n]={name:n,ctype:['warrior','mage','priest'][i],map:'cave',in:'cave',server:'USII',x:0,y:0,hp:100,max_hp:100,range:200,seenAt:now,lastDeath:{at:0},combatSelection:{runtimeId:n},groupedCombat:{protocol:4,epoch:0,threats:[target],sightings:[target],evidence:[],candidates:[],deaths:[],anchorVisible:true}};
 const registry=createRegistry(),heard=[];
 installCoordinatorTargeting(registry,{state:group=>group==='party:W'?party:undefined,now:()=>now});
 registry.register({name:'core:test-notices',folder:'core',author:'test',summary:'test',hooks:Object.fromEntries(NOTICES.map(hook=>[hook,payload=>
  heard.push({hook,payload,fight:{groupedCombat:party.groupedCombat,resetAt:party.groupedCombatResetAt,byCharacter:{...party.combatResetByCharacter}}})]))});
 const revisions={W:1,M:1,P:1},home={goal:'death',map:'main',x:0,y:0,radius:65,spawn:0};
 // The tasks owner's table answers the death recovery from each member's reported presence, as its install does.
 publishTasks({allows:(question,n)=>question==='death-recovery'&&deathRecoveryAllows(party.statuses[n]?.presence)});
 // The survival owner's party half: its one death counter and the
 // verdict, as install.ts gives them. The fixture's mole has no game data, so before two readings
 // the model finds the fight winnable (`fightWinnable` with no monsters).
 const {createDied}=require('../../../runtime/coordinator/survival/died.ts'),{createVerdicts}=require('../../../runtime/coordinator/survival/verdict.ts');
 const {createEscaped}=require('../../../runtime/coordinator/survival/escaped.ts');
 const publish={notify:(hook,payload)=>registry.notify(hook,payload),log:(entry,member)=>survivalLog(party,entry,member)};
 const died=createDied({now:()=>now,status:n=>party.statuses[n],seen:()=>(party.combatDeathSeen||={}),publish});
 const verdicts=createVerdicts({now:()=>now,monsters:()=>null});
 const escaped=createEscaped({now:()=>now,record:()=>(party.survivalEscapes||={}),publish});
 const ports={now:()=>now,persist(){},log:message=>survivalLog(party,{at:now,type:'disengagement',message}),group:()=>'party:W',
  notify:(hook,payload)=>registry.notify(hook,payload),died:(n,rules)=>died.scan(n,rules),
  verdict:(key,s,f,at)=>verdicts.decide('recovery:'+key,s,f,at),endVerdict:key=>verdicts.end('recovery:'+key),
  escaped:(n,s,m,j,by)=>escaped.escaped(n,s,m,j,by),won:k=>escaped.won(k),refuses:ask=>registry.survival.refuses(ask),
  fight:()=>registry.targeting.fight('party:W'),...recoveryReads(party),home:()=>home,atHome:(s,g)=>isSafeAt(g,s),members:()=>names,
  intent:n=>({revision:revisions[n],cancelled:false}),inCave:()=>false,
  escape(){escapes++;},releaseEscape(){},endWalk(){},
  returnToFarm(){returns++;party.activeConvoy={id:"return-"+returns,purpose:"death-recovery",phase:"assemble"};return true;}};
 const ctl=createPartyRecovery(party,ports);ctl.tick();
 const members=()=>names.map(n=>({name:n,ctype:party.statuses[n].ctype,revision:1,status:party.statuses[n]}));
 return {party,names,target,revisions,ctl,ports,registry,verdicts,died,heard,escapes:()=>escapes,returns:()=>returns,
 of:hook=>heard.filter(n=>n.hook===hook).map(n=>n.payload),
 advance(ms=100){now+=ms;for(const s of Object.values(party.statuses))s.seenAt=now;},kill(n){party.statuses[n].rip=true;party.statuses[n].hp=0;party.statuses[n].lastDeath={at:now};},home(){for(const s of Object.values(party.statuses)){s.rip=false;s.hp=100;s.map=s.in='main';s.x=s.y=0;s.groupedCombat.threats=[];}},
 // The grouped fight as the targeting owner's queue evaluates it on the members' reports, without the recovery's
 // masks, which the grouped snapshot row checks.
 reconcile(){ctl.tick();party.groupedCombat=evaluateGroup(party.groupedCombat?.protocol?party.groupedCombat:null,members(),'W',now,party.groupedCombatResetAt||0,ctl.active());},
 members,now:()=>now};
}

// The coordinator verdict alone (runtime/coordinator/survival/verdict.ts) on a clock the row moves,
// with the game data of the monsters the row plants.
function verdicts(monsters){
 const clock={now:0};const {createVerdicts}=require('../../../runtime/coordinator/survival/verdict.ts');
 return {clock,v:createVerdicts({now:()=>clock.now,monsters:()=>monsters})};
}

module.exports = { fixture, verdicts };
