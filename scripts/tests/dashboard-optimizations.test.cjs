const {test}=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/dashboard-query-module.cjs');
const {createDashboardClient,domainOptions,key}=load('query-cache.tsx');
const {characterKey,writeVitals,writeCharacter}=load('character-cache.ts');
const {createLiveReceiver}=require('../../dashboard/features/party/live-protocol.ts');
const {durationSignature,reconcileDurations,statusRemaining}=require('../../dashboard/features/party/status-duration.ts');

test('diagnostics count Unicode code units honestly and keep commit domains independent',()=>{
 const {receivedLiveMessage,dashboardLiveMetrics,receivedLiveRecord,committedLiveRecord,clearLiveMetrics}=load('live-metrics.ts');
 const text='Aé😀';const before=dashboardLiveMetrics.utf16CodeUnits;
 receivedLiveMessage(text);assert.equal(dashboardLiveMetrics.utf16CodeUnits-before,4);
 assert.notEqual(text.length,Buffer.byteLength(text));
 receivedLiveRecord('A',Date.now(),'position');receivedLiveRecord('A',Date.now(),'vitals');
 committedLiveRecord('A','position');assert.equal(dashboardLiveMetrics.domainCommits.position,1);
 assert.equal(dashboardLiveMetrics.domainCommits.vitals,0);
 committedLiveRecord('A','vitals');assert.equal(dashboardLiveMetrics.domainCommits.vitals,1);clearLiveMetrics();
});

test('position cache isolates vitals, preserves nested identities and replaces generations/removals',()=>{
 const client=createDashboardClient();
 const receiver=createLiveReceiver((name,record)=>{
  if(record)writeVitals(client,name,record.vitals);
  else for(const kind of ['vitals','position','inventory'])writeCharacter(client,name,kind,null);
 });
 let sequence=0;
 const send=(vitals,generation='g')=>receiver.accept({type:sequence?'delta':'snapshot',epoch:'e',sequence:++sequence,characters:{A:{generation,sample:sequence,sampledAt:1000,vitals,items:{},slots:{}}}});
 send({hp:100,x:1,y:2,map:'main',in:'one',conditions:[{id:'buff',remainingMs:10000}]});
 const before=client.getQueryData(characterKey('A','vitals'));
 send({x:2});
 assert.equal(client.getQueryData(characterKey('A','vitals')),before);
 assert.equal(client.getQueryData(characterKey('A','position')).x,2);
 send({hp:99});
 assert.equal(client.getQueryData(characterKey('A','vitals')).conditions,before.conditions);
 send({map:'cave',x:0,y:0},'new');
 assert.equal(client.getQueryData(characterKey('A','position')).in,undefined);
 assert.equal(client.getQueryData(characterKey('A','vitals')).hp,undefined);
 receiver.accept({type:'delta',epoch:'e',sequence:++sequence,characters:{A:null}});
 for(const kind of ['vitals','position','inventory'])assert.equal(client.getQueryData(characterKey('A',kind)),null);
 client.clear();
});

test('fallback polling populates position separately and keeps unchanged vitals stable',async()=>{
 const client=createDashboardClient(),old=global.fetch;
 let x=1;global.fetch=async()=>({ok:true,status:200,json:async()=>({characters:{A:{hp:100,map:'main',x,y:2}},})});
 client.setQueryData(key('core'),{referenceRevision:'r'});
 try{const options=domainOptions(client,'fast');await options.queryFn({signal:new AbortController().signal});
 const first=client.getQueryData(characterKey('A','vitals'));x=2;
 await options.queryFn({signal:new AbortController().signal});
 assert.equal(client.getQueryData(characterKey('A','vitals')),first);
 assert.equal(client.getQueryData(characterKey('A','position')).x,2);
 }finally{global.fetch=old;client.clear();}
});

test('duration signatures ignore presentation changes but track expiry, refresh, source and definition',()=>{
 const condition={id:'buff:|',source:'A:|',remainingMs:10000,definition:{duration:20000},name:'Buff'};
 const signature=durationSignature([condition]);
 const durations=reconcileDurations(signature,{},1000);
 assert.equal(reconcileDurations(signature,durations,2000),durations);
 assert.equal(durationSignature([{...condition,name:'Renamed',stacks:2}]),signature);
 assert.equal(statusRemaining(durations[condition.id],4000),7000);
 const extended=reconcileDurations(durationSignature([{...condition,definition:{duration:30000}}]),durations,4000);
 assert.equal(extended[condition.id].total,30000);
 assert.equal(extended[condition.id].at,1000);
 const refreshed=reconcileDurations(durationSignature([{...condition,remainingMs:15000}]),durations,4000);
 assert.equal(refreshed[condition.id].at,4000);
 for(const remainingMs of [null,-1])assert.equal(reconcileDurations(durationSignature([{...condition,remainingMs}]),durations,5000)[condition.id],undefined);
 assert.deepEqual(reconcileDurations('[]',durations,5000),{});
 assert.equal(statusRemaining(durations[condition.id],12000),0);
 const changed=reconcileDurations(durationSignature([{...condition,source:'B'}]),durations,4000);
 assert.equal(changed[condition.id].source,'B');
});
