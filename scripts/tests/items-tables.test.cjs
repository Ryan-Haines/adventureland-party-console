// and: each of the items owner's tables asked beside the code it replaces, for one fixture state per
// case. A separate file: it asks every old function and the table on plain states, and no live run
// meets every case. The two realm stay rows and the needs rows join it, since they read the same
// tables.
const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../../runtime/items/rules.ts');
const {commerceRuleKey}=require('../../runtime/items/identity.ts');
const fates=require('../../runtime/items/coordinator/fates.ts');
const {createRealmStay}=require('../../runtime/items/coordinator/needs.ts');
const {partyHooks}=require('../../runtime/hooks/index.ts');

const bag=(cells={})=>{const items=Array(42).fill(null);for(const [slot,item] of Object.entries(cells))items[slot]={slot:Number(slot),item};return items;};
const state=(extra={})=>({merchantCharacter:'M',statuses:{F:{items:bag()},M:{items:bag()}},marked:{},merchantMarked:{},upgrades:{},compounds:{},
  statScrolls:{},autoCompounds:{},autoItemMarks:{},merchantQueue:[],merchantCurrent:null,orders:[],
  restockPolicies:{F:{hp:{item:'hpot1',min:0,max:0},mp:{item:'mpot1',min:0,max:0}},M:{hp:{item:'hpot1',min:0,max:0},mp:{item:'mpot1',min:0,max:0}}},...extra});

test('an exchange reward takes the first active F5 processing rule of the merchant, else F7 banks it and records the bank rule',()=>{
  const item={name:'ringsj',level:0},key=commerceRuleKey(item);
  // A collection rule is no processing rule: a reward with a merchant rule banks, as the earlier
  // console's did.
  const cases=[[{},'bank'],[{autoExchanges:{'ringsj@0':true}},'exchange'],[{autoNpcSales:{[key]:{item}}},'npc'],
    [{autoCompounds:{M:[{name:'ringsj',quantity:-1,targetTier:3}]}},'compound'],[{autoDeconstruction:{M:{[key]:{item}}}},'deconstruction'],
    [{autoItemMarks:{M:{'ringsj@+0':'merchant'}}},'bank']];
  for(const [extra,action] of cases){
    const writes=[],{fates:[fate]}=fates.exchangeRewardFates(state(extra),[item],batch=>{writes.push(batch);return {ok:true};});
    assert.equal(fate.action,action,JSON.stringify(extra));
    if(!Object.keys(extra).length)
      assert.deepEqual(writes.map(w=>w.changes),[[{field:'autoItemMarks',value:{M:{'ringsj@+0':'bank'}}}]],'a banked reward records its bank rule');
    else if(action!=='bank') assert.deepEqual(writes,[],'a processed reward records no rule');
  }
});

test('I1 reads its rows top down; the first that holds decides',()=>{
  const none=()=>null,row=(fate,by)=>()=>({fate,by});
  const rows={held:none,equipped:none,mark:none,claim:none,rule:none,addon:none,reward:()=>false};
  assert.deepEqual(rules.fateOf(rows),{fate:'keep',row:'F7',by:'default'});
  assert.deepEqual(rules.fateOf({...rows,reward:()=>true}),{fate:'bank',row:'F7',by:'default'});
  assert.deepEqual(rules.fateOf({...rows,addon:row('npc','addon:a'),rule:row('bank','rule:M')}),{fate:'bank',row:'F5',by:'rule:M'});
  assert.deepEqual(rules.fateOf({...rows,claim:row('keep','core:restock'),rule:row('bank','rule:M')}),{fate:'keep',row:'F4',by:'core:restock'});
  assert.deepEqual(rules.fateOf({...rows,mark:()=>'merchant',claim:row('keep','core:restock')}),{fate:'merchant',row:'F3',by:'player'});
  assert.deepEqual(rules.fateOf({...rows,held:()=>'delivery',mark:()=>'bank'}),{fate:'held',row:'F1',by:'delivery'});
  let asked=false;
  rules.fateOf({...rows,claim:row('keep','core:restock'),addon:()=>{asked=true;return null;}});
  assert.equal(asked,false,'an add-on is not asked about a claimed copy');
});

test('I7 gives each code one J4 class, and an unknown text none',()=>{
  for(const [code,kind] of Object.entries(rules.ITEM_FAILURES)) assert.equal(rules.failureClass(code),kind);
  assert.equal(rules.failureClass('insufficient gold'),null);
});

test('claims take each copy once, and a lower claim never takes a higher one\'s copy',()=>{
  const s=state({restockPolicies:{F:{hp:{item:'hpot1',min:1,max:2},mp:{item:'mpot1',min:0,max:0}}}});
  s.statuses.F.items=bag({3:{name:'hpot1',q:2},4:{name:'hpot1',q:2},5:{name:'hpot1',q:2}});
  const name='claims-table';
  if(!partyHooks().map().registrations.some(r=>r.name===name))
    assert.deepEqual(partyHooks().register({name,folder:'addons',author:'test',summary:'Claims two hpot1 stacks.',hooks:{
      'items.claim':view=>view.character==='F'?[{item:{name:'hpot1'},quantity:{count:4},place:'carried:F',reason:'table'}]:undefined}}),{ok:true});
  partyHooks().configure({[name]:{enabled:true}});
  const {taken,short}=fates.bagClaims(s,'F');
  assert.deepEqual([...taken].map(([slot,t])=>[slot,t.by]),[[3,'core:restock'],[4,`addon:${name}`],[5,`addon:${name}`]],
    'the restock range takes its copies first; the add-on takes the next ones');
  assert.deepEqual(short,[],'the add-on has its four');
  partyHooks().configure({});
});

const stayFixture=(ready)=>{
  const wants=[],name='core:jobs-ready-table';
  if(!partyHooks().map().registrations.some(r=>r.name===name))
    partyHooks().register({name,folder:'core',author:'test',summary:'Answers jobs.ready for the stay rows.',hooks:{'jobs.ready':()=>globalThis.__itemsTablesReady}});
  globalThis.__itemsTablesReady=ready;
  const stay=createRealmStay({merchant:()=>'M',home:()=>'EU',here:()=>'US',want:(owner,realm)=>{wants.push(['want',realm]);return {ok:true};},
    release:()=>wants.push(['release'])});
  return {stay,wants};
};
test('CF-B2: at equal priority the stay holds while the pick runs the realm\'s job first',()=>{
  const f=stayFixture([{id:'a',reason:'Ponty purchases',target:'M',priority:40,realm:'US'},{id:'b',reason:'restock',target:'M',priority:40,realm:'EU'}]);
  f.stay.ended('Ponty purchases');
  assert.deepEqual(f.wants,[['want','US']]);
});
test('CF-B2: a more urgent home job releases the stay',()=>{
  const f=stayFixture([{id:'a',reason:'Ponty purchases',target:'M',priority:40,realm:'US'},{id:'b',reason:'restock',target:'M',priority:60,realm:'EU'}]);
  f.stay.ended('Ponty purchases');
  assert.deepEqual(f.wants,[['release']]);
});

// G01: an `all` claim at the merchant keeps its bag copies and stages its
// stored copies as marked withdrawals for the next visit; `items.claimPending` counts them until the
// visit takes them, and a claim that ends drops its requests.
test('G01: an all claim fetches its stored copies on the normal visit',()=>{
  const s=state({bankSnapshot:{packs:{items0:[{slot:0,item:{name:'frostscale',q:4}},{slot:1,item:{name:'hpot0',q:9}}]}},bankbois:{},
    merchantAutomations:{},withdrawals:{}});
  s.statuses.M.items=bag({2:{name:'frostscale',q:1}});
  const name='core:claims-table';
  globalThis.__claimsTableOn=true;
  if(!partyHooks().map().registrations.some(r=>r.name===name))
    partyHooks().register({name,folder:'core',author:'test',summary:'Claims every frostscale at the merchant.',hooks:{
      'items.claim':view=>globalThis.__claimsTableOn&&view.character==='M'?[{item:{name:'frostscale'},quantity:{all:true},place:'merchant',reason:'cipher'}]:undefined}});
  const {taken,short}=fates.bagClaims(s,'M');
  assert.deepEqual([...taken].map(([slot,t])=>[slot,t.by]),[[2,name]],'the bag copy is kept, named by the core registration');
  assert.deepEqual(short.map(one=>one.short),[4],'short by the stored copies');
  assert.equal(fates.stageClaimWithdrawals(s,'M'),true);
  assert.deepEqual(s.withdrawals.M.map(r=>[r.pack,r.slot,r.item.name]),[['items0',0,'frostscale']]);
  assert.equal(fates.claimPending(s,'M',name),4);
  assert.equal(fates.stageClaimWithdrawals(s,'M'),false,'one request per cell');
  // A copy the player banks by hand stays banked for that claim, and the record lapses with it.
  s.claimBanked={};
  fates.recordClaimBanked(s,'M',[{slot:2,item:{name:'frostscale',q:1},auto:true}]);
  assert.deepEqual(s.claimBanked,{},'an auto bank receipt records nothing');
  fates.recordClaimBanked(s,'M',[{slot:2,item:{name:'frostscale',q:1}}]);
  assert.equal(fates.stageClaimWithdrawals(s,'M'),true);
  assert.deepEqual(s.withdrawals.M,[],'the claim fetches none of the copies the player banked');
  s.claimBanked={};
  assert.equal(fates.stageClaimWithdrawals(s,'M'),true);
  // G01: an auto bank rule never banks a claimed copy, so the
  // claim's fetch never brings back what the rule deposited, with the withdrawals automation on or off.
  s.autoItemMarks={M:{'frostscale@+0':'bank'}};
  const bankMarks=()=>{fates.reconcileCoordinatorCollectionMarks(s,'M',s.statuses.M);return (s.marked.M||[]).map(mark=>mark.slot);};
  assert.deepEqual(bankMarks(),[],'a claimed copy carries no auto bank mark');
  s.merchantAutomations.withdrawals=false;
  assert.deepEqual(bankMarks(),[],'nor with the withdrawals automation off');
  s.merchantAutomations.withdrawals=true;
  fates.recordClaimBanked(s,'M',[{slot:2,item:{name:'frostscale',q:1}}]);
  globalThis.__claimsTableOn=false;
  assert.equal(fates.stageClaimWithdrawals(s,'M'),true);
  assert.deepEqual(s.withdrawals.M,[],'an ended claim drops its requests');
  assert.deepEqual(s.claimBanked,{},'and the player bank record lapses with it');
  assert.deepEqual(bankMarks(),[2],'with the round over, F5 banks it');
  // F1 and F4 hold a copy from the same rule: a queued job's input and a fighter's restock range.
  s.merchantQueue=[{id:'x',exchanges:[{id:'frostscale',level:0,quantity:1}]}];
  assert.deepEqual(bankMarks(),[],'a job input carries no auto bank mark');
  s.statuses.F.items=bag({0:{name:'hpot1',q:50}});s.autoItemMarks.F={'hpot1@+0':'bank'};s.restockPolicies.F.hp={item:'hpot1',min:10,max:100};
  fates.reconcileCoordinatorCollectionMarks(s,'F',s.statuses.F);
  assert.deepEqual(s.marked.F,[],'a restock-claimed copy carries no auto bank mark');
});
// The rule migration reads a key's level through identity.ts, so a name-only rule from
// before levels moves to the merchant as the same item's +0 rule.
test('a legacy name-only item rule migrates as the +0 rule, and a levelled key keeps its level',()=>{
 const {migrateSharedRules}=require('../../runtime/items/coordinator/fates.ts');
 const state={merchantCharacter:'M',autoItemMarks:{F:{ringsj:'bank','ringsj@+2':'merchant'}},autoUpgradeMarks:{},autoCompounds:{},autoDeconstruction:{},autoNpcSales:{},npcSaleMarks:[]};
 const writes=[];assert.equal(migrateSharedRules(state,['F'],batch=>{writes.push(batch);return {ok:true,changed:[]};}).ok,true);
 const marks=writes[0].changes.find(change=>change.field==='autoItemMarks').value;
 assert.deepEqual(marks,{M:{'ringsj@+0':'bank','ringsj@+2':'merchant'}});
});

test("P11: the add-on's sell runs before the core deposit, and a held copy stays held",()=>{
  const none=()=>null,row=(fate,by)=>()=>({fate,by});
  const rows={held:none,equipped:none,mark:none,claim:none,rule:row('bank','rule:M'),reward:()=>false};
  let order={before:'bank'};
  const ask=core=>rules.addonAhead(order,core)?{fate:'npc',by:'addon:seller',ahead:true}:null;
  assert.deepEqual(rules.fateOf({...rows,addon:ask}),{fate:'npc',row:'F6',by:'addon:seller'});
  order={after:'merchant'};
  assert.deepEqual(rules.fateOf({...rows,addon:ask}),{fate:'bank',row:'F5',by:'rule:M'});
  order={before:'bank'};
  assert.deepEqual(rules.fateOf({...rows,held:()=>'delivery',addon:ask}),{fate:'held',row:'F1',by:'delivery'});
  // Through the registry: the add-on's answer with its order takes the items owner's F6 row over
  // the bank rule.
  const st=state({statuses:{F:{items:bag({0:{name:'hpot1',q:1}})},M:{items:bag()}},autoItemMarks:{F:{'hpot1@+0':'bank'}}});
  const before=fates.itemFate(st,'F',0);
  assert.equal(before.row,'F5');
  assert.deepEqual(partyHooks().register({name:'seller',folder:'addons',author:'test',summary:'Sells potions.',
    hooks:{'items.action':a=>a.item.name==='hpot1'?{action:'npc',order:{before:before.fate}}:undefined}}),{ok:true});
  partyHooks().configure({seller:{enabled:true}});
  try{ assert.deepEqual(fates.itemFate(st,'F',0),{fate:'npc',row:'F6',by:'addon:seller'}); }
  finally{ partyHooks().configure({seller:{enabled:false}}); }
});

test("items-rules part 4: the copies an add-on's action holds are published by character and slot, and cleared when it is off",()=>{
  const st=state({statuses:{F:{items:bag({0:{name:'hpot1',q:1},1:{name:'mpot1',q:1}})},M:{items:bag()}}});
  assert.equal(fates.publishAddonFates(st,'F'),false);
  assert.deepEqual(partyHooks().register({name:'potseller',folder:'addons',author:'test',summary:'Sells potions.',
    hooks:{'items.action':a=>a.item.name==='hpot1'?{action:'npc'}:undefined}}),{ok:true});
  partyHooks().configure({potseller:{enabled:true}});
  try{
    assert.equal(fates.publishAddonFates(st,'F'),true);
    assert.deepEqual(st.addonItemFates,{F:{0:{fate:'npc',row:'F6',by:'addon:potseller'}}});
    assert.equal(fates.publishAddonFates(st,'F'),false);
  }finally{ partyHooks().configure({potseller:{enabled:false}}); }
  assert.equal(fates.publishAddonFates(st,'F'),true);
  assert.deepEqual(st.addonItemFates,{});
});
