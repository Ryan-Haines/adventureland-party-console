// A Cave assembly with a drifted member, through the hunting owner's Cave service (cave.ts `createCave`) on the
// daily dungeon fixture (a shared setup lives in the harness).
// `travel.tick` reconciles the visit; `calls` lists each command the tick issued, one entry per id
// with the members it went to.
const {fixture}=require('./daily-dungeons-scenario.cjs');
const {caveFloorMap}=require('../../../runtime/hunting/rules.ts');
function setup(){
 const f=fixture();f.active();
 const map=caveFloorMap('run-1',0),d=f.party.dailyDungeons,party=f.party,calls=[];
 const origin={id:'assembly',label:'Party assembly',map,x:0,y:0};
 const target={id:'boss',label:'Lockbreaker',map,x:1000,y:0};
 d.travel={origin,target,stage:'assembling',serial:4};
 for(const name of d.participants){d.commands[name]={id:'gather:'+name,action:'gather',run:d.run,target:origin};
  Object.assign(party.statuses[name],{map,x:0,y:0});party.statuses[name].dungeon.action={id:d.commands[name].id,status:'complete'};}
 party.statuses.P.x=100;
 const travel={tick(){
  const before=Object.fromEntries(d.participants.map(n=>[n,d.commands[n]?.id]));
  f.service.reconcile();
  for(const name of d.participants){const c=d.commands[name];if(!c||c.id===before[name])continue;
   const id=c.id.endsWith(':'+name)?c.id.slice(0,-name.length-1):c.id,call=calls.find(e=>e.id===id&&e.tick===calls.ticks);
   if(call)call.names.push(name);else calls.push({names:[name],action:c.action,id,tick:calls.ticks});}
  calls.ticks=(calls.ticks||0)+1;
 }};
 return {d,party,travel,calls};
}
function destinationFixture(){
 const f=setup();f.d.travel.stage='travelling';f.d.travel.target.down=true;
 for(const name of f.d.participants){f.d.commands[name]={id:'move:'+name,action:'move',run:f.d.run,target:f.d.travel.target,cruiseSpeed:79};
 Object.assign(f.party.statuses[name],{x:1000,y:0});f.party.statuses[name].dungeon.action={id:'move:'+name,status:'complete'};}
 f.party.statuses.W.x=1219;return f;
}

module.exports = { setup, destinationFixture };
