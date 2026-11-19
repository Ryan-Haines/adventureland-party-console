// The coordinator's navigation command routes (a shared setup lives in the harness).
const test=require('node:test'),assert=require('node:assert/strict');
const {createManualNavigationCommands}=require('../../../runtime/movement/coordinator/arrivals.ts');
const {createMerchantHomeCommand}=require('../../../runtime/merchant-realm/api.ts');
function fixture(){
 const state={merchantCharacter:'M',leader:'L',activeRealm:'SR_USII',statuses:{L:{seenAt:100000,map:'cave',x:2,y:3}},characterLocations:{},commands:{}};
 const calls=[],block={realm:'SR_USI',connected:true};let seq=1,stop=()=>Promise.resolve();
 // The merchant's go-home command is the realm owner's; movement's commands ask it.
 const ports={now:()=>100000,nextCommand:()=>seq++,queue:(...args)=>calls.push(['queue',...args]),
 releaseEscape:()=>calls.push('escape'),authorize:(names,location)=>{calls.push(['authorize',names,location]);for(const name of names)state.characterLocations[name]=location;},
 authorizeRoute:(...args)=>calls.push(['route',...args]),members:()=>['L','F'],convoy:(...args)=>calls.push(['convoy',...args]),caller:()=>undefined,
 invalidate:(...args)=>calls.push(['invalidate',...args]),block:()=>block,realmExists:r=>r==='SR_USII',realmLabel:r=>r,
 restart:(...args)=>{calls.push(['restart',...args]);return stop();},log:(...args)=>calls.push(['log',...args]),persist:()=>calls.push('persist')};
 const service=createManualNavigationCommands(state,{...ports,home:createMerchantHomeCommand(state,ports)});
 return {state,calls,block,send:body=>service.handle({character:'F',...body}),failStop:error=>{stop=()=>Promise.reject(error);}};
}

module.exports = { fixture };
