const test=require('node:test'),assert=require('node:assert/strict');
const {projectEventSchedules}=require('../../runtime/events/coordinator/occurrences.ts');
test('schedule reports select the newest feed on the leader realm and preserve input',()=>{
 const event={name:'abtesting',stale:true};const statuses={L:{server:'II',seenAt:200000},A:{server:'II',seenAt:200000,eventFeedAt:199000,eventSchedules:[event]},B:{server:'III',seenAt:200000,eventFeedAt:200000,eventSchedules:[{name:'other'}]}};
 assert.deepEqual(projectEventSchedules(statuses,'L',()=>200000),[{name:'abtesting',stale:false}]);assert.equal(event.stale,true);
 delete statuses.L.server;assert.deepEqual(projectEventSchedules(statuses,'L',()=>200000),[{name:'other',stale:false}]);
});
// A reporter counts while its report is younger than the presence age (protocol/reports.ts), the one
// age every reader in occurrences.ts takes.
test('fresh connected change-only feeds retain schedules until disconnect or clock staleness',()=>{
 const {ageOf}=require('../../runtime/protocol/reports.ts');
 const now=200000,clock=()=>now;
 const report={seenAt:now-ageOf('presence'),eventFeedAt:80000,eventSchedules:[{name:'event'}]};
 assert.deepEqual(projectEventSchedules({A:report},'missing',clock),[]);
 report.seenAt++;assert.equal(projectEventSchedules({A:report},'missing',clock)[0].stale,false);
 report.eventFeedAt--;assert.equal(projectEventSchedules({A:report},'missing',clock)[0].stale,false);
 report.eventFeedConnected=false;assert.equal(projectEventSchedules({A:report},'missing',clock)[0].stale,true);
 report.eventFeedConnected=true;
 report.eventFeedAt=now;report.eventClockStale=true;assert.equal(projectEventSchedules({A:report},'missing',clock)[0].stale,true);
});
