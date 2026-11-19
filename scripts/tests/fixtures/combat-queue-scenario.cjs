// Setups for the combat queue tests (scripts/tests/combat-queue.test.cjs), in the shared harness.
// The coordinator group, the same group on a Hunt, and the group pursuing a moving target.
const {evaluateGroup}=require('../../../runtime/coordinator/targeting/queue.ts');
const monster=(id,x=80,priority=50)=>({id,mtype:'boar',map:'cave',in:'cave',x,y:0,priority});
function fixture(){const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:1000,hp:100,map:'cave',in:'cave',server:'USII',x:i*20,y:0,range:200,
 combatSelection:{runtimeId:name,id:null,revision:0,map:'cave'},groupedCombat:{protocol:4,anchorVisible:true,ack:null,candidates:[],threats:[],evidence:[],deaths:[]}}}));
 let now=1000,g=null;
 return {members,get g(){return g;},tick(){members.forEach(m=>m.status.seenAt=now);g=evaluateGroup(g,members,'W',now);now+=100;return g;},ack(){members.forEach(m=>{m.status.groupedCombat.ack=g.selection;m.status.groupedCombat.queueAck=g.queueRevision;});}};}
function huntFixture() {
 const f=fixture();let group=null,now=1000;
 f.members[0].status.groupedCombat.candidates=[monster('A',80),monster('B',120)];
 function tick(ack=false,hunt='boar'){
  for(const m of f.members){m.status.seenAt=now;m.status.groupedCombat.ack=group?.selection;m.status.groupedCombat.queueAck=group?.queueRevision;
   if(ack)m.status.groupedCombat.pursuitAck=group?.pursuit?.revoking;}
  group=evaluateGroup(group,f.members,'W',now,0,false,hunt);now+=100;return group;
 }
 for(let i=0;i<8;i++)tick();
 return {members:f.members,tick,get group(){return group;},get now(){return now;}};
}
function pursuitFixture() {
 const f=fixture();f.members[0].status.groupedCombat.candidates=[monster('A',400),monster('B',500)];
 f.tick();f.ack();
 function tick(ackRevoke=false) {
  for(const m of f.members){const g=m.status.groupedCombat;
   g.approach={target:JSON.stringify(['USII','cave','cave',f.g.target.id]),at:f.g.seenAt+100,active:true,visible:true,intent:'approach',moving:true,displacement:0,deficit:300,coverage:0};
   if(ackRevoke)g.pursuitAck=f.g.pursuit?.revoking;
  }
  f.tick();f.ack();return f.g;
 }
 return {f,tick};
}
module.exports={fixture,huntFixture,pursuitFixture};
