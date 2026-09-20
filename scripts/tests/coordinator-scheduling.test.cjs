const test=require('node:test');
const assert=require('node:assert/strict');
const {createMerchantScheduling}=require('../../runtime/coordinator/status/merchant-scheduling.ts');
function fixture(){
 const state={merchantCharacter:'M',merchantCurrent:null,merchantQueue:[],merchantAutomations:{},gatheringModes:[],gatheringCooldowns:{},
  merchantCapacityBlocked:false,transferSignatures:{},itemCollectionThreshold:5,upgrades:{},compounds:{},statScrolls:{},marked:{},merchantMarked:{},
  statuses:{M:{name:'M',items:Array(10).fill(null)}},bankCurrent:null,bankStartedAt:0,threshold:1000,thresholdRunActive:false,bankCycleMembers:{}};
 const effects=[];let slots=0,gold=[];
 const ports={reconcileItems:()=>{effects.push('items');return true;},reconcileUpgrades:()=>{effects.push('upgrades');return true;},reconcileSales:()=>{effects.push('sales');return true;},
  luck:()=>effects.push('luck'),recovery:()=>effects.push('recovery'),standMarket:()=>false,giveaways:()=>effects.push('giveaways'),compounds:()=>effects.push('compound'),exchanges:()=>effects.push('exchange'),
  policy:()=>({hp:{item:'hpot',min:1,max:10},mp:{item:'mpot',min:1,max:10}}),queue:(names,reason)=>effects.push(['queue',names,reason]),
  markedItem:mark=>mark.item,sameItem:(left,right)=>left?.name===right.name,collectionSlots:()=>slots,standSync:()=>effects.push('stand'),dispatch:()=>effects.push('dispatch'),idle:()=>effects.push('idle'),bankboi:()=>effects.push('bankboi'),
  clearCommand:name=>effects.push(['clear',name]),dispatchBank:()=>effects.push('dispatchBank'),activeGold:()=>gold,persist:()=>effects.push('persist'),now:()=>200000};
 return {state,effects,observe:createMerchantScheduling(state,ports).observe,slots:value=>{slots=value;},gold:value=>{gold=value;}};
}
test('first reconnect preserves marks and subsequent reports run all reconciliation even when one changed',()=>{
 const f=fixture(), report={name:'P'};f.observe(report,false);assert.equal(f.effects.includes('items'),false);
 f.effects.length=0;f.observe(report,true);assert.deepEqual(f.effects.slice(0,4),['items','upgrades','sales','persist']);
});

test('fighter automatic marks schedule collection and retire empty legacy manual jobs',()=>{
 const f=fixture();f.state.upgrades.P=[{auto:true,item:{name:'wcap'}}];
 f.state.merchantQueue=[{target:'P',reason:'manual upgrades'},{target:'P',reason:'auto compound'}];
 f.observe({name:'P',items:[]},false);
 assert.ok(f.effects.some(x=>Array.isArray(x)&&x[2]==='marked items'));
 assert.equal(f.effects.some(x=>Array.isArray(x)&&x[2]==='manual upgrades'),false);
 assert.deepEqual(f.state.merchantQueue,[{target:'P',reason:'auto compound'}]);
 f.state.upgrades.P.push({item:{name:'coat'}});f.observe({name:'P',items:[]},false);
 assert.ok(f.effects.some(x=>Array.isArray(x)&&x[2]==='manual upgrades'));
});
test('below-threshold collection is not scheduled; capacity reserve blocks collection and resets stale signatures',()=>{
 const f=fixture(),report={name:'P',items:[{item:{name:'coat'}}]};f.state.marked.P=[{slot:0,item:{name:'coat'}}];
 f.state.merchantAutomations.restock=false;f.state.merchantAutomations['inventory cleanout']=false;
 f.slots(2);f.observe(report,false);assert.equal(f.effects.some(entry=>Array.isArray(entry)&&entry[2]==='marked items'),false);
 f.slots(5);f.observe(report,false);assert.equal(f.effects.filter(entry=>Array.isArray(entry)&&entry[2]==='marked items').length,1);
 f.observe(report,false);assert.equal(f.effects.filter(entry=>Array.isArray(entry)&&entry[2]==='marked items').length,1);
 f.observe({name:'M',items:Array(3).fill(null)},false);assert.equal(f.state.merchantCapacityBlocked,true);assert.deepEqual(f.state.transferSignatures,{});
});
test('gold collection queues newcomers once per threshold cycle and fighter restock follows dispatch',()=>{
 const f=fixture();f.gold([{name:'P',gold:2000}]);f.observe({name:'P',items:[]},false);
 assert.ok(f.effects.indexOf('idle')<f.effects.findIndex(entry=>Array.isArray(entry)&&entry[2]==='restock'));
 assert.deepEqual(f.effects.at(-1),['queue',['P'],'gold threshold']);
 f.observe({name:'P'},false);assert.deepEqual(f.effects.at(-1),['queue',[],'gold threshold']);
 f.gold([]);f.observe({name:'P'},false);assert.equal(f.state.thresholdRunActive,false);
});
test('pending delivery equipment resumes after restart without overwriting another command',()=>{
 const f=fixture();f.state.nextCommandId=10;f.state.commands={P:{id:9,type:'convoy'}};
 f.state.merchantDeliveries={P:[{item:{name:'intearring',level:2},awaitingEquip:true}]};
 f.observe({name:'P'},false);assert.equal(f.state.commands.P.type,'convoy');
 delete f.state.commands.P;f.observe({name:'P'},false);
 assert.equal(f.state.commands.P.type,'equip-deliveries');assert.equal(f.state.commands.P.items[0].level,2);
 delete f.state.commands.P;f.observe({name:'P'},false);assert.equal(f.state.commands.P,undefined,'failed attempts are rate limited');
});

test('merchant observations persist relocated delivery marks before scheduling further work',()=>{
 const f=fixture(),mark={id:'delivery',slot:1,item:{name:'sword',level:2},equipOnDelivery:true};
 f.state.merchantDeliveries={P:[mark]};
 const report={name:'M',seenAt:200000,items:[{slot:1,item:{name:'leather',q:20}},{slot:7,item:{...mark.item}}]};
 f.state.statuses.M=report;
 f.observe(report,false);
 assert.equal(mark.slot,7);assert.equal(mark.id,'delivery');assert.equal(mark.equipOnDelivery,true);
 assert.equal(f.effects[0],'persist');assert.ok(f.effects.indexOf('persist')<f.effects.indexOf('idle'));
});
