// Setups for the independent approach group tests (scripts/tests/independent-approach-group.test.cjs),
// in the shared harness. The coordinator group whose members report independent capability.
const {evaluateGroup}=require('../../../runtime/coordinator/targeting/queue.ts');
const target={id:'A',mtype:'sparkbot',map:'main',in:'main',server:'USI',x:400,y:0};
function fixture(){
 let now=1000,g=null;const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:now,hp:100,map:'main',in:'main',server:'USI',x:i*400,y:0,range:200,
 combatSelection:{runtimeId:name},groupedCombat:{protocol:4,independentApproach:true,anchorVisible:false,candidates:i===0?[target]:[],evidence:[],currentAttackers:[],currentAttackersAt:now}}}));
 return {members,get g(){return g;},get now(){return now;},tick(){members.forEach(m=>{m.status.seenAt=now;m.status.groupedCombat.currentAttackersAt=now;});g=evaluateGroup(g,members,'W',now);now+=100;return g;},ready(nativeReady=true){for(let i=0;i<8;i++){this.tick();for(const m of members){m.status.groupedCombat.ack=g.selection;m.status.groupedCombat.queueAck=g.queueRevision;m.status.groupedCombat.independentReady={selection:g.selection,target:g.target?.id,at:now,ready:nativeReady,confirmation:g.independentConfirmation?.id};}}return this.tick();}};
}
module.exports={fixture};
