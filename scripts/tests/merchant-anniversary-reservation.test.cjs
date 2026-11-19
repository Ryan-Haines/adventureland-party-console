const test = require('node:test');
const assert = require('node:assert/strict');
const { merchantAnniversaryControl } = require('../../runtime/merchant-jobs/rules.ts');
const { installEventMerchant } = require('../../runtime/events/character/merchant.ts');
require('../../runtime/merchant-jobs/character/visits.ts');

// shared.js's `control` port of the merchant row, run as written over the merchant jobs owner's character door
// (`partyMerchant.jobs`) on a frame with no other global.
const shared = require('node:fs').readFileSync('characters/shared.js', 'utf8');
const controlPort = shared.slice(shared.indexOf('root.installEventMerchant(')).match(/control: (function \(\) \{[^}]*\})/)[1];
const sharedControl = new Function('root', 'merchantJobs', 'return ' + controlPort)({}, globalThis.partyMerchant.jobs);

function control(event, state = {}) {
  const now = 1_000_000;
  return merchantAnniversaryControl('GoldMajesty',true,{anniversaryServer:event,
    anniversaryState:state,anniversaryVisit:event.live===false?null:{round:event.round}}, {}, now);
}

// The merchant's row on the character (character/merchant.ts) over the merchant jobs owner's anniversary control, as
// shared.js installs it, with its control port: no event holds the merchant, and `anniversary` is the anniversary module's
// round id, plan, completed rounds, merchant mode and the round released at the featured hold's end.
function merchantRow(event, anniversary) {
  const character = { name: 'M', ctype: 'merchant', s: {} };
  return installEventMerchant({ now: () => Date.now(), character: () => character,
    attend: { selected: () => true, joined: () => null, traveling: () => null, active: () => null },
    exitPending: () => false, eventsEnabled: () => false, intentCancelled: () => false, coordinatorHolds: () => false,
    anniversary: { roundId: anniversary.roundId, plan: () => anniversary.plan, completed: () => anniversary.completed,
      merchantState: () => ({ busy: false, mode: anniversary.mode, retryAt: 0 }) },
    round: () => event, epoch: x => x, releasedRound: () => anniversary.released, control: sharedControl,
    job: () => null, holder: () => null, standReturning: () => false, leaveStand: async () => undefined, errand: () => false,
    gathering: () => null, stopGathering: async () => undefined, request: async () => ({}) });
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
 const event={active:true,live:true,round:'r',target:'Party',expires:Date.now()+200000};
 const anniversary={roundId:e=>e.round,plan:{abortedRounds:{}},completed:{},mode:'complete',released:'r'};
 const merchant=merchantRow(event,anniversary);
 assert.equal(merchant.anniversaryReserved(),false);
 event.round='next';assert.equal(merchant.anniversaryReserved(),true);
 anniversary.plan.abortedRounds.next={};assert.equal(merchant.anniversaryReserved(),false);
});

test('restarted client restores its recorded claim and does not release a later round',()=>{
 const event={active:true,live:true,round:123,target:'Other',expires:Date.now()+200000};
 const anniversary={roundId:e=>String(e.round),completed:{},mode:'idle',released:null,
  plan:{live:{round:123},round:{claims:{M:{at:Date.now(),slice:'slice_nightberry'}}},abortedRounds:{}}};
 const merchant=merchantRow(event,anniversary);
 assert.equal(merchant.anniversaryReserved(),false);
 assert.equal(merchant.completedRound(),'123');
 event.round=124;assert.equal(merchant.anniversaryReserved(),true);
 anniversary.plan.live.round=124;anniversary.plan.round.claims={Other:{at:Date.now()}};
 assert.equal(merchant.anniversaryReserved(),true);
});
