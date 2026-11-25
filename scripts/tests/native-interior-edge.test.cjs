const test=require('node:test'),assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {fixture,repairDoorApproaches,native,walk,ports,from,to,origin,entry}=require('./fixtures/native-interior-edge-scenario.cjs');
scenarioTable('a native interior edge keeps its exact points and a local repair keeps transport boundaries (MOV-010)', ()=>undefined, [
 ['native Halloween interior corner retains its exact endpoint through a clear local connector', ()=>{
 assert.equal(walk(from,from),true);assert.equal(walk(to,to),true);assert.equal(walk(from,to),false);
 const plot=[entry,{...from},to],fixed=repairDoorApproaches(ports,origin,plot);
 assert.deepEqual(fixed.slice(0,2),plot.slice(0,2));assert.equal(fixed.at(-1),to);
 assert.ok(fixed.length>plot.length);let previous=from;
 for(const point of fixed.slice(2)){assert.equal(walk(previous,point),true,JSON.stringify([previous,point]));previous=point;}
 }],
 ['native-clear walking segments keep exact points and metadata', ()=>{
 const plot=[{...to,y:-91}],fixed=repairDoorApproaches(ports,from,plot);
 assert.deepEqual(fixed,plot);assert.equal(fixed[0],plot[0]);
 }],
 ['foreign instance, transition, long and unreachable edges keep their rejection', ()=>{
 for(const [origin,goal] of [[{...from,in:'a'},{...to,in:'b'}],[{...from,town:true},to],
  [from,{...to,town:true}],[from,{...to,map:'main'}],[from,{...to,x:1200}]]){
  const plot=[origin,goal];assert.deepEqual(repairDoorApproaches(ports,{map:'spookytown',x:34,y:1449},plot),plot);
 }
 assert.deepEqual(repairDoorApproaches({...ports,walk:()=>false},from,[to]),[to]);
 }],
 ['local walking repair preserves surrounding transport boundaries', ()=>{
 const exit={map:'main',x:1471,y:-424,transport:true,s:15};
 const plot=[entry,{...from},to,exit],fixed=repairDoorApproaches(ports,origin,plot);
 assert.equal(fixed[0],entry);assert.equal(fixed.at(-1),exit);assert.equal(fixed.at(-2),to);
 assert.ok(fixed.length>plot.length);
 }],
]);
