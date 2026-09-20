const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const routing=require('../bank-stack-routing.cjs');
const source=fs.readFileSync('characters/shared.js','utf8');
function fixture(){
 let now=0,pending;
 const character={items:[{name:'tracker'},{name:'tracker'},null],bank:{items1:Array(42).fill(null)}};
 const operations=[];
 const context={character,Number,Error,Date:{now:()=>now},bankStackIdentity:routing.identity,
  sleep:async()=>{now+=100;if(pending){const update=pending;pending=null;update();}},
  bank_store:async(inv,pack,slot)=>{operations.push(['store',inv,slot]);pending=()=>{character.bank[pack][slot]=character.items[inv];character.items[inv]=null;};},
  bank_retrieve:async(pack,slot)=>{operations.push(['retrieve',slot]);pending=()=>{character.items[character.items.indexOf(null)]=character.bank[pack][slot];character.bank[pack][slot]=null;};}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('  async function bankRetrieveConfirmed('),source.indexOf('  async function runBankboiService(')),context);
 return {context,character,operations};
}
test('two identical tracktrix transfers wait for delayed inventory and bank snapshots at both ends',async()=>{
 const {context:c,character,operations}=fixture();
 for(let i=0;i<2;i++)await c.bankStageConfirmed(character.items.findIndex(Boolean),'items1',character.bank.items1.findIndex((item,slot)=>slot>=35&&!item));
 assert.deepEqual(operations,[['store',0,35],['store',1,36]]);
 assert.equal(character.items.filter(Boolean).length,0);
 await c.bankRetrieveConfirmed('items1',35);await c.bankRetrieveConfirmed('items1',36);
 assert.equal(character.items.filter(Boolean).length,2);assert.equal(character.bank.items1.filter(Boolean).length,0);
});
test('an unconfirmed transfer cannot issue a successful receipt',async()=>{
 const {context:c,character}=fixture();c.bank_store=async()=>{};
 await assert.rejects(c.bankStageConfirmed(0,'items1',35),/not confirmed/);
 character.bank.items1[35]={name:'tracker'};c.bank_retrieve=async()=>{};
 await assert.rejects(c.bankRetrieveConfirmed('items1',35),/not confirmed/);
});
test('two outgoing transfer slots reserve the merchant even with spare slots and competing BankBoi work',()=>{
 const packs={items1:Array(42).fill(null)};packs.items1[35]={item:{name:'tracker'}};packs.items1[36]={item:{name:'tracker'}};packs.items1[37]={item:{name:'leather'}};
 const party={merchantCharacter:'M',withdrawals:{M:[35,36].map(slot=>({pack:'items1',slot,item:{name:'tracker'}}))},bankSnapshot:{packs},
  bankbois:{B0:{name:'B0',state:'ready',items:[]},B1:{name:'B1',state:'ready',items:[]}},bankboiQueue:[{id:'other',state:'staged',pack:'items1',slot:37,item:{name:'leather'}}]};
 assert.equal(routing.servicePlan(party),null);
 party.withdrawals.M=[];assert.ok(routing.servicePlan(party));
});
test('a partial success or gold delivery cannot clear unrelated withdrawals',()=>{
 const {fixture}=require('./helpers/coordinator-completion.cjs');
 const {createCompletionResults}=require('../../runtime/coordinator/merchant/completion-results.ts');
 const f=fixture({});const keep={pack:'bankboi:B1',slot:1,item:{name:'tracker'}},done={pack:'items1',slot:35,item:{name:'tracker'}};
 f.state.withdrawals.F=[keep,done];
 createCompletionResults(f.state,f.ports).resolve(f.state.merchantCurrent,{success:true,withdrawalsDelivered:true,confirmedWithdrawals:[done]});
 assert.deepEqual(f.state.withdrawals.F,[keep]);
});
