// A member's movement owner for a task walk's ladder (protocol/ladder.ts taskRound), in the
// shared harness. `climb` builds one ladder per owner on
// the context's clock and `endClimb` drops it; `released` and `ended` keep the owners the walk let
// go. The context's sleep never resolves, so a rung that waits stays waiting. The owner's walking-try
// reads (steps.ts `stepStalled`) answer one 200 ms round trip and a 1 s report interval unless `ports`
// names its own. The context's climbTaskWalk is the movement owner's (runtime/movement/character/owner.ts),
// which climbs these ladders.
const {createOwnerLadder,taskRound}=require('../../../runtime/protocol/ladder.ts');
const {installRequesters}=require('./requesters.cjs');
function taskLadder(c,ports={}){
  const ladders={},ended=[],released=[];
  c.sleep=()=>new Promise(()=>{});
  (c.root??={}).partySurvival={taskRound};
  c.movement={climb:(owner,round)=>ladders[owner]||=createOwnerLadder(round,()=>c.Date.now()),
    fighting:()=>false,live:()=>null,hold(){},release(owner){released.push(owner);},endClimb(owner){ended.push(owner);delete ladders[owner];},last:()=>null,
    roundTrip:()=>200,reportInterval:()=>1000,...ports};
  installRequesters(c,{missingOnly:true});
  return {ladders,ended,released};
}
module.exports={taskLadder};
