const assert=require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {handoffAnniversaryToHunt}=require('../../runtime/events/coordinator/anniversary.ts');
const {catchup,handoff}=require('./fixtures/encounter-recovery-scenario.cjs');

// The catch-up walk carries a currency test, and the movement owner ends
// it; the client's own watcher no longer stops it. The fix pass removed the 30 s deadline: the
// journey's walking try ends a catch-up that stalls (`encounterCatchup`, `hold`).
scenarioTable('a catch-up walk carries its currency test, and each way it ends leaves no obsolete route restart',catchup,[
['the catch-up request carries its currency test and no deadline',r=>{
 const asked=[];
 r.c.smart_move=(destination,_cb,options)=>{asked.push(options.request);return new Promise(()=>{});};
 r.c.encounterCatchup();
 assert.equal(asked.length,1);assert.equal(asked[0].deadline,undefined);assert.equal(asked[0].current(),true);
 r.advance(30001);r.c.encounterCatchup();assert.equal(r.stops(),0,'the owner, not the client, ends the walk');
 assert.equal(asked.length,1,'a catch-up past 30 s asks no second walk');assert.equal(asked[0].current(),true,'a catch-up past 30 s stays current');
 assert.equal(r.c.groupWalk.travel.encounterCatchup.failed,undefined);
 r.c.cancelEncounterCatchup(r.c.groupWalk.travel);assert.equal(asked[0].current(),false,'a cancelled catch-up is no longer current');
}],
...['death','hold','manual','runtime','instance'].map(reason=>['catch-up handles '+reason+' without an obsolete route restart',r=>{
 r.c.encounterCatchup();
 if(reason==='death')r.control.primary=null;
 if(reason==='hold')r.c.groupWalk.travel.holdRequested=true;
 if(reason==='manual')r.c.navigationIntent.revision++;
 if(reason==='runtime')r.c.groupedFresh=()=>false;
 if(reason==='instance')r.target.in='other-instance';
 r.c.encounterCatchup();
 assert.equal(r.moves(),1);
 if(reason==='instance')assert.ok(r.c.groupWalk.travel.encounterCatchup.failed);
 else assert.equal(r.c.groupWalk.travel.encounterCatchup,undefined);
}]),
]);
// The encounter handoff table's positive row, restored from b9b5c91e after 9fe3dd11 cut it: a
// completed anniversary return whose members are free hands the party back to the Hunt's quest
// check once, and each row below holds one ownership that keeps the return.
scenarioTable('a completed anniversary return hands the party back to the Hunt only while no ownership keeps it',handoff,[
['completed osnake with a retained anniversary return hands back to quest policy',r=>{
 assert.equal(handoffAnniversaryToHunt(r.state,r.cycle,r.ports),true);
 assert.equal(r.state.monsterHunt.stage,'checking-quests');assert.equal(r.state.activeConvoy,null);
 assert.equal(handoffAnniversaryToHunt(r.state,r.cycle,r.ports),false);
}],
...['manual','new-command','loot','attacker','stale','hold','defending','visit'].map(reason=>['anniversary Hunt handoff preserves '+reason+' ownership',r=>{
 const s=r.state.statuses.W;
 if(reason==='manual')r.ports.navigation.intent=()=>({revision:4});
 if(reason==='new-command')r.state.commands.W={id:42};
 if(reason==='loot')s.groupedCombat.lootPending=true;
 if(reason==='attacker')s.groupedCombat.currentAttackers=[{id:'hawk'}];
 if(reason==='stale')s.seenAt=1;
 if(reason==='hold')r.state.activeConvoy.communicationHold={};
 if(reason==='defending')r.state.activeConvoy.phase='defending';
 if(reason==='visit')s.anniversaryVisit={};
 assert.equal(handoffAnniversaryToHunt(r.state,r.cycle,r.ports),false);
}]),
]);
