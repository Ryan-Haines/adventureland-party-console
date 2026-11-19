const test=require('node:test'),assert=require('node:assert/strict');
const {controlFixture}=require('./fixtures/farm-approach-scenario.cjs');
const {installFarmClient}=require('../../runtime/hunting/character/farm.ts');
const {REPORT_AGE_DEFAULTS}=require('../../runtime/protocol/reports.ts');
// The hunting owner's farm area service holds a competition move (farm.ts `competitionHold`) and writes the reason
// to the farm area's message; each case starts from Other's kill in the party's zone.
function held(plant){
 const t=controlFixture();t.party.targetMode='hunt';
 t.party.statuses.W.farmAreaEvidence=[{key:'kill',actor:'Other',mtype:'bee',map:'main',x:50,y:50,at:t.now(),kill:true}];
 plant(t);t.c.farmAreaTick();return t.party.farmAreaState.message;
}
test('all member radii must be empty, with fresh matching observations and competitor present',()=>{
 assert.match(held(t=>{t.party.statuses.P.farmCompetition.monsters.bee=1;}),/monsters remain/);
 assert.match(held(t=>{t.party.statuses.P.farmCompetition.monsters={goo:2};}),/^Relocating after Other/);
 assert.match(held(t=>{t.party.statuses.P.farmCompetition.at=t.now()-REPORT_AGE_DEFAULTS.reportFreshMs-1;}),/fresh/);
 assert.match(held(t=>{t.party.statuses.P.farmCompetition.revision=2;}),/fresh/);
 assert.match(held(t=>{for(const s of Object.values(t.party.statuses))s.farmCompetition.players=[];}),/no longer nearby/);
 // The switch is the root setting, read through the settings owner.
 const off=t=>t.c.settings.write({by:'test',changes:[{field:'relocateIfCompeting',value:false}]});
 assert.match(held(off),/disabled/);
 // HN15: the switch holds the move in every target mode, Farming included.
 assert.match(held(t=>{off(t);t.party.targetMode='farming';}),/disabled/);
});
test('client observes live monsters within its radius irrespective of claims and excludes dead or other-instance entities',()=>{
 const frame={socket:{connected:true},server_region:'US',server_identifier:'II',entities:{}};
 const planted={character:()=>({name:'W',map:'mansion',in:'mansion',x:0,y:0}),frame:()=>frame,spot:()=>({id:'a'}),members:()=>['W','P'],
  walk:()=>({clockOffset:0,runtimeId:'W',intent:{revision:1}}),kept:()=>({})};
 // The other ports answer nothing: this row reads only the report's competition part.
 const client=installFarmClient(new Proxy(planted,{get:(t,k)=>k in t?t[k]:()=>null}));
 client.receive({monsterSearchRadius:100});
 const rat={type:'monster',mtype:'rat',x:99,y:0,hp:10,visible:true};
 frame.entities={a:rat,b:{...rat,target:'Other'},dead:{...rat,hp:0},far:{...rat,x:101},wrong:{...rat,in:'other'},player:{type:'character',name:'Other',visible:true,x:5,y:0},party:{type:'character',name:'P',visible:true,x:5,y:0}};
 const o=client.report().farmCompetition;assert.equal(o.monsters.rat,2);assert.deepEqual(Array.from(o.players),['Other']);
 frame.socket.connected=false;assert.equal(client.report().farmCompetition,null);
});
// A burn tick carries no `pid`, so its evidence key keeps equal ticks apart by time. The 500 ms
// bucket before folded two ticks 210 ms apart into one hit, so a burning rival's two ticks never
// made the two hits a contest needs; the bucket is now the game's burn interval.
test('two equal burn ticks from another player are two hits, and two members see one tick as one',()=>{
 const had=Object.getOwnPropertyDescriptor(globalThis,'G');
 globalThis.G={conditions:{burned:{interval:210}}};
 try{
  let offset=0;
  const entities={Other:{type:'character',name:'Other'},m:{id:'m',type:'monster',mtype:'bee',x:0,y:0}};
  const planted={character:()=>({name:'W',map:'main',x:0,y:0}),frame:()=>({entities:{}}),members:()=>['W','P'],entity:id=>entities[id],
   walk:()=>({clockOffset:offset,runtimeId:'W',intent:{revision:1}}),kept:()=>({}),own:()=>false,hitReaders(){},ownHit(){}};
  const client=installFarmClient(new Proxy(planted,{get:(t,k)=>k in t?t[k]:()=>null}));
  const keys=()=>client.report().farmAreaEvidence.map(e=>e.key);
  const base=Math.ceil(Date.now()/210)*210-Date.now()+5;offset=base;
  client.onHit({source:'burn',hid:'Other',id:'m',damage:40});
  offset=base+210;client.onHit({source:'burn',hid:'Other',id:'m',damage:40});
  assert.equal(new Set(keys()).size,2,'two ticks 210 ms apart keep two keys');
  const copy=installFarmClient(new Proxy(planted,{get:(t,k)=>k in t?t[k]:()=>null}));
  offset=base+250;copy.onHit({source:'burn',hid:'Other',id:'m',damage:40});
  assert.equal(copy.report().farmAreaEvidence[0].key,keys()[1],'another member\'s copy of the second tick shares its key');
 }finally{if(had)Object.defineProperty(globalThis,'G',had);else delete globalThis.G;}
});
