// The coordinator's recovery hooks (a shared setup lives in the harness).
const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorRecoveryHooks}=require('../../../runtime/movement/coordinator/arrivals.ts');
function fixture(){
 const state={monsterHunt:null,escape:null,commands:{}},calls=[];
 const ports={huntParticipants:()=>['P'],members:()=>['P','W'],intent:()=>({revision:8}),
  cancelConvoy:()=>calls.push('cancel'),convoy:(...args)=>{calls.push(['convoy',...args]);return false;},
  persist:()=>calls.push('persist'),
  escape:names=>names,releaseEscape:()=>{},abandonRare:()=>{},resumeHunt:()=>{},group:()=>'party:W'};
 return {state,calls,ports,hooks:createCoordinatorRecoveryHooks(state,ports)};
}

module.exports = { fixture };
