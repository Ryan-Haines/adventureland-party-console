const test=require('node:test'),assert=require('node:assert/strict');
const zones=require('../../.build/shared/farming-zones.cjs');
// The hunting owner's farm evidence and alternatives (coordinator/farm.ts, rules.ts) and the Hunt's fight read (hunt.ts).
const {recordFarmEvidence:record}=require('../../runtime/hunting/coordinator/farm.ts');
const {alternatives}=require('../../runtime/hunting/rules.ts');
const {partyFighting}=require('../../runtime/hunting/coordinator/hunt.ts');
const box=(b,id='bee',map='main')=>({id,locations:[{map,x:(b[0]+b[2])/2,y:(b[1]+b[3])/2,boundary:b}]});
test('overlapping bee packs merge as their actual union, leaving other packs separate',()=>{
 const catalog=[{id:'bee',locations:[...box([424,1014,668,1104]).locations,...box([418,994,570,1208]).locations,...box([448,694,592,812]).locations]}];
 const areas=zones.zones(catalog,['bee']);assert.equal(areas.length,2);
 const south=areas.find(a=>zones.contains(a,{x:546,y:1059,map:'main'}));
 assert.equal(south.shapes.length,2);assert.equal(zones.contains(south,{x:650,y:1190,map:'main'}),false);
 assert.equal(zones.contains(south,{x:500,y:760,map:'main'}),false);
 assert.equal(zones.resolve(catalog,['bee'],catalog[0].locations[0]).id,south.id);
});
test('polygons exclude holes in a concave spawn outline; pursuit margin and map are checked',()=>{
 const area={map:'arena',polygon:[[0,0],[100,0],[100,30],[30,30],[30,100],[0,100]]};
 assert.equal(zones.contains(area,{map:'arena',x:70,y:70}),false);
 assert.equal(zones.contains(area,{map:'arena',x:10,y:70}),true);
 assert.equal(zones.contains(area,{map:'main',x:10,y:10},150),false);
 assert.equal(zones.contains(area,{map:'arena',x:120,y:10},150),true);
});
test('legacy point locations retain radius fallback',()=>{
 assert.equal(zones.contains({map:'main',x:0,y:0},{map:'main',x:399,y:0},0,400),true);
 assert.equal(zones.contains({map:'main',x:0,y:0},{map:'main',x:401,y:0},0,400),false);
});
test('competition counts current hits once, ignores owned players, and clears when no report lists the player (R07-12, R07-13)',()=>{
 const areas=zones.zones([box([0,0,100,100])],['bee']),state={};
 const hit={key:'a',actor:'Outside',mtype:'bee',map:'main',x:50,y:50,at:1000};
 record(state,[{seenAt:1000,farmAreaEvidence:[hit]}],['Merchant'],areas,1000);
 assert.equal(state.activity[areas[0].id],undefined);
 record(state,[{seenAt:1001,farmAreaEvidence:[hit]},{seenAt:1001,farmAreaEvidence:[hit]}],[],areas,1001);assert.equal(state.activity[areas[0].id],undefined);
 record(state,[{seenAt:1001,farmAreaEvidence:[{...hit,key:'b',actor:'Merchant',kill:true}]}],['Merchant'],areas,1001);
 assert.equal(state.activity[areas[0].id],undefined);
 record(state,[{seenAt:1002,farmAreaEvidence:[hit,{...hit,key:'c',at:1002}]}],[],areas,1002);
 assert.equal(state.activity[areas[0].id].actor,'Outside');
 record(state,[{seenAt:1003,farmCompetition:{players:['Outside']}}],[],areas,1003);
 assert.equal(state.activity[areas[0].id].actor,'Outside');
 record(state,[{seenAt:1004,farmCompetition:{players:[]}}],[],areas,1004);
 assert.equal(state.activity[areas[0].id],undefined);
});
// A quiet mark dropped after 2 min, and an observation older than 10 s did not count. Each current
// report recomputes its observation, so the observation counts as the report does; no event says an
// unwatched area turned busy, so the mark holds until a member observes the area again, and the
// newer of two marks ranks first.
test('a quiet mark holds until the area is observed again and the newer mark ranks first',()=>{
 const areas=zones.zones([box([0,0,100,100]),box([300,0,400,100]),box([700,0,800,100])],['bee']),state={};
 const [here,near,far]=['main',300,700].map((_,i)=>areas.find(a=>zones.contains(a,{map:'main',x:[50,350,750][i],y:50})));
 const seen=(area,at,now)=>record(state,[{seenAt:now,farmAreaObservation:{id:area.id,at}}],[],areas,now);
 seen(near,1000,20_000);assert.equal(state.quiet[near.id],1000,'an observation in a current report counts whatever its age');
 seen(far,5000,5000);record(state,[],[],areas,1_000_000);
 assert.deepEqual(alternatives(state,areas,here).map(a=>a.id),[far.id,near.id],'both marks held; the newer ranks first');
 seen(near,1_000_000,1_000_000);assert.equal(alternatives(state,areas,here)[0].id,near.id,'a new observation renews the mark');
 record(state,[{seenAt:1_000_001,farmAreaEvidence:[{key:'k',actor:'Other',mtype:'bee',map:'main',x:350,y:50,at:1_000_001,kill:true}]}],[],areas,1_000_001);
 assert.equal(state.quiet[near.id],undefined,'a contest clears the mark');
});
test('one observed kill triggers contention; same-map quiet or unknown alternatives outrank another map',()=>{
 const areas=zones.zones([box([0,0,100,100]),box([300,0,400,100]),box([0,0,100,100],'bee','cave')],['bee']),state={};
 record(state,[{seenAt:1000,farmAreaEvidence:[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:1000,kill:true}]}],[],areas,1000);
 assert.equal(alternatives(state,areas,areas[0])[0].map,'main');
 for(const a of areas)state.activity[a.id]={actor:'Other'};
 assert.equal(alternatives(state,areas,areas[0]).length,0);
});
// The turns report's `fighting` carries the fight state. A member that kited out of range for
// longer than v1.5.0's 3 s window still fights the target it hit, so the Hunt's route
// recovery and backup walk wait for it.
test('unreachable selected target does not block recovery; the fight state and threats do',()=>{
 const s={seenAt:10000,target:{hp:100},combat:{inRange:false},turns:{fighting:false}};
 const fighting=()=>partyFighting({participants:['W']},{W:s},10000);
 assert.equal(fighting(),false,'a selected target it never hit');
 s.turns.fighting=true;assert.equal(fighting(),true,'kiting the target it hit, however long ago the last hit');
 s.target.hp=0;assert.equal(fighting(),false,'the target died');
 s.target.hp=100;s.turns.fighting=false;s.threats=[{hp:1}];assert.equal(fighting(),true,'a live threat');
});
