const {withRunner}=require('./helpers/merchant-runner.cjs');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {productionFunctions} = require('./helpers/production-functions.cjs');
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
const {createMerchantObservation}=require('../../runtime/items/coordinator/market.ts');
function fixture(){const party={merchantCharacter:'M',statuses:{M:{map:'bank',x:0,y:-37,seenAt:Date.now()}},merchantQueue:[{reason:'marked items'}],gatheringModes:['fishing'],gatheringCooldowns:{fishing:Date.now()+60000},commands:{},standListings:[],nextCommandId:1,withdrawals:{},bankbois:{}};
const r=withRunner(vm.createContext({merchantInventoryStacks:{plan:require('../../runtime/items/coordinator/storage.ts').inventoryMergePlan},party,bankboiSwitchBusy:false,bankboiService:{busy:()=>r.bankboiSwitchBusy},merchantAnniversaryControl:()=>({}),ensureMerchantHome:()=>true,merchantTransferCapacityBlocked:()=>false,markedCollectionReady:job=>job.reason!=='marked items'}));
require('./helpers/coordinator-idle.cjs')(r);return {r,party};}
scenarioTable('the merchant idle dispatch gives the stand return or yields to its owner',fixture,[
 ['deferred pickups allow the stand return while gathering is disabled or cooling down',()=>{
 const {r,party}=fixture();r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle','the fishing cooldown');
 delete party.commands.M;party.gatheringModes=[];r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle','gathering disabled');
}],
// The helper composes the stand return as the coordinator does, so the owner's event hold runs: a
// merchant whose fresh report holds it for a selected event gets no stand return.
 ['an event reservation holds the stand return',({r,party})=>{party.gatheringModes=[];party.eventSelectionsByCharacter={M:['snowman']};party.statuses.M.merchantEventReserved=true;r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);}],
// The stand return reads the dispatch's readiness, so gathering the dispatch refuses at three free slots does not keep it.
 ['gathering at three free slots leaves the stand return to go',({r,party})=>{party.gatheringCooldowns.fishing=0;party.statuses.M.items=[null,null,null,{name:'wbook0'}];r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');}],
// The game opens a stand only from a stand item in the bag (runner_functions.js open_stand). A farm
// run with no stand0 failed "Could not update stand" on every report; the bank sort live rows wait
// for the standless merchant to leave the bank.
 ['a merchant with no stand in its bag walks back from the bank and opens nothing',({r,party})=>{party.gatheringModes=[];party.statuses.M.standItem=null;r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');assert.equal(party.commands.M.noStand,true);
 delete party.commands.M;party.statuses.M.standItem='stand0';r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');assert.equal(party.commands.M.noStand,undefined);}],
 ['a merchant with no stand in its bag at the market gets no stand return',({r,party})=>{party.gatheringModes=[];Object.assign(party.statuses.M,{map:'main',x:-63,y:100,standItem:null});r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);}],
 ['open stand away from market still requires a return',({r,party})=>{party.gatheringModes=[];party.statuses.M.standOpen=true;r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');}],
 ['already open at market does not issue another return',({r,party})=>{Object.assign(party.statuses.M,{map:'main',x:-63,y:100,standOpen:true});r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);}],
 ['anniversary reservation returns to stand despite paused queue and gathering',({r,party})=>{r.merchantAnniversaryControl=()=>({reserved:true,preWindow:true});r.markedCollectionReady=()=>true;r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');}],
 ['active anniversary kiss retains movement ownership',({r,party})=>{r.merchantAnniversaryControl=()=>({reserved:true,busy:true});r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);}],
]);

test('ready collection and ready gathering retain priority over stand return',()=>{for(const mode of ['collection','gathering']){const {r,party}=fixture();if(mode==='collection')r.markedCollectionReady=()=>true;else party.gatheringCooldowns.fishing=0;r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);}});

test('stand-open log checks coordinates before claiming arrival',()=>{const logs=[];const observer=createMerchantObservation({listings:[]},{log:(...args)=>logs.push(args),persist(){},publish(){}});const body={standOpen:true,map:'bank',x:0,y:-37},previous={standOpen:false,map:'bank'};observer.observe(body,previous);assert.equal(logs[0][0],'Stand opened away from market');body.map='main';body.x=-63;body.y=100;observer.observe(body,previous);assert.equal(logs[1][0],'At stand');});
const shared=fs.readFileSync('characters/shared.js','utf8');
// The stand return in the runner: a walk that resolves on the wrong map is no arrival. The game's
// open_stand and close_stand flip the character's stand.
function standContext(extra){const c=vm.createContext(Object.assign({request:async()=>{},root:{},character:{name:'M',map:'bank',x:0,y:-37,items:[]},
 merchantHomeRealm:'US',smart_move:async()=>{},close_stand:async()=>{c.character.stand=false;},open_stand:async()=>{c.character.stand=true;},
 game_log(){},recoverLuckyUpgrade:async()=>{},tidyLuckySlot:async()=>{},freeInventorySlots:()=>10},extra));return withRunner(c);}
test('resolved movement at the wrong map cannot count as stand arrival',async()=>{
 const r=standContext();
 await assert.rejects(r.merchantRunner.standReturn({id:1},()=>true),/before reaching the market/);
 assert.equal((await r.merchantRunner.standReturn({id:1,inPlace:true},()=>true)).state,'complete');
 Object.assign(r.character,{map:'main',x:-63,y:100});
 assert.equal((await r.merchantRunner.standReturn({id:1},()=>true)).state,'complete');
});
// The stand return holds and opens the stand; a job command that arrives while it awaits its idle
// status ends it, and the job starts only after the release has closed the stand, with no close
// of its own.
test('a job command meets the stand return, which closes the stand before the job starts',async()=>{
 let arrived;const gate=new Promise(resolve=>{arrived=resolve;}),seen=[];
 const r=standContext({character:{name:'M',map:'main',x:-63,y:100,items:[],stand:false},
  request:async(url,options)=>{if(url==='/merchant/idle-status'&&options.body.phase==='arrived')await gate;return {};},
  close_stand:async()=>{seen.push('close');r.character.stand=false;},
  open_stand:async()=>{r.character.stand=true;seen.push('open');}});
 // A stand already open for trades is the first holder's: the take closes it once for the job.
 r.root.__merchantHolder={kind:'command',type:'merchant-idle',commandId:5};
 const standing=r.merchantRunner.holdStand({id:5,type:'merchant-idle'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(r.merchantRunner.record().kind,'idle');
 const job={type:'merchant-service',id:6,jobId:'J6'};
 const met=r.merchantRunner.meetStand(job);arrived();await met;await assert.rejects(standing,/interrupted/);
 assert.equal(r.merchantRunner.record(),null);assert.equal(r.character.stand,false);
 r.merchantRunner.holdCommand(job);await r.merchantRunner.leaveStand();
 await r.merchantRunner.runJob(job,'merchant service',async()=>{seen.push('job:'+r.character.stand);});
 assert.deepEqual(seen,['job:false']);
 // A stand return that finishes keeps the merchant with the stand open; a command's meet closes it.
 r.root.__merchantHolder={kind:'command',type:'merchant-idle',commandId:7};
 await r.merchantRunner.holdStand({id:7,type:'merchant-idle'});
 assert.deepEqual([r.merchantRunner.record().kind,r.merchantRunner.record().phase,r.character.stand],['idle','open',true]);
 await r.merchantRunner.meetStand({type:'travel',id:8});
 assert.deepEqual([r.merchantRunner.record(),r.character.stand],[null,false]);
});

// merchant.stand.closed names the holder that took the stand: the job a job command runs under, or
// the command itself.
test('the stand return closing for a command names the holder that takes the stand',async()=>{
 const {partyHooks}=require('../../runtime/hooks/index.ts'),closed=[];
 partyHooks().publish({name:'test:stand-closed',folder:'core',author:'test',summary:'Hears the stand closes.',hooks:{'merchant.stand.closed':p=>closed.push(p.by)}});
 const r=standContext({character:{name:'M',map:'main',x:-63,y:100,items:[],stand:false}});
 for(const [id,command] of [[5,{type:'merchant-service',id:6,jobId:'J6'}],[7,{type:'travel',id:8}]]){
  r.root.__merchantHolder={kind:'command',type:'merchant-idle',commandId:id};
  await r.merchantRunner.holdStand({id,type:'merchant-idle'});
  await r.merchantRunner.meetStand(command);
 }
 assert.deepEqual(closed,['job','command']);
 // A job that meets the stand return after it opened, before its return ends, names the job too.
 let arrived;const gate=new Promise(resolve=>{arrived=resolve;});
 const g=standContext({character:{name:'M',map:'main',x:-63,y:100,items:[],stand:false},
  request:async(url,options)=>{if(url==='/merchant/idle-status'&&options.body.phase==='complete')await gate;return {};}});
 g.root.__merchantHolder={kind:'command',type:'merchant-idle',commandId:9};
 const standing=g.merchantRunner.holdStand({id:9,type:'merchant-idle'});
 await new Promise(resolve=>setImmediate(resolve));
 const met=g.merchantRunner.meetStand({type:'merchant-service',id:10,jobId:'J10'});arrived();await met;await standing.catch(()=>{});
 assert.deepEqual(closed,['job','command','job']);
});

// The items owner's stand close (items/character/market.ts) waits for the game to report the
// stand closed.
test('bank travel waits for the stand to close and refuses a failed close',async()=>{
 const {marketHarness}=require('./helpers/items-character.cjs');
 const character={name:'M',ctype:'merchant',stand:true,items:[]};let closes=0;
 const game={closeStand:async()=>{closes++;}};
 const {market}=marketHarness({character,game});
 await assert.rejects(market.stand.close(),/did not close/);
 game.closeStand=async()=>{character.stand=false;};await market.stand.close();assert.equal(character.stand,false);assert.equal(closes,1);
});

// Each row plants one owner's hold, sees the dispatch yield, clears the hold and sees the stand return go.
const holds={gathering:[p=>p.statuses.M.gatheringActive=true,p=>p.statuses.M.gatheringActive=false],
 banking:[p=>p.statuses.M.banking=true,p=>p.statuses.M.banking=false],
 job:[p=>p.merchantCurrent={id:'job'},p=>p.merchantCurrent=null],
 bankboi:[p=>p.bankboiTransaction={},p=>p.bankboiTransaction=null]};
scenarioTable('an active owner retains the merchant during the stand return cooldown',fixture,Object.entries(holds).map(([owner,[hold,release]])=>
 ['active '+owner+' retains ownership during cooldown',({r,party})=>{
  hold(party);r.dispatchMerchantIdle();assert.equal(party.commands.M,undefined);
  release(party);r.dispatchMerchantIdle();assert.equal(party.commands.M.type,'merchant-idle');
 }]));

test('bank entry and cake result logs are based on observed changes',()=>{
 const logs=[];const r={body:{map:'bank',x:0,y:-37},previousStatus:{map:'main'}};
 const observer=createMerchantObservation({listings:[]},{log:(...args)=>logs.push(args),persist(){},publish(){}});
 const run=()=>observer.observe(r.body,r.previousStatus);
 run();assert.equal(logs[0][0],'Entered bank');
 r.previousStatus={map:'bank'};run();assert.equal(logs.length,1);
 r.body.map='bank_b';run();assert.equal(logs.length,1);
 r.previousStatus=undefined;run();assert.equal(logs.at(-1)[0],'Merchant online in bank');
 r.previousStatus={map:'main'};r.body.map='bank_u';run();assert.equal(logs.at(-1)[0],'Entered bank');
 r.previousStatus={map:'bank_u'};r.body.anniversaryState={craftResult:{at:123,success:false,error:'missing slice_strawberry'}};
 run();assert.equal(logs.at(-1)[0],'Anniversary cake deferred');assert.equal(logs.at(-1)[2],'missing slice_strawberry');
 const count=logs.length;r.previousStatus=JSON.parse(JSON.stringify(r.body));run();assert.equal(logs.length,count);
});

// The rest is read from the game between ticks (gathering.ts `resting`): the stand open at the market
// point with the rest's listings. A merchant away from it, or at a closed stand, walks back once.
for(const closed of [false,true])test('cooldown rechecks '+(closed?'closed stand at market':'position despite cached arrival'),async()=>{
 let returns=0;
 const {installGathering}=require('./helpers/merchant-gathering.cjs');
 const c={character:{ctype:'merchant',level:30,map:closed?'main':'bank',x:closed?-63:0,y:closed?100:-37,stand:!closed,slots:{},items:[]},
  root:{__merchantGatheringSession:{mode:'fishing',tool:'rod',cooldownUntil:Date.now()+60000,restListings:'[]'}},
  G:{skills:{fishing:{}},items:{}},is_on_cooldown:()=>true,can_use:()=>false,freeInventorySlots:()=>10,sleep:async()=>{},
  merchantMarketLocation:{map:'main',x:-63,y:100},restoreGatheringEquipment:async()=>true,merchantTownReturn:async()=>{},
  close_stand:async()=>{c.character.stand=false;},
  standReturn:async()=>{returns++;Object.assign(c.character,{map:'main',x:-63,y:100,stand:true});}};
 const g=installGathering(c);
 // The mode choice on a free merchant runs the first tick; the second reads the open stand at the market.
 g.choose(['fishing']);g.halt();await c.root.__merchantHolder?.done;
 await g.gatheringTick();g.halt();
 assert.equal(returns,1);assert.equal(c.root.__merchantGatheringSession.restListings,'[]');
});

// The equip route writes through `jobs.command`, so the owner knows the slot holds your command;
// the stand return leaves it until its report.
test('manual equipment commands survive automatic stand dispatch until delivered',()=>{
 const {merchantSlotCommand}=require('../../runtime/merchant-jobs/coordinator/owner.ts');
 const {r,party}=fixture();party.gatheringModes=[];
 for(const type of ['equip','unequip']){
  const command={id:17,type,slot:'amulet',item:{name:'dexamulet',level:2}};
  merchantSlotCommand(party,'manual:'+type,command);r.dispatchMerchantIdle();assert.equal(party.commands.M,command);
 }
});
// The runner holds the home realm, v1.5.0's SR_USII until a stand return's command
// names one, and the next stand return hops to it with no shared.js port.
test('a command home realm reaches the next stand return through the runner alone',async()=>{
 const asked=[];
 const r=standContext({merchantHop:{liveRealm:()=>'SR_USII',hop:async(url,body,realm)=>{asked.push(realm);return 'alreadyThere';}},
  character:{name:'M',map:'main',x:-63,y:100,items:[]},partyItems:{stand:{close:async()=>{},open:async()=>true,list:async()=>[]}}});
 await r.merchantRunner.standReturn({id:1},()=>true);
 await r.merchantRunner.standReturn({id:2,homeRealm:'SR_EUI'},()=>true);
 await r.merchantRunner.standReturn({id:3},()=>true);
 assert.deepEqual(asked,['SR_EUI','SR_EUI']);
});
test('a standless stand return walks to the market and reports no stand without an open',async()=>{
 const statuses=[];let opened=0;
 const r=standContext({partyItems:{stand:{close:async()=>{},open:async()=>{opened++;throw Error('Merchant stand did not open');},list:async()=>[]}},
  request:async(url,options)=>{if(url==='/merchant/idle-status')statuses.push(options.body.phase);return {};}});
 r.merchantRunner=require('./helpers/merchant-runner.cjs').installRunner(r,{walkToMarket:async()=>{Object.assign(r.character,{map:'main',x:-63,y:100});}});
 assert.equal((await r.merchantRunner.standReturn({id:1,noStand:true},()=>true)).state,'complete');
 assert.deepEqual(statuses,['returning','arrived','no-stand']);assert.equal(opened,0);
});
// The stand return's walk ends on movement's answer, with no 90 s cut of its own; a walk that
// movement fails reports its code in the failed status.
test('the stand walk carries no bound, and a walk movement fails reports its code',async()=>{
 const walks=[],statuses=[];
 const r=standContext({partyItems:{stand:{close:async()=>{},open:async()=>true,list:async()=>[]}},
  request:async(url,options)=>{if(url==='/merchant/idle-status')statuses.push(options.body);return {};}});
 r.merchantRunner=require('./helpers/merchant-runner.cjs').installRunner(r,{walkToMarket:(...args)=>{walks.push(args);
  return Promise.reject(Object.assign(new Error('no path'),{code:'path_failed'}));}});
 await assert.rejects(r.merchantRunner.standReturn({id:1},()=>true),/no path/);
 assert.equal(walks.length,1);assert.equal(walks[0].length,1,'the walk gets the spot alone');
 assert.equal(statuses.at(-1).phase,'failed');assert.equal(statuses.at(-1).code,'path_failed');
});
