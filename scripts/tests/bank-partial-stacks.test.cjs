const test=require('node:test'),assert=require('node:assert/strict');
const {bankRuntime}=require('./helpers/bank-stacks.cjs');
const {stackDepositPlan,stackLocations}=require('../../runtime/items/rules.ts');
const key=q=>({name:'tombkey',q});
// bank.ts's stack service over helpers/bank-stacks.cjs `bankRuntime`, reached as in play: the merchant
// leaving the bank compacts the piles (`compact`), a walk that ends on the bank floor recovers the
// journal (`recover`), and a deposit fills partial piles (`fill`, bankStoreFully). `restart` builds a
// second runtime over the same bank, bag and stored journal; `floors` lists each walk's floor.
const JOURNAL='party-bank-stack-buffer';
function stacks(bank,items,limits,store={}){
 const r=bankRuntime(bank,items,limits,{ports:{saved:k=>store[k]??null,save:(k,v)=>{store[k]=v;}}});
 const floors=[],walk=r.game.smart_move;r.game.smart_move=async floor=>{floors.push(floor);await walk(floor);};
 return Object.assign(r,{floors,compact:()=>r.leave(),recover:()=>r.bank.bankSortMove('bank'),fill:slot=>r.bank.bankStoreFully(slot),
  journal:()=>store[JOURNAL]??null,write:journal=>{store[JOURNAL]=journal;},
  // A second floor through the doors between the two (G.maps door[4]).
  secondFloor(packs){r.game.bank_packs=packs;r.G.maps.bank={doors:[[0,0,0,0,'bank_b']]};r.G.maps.bank_b={doors:[[0,0,0,0,'bank']]};},
  restart(){const next=stacks(bank,r.character.items,limits,store);next.character.map=r.character.map;next.game.bank_packs=r.game.bank_packs;next.G.maps=r.G.maps;return next;}});
}
test('legacy completed buffer reservations cannot shadow later reuse of the same slots',async()=>{
 const {stackKey}=require('../../runtime/items/identity.ts');
 const r=stacks({items0:[null,null]},[key(3),key(46),null]);
 r.write({buffers:[
  {slot:0,identity:stackKey({name:'seashell'}),origin:{pack:'items0',slot:0,floor:'bank'}},
  {slot:1,identity:stackKey({name:'seashell'}),origin:{pack:'items0',slot:1,floor:'bank'}},
  {slot:0,identity:stackKey(key(3)),origin:{pack:'items0',slot:0,floor:'bank'}},
  {slot:1,identity:stackKey(key(46)),origin:{pack:'items0',slot:1,floor:'bank'}}]});
 await r.recover();assert.equal(r.total(),49);assert.deepEqual(r.quantities(),[3,46]);assert.equal(r.journal(),null);
});

test('reused buffer identity retires stale intent without moving unrelated inventory',async()=>{
 const {stackKey}=require('../../runtime/items/identity.ts');
 const r=stacks({items0:[null]},[{name:'sword'}]);
 r.write({buffers:[{slot:0,identity:stackKey(key(3)),origin:{pack:'items0',slot:0,floor:'bank'}}]});
 await r.recover();assert.equal(r.calls.length,0);assert.equal(r.character.items[0].name,'sword');assert.equal(r.journal(),null);
});

test('legacy mixed seashell and crypt-key journal recovers only remaining bank cargo',async()=>{
 const {stackKey}=require('../../runtime/items/identity.ts');
 const items=Array(12).fill(null);items[7]={name:'cryptkey',q:45};items[9]={name:'anniversarygift',q:1};items[10]={name:'slice_nightberry',q:1};
 const r=stacks({items6:Array(27).fill(null)},items,{cryptkey:50});r.character.bank.items6[25]={name:'cryptkey',q:50};
 const origin=slot=>({pack:'items6',slot,floor:'bank'});
 r.write({buffers:[{slot:7,identity:stackKey({name:'seashell'}),origin:origin(10)},
  {slot:9,identity:stackKey({name:'seashell'}),origin:origin(11)},
  {slot:7,identity:stackKey(items[7]),origin:origin(26)},
  {slot:9,identity:stackKey(items[7]),origin:origin(25)},
  {slot:10,identity:stackKey(items[7]),source:7}]});
 await r.recover();assert.equal(items[7],null);assert.equal(items[9].name,'anniversarygift');assert.equal(items[10].name,'slice_nightberry');
 assert.deepEqual(r.calls,[['store',7,'items6',26]]);assert.equal(r.character.bank.items6[26].q,45);assert.equal(r.journal(),null);
});
// The compaction walks back to the floor it started on before the merchant leaves; a second visit
// finds nothing left to merge.
for(const cross of [false,true])test('97 tomb keys compact into 50 and 47 '+(cross?'across floors':'in one pack'),async()=>{
 const bank=cross?{items0:[key(46)],items8:[key(46),key(5)]}:{items0:[key(46),key(46),key(5)]};
 const r=stacks(bank);if(cross)r.secondFloor({items0:['bank'],items8:['bank_b']});
 await r.compact();assert.deepEqual(r.quantities(),[50,47]);assert.equal(r.total(),97);
 assert.ok(r.character.items.every(x=>!x));assert.equal(r.journal(),null);assert.deepEqual(r.floors.slice(cross?-2:-1),cross?['bank','main']:['main']);
 await r.recover();const count=r.calls.length;await r.compact();assert.equal(r.calls.length,count);
});
test('new deposit fills both gaps without touching unrelated inventory',async()=>{
 const r=stacks({items0:[key(46),key(46)]},[key(5),key(12),null,null,null]);
 await r.fill(0);assert.deepEqual(r.quantities(),[50,47]);assert.equal(r.character.items[1].q,12);assert.equal(r.character.items[0],null);assert.equal(r.total(),109);
});
test('bee wings consolidate and legitimate overflow retains full stacks',async()=>{
 const r=stacks({items0:[{name:'beewings',q:9000},{name:'beewings',q:800},{name:'beewings',q:500}]});
 await r.compact();assert.deepEqual(r.quantities(),[9999,301]);assert.equal(r.total(),10300);
});
test('protected locations, variants and staging are preserved',async()=>{
 const bank={items0:[key(46),{...key(5),l:'l'},key(5)],items1:Array(42).fill(null)};bank.items1[35]=key(5);
 const r=stacks(bank);r.game.protection={locations:[{pack:'items0',slot:2}],items:[]};
 await r.compact();assert.deepEqual(r.quantities(),[46,5,5,5]);assert.equal(r.calls.length,0);
});
test('full inventory defers partial work but permits safe whole-stack bank merges',async()=>{
 const r=stacks({items0:[key(46),key(46),key(5)]},Array(4).fill({name:'sword'}));const statuses=[];r.p.status=message=>statuses.push(message);
 await r.compact();assert.ok(statuses.includes('Bank stack cleanup deferred: inventory buffers unavailable'));assert.equal(r.calls.length,0);
 r.character.bank.items0=[key(20),key(25)];await r.recover();await r.compact();assert.deepEqual(r.quantities(),[45]);
});
test('deposit with insufficient split buffers is deferred without creating a bank stack',async()=>{
 const r=stacks({items0:[key(46),key(46)]},[key(5)]);
 await assert.rejects(r.fill(0),/buffers/);assert.equal(r.calls.length,0);assert.deepEqual(r.quantities(),[46,46]);
});
test('planner fills all partial capacity before allocating an overflow slot',()=>{
 const plan=stackDepositPlan(key(12),50,stackLocations({items0:[key(46),key(46)]},{locations:[],items:[]}));
 assert.deepEqual(plan.moves.map(m=>m.quantity),[4,4,4]);assert.equal(plan.remaining,0);
});
for(const failAt of [1,2,3,4,5,6])test('restart recovers confirmed mutation '+failAt+' without duplication',async()=>{
 const r=stacks({items0:[key(46)],items8:[key(5)]});r.secondFloor({items0:['bank'],items8:['bank_b']});
 let operations=0,crashed=false;
 for(const name of ['bank_retrieve','bank_store','split','swap','bank_swap']){const run=r.game[name];r.game[name]=async(...args)=>{
  const result=await run(...args);if(++operations===failAt&&!crashed){crashed=true;throw Error('connection lost after mutation');}return result;};}
 try{await r.compact();}catch(error){assert.match(error.message,/connection lost/);}
 const restarted=r.restart();
 await restarted.recover();await restarted.compact();
 assert.equal(r.total(),51);assert.deepEqual(r.quantities(),[50,1]);assert.ok(r.character.items.every(x=>!x));assert.equal(r.journal(),null);
});
test('unconfirmed operation stays journaled and is not sent twice',async()=>{
 const r=stacks({items0:[key(46)],items8:[key(5)]});let sent=0;r.game.bank_retrieve=async()=>{sent++;};
 await assert.rejects(r.compact(),/not confirmed/);assert.ok(r.journal().pending);await r.recover();
 assert.equal(sent,1);assert.equal(r.journal(),null);assert.equal(r.total(),51);
});

test('locked floors and protected crafting item types are excluded',async()=>{
 const r=stacks({items0:[key(46)],items8:[key(5)]});r.game.bank_packs={items0:['bank'],items8:['bank_b']};
 await r.compact();assert.equal(r.calls.length,0);
 r.secondFloor(r.game.bank_packs);r.game.protection={locations:[],items:[{name:'tombkey',level:0}]};
 await r.recover();await r.compact();assert.equal(r.calls.length,0);
});

test('delayed proxy updates settle before the next mutation',async()=>{
 const r=stacks({items0:[key(20),key(25)]});const original=r.game.bank_swap,clock=r.p.sleep;let update;
 r.game.bank_swap=async(...args)=>{update=()=>original(...args);};
 r.p.sleep=async ms=>{await clock(ms);if(update){const apply=update;update=null;await apply();}};
 await r.compact();assert.deepEqual(r.quantities(),[45]);assert.equal(r.total(),45);
});

test('a full bank pane compacts without requiring an empty bank slot',async()=>{
 const pack=[key(46),key(46),key(5),...Array.from({length:39},(_,i)=>({name:'equipment'+i}))];
 const r=stacks({items0:pack});await r.compact();
 assert.deepEqual(pack.filter(x=>x?.name==='tombkey').map(x=>x.q),[50,47]);assert.equal(pack.filter(Boolean).length,41);
 assert.ok(r.character.items.every(x=>!x));
});

test('concurrent cleanup calls serialize rather than borrowing the same buffers',async()=>{
 const r=stacks({items0:[key(46),key(46),key(5)]});
 await Promise.all([r.compact(),r.compact(),r.recover()]);
 assert.deepEqual(r.quantities(),[50,47]);assert.equal(r.total(),97);assert.equal(r.journal(),null);
});

test('replacement runtime leaves the operation journal for the new runner',async()=>{
 const r=stacks({items0:[key(46)],items8:[key(5)]});let current=true;
 r.p.current=()=>current;const retrieve=r.game.bank_retrieve;
 r.game.bank_retrieve=async(...args)=>{await retrieve(...args);current=false;};
 await assert.rejects(r.compact(),/runtime replaced/);assert.ok(r.journal().pending);assert.equal(r.total(),51);
 const restarted=r.restart();
 await restarted.recover();await restarted.compact();assert.deepEqual(r.quantities(),[50,1]);
});

test('a stack changed during floor travel is replanned without depositing stale quantities',async()=>{
 const r=stacks({items8:[key(40)]},[key(5),null,null]);r.secondFloor({items8:['bank_b']});
 r.game.smart_move=async()=>{r.character.bank.items8[0].q=45;};
 await assert.rejects(r.fill(0),/changed during travel/);
 assert.equal(r.calls.length,0);assert.equal(r.character.items[0].q,5);assert.equal(r.journal(),null);
});

// The bank plans stack what the game's `can_stack` stacks: a PvP copy (`v`) stays apart from a
// plain pile, an `acl` or `ps` pile merges with it.
test("bank piles merge by the game's stack identity",()=>{
 const {nextStackMerge}=require('../../runtime/items/rules.ts'),{stackKey}=require('../../runtime/items/identity.ts');
 // The game's can_stack as helpers/bank-stacks.cjs plants it: the same pile key.
 const canStack=(target,source)=>stackKey(target)===stackKey(source);
 assert.equal(nextStackMerge([{pack:'items0',slot:0,item:key(10)},{pack:'items0',slot:1,item:{...key(5),v:1}}],()=>50,canStack),null);
 for(const extra of [{acl:1},{ps:['x']}])
  assert.ok(nextStackMerge([{pack:'items0',slot:0,item:key(10)},{pack:'items0',slot:1,item:{...key(5),...extra}}],()=>50,canStack));
 assert.ok(nextStackMerge([{pack:'items0',slot:0,item:key(10)},{pack:'items0',slot:1,item:key(5)}],()=>50,canStack));
});
// T1-12: a buffer journaled by carries its nine-field stackIdentity
// (characters/party-member.js:1251-1253 at v1.5.0); the load keys it by stackKey
// once, so the recovery returns the buffered pile to its bank cell instead of clearing the
// journal.
test('T1-12: a stack journal returns its buffered pile to the bank',async()=>{
 const {bankHarness}=require('./helpers/items-character.cjs');
 const pile={name:'tombkey',q:3};
 const character={name:'M',ctype:'merchant',map:'bank',items:[{...pile},null],isize:2,bank:{items0:[null]}};
 const legacy=JSON.stringify(['name','level','p','stat_type','data','rid','b','m','l'].map(k=>k==='level'?0:pile[k]??null));
 const h=bankHarness({character,G:{items:{tombkey:{s:50}},skills:{}},ports:{bankPacks:()=>({items0:['bank']}),
  bankStore:async(inv,pack,slot)=>{[character.items[inv],character.bank[pack][slot]]=[character.bank[pack][slot],character.items[inv]];}}});
 h.p.save('party-bank-stack-buffer',{buffers:[{slot:0,identity:legacy,origin:{pack:'items0',slot:0,floor:'bank'}}]});
 await h.bank.bankSortMove('bank');
 assert.deepEqual(character.bank.items0[0],pile);assert.equal(character.items[0],null);
 assert.equal(h.p.saved('party-bank-stack-buffer'),null);
});
// Every bank sort move carries the items owner's errand request, so movement names 10 as its
// caller and the shared protocol filters no 10 function by name.
test('a bank sort move asks movement with the errand request',async()=>{
 const {bankHarness}=require('./helpers/items-character.cjs');
 const errand={kind:'errand',owner:'items'},moves=[];
 const character={name:'M',ctype:'merchant',map:'main',items:[null],isize:1,bank:{}};
 const h=bankHarness({character,ports:{errand:()=>errand,move:async(destination,callback,options)=>{moves.push(options);}}});
 await h.bank.bankSortMove('bank');
 assert.deepEqual(moves,[{request:errand}]);
});
