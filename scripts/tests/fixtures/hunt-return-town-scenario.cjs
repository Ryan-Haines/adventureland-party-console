// A continuous Hunt return convoy (a shared setup lives in the harness).
require('./coordinator-core.cjs');
const test=require('node:test'),assert=require('node:assert/strict');
const {recordTownAttempt,observeReturnTown}=require('../../../runtime/movement/coordinator/arrivals.ts');
const {sharedCommand}=require('../../../runtime/movement/coordinator/walk.ts');
const defense=require('../../../runtime/movement/coordinator/defense.ts');
const {runtime,settle}=require('../helpers/native-convoy-runtime.cjs');
const {namedFunction}=require('../helpers/named-function.cjs');
const vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('characters/shared.js','utf8');
function party(){
 const names=['L','F','P'],c={id:'return',epoch:1,routeVersion:1,continuousReturn:1,returnRouting:true,
  phase:'shared-prepare',purpose:'monster-hunt',nonPreemptible:true,leader:'L',participants:names,completed:[],
  location:{map:'main',x:126,y:-413},rally:{map:'main',x:500,y:1100},slowestSpeed:57,runtimes:{L:'L',F:'F',P:'P'}};
 const p={activeConvoy:c,nextCommandId:1,commands:{},navigationIntents:{},combatLogs:{},monsterHunt:{stage:'returning'},
  statuses:Object.fromEntries(names.map(name=>[name,{name,seenAt:1000,map:'main',in:'main',x:500,y:1100,hp:100,speed:57,server:'USII',
   convoyProtocol:4,huntReturnProtocol:2,returnTownReady:true,combatSelection:{runtimeId:name},groupedCombat:{currentAttackersAt:1000,currentAttackers:[]}}]))};
 for(const name of names){const cmd=p.commands[name]=sharedCommand(p,c,c.phase,name);p.statuses[name].convoyNavigation={
  id:c.id,epoch:c.epoch,commandId:cmd.id,navigationRevision:0,runtimeId:name,phase:'route-ready'};}
 return p;
}

module.exports = { party };
