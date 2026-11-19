const test=require('node:test');
const assert=require('node:assert/strict');
const { merchantAnniversaryControl } = require('../../runtime/merchant-jobs/rules.ts');
const control=(event,state={},now=100000,visit=true,enabled=true,aborted={})=>merchantAnniversaryControl('M',enabled,
  {anniversaryServer:event,anniversaryState:state,anniversaryVisit:visit},aborted,now);

test('merchant staging reserves ninety seconds and tolerates a fifteen-second late live payload',()=>{
  for(const [next,reserved] of [[190001,false],[190000,true],[85000,true],[84999,false]]){
    assert.equal(control({live:false,next}).preWindow,reserved);
  }
});

test('featured merchant leaves after one minute of the five-minute round',()=>{
  const event={live:true,target:'M',expires:400000};
  assert.equal(control(event,{},159999).featured,true);
  const done=control(event,{},160000);assert.equal(done.featured,false);assert.equal(done.reserved,false);assert.equal(done.kissDue,false);
});

test('kiss attempts honor completion, availability, retries, disabled events and aborted rounds',()=>{
  const event={live:true,target:'P',expires:400000,round:'round'};
  assert.equal(control(event).kissDue,true);assert.equal(control(event,{retryAt:100001}).kissDue,false);
  assert.equal(control(event,{mode:'complete'}).reserved,false);assert.equal(control({...event,available:false}).kissDue,false);
  assert.equal(control(event,{},100000,true,false).live,false);assert.equal(control(event,{},100000,true,true,{round:true}).live,false);
  assert.equal(control(event,{mode:'kiss-active'}).busy,true);
});

// `event.cycle` (EVT-043): the anniversary cycle holds from its staging
// until its return completes, is superseded or hands off to combat, and the rare waits that long.
test("event.cycle: a rare waits through the anniversary's staging and its return", () => {
  const { cycleHolds } = require('../../runtime/events/coordinator/anniversary.ts');
  assert.equal(cycleHolds(null), false, 'no cycle holds nothing');
  assert.equal(cycleHolds({ stagedAt: 1 }), true, 'a staged cycle holds');
  for (const end of ['returnCompletedAt', 'supersededAt', 'combatHandoffAt'])
    assert.equal(cycleHolds({ stagedAt: 1, [end]: 2 }), false, end + ' ends the hold');
});
