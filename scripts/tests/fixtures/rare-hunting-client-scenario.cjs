// The character's rare client holding a Fairy encounter control, beside the targeting module that
// reads it (a shared setup lives in the harness). The hunting owner's
// client (hunting/character/rares.ts `installRareClient`) holds the control, and the targeting owner's module reads
// it through the hunting door's rare facts, as shared.js wires them (shared.js `target`,
// `pathRequest`, `climb`, `endClimb`). The row's doors stay in `doors`, so a row changes the Hunt
// walk's control or the group walk the module reads.
const {installRareClient}=require('../../../runtime/hunting/character/rares.ts');
function fixture() {
  let time=10000;
  const entity={id:'fairy',mtype:'tinyp',type:'monster',map:'main',x:100,y:0,hp:5600,visible:true};
  const control={id:'e1',kind:'encounter',revision:1,target:{...entity,in:'main'},destination:entity,deployer:'M'};
  let client;
  const rare={get control(){return client.control();},get active(){return client.active();},candidate:()=>false};
  const doors={hunt:{control:()=>null},walks:{groupWalk:{travel:null,signal:null}}};
  const c=require('../helpers/client-dependencies.cjs').passingContext({character:{name:'M',ctype:'merchant',map:'main',in:'main',x:0,y:0,items:[{name:'fieldgen0'}],slots:{}},
    G:{classes:{merchant:{}},items:{},skills:{}},parent:{entities:{fairy:entity}},get_entity:id=>c.parent.entities[id],Date:{now:()=>time},
    navigationIntent:{revision:1},isExternallyClaimedMonster:()=>false,
    smart_move:()=>new Promise(()=>{})},
  {hunting:{facts:{focus:{rare}},hunt:doors.hunt},walks:doors.walks});
  client=installRareClient({character:()=>c.character,frame:()=>c.parent,game:()=>c.G,entity:id=>c.get_entity(id),
    walk:()=>({clockOffset:0,runtimeId:'rt',intent:c.navigationIntent}),travel:()=>null,realm:()=>'USII',members:()=>['W','M'],
    passing:()=>false,priority:()=>0,levelAllowed:()=>true,reachable:()=>true,target:()=>c.rareTarget(),queueTarget:()=>null,
    unfinishedFight:()=>false,focus:()=>[],grouped:()=>false,eventBusy:()=>false,escaping:()=>false,errands:()=>false,lootClient:()=>null,
    loot:async()=>{},chestsLeft:()=>0,deploy:async()=>{},pathRequest:id=>c.rarePathRequest({id}),climb:walk=>c.climbTaskWalk(walk),
    endClimb:owner=>c.endTaskWalk(owner),retirePatrolWalk(){},handoff:async()=>{}});
  // The control arrives with a combat report, which applies it at once.
  client.acceptCombat({serverNow:time,rareControl:control});
  return {c,entity,control,client,doors,advance:ms=>time+=ms,
    // The next reply carries no control.
    endControl:()=>client.receive({serverNow:time,rareControl:null})};
}

module.exports = { fixture };
