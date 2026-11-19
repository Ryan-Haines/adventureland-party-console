// shared.js routes every smart_move of the character's code through the items owner's bankSortMove
// (runtime/items/character/bank.ts). Observed on the e2e farm run: the leader's group walk reached
// movement as an errand, waited behind its own walk's hold, and the party never left the rally point.
const test=require('node:test'),assert=require('node:assert/strict');
const {bankHarness}=require('./helpers/items-character.cjs');
const errand={kind:'errand',owner:'items'};
function harness(moves){
 const character={name:'W',ctype:'warrior',map:'main',items:[null],isize:1,bank:{}};
 return bankHarness({character,ports:{errand:()=>errand,move:async(destination,callback,options)=>{moves.push([callback,options]);}}});
}
test('a caller\'s callback, request and gate reach movement through the bank sort move',async()=>{
 const moves=[],callback=()=>{},walk={request:{kind:'group-walk',owner:'walk:party:W'},gate:{tick(){}}};
 await harness(moves).bank.bankSortMove({map:'main',x:152,y:1487},callback,walk);
 assert.equal(moves[0][0],callback);assert.equal(moves[0][1],walk);
});
test('10\'s own walk asks movement with the errand request',async()=>{
 const moves=[];
 await harness(moves).bank.bankSortMove('bank');
 assert.deepEqual(moves,[[undefined,{request:errand}]]);
});
