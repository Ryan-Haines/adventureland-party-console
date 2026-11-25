// A party travel convoy restored after a coordinator restart (a shared setup lives in the harness).
const test=require('node:test'),assert=require('node:assert/strict');
const {createCoordinatorPartyConvoys}=require('../../../runtime/movement/coordinator/arrivals.ts');
const {initialCommandState}=require('../../../runtime/settings/coordinator/initial.ts');
function fixture(){
 let now=1000;
 const status=()=>({seenAt:now,map:'main',x:1,y:2,hp:100,server:'USII',convoyProtocol:4,convoyNavigation:{runtimeId:'fresh'}});
 const state={leader:'W',merchantCharacter:'M',followers:{P:true},statuses:{W:status(),P:status()},commands:{},activeConvoy:null,navigationEpoch:1,nextCommandId:2,location:null,targetMode:'farming'};
 const intents={W:{revision:1},P:{revision:1}},logs=[];
 const service=createCoordinatorPartyConvoys(state,{now:()=>now,activeNames:()=>['W','P'],intent:n=>intents[n],persist(){},resolveArea:(_a,_b,x)=>x,log:m=>logs.push(m),
  live:()=>({kind:'farming',tier:'farming',owner:'farm'})});
 service.start({map:'cave',x:50,y:60},'cave',['W','P']);
 const original=state.activeConvoy;
 Object.assign(state,initialCommandState({activeConvoy:original},()=>now));
 return {state,service,logs,intents,original,advance(ms){now+=ms;for(const s of Object.values(state.statuses))s.seenAt=now;}};
}

module.exports = { fixture };
