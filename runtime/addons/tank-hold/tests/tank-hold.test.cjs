// Tank Hold's rules (runtime/addons/tank-hold/tank.ts) and its registration's answers, on planted
// views. The party is T (warrior tank), O (paladin off tank), R (ranger puller) and P (priest).
const test=require('node:test'),assert=require('node:assert/strict');
const t=require('../tank.ts');
const {registration}=require('../index.ts');

const party=['T','O','R','P'];
const settings=(extra={})=>({tank:'T',offTank:'O',puller:'R',pull:true,dangerHp:50,...extra});
const picks=(extra={})=>{const s=settings(extra);return t.picksOf(k=>s[k],s);};
const hero=(name,x,y,extra={})=>({name,type:'character',x,y,real_x:x,real_y:y,hp:1000,max_hp:1000,...extra});
const mob=(id,x,y,extra={})=>({id,type:'monster',mtype:'bee',x,y,real_x:x,real_y:y,target:null,...extra});
// A mover view for `me`, with the party at the camp (0,0) unless planted elsewhere and the pack at x 400.
function view(me,{heroes={},mobs=[],...extra}={}){
  const at={T:hero('T',0,0),O:hero('O',10,0),R:hero('R',20,0,{range:150}),P:hero('P',-10,0,{range:150}),...heroes};
  const entities={...at,...Object.fromEntries(mobs.map(m=>[m.id,m]))};
  const character={ctype:'x',map:'main',...at[me]};delete entities[me];
  return {character,entities,party,canMoveTo:()=>true,canStand:()=>true,stepSafe:()=>true,...extra};
}
const pack=[mob('a',400,0),mob('b',430,20),mob('c',460,-10)];

test('the picks: the puller defaults to the tank, and a blank pick is none',()=>{
  const scope={tank:'T',offTank:'',puller:null,pull:false};
  assert.deepEqual(t.picksOf(k=>scope[k],{dangerHp:50}),{tank:'T',offTank:null,puller:null,pull:false,dangerHp:50});
  assert.deepEqual(t.pulling(picks({puller:null}),view('T')),{tank:'T',puller:'T'});
  assert.equal(t.pulling(picks({pull:false}),view('T')),undefined,'Pull off');
  assert.equal(t.pulling(picks({tank:'X'}),view('T')),undefined,'a tank outside the party');
});

// The party as `targeting.aggroOwner` hands it, with the tank at `tankHp` of 1000.
const members=(tankHp=1000)=>party.map(name=>({name,hp:name==='T'?tankHp:1000,max_hp:1000}));
test('the aggro holder: the tank, and the off tank while the tank is in danger',()=>{
  assert.equal(t.holder(picks(),members()),'T');
  assert.equal(t.holder(picks(),members(400)),'O');
  assert.equal(t.holder(picks({offTank:null}),members(400)),'T','no off tank keeps the tank');
  assert.equal(t.holder(picks({tank:null}),members()),undefined,'no tank leaves it to the console');
  assert.equal(t.inDanger(hero('T',0,0,{hp:400}),50),true,'below the share');
  assert.equal(t.inDanger(hero('T',0,0,{hp:600}),50),false);
  assert.equal(t.inDanger(hero('T',0,0,{rip:true}),50),true,'dead');
});

test('the order: members hit what the tank holds, the tank grabs loose monsters, the off tank takes the tank\'s attackers in danger',()=>{
  const onTank=mob('a',0,0,{target:'T'}),onPriest=mob('b',0,0,{target:'P'}),idle=mob('c',0,0);
  const c=[idle,onPriest,onTank];
  const ids=list=>list&&list.map(m=>m.id);
  assert.deepEqual(ids(t.preferred(picks(),view('P'),c)),['a','c','b']);
  assert.deepEqual(ids(t.preferred(picks(),view('T'),c)),['b','c','a']);
  assert.equal(t.preferred(picks(),view('O'),c),undefined,'the off tank fights as usual while the tank is safe');
  assert.deepEqual(ids(t.preferred(picks(),view('O',{heroes:{T:hero('T',0,0,{hp:100})}}),c)),['a','c','b']);
});

test('pull candidates: one pack monster for a ready puller, the attackers in a fight, nothing for the others',()=>{
  const ids=list=>list&&list.map(m=>m.id);
  assert.deepEqual(ids(t.pullCandidates(picks(),view('R',{mobs:pack}),pack)),['a'],'the pack monster nearest the tank');
  assert.deepEqual(ids(t.pullCandidates(picks(),view('P',{mobs:pack}),pack)),[],'the others wait');
  const low=view('R',{mobs:pack,heroes:{P:hero('P',-10,0,{hp:100})}});
  assert.deepEqual(ids(t.pullCandidates(picks(),low,pack)),[],'no pull while a member is in danger');
  const pulled=[mob('a',30,0,{target:'R'}),...pack.slice(1)];
  assert.deepEqual(ids(t.pullCandidates(picks(),view('P',{mobs:pulled}),pulled)),['a'],'the pulled monster only');
  assert.equal(t.pullCandidates(picks({pull:false}),view('P',{mobs:pack}),pack),undefined,'Pull off narrows nothing');
});

test('the pull mover: the tank waits outside the pack, the party beside it, the puller brings one back',()=>{
  // The tank inside the pack steps to a clear point; outside it holds.
  const inside=t.pullMove(picks(),view('T',{mobs:pack,heroes:{T:hero('T',410,0)}}));
  assert.equal(inside.answer.kind,'step');assert.equal(t.clear(inside.answer.to,pack),true);
  assert.equal(t.pullMove(picks(),view('T',{mobs:pack})).answer.kind,'hold');
  // A member out of its range steps toward the tank; inside it holds.
  const far=t.pullMove(picks(),view('P',{mobs:pack,heroes:{P:hero('P',-300,0,{range:150})}}));
  assert.equal(far.answer.kind,'step');assert.ok(Math.hypot(far.answer.to.x,far.answer.to.y)<=150);
  assert.equal(t.pullMove(picks(),view('P',{mobs:pack})).answer.kind,'hold');
  // A ready puller leaves the approach to the console.
  assert.equal(t.pullMove(picks(),view('R',{mobs:pack})).answer,undefined);
  // The chased puller walks back to the tank, keeping its target.
  const chased=t.pullMove(picks(),view('R',{mobs:[mob('a',380,0,{target:'R'})],heroes:{R:hero('R',350,0,{range:150})}}));
  assert.equal(chased.answer.kind,'step');assert.equal(chased.answer.target,'a');assert.ok(chased.answer.to.x<350);
  // In a fight everyone else is the console's.
  assert.equal(t.pullMove(picks(),view('P',{mobs:[mob('a',30,0,{target:'R'})]})).answer,undefined);
  // A dead puller ends the pulls with the reason.
  const down=t.pullMove(picks(),view('T',{mobs:pack,heroes:{R:hero('R',20,0,{rip:true})}}));
  assert.equal(down.answer,undefined);assert.match(down.line,/R is down/);
});

test('step safety in pull mode: no member but the puller ends a step in the pack, and a member under attack is never refused',()=>{
  assert.match(t.packRefusal(picks(),view('P',{mobs:pack}),{x:410,y:0}),/the pack/);
  assert.equal(t.packRefusal(picks(),view('P',{mobs:pack}),{x:100,y:0}),undefined);
  assert.equal(t.packRefusal(picks(),view('R',{mobs:pack}),{x:410,y:0}),undefined,'the puller');
  assert.equal(t.packRefusal(picks(),view('P',{mobs:[...pack,mob('d',0,0,{target:'P'})]}),{x:410,y:0}),undefined,'under attack');
  assert.equal(t.packRefusal(picks(),view('P',{mobs:pack,heroes:{P:hero('P',405,0)}}),{x:300,y:0}),undefined,'a step out of the block it stands in');
  assert.equal(t.packRefusal(picks({pull:false}),view('P',{mobs:pack}),{x:410,y:0}),undefined,'Pull off');
});

test('the formation: the safest point nearest the tank, and the tank keeps the solver\'s best',()=>{
  const ask=character=>({character,members:[{name:'T',x:0,y:0},{name:'P',x:-100,y:0}],
    candidates:[{x:5,y:0,danger:2},{x:40,y:0,danger:0},{x:-80,y:0,danger:0}]});
  assert.deepEqual(t.aroundTank(picks(),ask('P')),{x:40,y:0});
  assert.equal(t.aroundTank(picks(),ask('T')),undefined);
  assert.equal(t.aroundTank(picks({tank:null,offTank:null}),ask('P')),undefined);
});

// A planted context: the scope store holds the card line's picks for the scope the call is for.
function ctx(scopeStore,{character}={}){
  const handle=values=>({get:k=>values[k],set:(k,v)=>{values[k]=v;},rev:()=>0});
  return {side:'character',character,scope:'T',settings:{dangerHp:50},
    store:{scope:handle(scopeStore),character:handle({}),party:handle({})},read:()=>undefined,act:()=>({id:'x'}),outcome:()=>undefined};
}
test("the registration: each scope's own picks reach the anchor and the aggro owner through the context",()=>{
  const h=registration.hooks,s={dangerHp:50};
  const first=ctx(settings()),second=ctx({tank:'P',offTank:null,puller:null,pull:false});
  assert.equal(h['group.anchor']([{name:'P',ctype:'priest'},{name:'T',ctype:'warrior'}],s,first),'T');
  assert.equal(h['group.anchor']([{name:'P',ctype:'priest'},{name:'T',ctype:'warrior'}],s,second),'P','another scope names its own tank');
  assert.equal(h['group.anchor']([{name:'T',ctype:'warrior',available:false},{name:'O',ctype:'paladin'}],s,first),'O');
  assert.equal(h['group.anchor']([{name:'T',ctype:'warrior'}],s,ctx({})),undefined,'no tank picked');
  const aggro=(tankHp,c=first)=>h['targeting.aggroOwner']({character:'P',leader:'P',members:members(tankHp)},s,c);
  assert.equal(aggro(),'T');
  assert.equal(aggro(400),'O',"the off tank while the tank's member view reads in danger");
  assert.equal(aggro(400,second),'P','no off tank in that scope');
  assert.equal(h['targeting.candidates']({candidates:pack,character:{name:'T'},entities:{},party},s,first),undefined,'the grouped queue has no entities');
});

test('the registration: the mover keeps its line in the character store for the status report',()=>{
  const h=registration.hooks,c=ctx(settings(),{character:'T'});
  const answer=h['movement.request'][0].answer(view('T',{mobs:pack}),{dangerHp:50},c);
  assert.equal(answer.kind,'hold');
  assert.deepEqual(h['status.report']({character:{name:'T'}},{dangerHp:50},c),{role:'Tank',line:"Waiting outside the pack for R's pull"});
  assert.equal(h['status.report']({character:{name:'T'}},{dangerHp:50},ctx({})),undefined,'no tank picked');
});
