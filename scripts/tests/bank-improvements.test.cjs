// Native merchant status always reports all 42 inventory slots.
// The merchant's bank visit runs on bank.ts (helpers/bank-stacks.cjs `bankRuntime`) and the bank
// upgrade preparation on production.ts (helpers/items-character.cjs `productionHarness`).
const {bankRuntime}=require('./helpers/bank-stacks.cjs');
const {productionHarness,vault}=require('./helpers/items-character.cjs');
const nativeInventory=(items=[])=>items.concat(Array(42-items.length).fill(null));
const test=require('node:test'),assert=require('node:assert/strict');
const {sharedUpgradeRules,runnableBankUpgrades,planUpgradeStorage,sharedCompoundRules}=require('../../runtime/items/coordinator/production.ts');
const {createImprovementScheduler}=require('../../runtime/items/coordinator/production.ts');
const {reconcileCollectionMarks}=require('../../runtime/items/coordinator/fates.ts'),{ruleMode}=require('../../runtime/items/identity.ts');
const {coordinatorMerchantPriority}=require('../../runtime/merchant-jobs/rules.ts');
const {visitWithdrawals,visitPlanned}=require('../../runtime/items/coordinator/needs.ts');
const {jobsReady}=require('./helpers/test-registry.cjs');
const item=(name,level=0,extra={})=>({name,level,...extra});
const entry=(name,level=0,extra={})=>({slot:0,item:item(name,level,extra)});
// The merchant arrives on the bank floor before the game sends the vault; the vault lands at the
// first wait. `errands` is the visit's gold deposit.
test('bank visits wait for the bank snapshot before checkpointing or running errands',async()=>{
 const calls=[],vault={items0:Array(42).fill(null)};
 const r=bankRuntime(vault,undefined,undefined,{character:{map:'main',bank:undefined,gold:100},ports:{
  sleep:async()=>{if(!r.character.bank){r.character.bank=vault;calls.push('loaded');}},
  bankDeposit:async()=>calls.push('errands'),
  request:async path=>{if(path==='/bankboi/checkpoint'){assert.ok(r.character.bank);calls.push('checkpoint');}return path==='/merchant/bank-sort/checkpoint'?{mode:'off'}:{};}}});
 r.game.smart_move=async()=>calls.push('arrive');
 await r.bank.merchantVisitBank({merchantGoldTarget:0},[]);assert.deepEqual(calls,['arrive','loaded','checkpoint','errands','checkpoint']);
});
function state(){return {merchantCharacter:'M',statuses:{M:{items:nativeInventory()},F:{items:[]}},autoUpgradeMarks:{F:{'sword@+0':{tiers:3,quantity:1}}},autoCompounds:{F:[{name:'ring',targetTier:3,quantity:-1}]},autoItemMarks:{M:{'sword@+0':'bank','ring@+0':'bank'}},bankSnapshot:{packs:{items0:[entry('sword'),entry('ring'),entry('ring'),entry('ring')]}},bankbois:{},merchantAutomations:{},merchantQueue:[],withdrawals:{}}}
test('staged improvement stock prioritizes its consuming job ahead of an unrelated bank visit',()=>{
 const s={bankbois:{B:{name:'B'}},merchantCharacter:'M',merchantRoutinePriorities:{'manual bank exchange':80,'upgrades and compounds':70},withdrawals:{M:[{pack:'items1',slot:35,improvement:'upgrades and compounds'}]},bankSnapshot:{packs:{items1:{35:entry('sword')}}}};
 assert.ok(coordinatorMerchantPriority(s,{target:'M',reason:'upgrades and compounds'})>coordinatorMerchantPriority(s,{target:'M',reason:'manual bank exchange'}));
 delete s.bankSnapshot.packs.items1[35];assert.equal(coordinatorMerchantPriority(s,{target:'M',reason:'upgrades and compounds'}),70);
});
test('shared bank stock schedules upgrades and compounds while preserving permanent bank preferences',()=>{
 const s=state(),before=JSON.stringify(s.autoItemMarks),queued=[];
 const scheduler=createImprovementScheduler(Object.assign(s,{production:s.production||{attempts:{}}}),{now:()=>1,nextCommand:()=>1,stamp:x=>x,persist(){},log(){},queue:(names,reason)=>queued.push({names,reason})});
 scheduler.compound('M',s.statuses.M);
 assert.ok(queued.some(x=>x.reason==='auto upgrade'));assert.ok(queued.some(x=>x.reason==='auto compound'));
 assert.equal(JSON.stringify(s.autoItemMarks),before);
 s.statuses.F.items=[entry('sword',3)];assert.equal(runnableBankUpgrades(s).length,1);
 s.statuses.F.items=[];s.bankSnapshot.packs.items0[0].item.l='l';assert.equal(runnableBankUpgrades(s).length,0);
});

test('disabling auto upgrade suppresses bank upgrade jobs without deleting rules',()=>{
 const s=state(),queued=[];s.merchantAutomations['auto upgrade']=false;
 const scheduler=createImprovementScheduler(Object.assign(s,{production:s.production||{attempts:{}}}),{now:()=>1,nextCommand:()=>1,stamp:x=>x,persist(){},log(){},queue:(_names,reason)=>queued.push(reason)});
 scheduler.compound('M',s.statuses.M);
 assert.equal(queued.includes('auto upgrade'),false);assert.ok(s.autoUpgradeMarks.F['sword@+0']);
});
// A rule saved to +13 plans no attempt past the game's +12, and a rule from +12 plans none (red
// on v1.5.0, which planned 12 to 13).
test("an automatic upgrade rule to +the lifecycle owner runs to the game's +12",()=>{
 const s=state();s.autoUpgradeMarks.F={'sword@+10':{tiers:3,quantity:1},'blade@+12':{tiers:1,quantity:1}};
 assert.deepEqual(sharedUpgradeRules(s).map(rule=>[rule.name,rule.level,rule.tiers]),[['sword',10,2]]);
});
test('duplicate rules authorize one pass; BankBoi requests reserve only missing improvement stock',()=>{
 const s=state();s.autoUpgradeMarks.M={'sword@+0':{tiers:3,quantity:1}};
 assert.equal(sharedUpgradeRules(s).length,1);assert.equal(sharedUpgradeRules(s)[0].tiers,3);
 s.autoCompounds.M=[{name:'ring',targetTier:3,quantity:1}];assert.deepEqual(sharedCompoundRules(s),[{name:'ring',targetTier:3,quantity:-1}]);
 s.bankbois.B={name:'B',items:[{slot:4,item:item('sword')}]};
 assert.deepEqual(planUpgradeStorage(s,runnableBankUpgrades(s)),[]);
 s.bankSnapshot.packs.items0=[];
 assert.deepEqual(planUpgradeStorage(s,runnableBankUpgrades(s)),[{pack:'bankboi:B',slot:4,item:item('sword'),improvement:"auto upgrade"}]);
});
// A merchant on the bank floor whose bag holds `items`; `stored` lists each bag cell a visit deposits.
function errandVisit(items){
 const r=bankRuntime({items0:Array(42).fill(null)},[...items,...Array(6).fill(null)]);
 return {...r,stored:()=>r.calls.filter(call=>call[0]==='store').map(call=>call[1])};
}
test('bank errands skip active upgrade and compound ingredients, then normal banking resumes',async()=>{
 const r=errandVisit([item('sword'),item('ring'),item('junk')]);
 const marks=[{slot:0,item:item('sword')},{slot:1,item:item('ring')},{slot:2,item:item('junk')}];
 const command={type:'merchant-self-improve',upgrades:[{slot:0,item:item('sword'),tiers:3}],autoCompounds:[{name:'ring',targetTier:3}],merchantBankMarked:marks};
 await r.bank.merchantVisitBank(command,[]);assert.deepEqual(r.stored(),[2]);assert.equal(command.merchantBankMarked.length,3);
 await r.bank.merchantVisitBank({...command,type:'merchant-self-bank',_merchantBankErrandsChecked:false},[]);assert.deepEqual(r.stored(),[2,0,1]);
 const result=reconcileCollectionMarks([],[],[entry('sword')],one=>ruleMode({'sword@+0':'bank'},one.item));assert.equal(result.bank.length,1);
});
// A copy a craft reservation holds stays in the bag while the other marked copies bank.
test('bank errands keep a craft-reserved copy and bank the rest',async()=>{
 const r=errandVisit([item('cloth'),item('junk')]),activity=[];
 const command={type:'merchant-self-bank',craftProtection:{requirements:[{id:'cloth',level:0,quantity:1}]},merchantBankMarked:[{slot:0,item:item('cloth')},{slot:1,item:item('junk')}]};
 await r.bank.merchantVisitBank(command,activity);
 assert.deepEqual(r.stored(),[1]);assert.ok(activity.some(entry=>/Kept cloth reserved for crafting/.test(entry.message)));
});
// A visit's withdrawals put the ready jobs on the merchant's realm ahead of a job on
// another realm, and stop at the bag's free cells. A visit's withdrawals fill only the cells past
// the protected ones.
test('a visit withdraws for its realm\'s ready jobs first and stops at the bag',t=>{
 const s=state();s.statuses.M.server='EUI';s.statuses.M.items=nativeInventory(Array(38).fill(item('junk')));
 const here={pack:'items0',slot:1,item:item('ring'),craftJobId:'a'},there={pack:'items0',slot:2,item:item('ring'),craftJobId:'b'};
 s.withdrawals={M:[there,here]};
 s.merchantQueue=[{id:'a',target:'M',reason:'craft'},{id:'b',target:'M',reason:'craft'}];
 jobsReady(t,[{id:'a',target:'M',reason:'craft',priority:50,realm:'SR_EUI'},{id:'b',target:'M',reason:'craft',priority:50,realm:'SR_USI'}]);
 assert.deepEqual(visitWithdrawals(s,{id:'v',target:'M',reason:'bank visit'}),[here]);
 s.statuses.M.items=nativeInventory(Array(39).fill(item('junk')));
 assert.deepEqual(visitWithdrawals(s,{id:'v',target:'M',reason:'bank visit'}),[]);
});
// An automatic NPC sale's visit withdraws its own sale stock ahead of the player's marks.
test('an auto npc withdrawals visit takes its own sale stock first',t=>{
 const s=state();s.statuses.M.items=nativeInventory(Array(38).fill(item('junk')));
 const marked={pack:'items0',slot:1,item:item('ring')},sale={pack:'items0',slot:2,item:item('ring'),autoNpcRuleKey:'ring@+0'};
 s.withdrawals={M:[marked,sale]};jobsReady(t,[]);
 assert.deepEqual(visitWithdrawals(s,{id:'n',target:'M',reason:'auto npc withdrawals'}),[sale]);
});
// A marked withdrawal rides a planned own visit; with none planned, its own job is
// queued.
test('a marked withdrawal rides a planned visit and gets a trip only with none planned',()=>{
 const s=state();s.merchantQueue=[{id:'v',target:'M',reason:'auto upgrade'}];
 assert.equal(visitPlanned(s),true);
 s.merchantQueue=[];s.merchantCurrent=null;assert.equal(visitPlanned(s),false);
});
// merchantSelfImprove prepares the bank upgrades, then stops at the offering checkpoint, which the
// row's coordinator refuses.
test('bank upgrade preparation withdraws bounded unlocked matching stock and respects finite targets',async()=>{
 const character={name:'M',ctype:'merchant',items:Array(8).fill(null),slots:{},q:{},bank:{items0:[item('sword',0,{l:'l'}),item('sword'),item('sword'),item('sword'),item('sword')]}};
 const {bank,bankRetrieve,withdrawals}=vault(character);
 const {production}=productionHarness({character,G:{items:{sword:{upgrade:true}},skills:{}},bank:{...bank,merchantVisitBank:async()=>{}},
  ports:{bankRetrieve,request:async()=>{throw Error('offering checkpoint refused');}}});
 const prepare=async rules=>{const command={jobId:'j',statScrolls:[],bankUpgradeRules:rules};await production.merchantSelfImprove(command).catch(()=>{});return command;};
 const rule={name:'sword',level:0,tiers:3,quantity:1};
 const command=await prepare([rule]);
 assert.deepEqual(withdrawals,[1]);assert.equal(command.upgrades.length,1);assert.equal(command.upgrades[0].tiers,3);
 character.items[0].level=3;await prepare([rule]);assert.deepEqual(withdrawals,[1,2]);
 const unlimited=await prepare([{...rule,quantity:-1}]);assert.equal(unlimited.upgrades.length,3);assert.equal(character.bank.items0[0].l,'l');
});
// The live BankBoi Lantern row: the visit's withdrawals take the group's reserved bank cells, so
// the compound marks find those cells empty. Each mark takes its copy from the bag cell the visit
// landed it in, and the receipt names that cell for the coordinator's compound marks.
test('a compound mark whose bank cell the visit withdrew takes the copy the visit landed in the bag',async()=>{
 const lantern=item('lantern',2),character={name:'M',ctype:'merchant',items:[null,null,{...lantern,oo:'M'},null,null,null,null,null],slots:{},q:{},bank:{items1:Array(42).fill(null)}};
 const {bank,bankRetrieve}=vault(character),bodies=[];
 const {production}=productionHarness({character,G:{items:{lantern:{compound:true}},skills:{}},bank:{...bank,merchantVisitBank:async()=>{}},
  ports:{bankRetrieve,request:async(path,options)=>{bodies.push({path,body:options?.body});throw Error('stop after the bank stage');}}});
 const withdrawal={pack:'items1',slot:35,item:lantern,improvement:'manual compounds'};
 const command={jobId:'j',statScrolls:[],compounds:[{id:'group-1',items:[{slot:-1,item:lantern,storage:{pack:'items1',slot:35}}]}],
  _merchantWithdrawalsCompleted:[withdrawal],_merchantWithdrawalsLanded:[{pack:'items1',slot:35,inventorySlot:2}]};
 await production.merchantSelfImprove(command).catch(()=>{});
 const mark=command.compounds[0].items[0];
 assert.equal(mark.storageReceived,true);assert.equal(mark.slot,2);
 assert.deepEqual(command._merchantWithdrawalsCompleted,[{...withdrawal,inventorySlot:2}]);
 assert.ok(!JSON.stringify(bodies).includes('Reserved bank compound item changed'));
});
test('a visit withdrawal records the bag cell its copy landed in',async()=>{
 const r=bankRuntime({items0:[null,item('lantern',2),...Array(40).fill(null)]},[item('junk'),null,null,null,null,null,null,null]);
 const withdrawal={pack:'items0',slot:1,item:item('lantern',2),improvement:'manual compounds'},command={type:'merchant-self-improve',merchantWithdrawals:[withdrawal]};
 await r.bank.merchantVisitBank(command,[]);
 assert.deepEqual(command._merchantWithdrawalsCompleted,[withdrawal]);
 assert.equal(command._merchantWithdrawalsLanded.length,1);
 assert.equal(r.character.items[command._merchantWithdrawalsLanded[0].inventorySlot].name,'lantern');
});
