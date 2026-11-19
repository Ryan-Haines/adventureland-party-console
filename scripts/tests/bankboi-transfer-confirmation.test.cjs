const test=require('node:test'),assert=require('node:assert/strict');
const routing=require('../../runtime/items/coordinator/storage.ts');
const {bankHarness}=require('./helpers/items-character.cjs');
// bank.ts on a merchant whose game lands each bank call one sleep later. `game` holds the game's
// calls, which a row may replace after the build.
function fixture(){
 let pending;
 const character={name:'Merchant',ctype:'merchant',map:'bank',items:[{name:'tracker'},{name:'tracker'},null],bank:{items1:Array(42).fill(null)}};
 const operations=[];
 const game={
  bank_store:async(inv,pack,slot)=>{operations.push(['store',inv,slot]);pending=()=>{character.bank[pack][slot]=character.items[inv];character.items[inv]=null;};},
  bank_retrieve:async(pack,slot)=>{operations.push(['retrieve',slot]);pending=()=>{character.items[character.items.indexOf(null)]=character.bank[pack][slot];character.bank[pack][slot]=null;};}};
 const {bank}=bankHarness({character,tick:()=>{if(pending){const update=pending;pending=null;update();}},
  ports:{bankStore:(...args)=>game.bank_store(...args),bankRetrieve:(...args)=>game.bank_retrieve(...args)}});
 return {bank,game,character,operations};
}
test('two identical tracktrix transfers wait for delayed inventory and bank snapshots at both ends',async()=>{
 const {bank:c,character,operations}=fixture();
 for(let i=0;i<2;i++)await c.bankStageConfirmed(character.items.findIndex(Boolean),'items1',character.bank.items1.findIndex((item,slot)=>slot>=35&&!item));
 assert.deepEqual(operations,[['store',0,35],['store',1,36]]);
 assert.equal(character.items.filter(Boolean).length,0);
 await c.bankRetrieveConfirmed('items1',35);await c.bankRetrieveConfirmed('items1',36);
 assert.equal(character.items.filter(Boolean).length,2);assert.equal(character.bank.items1.filter(Boolean).length,0);
});
test('an unconfirmed transfer cannot issue a successful receipt',async()=>{
 const {bank:c,game,character}=fixture();game.bank_store=async()=>{};
 await assert.rejects(c.bankStageConfirmed(0,'items1',35),/not confirmed/);
 character.bank.items1[35]={name:'tracker'};game.bank_retrieve=async()=>{};
 await assert.rejects(c.bankRetrieveConfirmed('items1',35),/not confirmed/);
});
test('two outgoing transfer slots reserve the merchant even with spare slots and competing BankBoi work',()=>{
 const packs={items1:Array(42).fill(null)};packs.items1[35]={item:{name:'tracker'}};packs.items1[36]={item:{name:'tracker'}};packs.items1[37]={item:{name:'leather'}};
 const party={merchantCharacter:'M',withdrawals:{M:[35,36].map(slot=>({pack:'items1',slot,item:{name:'tracker'}}))},bankSnapshot:{packs},
  bankbois:{B0:{name:'B0',state:'ready',items:Array(42).fill(null)},B1:{name:'B1',state:'ready',items:Array(42).fill(null)}},bankboiQueue:[{id:'other',state:'staged',pack:'items1',slot:37,item:{name:'leather'}}]};
 assert.equal(routing.servicePlan(party),null);
 party.withdrawals.M=[];assert.ok(routing.servicePlan(party));
});
test('a partial success or gold delivery cannot clear unrelated withdrawals',()=>{
 const {fixture}=require('./helpers/coordinator-completion.cjs');
 const {createCompletionResults}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
 const f=fixture({});const keep={pack:'bankboi:B1',slot:1,item:{name:'tracker'}},done={pack:'items1',slot:35,item:{name:'tracker'}};
 f.state.withdrawals.F=[keep,done];
 createCompletionResults(f.state,f.ports).resolve(f.state.merchantCurrent,{success:true,withdrawalsDelivered:true,confirmedWithdrawals:[done]});
 assert.deepEqual(f.state.withdrawals.F,[keep]);
});

// IT28: the bank cell empties at once and the bag shows the stack one sleep later. Each
// withdrawal waits for both before the next pass reads the count, so 150 potions take two stacks.
// Red on b9b5c91e: the pass read the lagging bag and withdrew the third stack.
test('IT28: a lagging bag never loops the withdrawal past its need',async()=>{
 const stack=()=>({name:'hpot0',q:100});
 const character={name:'Merchant',ctype:'merchant',items:Array(6).fill(null),bank:{items0:[stack(),stack(),stack(),null]}};
 let landing=null;const retrieved=[];
 const {bank}=bankHarness({character,G:{items:{hpot0:{s:9999}},skills:{}},tick:()=>{if(landing){const land=landing;landing=null;land();}},ports:{
  bankRetrieve:async(pack,slot)=>{retrieved.push(slot);const item=character.bank[pack][slot];character.bank[pack][slot]=null;
   landing=()=>{character.items[character.items.indexOf(null)]=item;};}}});
 const availability=await bank.retrieveFromBankUntil('hpot0',150);
 assert.deepEqual(retrieved,[0,1]);
 assert.deepEqual([availability.onPlayer,availability.inBank],[200,100]);
});

// B42: b9b5c91e's retrieveFromBankUntil (shared.js:1336-1345)
// read the bag again as soon as bank_retrieve answered, so while the bag and bank snapshots lagged
// the reply it found the same stack and sent again, up to its guard of 100. bank.ts confirms each
// call by the bank cell emptying and the bag gaining the stack, so each stack is one call.
test('B42: a quantity across two stacks takes one confirmed call per stack while the snapshots lag the reply',async()=>{
 const run=async loop=>{
  let pending=null;const calls=[];
  const character={name:'M',ctype:'merchant',map:'bank',items:Array(42).fill(null),
   bank:{items0:[{name:'hpot1',q:200},{name:'hpot1',q:200},...Array(40).fill(null)]}};
  const {bank,p}=bankHarness({character,G:{items:{hpot1:{s:9999}},skills:{}},tick:()=>{if(pending){const land=pending;pending=null;land();}},
   ports:{bankRetrieve:async(pack,slot)=>{calls.push(slot);pending=()=>{const stack=character.bank[pack][slot];if(!stack)return;
    character.items[character.items.indexOf(null)]=stack;character.bank[pack][slot]=null;};}}});
  await loop(bank,p);return calls;
 };
 assert.deepEqual(await run(bank=>bank.retrieveFromBankUntil('hpot1',300)),[0,1]);
 // b9b5c91e's loop, as written, over the same game.
 const ryan=await run(async(bank,p)=>{let availability=p.reads.itemAvailability('hpot1'),guard=0;
  while(availability.onPlayer<300&&availability.inBank>0&&guard++<100){const found=bank.findBankItem({name:'hpot1'});if(!found)break;
   await p.bankRetrieve(found.pack,found.slot);availability=p.reads.itemAvailability('hpot1');}});
 assert.ok(ryan.length>2,'b9b5c91e sends the same stack again: '+ryan.length+' calls');
});
// A withdrawal receipt that names its bag cell clears its request, and the compound mark on that
// bank cell takes the cell (the live BankBoi Lantern row).
test('a landed withdrawal receipt clears its request and hands the compound mark its bag cell',()=>{
 const {fixture}=require('./helpers/coordinator-completion.cjs');
 const {createCompletionResults}=require('../../runtime/merchant-jobs/coordinator/endings.ts');
 const f=fixture({});const merchant=f.state.merchantCharacter,lantern={name:'lantern',level:2},request={pack:'items1',slot:35,item:lantern,improvement:'manual compounds'};
 f.state.withdrawals[merchant]=[request];
 f.state.compounds={[merchant]:[{id:'group-1',items:[{slot:-1,item:lantern,storage:{pack:'items1',slot:35}}]}]};
 createCompletionResults(f.state,f.ports).resolve(f.state.merchantCurrent,{success:false,merchantWithdrawalsDelivered:[{...request,inventorySlot:2}]});
 assert.deepEqual(f.state.withdrawals[merchant],[]);
 assert.equal(f.state.compounds[merchant][0].items[0].storageReceived,true);assert.equal(f.state.compounds[merchant][0].items[0].slot,2);
});
