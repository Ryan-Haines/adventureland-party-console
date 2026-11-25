// Setups for the step safety tests (scripts/tests/step-safety.test.cjs), in the shared harness
//: one character among idle and attacking monsters on open
// ground. A bee-like idle monster in cell (1, 1) blocks (0, 0) to (96, 96); the pack is two idle bees west
// of the character.
const {stepSafety}=require('../../../runtime/movement/geometry/step-safety.ts');
const me='E2EWarrior';
const idle=(id,x,y,extra)=>({id,x,y,aggro:1,target:null,...extra});
const open=()=>true;
const check=(from,to,monsters,extra)=>stepSafety({name:me,from,to,monsters,walkable:open,...extra});
const pack=[idle('a',40,40),idle('b',40,104)];
// The two steps the choice rows offer: the first enters both bees' blocks, the second only bee b's.
const candidates=[{x:60,y:72},{x:90,y:130}];
const base=(extra)=>({name:me,from:{x:200,y:72},range:100,monsters:pack,walkable:open,...extra});
module.exports={me,idle,open,check,pack,candidates,base};
