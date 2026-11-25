const test=require('node:test'),assert=require('node:assert/strict');
const {eventPolicy, eventEnabled, selectedEvents}=require('../../runtime/events/api.ts');
function party(){return {leader:'W',merchantCharacter:'Merchant',followers:{M:true,P:true},eventsByCharacter:{W:true,M:false,P:false,Merchant:false}};}
test('followers display and use leader events even when their saved preference differs',()=>{const p=party();assert.deepEqual(eventPolicy(p,'M'),{inherited:true,source:'W',enabled:true});p.eventsByCharacter.W=false;p.eventsByCharacter.M=true;assert.equal(eventPolicy(p,'M').enabled,false);});
test('unfollowing restores the saved preference; changing leader updates inheritance immediately',()=>{const p=party();p.followers.M=false;assert.equal(eventPolicy(p,'M').enabled,false);p.followers.M=true;p.leader='P';assert.equal(eventPolicy(p,'M').source,'P');assert.equal(eventPolicy(p,'M').enabled,false);});
test('leader, merchant and characters without a leader keep independent settings',()=>{const p=party();p.followers.W=true;p.followers.Merchant=true;assert.equal(eventPolicy(p,'W').inherited,false);assert.equal(eventPolicy(p,'Merchant').inherited,false);p.leader=null;assert.equal(eventPolicy(p,'M').inherited,false);});
test('event return membership uses inherited attendance rather than follower saved flags',()=>{
 const p=party();Object.assign(p,{nextCommandId:1,statuses:{},commands:{},location:{map:'main',x:0,y:0}});
 const c={party:p,eventPolicy,eventEnabled,Date,activeNames:()=>['W','M','P','Merchant'],goobrawlStillFighting:()=>false,eventCheckpoint:()=>p.location,farmingNavigation:{capture:()=>({})},startFrankyExitConvoy(){},persistSettings(){}};
 c.eventsEnabledFor=(name,event)=>event?eventEnabled(p,name,event):eventPolicy(p,name).enabled;
 Object.assign(c,require('./helpers/coordinator-events.cjs').eventService(c));
 c.beginEventReturn('goobrawl',{});assert.deepEqual(Array.from(p.eventReturn.participants),['W','M','P']);assert.ok(p.commands.M);assert.ok(p.commands.P);
});

test('specific event selections inherit and restore independent choices',()=>{
 const p=party();p.eventSelectionsByCharacter={W:['anniversary','goobrawl'],M:['icegolem']};
 assert.deepEqual(selectedEvents(p,'M'),['anniversary','goobrawl']);assert.equal(eventEnabled(p,'M','icegolem'),false);
 p.followers.M=false;assert.deepEqual(selectedEvents(p,'M'),['icegolem']);
 p.eventSelectionsByCharacter.M=[];assert.equal(eventEnabled(p,'M','anniversary'),false);
});
test('migration retains anniversary even when combat was disabled; merchants cannot inherit combat',()=>{
 const p=party();assert.deepEqual(selectedEvents(p,'Merchant'),['anniversary']);
 p.eventSelectionsByCharacter={Merchant:['anniversary','franky']};assert.deepEqual(selectedEvents(p,'Merchant'),['anniversary','franky']);
});
// The anniversary routes order rounds through rules.ts `roundOrder`. The game's slot ids order by
// number; a character's fallback id (target, map and expiry) is the same round only as itself and
// orders against no other id, so an aborted fallback round is still skipped.
test('anniversary round ids order by the game slot, a fallback id only against itself',()=>{
 const {roundOrder}=require('../../runtime/events/rules.ts');
 assert.ok(roundOrder('12','13')<0);assert.ok(roundOrder(14,'13')>0);assert.equal(roundOrder('13',13),0);
 assert.equal(roundOrder('franky:main:9','franky:main:9'),0);assert.equal(roundOrder('franky:main:9','13'),null);
});
// K1's `priority` column names the events whose target a joined member takes first, the three
// v1.5.0 listed.
test('the priority events are the K1 rows with the priority column',()=>{
 const {eventKinds}=require('../../runtime/events/rules.ts');
 assert.deepEqual(eventKinds().filter(row=>row.priority).map(row=>row.name),['mrgreen','mrpumpkin','horseman']);
});
