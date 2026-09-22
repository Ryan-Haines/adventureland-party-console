const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {merchantAnniversaryControl}=require('../../runtime/coordinator/merchant/anniversary-control.ts');

function control(event, state = {}) {
  const now = 1_000_000;
  return merchantAnniversaryControl('GoldMajesty',true,{anniversaryServer:event,
    anniversaryState:state,anniversaryVisit:event.live===false?null:{round:event.round}}, {}, now);
}

test('merchant work is reserved throughout the ninety-second anniversary lead-up', () => {
  const result = control({ active: true, live: false, next: 1_090_000 });
  assert.equal(result.preWindow, true);
  assert.equal(result.reserved, true);
});

test('merchant work is not reserved before the ninety-second anniversary lead-up', () => {
  const result = control({ active: true, live: false, next: 1_090_001 });
  assert.equal(result.preWindow, false);
  assert.equal(result.reserved, false);
});

test('merchant work remains reserved through retries until the live kiss completes', () => {
  const event = { active: true, live: true, round: 'r1', target: 'Other', expires: 1_300_000 };
  assert.equal(control(event, { mode: 'retry-wait', retryAt: 1_010_000 }).reserved, true);
  assert.equal(control(event, { mode: 'complete' }).reserved, false);
});

test('merchant commands have a local anniversary reservation gate', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '../../characters/shared.js'), 'utf8'),
    /command\.type !== "merchant-idle"[\s\S]{0,100}merchantAnniversaryWorkReserved\(\)/);
});


test('completion from a previous round cannot release a new live visit',()=>{
 const event={active:true,live:true,round:'new',target:'Other',expires:1300000};
 assert.equal(control(event,{mode:'complete',completedRound:'old'}).reserved,true);
 assert.equal(control(event,{mode:'complete',completedRound:'new'}).reserved,false);
});
test('aborted round releases stale busy state',()=>{
 const result=merchantAnniversaryControl('M',true,{anniversaryServer:{active:true,live:true,round:'r',target:'Other'},anniversaryState:{busy:true,mode:'kiss-active'}},{r:{}},1000000);
 assert.equal(result.reserved,false);assert.equal(result.busy,false);
});

test('persisted claim releases a restarted merchant only for its matching round',()=>{
 const status={anniversaryServer:{active:true,live:true,round:'r',target:'Other'},anniversaryState:{mode:'idle'},anniversaryVisit:null};
 assert.equal(merchantAnniversaryControl('M',true,status,{},1000000,'r').reserved,false);
 assert.equal(merchantAnniversaryControl('M',true,status,{},1000000,'old').reserved,true);
 status.anniversaryServer.target='M';
 status.anniversaryServer.expires=1300000;
 assert.equal(merchantAnniversaryControl('M',true,status,{},1000000,'r').featured,true);
});


test('client and coordinator release the same featured round after reload and retain the next round',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../../characters/shared.js'),'utf8');
 const start=source.indexOf('  function merchantAnniversaryCompletedRound()');
 const end=source.indexOf('  async function exitGoobrawlForRecovery',start);
 const event={active:true,live:true,round:'r',target:'Party',expires:Date.now()+200000};
 const context={joinedEvent:null,eventTraveling:false,eventReturnPending:false,eventsEnabled:false,root:{partyMerchantAnniversaryControl:merchantAnniversaryControl,__merchantAnniversaryReleasedRound:'r'},
 character:{name:'M',ctype:'merchant',s:{}},eventStatus:()=>({anniversary:event}),eventSelected:()=>true,
 anniversaryRoundId:e=>e.round,anniversaryEpoch:x=>x,anniversaryCompletedRounds:{},anniversaryBusy:false,
 anniversaryMerchantMode:'complete',anniversaryMerchantRetryAt:0,anniversaryPlan:{abortedRounds:{}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 assert.equal(context.merchantAnniversaryWorkReserved(),false);
 event.round='next';assert.equal(context.merchantAnniversaryWorkReserved(),true);
 context.anniversaryPlan.abortedRounds.next={};assert.equal(context.merchantAnniversaryWorkReserved(),false);
});

test('restarted client restores its recorded claim and does not release a later round',()=>{
 const vm=require('node:vm'),source=fs.readFileSync(path.join(__dirname,'../../characters/shared.js'),'utf8');
 const start=source.indexOf('  function merchantAnniversaryCompletedRound()');
 const end=source.indexOf('  async function exitGoobrawlForRecovery',start);
 const event={active:true,live:true,round:123,target:'Other',expires:Date.now()+200000};
 const context={joinedEvent:null,eventTraveling:false,eventReturnPending:false,eventsEnabled:false,root:{partyMerchantAnniversaryControl:merchantAnniversaryControl},
 character:{name:'M',ctype:'merchant',s:{}},eventStatus:()=>({anniversary:event}),eventSelected:()=>true,
 anniversaryRoundId:e=>String(e.round),anniversaryEpoch:x=>x,anniversaryCompletedRounds:{},anniversaryBusy:false,
 anniversaryMerchantMode:'idle',anniversaryMerchantRetryAt:0,
 anniversaryPlan:{live:{round:123},round:{claims:{M:{at:Date.now(),slice:'slice_nightberry'}}},abortedRounds:{}}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 assert.equal(context.merchantAnniversaryWorkReserved(),false);
 assert.equal(context.merchantAnniversaryCompletedRound(),'123');
 event.round=124;assert.equal(context.merchantAnniversaryWorkReserved(),true);
 context.anniversaryPlan.live.round=124;context.anniversaryPlan.round.claims={Other:{at:Date.now()}};
 assert.equal(context.merchantAnniversaryWorkReserved(),true);
});
