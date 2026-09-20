const test=require('node:test'),assert=require('node:assert/strict');
const createReturn=require('../rare-farming-return.cjs');
function fixture(){
 let time=10000,starts=0,reject=false;
 const party={leader:'L',followers:{F:true},monsterFocus:['boar'],farmingPolicy:'auto',statuses:{},
  rareHuntReturn:{leader:'L',realm:'USII',focus:'["boar"]',policy:'auto',revisions:{L:1,F:1},returnLocation:{map:'winterland',x:0,y:0}}};
 for(const n of ['L','F'])party.statuses[n]={map:'main',x:0,y:0,hp:100,seenAt:time};
 const hooks={now:()=>time,realm:()=> 'USII',intent:()=>({revision:1,cancelled:false}),persist(){},
 cancelConvoy(){party.activeConvoy=null;},resumeHunt(){},convoy(location,label,names,purpose){starts++;if(reject)return false;
 party.activeConvoy={id:'c'+starts,location,participants:names,purpose,phase:'travel'};return true;}};
 let control=createReturn(party,hooks);
 return {party,hooks,tick:paused=>control.tick(paused),moving:()=>control.moving(),starts:()=>starts,reject:()=>reject=true,
 advance(){time+=6000;},reload(){party.rareHuntReturn=JSON.parse(JSON.stringify(party.rareHuntReturn));control=createReturn(party,hooks);}};
}
test('rejected return dispatch survives serialization and retries',()=>{
 const r=fixture();r.reject();r.tick(false);assert.ok(r.party.rareHuntReturn);r.reload();r.advance();
 for(const s of Object.values(r.party.statuses))s.seenAt=16000;
 r.tick(false);assert.equal(r.starts(),2);assert.ok(r.party.rareHuntReturn);
});
test('offline member retains obligation after leader arrives, then rejoins a return convoy',()=>{
 const r=fixture();r.party.statuses.F.seenAt=0;r.tick(false);
 assert.deepEqual(r.party.activeConvoy.participants,['L']);
 r.party.statuses.L.map='winterland';r.party.activeConvoy=null;r.reload();r.advance();
 r.party.statuses.L.seenAt=16000;r.tick(false);assert.ok(r.party.rareHuntReturn);assert.equal(r.starts(),1);assert.equal(r.moving(),false);
 r.party.statuses.F.seenAt=22000;r.party.statuses.L.seenAt=22000;r.advance();r.tick(false);
 assert.equal(r.starts(),2);assert.deepEqual(r.party.activeConvoy.participants,['L','F']);
});
test('protected activity and unrelated convoy cannot consume or steal the return',()=>{
 const r=fixture();r.party.activeConvoy={id:'event',purpose:'event-return'};r.tick(true);r.tick(false);
 assert.equal(r.party.activeConvoy.id,'event');assert.ok(r.party.rareHuntReturn);assert.equal(r.starts(),0);
});
test('missing leader heartbeat pauses recovery without discarding durable intent',()=>{
 const r=fixture();delete r.party.statuses.L;r.tick(false);assert.ok(r.party.rareHuntReturn);assert.equal(r.starts(),0);
});
test('arrival anywhere inside selected farm boundary completes return without a center-point loop',()=>{
 const r=fixture();r.party.rareHuntReturn.returnLocation.boundary=[-500,-500,500,500];
 for(const s of Object.values(r.party.statuses))Object.assign(s,{map:'winterland',x:400,y:400});
 r.tick(false);assert.equal(r.party.rareHuntReturn,null);assert.equal(r.starts(),0);
});

test('rare return resumes the same Hunt cycle and mission idempotently without preparing quests',()=>{
 const r=fixture(),mission={target:'snake',owners:['L'],destination:{map:'main',x:120,y:90}};
 r.party.monsterHunt={cycleId:'hunt-1',stage:'farming',missions:[mission],currentIndex:0,target:'snake',owner:'L',convoyId:'old'};
 r.party.rareHuntReturn.hunt=true;r.party.rareHuntReturn.cycleId='hunt-1';
 r.hooks.resumeHunt=()=>assert.fail('must not rebuild quest work');
 r.tick(false);r.tick(false);
 assert.equal(r.party.monsterHunt.stage,'mission-travel');assert.equal(r.party.monsterHunt.convoyId,null);
 assert.equal(r.party.monsterHunt.missions[0],mission);assert.equal(r.party.monsterHunt.currentIndex,0);
 assert.equal(r.party.monsterHunt.owner,'L');assert.equal(r.party.rareHuntReturn,null);
});
