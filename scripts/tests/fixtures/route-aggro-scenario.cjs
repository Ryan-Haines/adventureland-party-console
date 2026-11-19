// Setups for the idle-aggro route cost tests (scripts/tests/route-aggro.test.cjs), in the shared
// harness, over the step safety setup's idle monsters.
const {stepSafety}=require('../../../runtime/movement/geometry/step-safety.ts');
const {idle,open}=require('./step-safety-scenario.cjs');
const p=(x,y)=>({map:'main',x,y});
// True when any walking segment of the plot enters an idle monster's block it did not start in.
const enters=(plot,monsters)=>plot.slice(1).some((step,i)=>stepSafety({name:'me',from:plot[i],to:step,monsters,walkable:open}).refusal==='idle-aggro');
module.exports={p,enters};
