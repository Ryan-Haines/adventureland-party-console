const test=require('node:test'),assert=require('node:assert/strict');
const {playerMoved,observeEventAttendance,eventInstanceAllowed,manualEventOccurrenceSkipped}=require('../../runtime/events/coordinator/attendance.ts');
function fixture(){return {leader:'W',followers:{P:true},eventSelectionsByCharacter:{W:['icegolem']},
  statuses:{W:{seenAt:100000,server:'USII'}},eventAttendance:{},
  eventSessions:{W:{event:'icegolem',id:null,authorizedRealm:'USII',authorizedAt:100000,lastLiveAt:100000,participants:['W'],participationRecorded:true}}};}
test('manual travel records an already authorized prejoin before its first attendance entry',()=>{
  const s=fixture();playerMoved(s,['W'],{map:'main'},100000);
  assert.equal(s.eventAttendance.W.icegolem.ignored,'manual travel');
  assert.equal(s.eventAttendance.W.icegolem.attending,false);
  assert.equal(eventInstanceAllowed(s,'W','icegolem'),false);
  assert.equal(eventInstanceAllowed(s,'P','icegolem'),true);
  observeEventAttendance(s,{name:'W',server:'USII',serverLiveEvents:[{name:'icegolem',id:'native-1'}]},100100);
  assert.equal(s.eventAttendance.W.icegolem.id,'native-1');
  assert.equal(eventInstanceAllowed(s,'W','icegolem'),false);
  observeEventAttendance(s,{name:'W',server:'USII',serverLiveEvents:[]},111000);
  observeEventAttendance(s,{name:'W',server:'USII',serverLiveEvents:[{name:'icegolem',id:'native-2'}]},112000);
  assert.equal(eventInstanceAllowed(s,'W','icegolem'),true);
});
// `cant_join` is the server's realm-wide flag, so every member's record of the occurrence
// ends; `join_too_late` spares a member of the round.
test('a final join refusal ends the occurrence for every member on its realm',()=>{
  const s=fixture(),live={serverLiveEvents:[{name:'icegolem',id:'native-1'}]};
  observeEventAttendance(s,{name:'P',server:'USII',...live},100100);
  observeEventAttendance(s,{name:'W',server:'USII',...live,eventRefusal:{name:'icegolem',id:'native-1',reply:'cant_join'}},100200);
  assert.equal(s.eventAttendance.W.icegolem.ignored,'event-over');
  assert.equal(s.eventAttendance.P.icegolem.ignored,'event-over','the member that had not asked');
  assert.equal(eventInstanceAllowed(s,'P','icegolem'),false);
});
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const noExclusion=s=>{
 playerMoved(s,['W'],{map:'main'},100000);
 assert.deepEqual(s.eventAttendance,{});
};
scenarioTable('manual travel by a member whose event status is not trusted records no exclusion',amend=>{const s=fixture();amend(s);return s;},[
 ['manual travel does not manufacture exclusion from stale status',noExclusion,s=>s.statuses.W.seenAt=1],
 ['manual travel does not manufacture exclusion from missing realm',noExclusion,s=>delete s.statuses.W.server],
 ['manual travel does not manufacture exclusion from unrecorded session',noExclusion,s=>delete s.eventSessions.W.participationRecorded],
 ['manual travel does not manufacture exclusion from unowned session',noExclusion,s=>s.eventSessions.W.participants=['P']],
 ['manual travel does not manufacture exclusion from missing session',noExclusion,s=>delete s.eventSessions.W],
 ['manual travel does not manufacture exclusion from wrong authorization realm',noExclusion,s=>s.eventSessions.W.authorizedRealm='EUI'],
 ['manual travel does not manufacture exclusion from missing authorization realm',noExclusion,s=>delete s.eventSessions.W.authorizedRealm],
 ['manual travel does not manufacture exclusion from stale authorization',noExclusion,s=>s.eventSessions.W.authorizedAt=1],
 ['manual travel does not manufacture exclusion from disconnected feed',noExclusion,s=>s.statuses.W.eventFeedConnected=false],
 ['manual travel does not manufacture exclusion from stale clock',noExclusion,s=>s.statuses.W.eventClockStale=true],
]);

// Only a move that leaves the event's map leaves its occurrence. The member stands on
// the Goobrawl map; a point on the same map keeps it, a point on main leaves it.
test('a move inside the event map keeps attendance and a move off it leaves',()=>{
 const s=fixture(),live={serverLiveEvents:[{name:'goobrawl',id:'native-1'}]};
 s.eventSelectionsByCharacter.W=['goobrawl'];s.eventSessions.W.event='goobrawl';
 Object.assign(s.statuses.W,{map:'goobrawl',mapEvent:'goobrawl'});
 observeEventAttendance(s,{name:'W',server:'USII',mapEvent:'goobrawl',...live},100000);
 playerMoved(s,['W'],{map:'goobrawl',x:10,y:10},100000);
 assert.equal(s.eventAttendance.W.goobrawl.ignored,undefined,'a point on the event map');
 playerMoved(s,['W'],{map:'main',x:0,y:0},100000);
 assert.equal(s.eventAttendance.W.goobrawl.ignored,'manual travel','a point off the event map');
});
// A boss's map (live run on 1166d93dc): the Halloween map names no event of its own
// (`mapEvent` null), and the member attends Mr. Pumpkin there (`joinedEvent`). The boss's map is the
// event's map, so a point on it keeps the occurrence and a point off it leaves.
test('a move inside a boss event map keeps attendance and a move off it leaves',()=>{
 const s=fixture(),live={serverLiveEvents:[{name:'mrpumpkin'}]};
 s.eventSelectionsByCharacter.W=['mrpumpkin'];s.eventSessions.W.event='mrpumpkin';
 Object.assign(s.statuses.W,{map:'halloween',mapEvent:null,joinedEvent:'mrpumpkin'});
 observeEventAttendance(s,{name:'W',server:'USII',map:'halloween',joinedEvent:'mrpumpkin',...live},100000);
 playerMoved(s,['W'],{map:'halloween',x:-400,y:650},100000);
 assert.equal(s.eventAttendance.W.mrpumpkin.ignored,undefined,'a point on the boss map');
 playerMoved(s,['W'],{map:'main',x:0,y:0},100000);
 assert.equal(s.eventAttendance.W.mrpumpkin.ignored,'manual travel','a point off the boss map');
});
// The character reports `joinedEvent` from the start of its walk to the event, so a member on
// main walking to Mr. Pumpkin names it while main is not the event's map. A point on main leaves.
test('a move on the map a member walks through to its event leaves the occurrence',()=>{
 const s=fixture(),live={serverLiveEvents:[{name:'mrpumpkin'}]},walking={event:true};
 s.eventSelectionsByCharacter.W=['mrpumpkin'];s.eventSessions.W.event='mrpumpkin';
 Object.assign(s.statuses.W,{map:'main',mapEvent:null,joinedEvent:'mrpumpkin',farmingNavigationDebug:walking});
 observeEventAttendance(s,{name:'W',server:'USII',map:'main',joinedEvent:'mrpumpkin',farmingNavigationDebug:walking,...live},100000);
 playerMoved(s,['W'],{map:'main',x:100,y:100},100000);
 assert.equal(s.eventAttendance.W.mrpumpkin.ignored,'manual travel');
});
const keepsReason=({s,reason})=>{
 playerMoved(s,['W'],{map:'main'},100000);
 assert.equal(s.eventAttendance.W.icegolem.ignored,reason);
 assert.equal(manualEventOccurrenceSkipped(s,'W','icegolem'),true);
};
scenarioTable('manual travel keeps the limit an event occurrence was already skipped for',reason=>{
 const s=fixture();observeEventAttendance(s,{name:'W',server:'USII',joinedEvent:'icegolem',serverLiveEvents:[{name:'icegolem',id:'native-1'}]},100000);
 s.eventAttendance.W.icegolem.ignored=reason;
 return {s,reason};
},[
 ['manual route ownership preserves death limit',keepsReason,'death limit'],
 ['manual route ownership preserves time limit',keepsReason,'time limit'],
]);
