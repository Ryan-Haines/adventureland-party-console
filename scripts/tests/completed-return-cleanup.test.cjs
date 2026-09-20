const test=require('node:test'),assert=require('node:assert/strict');
const navigation=require('../farming-navigation.cjs');
const {createAnniversaryReturns}=require('../../runtime/coordinator/anniversary/returns.ts');
const {eventOwnsTravel}=require('../../runtime/hunt/policy.ts');
function fixture(){
 const destination={map:'main',x:120,y:-400};
 const cycle={id:'round',participants:['W'],convoyId:'old',returnDispatchedAt:1,
  returnRoutes:{W:{revision:1,location:destination,convoyId:'old',commandId:5}}};
 const party={leader:'W',followers:{},merchantCharacter:'M',navigationIntents:{W:{revision:1}},characterLocations:{},
  statuses:{W:{...destination,seenAt:100,hp:100}},commands:{W:{id:5,type:'party-monster-travel',convoyId:'old'}},
  activeConvoy:{id:'old',purpose:'anniversary-return',phase:'failed'},anniversary:{eventCycle:cycle},deferredEventReturns:{}};
 let persisted=0,cancelled=0;
 const nav=navigation(party,{now:()=>100,names:()=>['W'],activeNames:()=>['W'],persist:()=>persisted++,log(){},
  cancelConvoy(){cancelled++;for(const [n,c] of Object.entries(party.commands))if(c.convoyId===party.activeConvoy.id)delete party.commands[n];party.activeConvoy=null;}});
 return {party,cycle,nav,counts:()=>({persisted,cancelled})};
}
test('return completion releases its still-running convoy and matching commands immediately',()=>{
 const f=fixture();f.party.activeConvoy.phase='travel';f.nav.reconcile(f.cycle,'anniversary-return');
 assert.equal(f.cycle.returnCompletedAt,100);assert.equal(f.party.activeConvoy,null);assert.deepEqual(f.party.commands,{});
 f.nav.reconcile(f.cycle,'anniversary-return');assert.equal(f.counts().cancelled,1);
});
test('anniversary tick cleans a completed convoy restored as failed, allowing Hunt to resume at Daisy',()=>{
 const f=fixture();f.cycle.returnCompletedAt=90;
 const hunt={stage:'paused-event',resumeStage:'at-daisy',participants:['W']};
 assert.equal(eventOwnsTravel(hunt,f.party),false);
 const service=createAnniversaryReturns(f.party.anniversary,{reconcile:c=>f.nav.reconcile(c,'anniversary-return')});
 service.tick();assert.equal(f.party.activeConvoy,null);service.tick();assert.deepEqual(f.counts(),{persisted:1,cancelled:1});
});
test('completed return cleanup preserves newer convoy and commands; active event travel still blocks Hunt',()=>{
 const f=fixture();f.cycle.returnCompletedAt=90;f.party.activeConvoy.id='new';f.party.commands.W={id:99,convoyId:'new'};
 f.nav.reconcile(f.cycle,'anniversary-return');assert.equal(f.party.activeConvoy.id,'new');assert.equal(f.party.commands.W.id,99);
 assert.equal(eventOwnsTravel({stage:'paused-event',participants:['W']},f.party),true);
 delete f.cycle.returnCompletedAt;f.party.activeConvoy.id='old';assert.equal(eventOwnsTravel({stage:'paused-event',participants:['W']},f.party),true);
});


test('persisted Gigacrab return finishes inside the cgoo area away from its center',()=>{
 const f=fixture();
 const area={map:'arena',x:384,y:-420,boundary:[-376,-888,1144,48]};
 f.cycle.event='crabxx';f.cycle.returnRoutes.W.location=area;
 f.party.statuses.W={map:'arena',x:139,y:-123,hp:100,seenAt:100};
 f.party.activeConvoy.purpose='event-return';
 assert.ok(Math.hypot(139-384,-123+420)>180);
 assert.equal(f.nav.reconcile(f.cycle,'event-return'),true);
 assert.equal(f.cycle.returnCompletedAt,100);assert.equal(f.party.activeConvoy,null);
 assert.deepEqual(f.party.commands,{});
});
test('area return rejects stale, dead, wrong instance, and outside-area reports',()=>{
 for(const change of [{seenAt:-20000},{rip:true},{hp:0},{map:'cave'},{in:'other'},{x:9000}]) {
  const f=fixture(); const area={map:'arena',in:'arena',x:384,y:-420,boundary:[0,-800,800,0]};
  f.party.statuses.W={map:'arena',in:'arena',x:139,y:-123,hp:100,seenAt:100,...change};
  assert.equal(f.nav.at('W',area),false);
 }
});
test('point-only return still requires proximity to the saved point',()=>{
 const f=fixture();f.party.statuses.W.x=1000;
 assert.equal(f.nav.at('W',f.cycle.returnRoutes.W.location),false);
});
