const test=require('node:test'),assert=require('node:assert/strict');
const zones=require('../../.build/shared/farming-zones.cjs');
const control=require('../farm-area-control.cjs');
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
test('competition requires damage evidence and ignores owned players and duplicate/stale reports',()=>{
 const areas=zones.zones([box([0,0,100,100])],['bee']),state={};
 const hit={key:'a',actor:'Outside',mtype:'bee',map:'main',x:50,y:50,at:1000};
 control.record(state,[{farmAreaEvidence:[hit]}],['Merchant'],areas,1000);
 assert.equal(state.activity[areas[0].id].until,undefined);
 control.record(state,[{farmAreaEvidence:[hit,hit]}],[],areas,1001);assert.equal(state.activity[areas[0].id].until,undefined);
 control.record(state,[{farmAreaEvidence:[{...hit,key:'b',actor:'Merchant',kill:true}]}],['Merchant'],areas,1001);
 assert.equal(state.activity[areas[0].id].until,undefined);
 control.record(state,[{farmAreaEvidence:[{...hit,key:'c',at:1002}]}],[],areas,1002);
 assert.equal(state.activity[areas[0].id].until,121002);
 control.record(state,[{farmAreaEvidence:[{...hit,key:'old',kill:true}]}],[],areas,140000);
 assert.equal(state.activity[areas[0].id],undefined);
});
test('one observed kill triggers contention; same-map quiet or unknown alternatives outrank another map',()=>{
 const areas=zones.zones([box([0,0,100,100]),box([300,0,400,100]),box([0,0,100,100],'bee','cave')],['bee']),state={};
 control.record(state,[{farmAreaEvidence:[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:1000,kill:true}]}],[],areas,1000);
 assert.equal(control.alternatives(state,areas,areas[0],1000)[0].map,'main');
 for(const a of areas)state.activity[a.id]={until:121000,hits:[]};
 assert.equal(control.alternatives(state,areas,areas[0],1001).length,0);
});
test('unreachable selected target does not block recovery; actual attacks and threats do',()=>{
 const s={seenAt:10000,target:{hp:100},combat:{lastAttackAt:0,inRange:false}};
 assert.equal(control.fighting(s,10000),false);s.combat.lastAttackAt=9999;assert.equal(control.fighting(s,10000),true);
 s.combat.lastAttackAt=0;s.threats=[{hp:1}];assert.equal(control.fighting(s,10000),true);
});
