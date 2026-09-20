const test=require('node:test'),assert=require('node:assert/strict');
const {createManualNavigationCommands}=require('../../runtime/coordinator/navigation/manual-commands.ts');
function fixture(){
 const state={merchantCharacter:'M',leader:'L',activeRealm:'SR_USII',statuses:{L:{seenAt:100000,map:'cave',x:2,y:3}},characterLocations:{},commands:{}};
 const calls=[],block={realm:'SR_USI',connected:true};let seq=1;
 const service=createManualNavigationCommands(state,{now:()=>100000,nextCommand:()=>seq++,queue:(...args)=>calls.push(['queue',...args]),
 releaseEscape:()=>calls.push('escape'),authorize:(names,location)=>{calls.push(['authorize',names,location]);for(const name of names)state.characterLocations[name]=location;},
 authorizeRoute:(...args)=>calls.push(['route',...args]),members:()=>['L','F'],convoy:(...args)=>calls.push(['convoy',...args]),
 invalidate:(...args)=>calls.push(['invalidate',...args]),block:()=>block,realmExists:r=>r==='SR_USII',realmLabel:r=>r,
 restart:(...args)=>calls.push(['restart',...args]),log:(...args)=>calls.push(['log',...args]),persist:()=>calls.push('persist')});
 return {state,calls,block,send:body=>service.handle({character:'F',...body})};
}
test('manual travel releases escape and normalizes coordinates while retaining destination metadata',()=>{
 const f=fixture();assert.equal(f.send({type:'character-travel',location:{map:'cave',x:'2',y:'3',shape:'area'}}),null);
 assert.equal(f.calls[0],'escape');assert.deepEqual(f.state.commands.F.location,{map:'cave',x:2,y:3,shape:'area'});
 assert.equal(f.send({type:'character-travel',location:{map:'main',x:'bad',y:0}}),undefined);
 assert.equal(f.send({type:'unrelated'}),undefined);
});
test('party travel saves the return destination during an event without starting a convoy',()=>{
 const f=fixture();f.state.statuses.F={seenAt:100000,joinedEvent:'franky'};
 const result=f.send({character:'L',type:'party-monster-travel',location:{map:'main',x:1,y:2},resumeAfterEvent:true});
 assert.equal(result.body.deferredUntilEventEnd,true);assert.equal(f.calls[0][0],'route');assert.equal(f.calls.some(c=>c[0]==='convoy'),false);
 f.state.statuses.L.seenAt=1;assert.equal(f.send({character:'L',type:'party-monster-travel',location:{map:'main',x:1,y:2}}).status,409);
});
test('Town invalidates shared intent only for the party leader',()=>{
 for(const character of ['L','F']){const f=fixture();f.send({character,type:'town'});
 assert.deepEqual(f.calls[0],['invalidate',character==='L'?['L','F']:['F'],'manual Town',character==='L']);assert.equal(f.state.commands[character].navigationExempt,true);}
});
test('merchant home persists before delayed restart and avoids redundant same-realm restart',()=>{
 const f=fixture();f.send({character:'M',type:'go-home'});assert.equal(f.block.realm,'SR_USII');assert.equal(f.calls.at(-2),'persist');assert.equal(f.calls.at(-1)[2],150);
 f.calls.length=0;f.send({character:'M',type:'go-home'});assert.equal(f.calls.some(c=>c[0]==='restart'),false);
 assert.equal(f.send({type:'go-home'}).status,409);
});
test('return to leader rejects stale status; bank commands retain merchant-specific routing',()=>{
 const f=fixture();f.send({type:'return-leader'});assert.equal(f.state.commands.F.type,'return-leader');f.state.statuses.L.seenAt=0;assert.equal(f.send({type:'return-leader'}).status,409);
 f.send({type:'bank'});assert.deepEqual(f.calls.at(-1),['queue',['F'],'manual visit']);f.send({character:'M',type:'bank'});assert.deepEqual(f.calls.at(-1),['queue',['M'],'manual bank exchange']);
});
