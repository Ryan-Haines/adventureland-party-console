// The bank sort request on the coordinator and the character (a shared setup lives in the harness).
const {settingsWriter}=require('../helpers/settings-writer.cjs');
// Sliced shared.js functions run with the shared movement harness (fixtures/movement-owner-callers.cjs).
const { createMovementContext } = require('./movement-owner-callers.cjs');
const {installBankStacks}=require('../helpers/bank-stacks.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { createBankSortRoutes, initialBankSort, settleSortLease } = require('../../../runtime/items/coordinator/storage.ts');
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('characters/shared.js', 'utf8');
const { sliceBetween } = require('../helpers/slice.cjs');
function coordinator() {
 const state={merchantCharacter:'M',...initialBankSort({})}; let runtime='R';
 const routes=createBankSortRoutes(state,{persist(){},runtime:()=>runtime,write:settingsWriter(state).write});
 function call(route,body){let code=200,result;routes[route]({body},{status(v){code=v;return this},json(v){result=v}});return {code,...structuredClone(result)}}
 return {state,call,reconcile:()=>settleSortLease(state,runtime),runtime:v=>runtime=v};
}
function client(mode='request') {
 const c=coordinator();c.call('configure',{mode});const calls=[];
 const bank={items0:[{name:'z'},{name:'a'}],items1:Array(42).fill(null),items8:[{name:'z'},{name:'a'}]};
 bank.items1[35]={name:'reserved'};
 const r=createMovementContext({bankStaging:true,bankStagingSlot:(pack,slot)=>pack==="items1"&&slot>=35,character:{name:'M',ctype:'merchant',map:'main',items:Array(42).fill(null),bank,x:0,y:0},root:{},
  parent:{socket:{emit(type,{pack,str,inv}){calls.push('swap');[bank[pack][str],r.character.items[inv]]=[r.character.items[inv],bank[pack][str]]}}},
  convoyRuntimeId:'R',coordinatorClockOffset:0,runtimeCurrent:()=>true,
  bank_packs:{items0:['bank'],items1:['bank'],items8:['bank_b']},
  G:{items:{a:{},z:{},reserved:{},bkey:{type:'bank_key',unlocks:'bank_b'}},maps:{bank:{doors:[[0,0,0,0,'bank_b',0,0,'key']]},bank_b:{doors:[[0,0,0,0,'bank',0,0]]}}},
  movement:{move:async dest=>{const map=typeof dest==='string'?dest:dest.map;calls.push(map);r.character.map=map;return true}},
  request:async(path,{body})=>{calls.push(body.action);const v=c.call('checkpoint',body);if(v.code!==200)throw Error(v.error);return v},
  gatheringStatus(){},setTimeout:f=>f(),sleep:async()=>{},bankStackIdentity:x=>JSON.stringify(x),
  bankStoreFully:async inv=>{for(const pack of r.bankPacksOnCurrentFloor()){for(let slot=0;slot<42;slot++){if(pack==='items1'&&slot>=35)continue;if(!bank[pack][slot]){bank[pack][slot]=r.character.items[inv];r.character.items[inv]=null;return}}}throw Error('full')}
 });
 vm.runInContext(sliceBetween(source,'  // A visit spans all bank floors','  async function bankRetrieveConfirmed(','characters/shared.js'),r);
 vm.runInContext(sliceBetween(source,'  var bankStacks =','  async function bankStoreFully(','characters/shared.js'),r);
 installBankStacks(r);
 return {r,c,calls,bank,async enter(){r.observeBankSortVisit();r.character.map='bank';r.observeBankSortVisit();r.bankSortVisit.enteredAt=Date.now()+1000;}};
}

module.exports = { coordinator, client };
