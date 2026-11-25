// The terrain recovery's goals against a blocked melee target, on the game's own Main geometry and
// box distance (movement/character/formation.ts `terrainRecoveryGoals` through
// `terrainRecoveryPorts`). This row holds the goal checks of live H35 (test-windows DESIGN.md 4.3),
// which recomputed the runtime's reach and safety: live W22 keeps the damage the recovery leads to.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {installGameGeometry}=require('./helpers/game-geometry.cjs');
const {installCharacterEvents}=require('./helpers/character-events.cjs');
const manifest=require('./fixtures/game/manifest.json');

// The newest pinned game data, which installGameGeometry also reads its geometry from.
function gameData(){
  const base=path.resolve('.caracal/game_files');
  const version=manifest.versions.map(v=>v.version).sort((a,b)=>Number(b)-Number(a)).find(v=>fs.existsSync(path.join(base,v,'data.js')));
  if(!version)return null;
  const data=fs.readFileSync(path.join(base,version,'data.js'),'utf8');
  return JSON.parse(data.slice(data.indexOf('{'),data.lastIndexOf('}')+1));
}

test('a warrior walled off from a parked Phoenix gets goals clear of terrain, outside its safety, at its reach and inside its range',t=>{
  const G=gameData(),context=vm.createContext({G:{}});
  if(!G||!installGameGeometry(context)){t.skip('no pinned game files');return;}
  // Live H35's positions: the warrior at main(349,1532), the Phoenix parked at main(738,1702) across
  // the terrain. The bodies take their hitboxes from G.dimensions, as the game's `get_width` reads,
  // and the warrior the game's human movement base (planner-geometry.ts `canStand`).
  const box=name=>({awidth:G.dimensions[name][0],aheight:G.dimensions[name][1]});
  const w={name:'W',ctype:'warrior',map:'main',in:'main',x:349,y:1532,real_x:349,real_y:1532,range:G.classes.warrior.range,speed:G.classes.warrior.speed,
    hp:100,max_hp:100,visible:true,base:{h:8,v:7,vn:2},...box('default_character')};
  const phoenix={id:'phoenix1',type:'monster',mtype:'phoenix',map:'main',in:'main',x:738,y:1702,range:G.monsters.phoenix.range,visible:true,hp:10000000,...box('phoenix')};
  context.character=w;
  assert.equal(context.can_move_to(phoenix.x,phoenix.y),false,'the straight approach crosses Main terrain');
  const host={parent:{entities:{phoenix1:phoenix}},distance:(a,b)=>context.distance(a,b),get_entity:id=>host.parent.entities[id],get_player:name=>name==='W'?w:null,
    can_move_to:(x,y)=>context.can_move_to(x,y),can_move:q=>context.can_move(q),partyCombatPosition:null};
  installCharacterEvents(host);
  const {createFormationSolver}=require('../../runtime/movement/character/formation.ts');
  // The warrior's desired combat range (steps.ts `desiredCombatRange`).
  const desired=Math.max(1,w.range-Math.min(12,Math.max(2,w.range*.05)));
  const group={key:'k',target:{...phoenix,server:'USII',state:'planned'}};
  const solver=createFormationSolver(host,{groupWalk:{travel:null},travelCombatActive:()=>false,currentTravelAttackers:()=>[]},
    new Proxy({now:()=>10000,clockOffset:()=>0,character:()=>w,G:()=>G,groupedCombat:()=>group,desiredCombatRange:()=>desired,partyList:()=>['W'],
      partyPositions:()=>[{...w,seenAt:10000,server:'USII'}],realm:()=>'USII',fresh:()=>true,grouped:()=>true,leader:()=>'W'},
      {get:(ports,key)=>key in ports?ports[key]:()=>undefined}));
  const goals=solver.terrainRecoveryPorts().goals();
  assert.ok(goals.length>0,'the warrior computes nonempty recovery goals');
  // The selected target's safety and the goal ring's reach, from the code's own rules.
  const safety=Math.min(phoenix.range,Math.max(6,w.range-24))+8,reach=Math.min(w.range-1,Math.max(desired,safety+12));
  for(const goal of goals){
    const gap=context.distance({...w,x:goal.x,y:goal.y,real_x:goal.x,real_y:goal.y},phoenix);
    assert.equal(context.can_move({map:'main',x:goal.x,y:goal.y,going_x:goal.x,going_y:goal.y,base:w.base}),true,'each goal is clear of terrain');
    assert.ok(gap>safety,`the goal's box gap ${gap} outside the Phoenix's safety ${safety}`);
    assert.ok(Math.abs(gap-reach)<.01,`the goal's box gap ${gap} at the reach ${reach}`);
    assert.ok(gap<=w.range,`the goal's box gap ${gap} inside the warrior's range ${w.range}`);
  }
});
