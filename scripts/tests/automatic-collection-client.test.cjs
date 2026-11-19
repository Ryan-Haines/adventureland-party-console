const {test}=require('node:test'),{scenarioTable}=require('./fixtures/scenarios.cjs'),assert=require('node:assert/strict'),vm=require('node:vm');
const {availableCraftStock}=require('../../runtime/items/rules.ts');
function fixture(){
 const item={name:'gem',level:0,q:8},pickup={slot:0,item:{...item},quantity:4,automaticPickup:true},sent=[],requests=[];
 let current=[pickup],protection={requirements:[]},fateAnswer=null;
 // The coordinator's job answer: a copy's fate (the items owner's items.fate) sends an unlocked pickup to the
 // merchant, and its keep list carries the quantity no craft reservation holds.
 const fate=()=>fateAnswer||(context.character.items[0]?.l?{fate:'held',row:'F3',by:'locked'}:{fate:'merchant',row:'F5',by:'pickup'});
 const context={character:{name:'F',map:'main',in:'main',x:0,y:0,cc:0,rip:false,items:[{...item}],slots:{},gold:0},navigationIntent:{revision:1},lastCommand:1,
 runtimeCurrent:()=>true,reunionRealm:()=> 'USI',get_player:()=>({name:'M',map:'main',in:'main',x:1,y:0,rip:false}),engagedMonster:()=>null,sleep:async()=>{},
 waitForPlayer:async()=>({}),assertMerchantContinuation(){},sameItem:(a,b)=>!!a&&!!b&&a.name===b.name&&a.level===b.level,
 findItem:()=>0,freeInventorySlots:()=>10,itemQuantity:i=>i.q||1,game_log(){},encodeURIComponent,
 send_item:async(to,slot,q)=>{sent.push({to,slot,q});context.character.items[slot].q-=q;if(!context.character.items[slot].q)context.character.items[slot]=null;},
 request:async(url,options)=>{requests.push({url,body:options?.body});return{collectionPickups:{keep:current},craftProtection:protection,fates:{0:fate()}};}};
 vm.createContext(context);
 // The visit's compound stock is the items owner's production read (production.ts `compoundAvailableStock`) over the fighter's bag.
 context.compoundAvailableStock=require('./helpers/items-character.cjs').productionHarness({character:context.character}).production.compoundAvailableStock;
 // The fighter's visit is the job owner's character module.
 require('./helpers/merchant-visits.cjs').installVisits(context);require('./helpers/merchant-runner.cjs').installRunner(context);
 return{context,pickup,sent,requests,command:{id:1,jobId:'j',merchant:'M',capacity:3,merchantMarked:[pickup]},disable(){current=[]},
  exchange(){const mark={...pickup,quantity:8,exchangeJobId:'x'};current=[mark];this.command.merchantMarked=[mark];fateAnswer={fate:'held',row:'F1',by:'exchange'};},protect(){protection={requirements:[{id:'gem',level:0,quantity:5}]};current=[{...pickup,quantity:3}];}};
}
// The send window waits for the merchant's distance and the
// command's state only; the fighter's own call cost no longer holds a send, since the call budget's
// bands keep combat's room.
scenarioTable('automatic pickup sends only the currently authorized unreserved quantity as kept cargo',fixture,[0,190].map(cc=>
 ['at a call cost of '+cc,async f=>{
  f.protect();f.context.character.cc=cc;await f.context.merchantHandoff(f.command);
  assert.deepEqual(f.sent,[{to:'M',slot:0,q:3}]);
  const receipt=f.requests.find(r=>r.url==='/merchant/handoff-complete').body;assert.equal(receipt.kept[0].quantity,3);assert.equal(receipt.kept[0].automaticPickup,true);assert.equal(receipt.banked.length,0);
 }]));
// A one-time exchange's mark holds the copy (fates.ts `copyFate`, held by 'exchange') against every
// other errand; the exchange's own pickup is the errand that takes it to the merchant.
test('an exchange pickup sends the copy its own exchange holds',async()=>{
 const f=fixture();f.exchange();await f.context.merchantHandoff(f.command);
 assert.deepEqual(f.sent,[{to:'M',slot:0,q:8}]);
 const receipt=f.requests.find(r=>r.url==='/merchant/handoff-complete').body;
 assert.equal(receipt.kept[0].exchangeJobId,'x');assert.equal(receipt.kept[0].quantity,8);
});
test('disabled rules, locked items and stale slots cannot send an automatic pickup',async()=>{
 for(const mode of ['disabled','locked','moved']){const f=fixture();if(mode==='disabled')f.disable();if(mode==='locked')f.context.character.items[0].l='l';if(mode==='moved'){f.context.character.items[1]=f.context.character.items[0];f.context.character.items[0]=null;}await f.context.merchantHandoff(f.command);assert.equal(f.sent.length,0,mode);}
});
test('activity reports only processing commands and suppresses duplicate stage reports',async()=>{
 const f=fixture(),command={jobId:'j',processingRoutine:'auto compound'};
 const stage=f.context.merchantRunner.operationStage;await stage(command,'retrieving');await stage(command,'retrieving');await stage(command,'processing');await stage(command,'storing');await stage({jobId:'pickup'},'processing');
 assert.deepEqual(f.requests.map(r=>r.body.operationStage),['retrieving','processing','storing']);
});
