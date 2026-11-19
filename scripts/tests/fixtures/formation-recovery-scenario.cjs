// Setups for the formation recovery tests (scripts/tests/formation-path-recovery.test.cjs), in the
// shared harness: the coordinator's recovery state
// machine over three members, and the same machine with every follower report in for early coverage
// failure.
const {formationRecovery}=require('../../../runtime/movement/coordinator/recovery.ts');
const identity=JSON.stringify(['USII','arena','arena','goo']);
function recoveryFixture(){
 let now=10000,previous=null;
 const target={id:'goo',mtype:'cgoo',map:'arena',in:'arena',server:'USII',x:400,y:0,state:'planned',fighter:'W',startedAt:9000};
 const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:now,map:'arena',in:'arena',server:'USII',x:0,y:0,hp:100,range:180,
  combatSelection:{runtimeId:name},groupedCombat:{protocol:4,currentAttackersAt:now,currentAttackers:[],anchorVisible:true,evidence:[],candidates:[]}}}));
 members[1].status.groupedCombat.formationRecovery={target:identity,at:now,goals:[{x:240,y:0},{x:250,y:40},{x:250,y:-40}]};
 return {members,target,get r(){return previous?.formationRecovery;},get now(){return now;},
 tick(ms=100){now+=ms;for(const m of members){m.status.seenAt=now;m.status.groupedCombat.currentAttackersAt=now;
  if(m.status.groupedCombat.formationRecovery)m.status.groupedCombat.formationRecovery.at=now;}
 const r=formationRecovery(previous,members,target,'key',now,false,160,identity);previous={formationRecovery:r};return r;},
 ack(){for(const m of members)m.status.groupedCombat.formationRecovery={target:identity,at:now,ack:previous.formationRecovery.id};}};
}
function blockedCoverageFixture(){
 const f=recoveryFixture();f.tick();f.ack();f.tick();
 for(const m of f.members){m.status.moving=false;m.status.groupedCombat.formationRecovery={target:identity,at:f.now,ack:f.r.id,attempt:f.r.attempt};}
 f.members[1].status.groupedCombat.formationRecovery.coverageBlocked=true;
 f.members[0].status.groupedCombat.formationRecovery.followerRoute='unreachable';
 f.members[2].status.groupedCombat.formationRecovery.followerRoute='arrived';
 return f;
}
module.exports={identity,recoveryFixture,blockedCoverageFixture};
