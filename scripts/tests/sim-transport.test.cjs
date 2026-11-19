// The sim transports' request accounting (tools/sim/host/transport.cjs), which the threaded host's HTTP
// server (threaded.cjs) records through too. It needs no ChronAL run, so it shares no sim setup.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createTransport,recordRequest,recordResponse}=require('../../tools/sim/host/transport.cjs');

// One copy of the accounting, so a threaded run's stats read as a lockstep run's do.
test('the threaded host records a request and its failure in the lockstep transport\'s stats',()=>{
 const {stats}=createTransport({clock:{now:0,at(){}},apps:new Map(),latency:()=>0});
 const parsed=new URL('http://127.0.0.1:924/party-api/status'),body='{"combatWait":true}';
 recordRequest(stats,parsed,body);
 recordResponse(stats,parsed,body,{statusCode:500,body:'x'.repeat(400)});
 assert.equal(stats.requests,1);
 assert.deepEqual([...stats.byPath],[['/party-api/status [combatWait]',1]]);
 assert.equal(stats.largestBody,body.length);
 assert.deepEqual([...stats.byStatus],[['/party-api/status 500',1]]);
 assert.equal(stats.firstFailure.get('/party-api/status 500').length,300,'the first failure keeps its first 300 characters');
});
