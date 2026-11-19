// Setups for the successor handoff tests (scripts/tests/successor-handoff.test.cjs), in the shared harness.
require('./coordinator-core.cjs');
// The coordinator group with a fight to succeed, and the client that promotes the successor.
const {evaluateGroup}=require('../../../runtime/coordinator/targeting/queue.ts');
const {authorizeSuccessor}=require('../../../runtime/coordinator/targeting/queue.ts');
const {createSuccessorClient}=require('../../../runtime/characters/targeting/queue-client.ts');
const {hidden}=require('../helpers/declared.cjs');
const monster=(id,x=80)=>({id,mtype:'stoneworm',map:'cave',in:'cave',x,y:0,priority:50});
function fixture(count) {
 let now=1000,group=null;const scope={},told=[];
 const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:now,hp:100,map:'cave',in:'cave',server:'USII',x:i*20,y:0,range:200,
 combatSelection:{runtimeId:name,id:null,revision:1,map:'cave'},groupedCombat:{protocol:4,anchorVisible:true,candidates:i?[]:['A','B','C','D'].map((n,i)=>monster(n,80+i*20)),threats:[],evidence:[],deaths:[],handoff:{capability:1,pairAck:null}}}}));
 const policy={allowed:true,...(count===undefined?{}:{hunt:{owner:'W',quest:'stoneworm',count,fresh:true}})};
 function tick(ack=true) {now+=100;for(const m of members){m.status.seenAt=now;if(ack){m.status.groupedCombat.ack=group?.selection;if(m.status.groupedCombat.handoff)m.status.groupedCombat.handoff.pairAck=group?.pairRevision;}}
 group=evaluateGroup(group,members,'W',now,0,false,'stoneworm');authorizeSuccessor(scope,group,members,policy,now,(hook,payload)=>told.push([hook,payload]));return group;}
 for(let i=0;i<9;i++)tick();
 return {members,policy,tick,scope,told,get group(){return group;},get now(){return now;},death(id){members[0].status.groupedCombat.deaths.push({...monster(id),server:'USII',at:now});},advance(ms){now+=ms;}};
}
function clientFixture(f) {
 let wall=f.now,mono=100,allowed=true,live=true;const trace=[];
 const c=createSuccessorClient({now:()=>wall,monotonic:()=>mono,serverNow:()=>wall,allowed:()=>allowed,live:()=>live,trace:(stage,data)=>trace.push({stage,...data})});
 c.accept(structuredClone(f.group));return {c,trace,expire(){mono+=hidden('successorGrantMs')+1;},advance(ms){mono+=ms;},block(){allowed=false;},hide(){live=false;},wall(value){wall=value;}};
}
module.exports={fixture,clientFixture};
