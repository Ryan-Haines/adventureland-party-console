const test=require('node:test'),assert=require('node:assert/strict');
// The hunting owner's Cave queue (coordinator/cave.ts `caveCombat`) over the targeting owner's evaluateGroup, as snapshot.ts hands it.
const {caveCombat}=require('../../runtime/hunting/coordinator/cave.ts');
const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
require('./fixtures/coordinator-core.cjs');
const {hidden}=require('./helpers/declared.cjs');
function fixture(){
 const state={dailyDungeons:{phase:'active',run:'r',participants:['W','P','M']},statuses:{}};
 for(const [i,name] of ['W','P','M'].entries())state.statuses[name]={ctype:['warrior','priest','mage'][i],seenAt:1000,hp:100,map:'zone_r_0',in:'zone_r_0',server:'USII',x:i*10,y:0,range:200,
 dungeon:{cave:{run:'r',floor:0,paused:false}},combatSelection:{runtimeId:name,id:null,revision:0,map:'zone_r_0'},groupedCombat:{protocol:4,anchorVisible:true,candidates:[],deaths:[],evidence:[],sightings:[]}};
 let now=1000;
 const tick=()=>{for(const s of Object.values(state.statuses)){s.seenAt=now;s.groupedCombat.ack=state.groupedCombat?.selection;s.groupedCombat.queueAck=state.groupedCombat?.queueRevision;}
 state.groupedCombat=caveCombat(state,now,evaluateGroup);now+=100;return state.groupedCombat;};
 // The queue commits once the formation has held for groupReadyMs (queue.ts `ready`), so `steady`
 // ticks through that window from the next tick.
 const steady=()=>{const end=now+hidden('groupReadyMs');let g;while(now<=end)g=tick();return g;};
 return {state,tick,steady,now:()=>now};
}
const monster=(id,x)=>({id,mtype:'cave_rat',map:'zone_r_0',in:'zone_r_0',x,y:0,hp:100,priority:50});
test('cave uses three-slot normal queue, accepts follower sightings and promotes after death',()=>{
 const f=fixture();f.state.statuses.P.groupedCombat.candidates=['A','B','C','D'].map((id,i)=>monster(id,80+i*20));
 let g=f.steady();
 assert.deepEqual(g.queue.map(t=>t.id),['A','B','C']);assert.equal(g.committed,true);assert.equal(g.caveScope,'r:0');
 f.state.statuses.P.groupedCombat.deaths=[{...monster('A',80),server:'USII',at:f.now()}];
 g=f.tick();assert.deepEqual(g.queue.map(t=>t.id),['B','C','D']);
});
test('floor changes discard the old queue and votes prevent new pulls',()=>{
 const f=fixture();f.state.statuses.W.groupedCombat.candidates=[monster('A',80)];
 f.steady();
 for(const s of Object.values(f.state.statuses)){s.dungeon.cave.floor=1;s.map=s.in='zone_r_1';s.groupedCombat.state=f.state.groupedCombat;s.groupedCombat.candidates=[];}
 let g=f.tick();assert.equal(g.target,null);assert.equal(g.caveScope,'r:1');
 f.state.statuses.W.groupedCombat.candidates=[{...monster('B',80),map:'zone_r_1',in:'zone_r_1'}];
 f.state.statuses.P.dungeon.cave.paused=true;
 g=f.steady();assert.equal(g.committed,false);
});
