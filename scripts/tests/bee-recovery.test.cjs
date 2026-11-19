const test=require('node:test'),assert=require('node:assert/strict');
const {markerStyle}=require('../../runtime/status/character/marker-style.ts');
test('scatter markers stay red regardless of array index; grouped third stays double yellow',()=>{
 for(let i=0;i<3;i++)assert.deepEqual(markerStyle({role:'current'},i),{color:0xef4444,css:'#ef4444',double:false});
 assert.equal(markerStyle({role:'third'},0).double,true);assert.equal(markerStyle({role:'next'},0).css,'#facc15');
});
