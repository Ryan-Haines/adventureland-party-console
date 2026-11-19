const test = require('node:test'), assert = require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {coordinator}=require('./fixtures/bank-sort-request-scenario.cjs');

scenarioTable('a bank sort request travels as an errand and settles once', coordinator, [
 ['lease requires next entry, request identity and the current runtime', c=>{
 c.call('configure',{mode:'request',enabled:true});
 const id=c.state.bankSortRequest.id, at=c.state.bankSortRequest.requestedAt;
 const body={character:'M',runtime:'R',visit:'V',enteredAt:at-1,action:'claim'};
 c.call('checkpoint',body);assert.equal(c.state.bankSortRequest.status,'queued');
 body.enteredAt=at+1;c.call('checkpoint',body);assert.equal(c.state.bankSortRequest.status,'sorting');
 c.call('checkpoint',{...body,action:'complete',id:'old'});assert.ok(c.state.bankSortRequest);
 c.call('configure',{enabled:false});c.call('configure',{enabled:true});const newer=c.state.bankSortRequest.id;
 c.call('checkpoint',{...body,action:'complete',id});assert.equal(c.state.bankSortRequest.id,newer);
 c.runtime('R2');assert.equal(c.call('checkpoint',{...body,action:'complete',id:newer}).code,409);
 }],
]);

// And on the character's sort (runtime/items/character/bank.ts `sortCurrentBankFloor`), read from
// v1.5.0's e2e/bank-sort-failures.md; the floor builder is helpers/items-character.cjs.
const {bankSortFloor}=require('./helpers/items-character.cjs');
const sortG={items:{helmet:{type:'helmet',g:100},poison:{type:'material',g:10,s:9999}},skills:{}};
const vaultOf=(...cells)=>Object.assign(Array(42).fill(null),cells);

// Each row plants the bank's store or retrieve behaviour and asserts how the sort pass ends.
let refilled=false;
scenarioTable('a sort swap ends confirmed, not landed or unconfirmed',bankSortFloor,[
 // The native store drops the merchant's luck mark `m`, so the swap waits for the copy without it.
 // Red on an earlier build: the expected bank copy kept `m` and the swap never confirmed.
 ['a sort swap confirms on the stored copy without the luck mark',async({bank,character})=>{
  await bank.sortCurrentBankFloor([]);
  assert.deepEqual(character.bank.items7.slice(0,2).map(item=>item?.name),['helmet','poison']);
 },{vault:vaultOf({name:'poison',q:5},{name:'helmet',level:0}),G:sortG,
  store:(inv,pack,slot,character)=>{const cell=slot??character.bank[pack].indexOf(null);const carried=character.items[inv];
   character.items[inv]=character.bank[pack][cell]??null;character.bank[pack][cell]=carried&&{...carried,m:undefined};},
  retrieve:(pack,slot,inv,character)=>{const taken=character.bank[pack][slot];character.bank[pack][slot]=character.items[inv]??null;
   character.items[inv]=taken&&{...taken,m:'Merchant'};}}],
 // The buffer is a bag cell inside `isize`; a free cell past it is never planned. Red on an
 // earlier build: the sort planned cell 6 of a 6-cell bag.
 ['a sort plans no buffer past the bag size',async({bank,swaps})=>{
  await assert.rejects(bank.sortCurrentBankFloor([]),error=>error.code==='inventory_full');
  assert.deepEqual(swaps,[]);
 },{vault:vaultOf({name:'poison',q:5},{name:'helmet',level:9}),isize:6,G:sortG,
  items:[...Array(6)].map((_,i)=>({name:'helmet',level:i})).concat([null,null])}],
 // The case on issue #145: Poison x5 goes to items7 slot 34, and another pile refills the cell before
 // the confirmation. The pass ends unconfirmed, the bag holder is free and no journal entry keeps a
 // pending side. Red on an earlier build and the merchant stayed at the bank.
 ['a refilled cell ends the pass unconfirmed and frees the merchant',async({bank,bag,saved,swaps})=>{
  await assert.rejects(bank.sortCurrentBankFloor([]),error=>error.code==='not_confirmed'&&/unconfirmed/.test(error.reason||error.message));
  assert.ok(refilled,'the swap went to items7 slot 34');
  assert.ok(swaps.some(([kind])=>kind==='publish'),'the next report is read as the bank');
  assert.equal(bag.busy(),false);
  assert.ok((saved['party-bank-sort-buffer']||[]).every(entry=>!entry.pending));
 },{vault:vaultOf({name:'poison',q:5},...[...Array(34)].map((_,i)=>({name:'helmet',level:i%3}))),G:sortG,
  store:(inv,pack,slot,character)=>{const cell=slot??character.bank[pack].indexOf(null);
   if(!refilled&&cell===34){refilled=true;character.items[inv]=character.bank[pack][34];character.bank[pack][34]={name:'poison',q:2};return;}
   [character.items[inv],character.bank[pack][cell]]=[character.bank[pack][cell]??null,character.items[inv]??null];}}],
 // A refused swap with both sides as before ends the pass; the next visit plans again.
 ['a not-landed swap ends the pass',async({bank,bag,swaps})=>{
  await assert.rejects(bank.sortCurrentBankFloor([]),error=>error.code==='not_confirmed'&&/did not land/.test(error.reason||error.message));
  const refused=swaps.findIndex(([kind])=>kind==='store');
  assert.equal(swaps.slice(refused+1).filter(([kind])=>kind==='retrieve').length,0,'no swap after the refused one');
  assert.equal(bag.busy(),false);
 },{vault:vaultOf({name:'poison',q:5},{name:'helmet',level:0}),G:sortG,store:()=>{throw Error('bank refused');}}],
]);

// A stand-less merchant gets no stand return and stays in the bank after its job (merchant-jobs
// coordinator/stand.ts `needsCommand`), so its bank visit settles a requested sort without the walk out.
// Red on an earlier build: the lease was claimed only on leaving, and the live bank popup rows' merchant
// sat in the bank with the request queued.
test('a stand-less merchant in the bank finishes a requested sort at its visit',async()=>{
 const {bankRuntime}=require('./helpers/bank-stacks.cjs');
 const checkpoints=[],pending={id:'S',runtime:'r1',visit:null};
 const runtime=bankRuntime({items0:vaultOf({name:'poison',q:5},{name:'helmet',level:0})},Array(6).fill(null),{poison:9999},{G:sortG,character:{map:'main'},ports:{
  request:async(path,{body}={})=>{
   if(path!=='/merchant/bank-sort/checkpoint')return {};
   checkpoints.push(body.action);
   if(body.action==='claim')pending.visit=body.visit;
   if(body.action==='complete')return {mode:'request',pending:null};
   return {mode:'request',pending:pending.visit?pending:null,protection:{locations:[],items:[]}};
  }}});
 const activity=[];
 await runtime.bank.merchantVisitBank({},activity);
 assert.ok(checkpoints.includes('claim'));
 assert.equal(checkpoints.at(-1),'complete');
 assert.deepEqual(runtime.character.bank.items0.slice(0,2).map(item=>item?.name),['helmet','poison']);
 assert.equal(runtime.character.map,'bank');
 assert.deepEqual(activity.filter(entry=>entry.level==='error'),[]);
});
