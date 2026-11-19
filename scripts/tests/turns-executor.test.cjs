// The turns executor's reply rules against the game pin,
// in the shared harness. Isolated: a live row cannot order an old attack's acceptance ahead of a
// new attack's reply, or hold one slow reply 10 s before a lost one.
const test=require('node:test'),assert=require('node:assert/strict');
const {turnsWorld}=require('./fixtures/turns-world.cjs');

// An attack source that asks for the selected target each pass and logs what its spend books.
function attackWorld({frequency=1,own=[]}={}){
  let selected='A',epoch=0;const booked=[];
  const actor={name:'P',ctype:'priest',mp:1000,max_mp:1000,mp_cost:10,frequency,rip:false,items:[],level:80};
  const w=turnsWorld({actor,skills:{attack:{}},socket:true,own,epoch:()=>epoch,selected:()=>selected,
    asks:()=>[{skill:'attack',targets:[{id:selected}],rank:'damage',category:'damage',reason:'target',
      book:{accepted:()=>booked.push(['accepted',selected]),rejected:e=>booked.push(['rejected',selected,e&&e.reason])}}]});
  global.parent.next_skill={};
  return {...w,booked,reset(id){selected=id;epoch++;},select(id){selected=id;},last:()=>w.sent.at(-1)[1].id};
}

test('TC32: an attack accepted before a target reset settles nothing of the new flight',()=>{
  const w=attackWorld();
  try{
    w.turns.pass('tick');
    assert.deepEqual(w.sent.map(s=>s[1].id),['A']);
    // A target reset (runner.ts resetTargeting) moves the epoch; the next pass sends at the new target.
    // The next update, since a family sends once per update.
    w.reset('B');
    w.advance(1);
    w.turns.pass('tick');
    assert.deepEqual(w.sent.map(s=>s[1].id),['A','B']);
    // The old attack's acceptance arrives first. At the pin an acceptance names the target as
    // `target` and carries no `id` (server.js:3600-3610, 3662-3665, emitted at 11005).
    w.reply({response:'data',place:'attack',attacker:'P',target:'A',type:'attack'});
    assert.deepEqual(w.booked,[],'the old acceptance books nothing on the new target');
    assert.ok(w.turns.attackFlight(),'the new flight stays in flight');
    // The new attack's own reply settles it.
    w.reply({response:'cooldown',place:'attack',failed:true,id:'B',ms:400});
    assert.deepEqual(w.booked,[['rejected','B','cooldown']]);
  }finally{w.restore();}
});

// The lost-reply margin: the largest round trip of the last
// 4 s, the spends' own replies included, and at least the family's latest reply. One slow reply
// stops counting once it is older than the window and a newer reply of the family is measured.
test('TC5: a slow reply leaves the family margin once it is older than the 4 s window',()=>{
  const {mock}=require('node:test');
  // A 4000 ms attack cooldown, so the slow reply lands before the flight would count lost.
  let w;
  // The mock clock reads a tick's end inside its timers, so time moves 10 ms at a time.
  const step=ms=>{for(let i=0;i<ms/10;i++)mock.timers.tick(10);};
  try{
    mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
    w=attackWorld({frequency:0.25,own:['setTimeout','clearTimeout']});
    const answer=()=>w.reply({response:'data',place:'attack',target:w.last()});
    // Each send goes at the family's edge; the test answers it after `rtt`.
    const answered=rtt=>{const n=w.sent.length;for(let i=0;i<1000&&w.sent.length===n;i++)mock.timers.tick(10);
      assert.equal(w.sent.length,n+1,'the next attack goes at its edge');step(rtt);answer();};
    w.turns.pass('tick');
    step(2000);answer();
    answered(50);answered(50);
    const n=w.sent.length;
    for(let i=0;i<1000&&w.sent.length===n;i++)mock.timers.tick(10);
    // No reply to this one: the family counts it lost one cooldown and one margin after its send.
    step(8000);
    const lost=w.turns.records().filter(r=>r.kind==='lost').at(-1);
    assert.ok(lost,'the unanswered attack is counted lost');
    assert.ok(lost.waitedMs<=4000+200,`lost after ${lost.waitedMs} ms: the 2000 ms reply of 10 s before no longer counts`);
  }finally{w?.restore();mock.timers.reset();}
});

// The margin the survival owner's escape crossings and respawn read: the
// executor's own, a spend's reply time in it, so a lost reply on the gameplay clock waits for the
// clock's step once one reply has come back that late.
test('L6-11: the turns margin holds the largest reply time of the last 4 s',()=>{
  const {mock}=require('node:test');
  let w;
  try{
    mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
    w=attackWorld({frequency:0.25,own:['setTimeout','clearTimeout']});
    assert.equal(typeof w.turns.margin,'function','the turns owner answers its margin');
    w.turns.pass('tick');
    for(let i=0;i<25;i++)mock.timers.tick(10);
    w.reply({response:'data',place:'attack',target:w.last()});
    assert.ok(w.turns.margin()>=250,`the 250 ms reply counts: ${w.turns.margin()}`);
  }finally{w?.restore();mock.timers.reset();}
});

// A potion with none in the bag goes as the game's `use`, which the server answers as regeneration
// and holds 4000 ms (server.js:12041-12048 at the pin; game data 18285 `use_hp`: "Without a
// potion, restore 50 HP and wait 4 seconds instead"). Its lost-reply time counts from that cooldown.
test('TC5: a potion sent as regeneration counts lost only after regeneration\'s cooldown',()=>{
  const {mock}=require('node:test');
  const skills={attack:{},use_hp:{cooldown_group:'potion',cooldown:2000},regen_hp:{cooldown_group:'potion',share:'use_hp',cooldown_multiplier:2}};
  const actor={name:'W',ctype:'warrior',mp:100,max_mp:100,mp_cost:10,frequency:1,rip:false,items:[],level:80};
  let asked=true;
  const world=()=>turnsWorld({actor,skills,socket:true,own:['setTimeout','clearTimeout'],
    asks:()=>asked?[{skill:'use_hp',rank:'survival',category:'survival',reason:'class potion'}]:[]});
  let w;
  try{
    mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
    w=world();
    const {sent}=w;
    w.turns.pass('tick');asked=false;
    assert.deepEqual(sent.map(s=>s[0]),['skill'],'the potion goes');
    // The role loop's 250 ms tick is a pass, which finds a lost flight.
    for(let i=0;i<24;i++){mock.timers.tick(250);w.turns.pass('tick');}
    const lost=w.turns.records().find(r=>r.kind==='lost');
    assert.ok(lost,'the unanswered potion is counted lost');
    assert.ok(lost.waitedMs>=4000,`lost after ${lost.waitedMs} ms, inside the server's 4000 ms regeneration hold`);
  }finally{w?.restore();mock.timers.reset();}
});

// TG7: during a live A/B
// event the feed Curses the strongest teammate in range through `feedPush`, never a raw
// `use_skill`, and the executor sends it after its call budget question. The target gate behind
// `targeting.allows` refuses every player (shared.js `skillTargetAllowed`), and the executor skips
// that ask for the feed's own pushes only, so the same Curse from another requester is refused with
// the gate's reason. Separate: no live fixture runs the A/B event.
test('TG7: the A/B feed Curses its pick through the executor, and another requester is refused',async()=>{
  // The feed's own pick (turns/ab-feed.ts `sabotageSkill`): a priest, two
  // teammates in range and one of the other team; the feed's pushes are recorded.
  const {createAbFeed}=require('../../runtime/characters/turns/ab-feed.ts');
  const pushes=[],raw=[];
  const me={name:'P',ctype:'priest',type:'character',team:'A',mp:5000,x:0,y:0};
  const mates=[{id:'W',name:'W',type:'character',team:'A',attack:300,s:{}},{id:'R',name:'R',type:'character',team:'A',attack:900,s:{}},
    {id:'X',name:'X',type:'character',team:'B',attack:2000,s:{},x:0,y:0}];
  // The feed reads the A/B mode from the events owner's facts and each cast's readiness from the
  // executor (`ready`), which answers the Curse ready at its cost.
  const keep=['character','parent','G','is_in_range','use_skill','__partyEventFacts'].map(k=>[k,global[k]]);
  Object.assign(global,{character:me,parent:{entities:Object.fromEntries(mates.map(m=>[m.id,m]))},G:{skills:{curse:{mp:400}}},
    is_in_range:()=>true,use_skill:async(...a)=>{raw.push(a);},__partyEventFacts:{abtestingMode:()=>'feed'}});
  try{
    const feed=createAbFeed({facts:{abtesting:()=>'feed',feed:{strategy:()=>({mode:'feed'}),team:e=>e.team,enemySpawn:()=>({x:0,y:0}),step:async()=>undefined}},
      spend:async ask=>{pushes.push([ask.skill,ask.targets[0].name,ask.by]);return true;},
      ready:skill=>({ready:skill==='curse',flying:false,target:null,cost:400,reserve:0,margin:0}),
      setTargetId:()=>undefined,setState:()=>undefined});
    assert.equal(await feed.run(),true);
  }finally{for(const [k,v] of keep)global[k]=v;}
  assert.deepEqual(pushes,[['curse','R','core:turns/ab-feed']],"the feed's pick: the strongest teammate in range, pushed as the feed");
  assert.deepEqual(raw,[],'no raw use_skill from the feed');
  // The executor: the feed's push is sent after a call budget question; another requester's is refused.
  const actor={name:'P',ctype:'priest',level:80,mp:5000,max_mp:5000,mp_cost:10,mp_reduction:0,rip:false,items:[],slots:{}};
  const skills={curse:{name:'curse',class:['priest'],type:'skill',mp:400,target:true,hostile:true}};
  const asked=[],teammate={id:'R',name:'R',type:'character'};
  const w=turnsWorld({actor,skills,asks:()=>[],world:()=>({actor,skills,item:()=>undefined,context:{leader:'P',allies:[],monsters:[],mode:'event'}}),
    allows:t=>t&&t.type!=='monster'?'unauthorized or immune target':undefined,band:q=>{asked.push(q);return 'send';}});
  try{
    const other=w.turns.spend({skill:'curse',targets:[teammate],rank:'damage',category:'damage',by:'e2e:other',reason:'TG7'}).then(()=>'sent',e=>e&&e.reason);
    assert.equal(await other,'unauthorized or immune target','another requester is refused with the gate reason');
    assert.deepEqual(w.sent,[]);
    void w.turns.spend({skill:'curse',targets:[teammate],rank:'damage',category:'damage',by:'core:turns/ab-feed',reason:'A/B feed curse'}).catch(()=>{});
    assert.deepEqual(w.sent.map(s=>[s[0],s[1],s[2]?.name??s[2]]),[['skill','curse','R']],"the feed's Curse goes to its pick");
    assert.deepEqual(asked.map(q=>[q.band,q.method,q.data?.name]),[['survival','skill','curse']],'after its call budget question');
  }finally{w.restore();}
});

// The game nulls its socket on a disconnect before it removes the CODE frame (js/game.js:3312-3315
// `socket.on("disconnect")`, then `disconnect()` at 381-389 at the game pin), and the frame's
// `pagehide` stops the role runner, which stops the executor (runtime/lifecycle/character/loader.ts `dispose`,
// lifecycle/character/roles.ts `stop`). Every page's errors held "Cannot read properties of null (reading 'off')"
// from turns step 2 on. Isolated: a live row reads
// only the message, with no stack.
test('turns stop with the game socket gone takes nothing off it and throws nothing',()=>{
  const w=attackWorld();
  const socket=global.parent.socket;
  try{
    global.parent.socket=null;
    assert.doesNotThrow(()=>w.turns.stop(),'stop with a null socket');
  }finally{global.parent.socket=socket;w.restore();}
});

// TC44: a `cooldown` reply to a flight the pass already
// dropped still books the family's server clock from its `ms`, so the family does not resend
// inside the server's cooldown; it books nothing else.
test('TC44: a stale cooldown reply books the family server clock and nothing else',()=>{
  const w=attackWorld();
  try{
    w.turns.pass('event');
    assert.deepEqual(w.sent.map(s=>s[1].id),['A']);
    // The selection leaves A: the pass drops the flight, and the next pass sends at B.
    w.reset('B');
    w.turns.pass('event');
    w.reply({response:'cooldown',place:'attack',failed:true,id:'A',ms:400});
    assert.deepEqual(w.booked,[],'the stale reply books nothing of the requester');
    const stale=w.turns.records().filter(r=>r.kind==='stale');
    assert.ok(stale.length&&stale.at(-1).ms===400,'the stale record keeps the ms');
    assert.ok(w.notices.some(n=>n.hook==='skills.settled'&&n.outcome==='stale'),'skills.settled names it stale');
  }finally{w.restore();}
});

// The selection change: targeting passes over a target once the character's own hit in flight
// covers its HP (retire.ts), so the selection moves on before the server answers the attack. Observed
// on the e2e stack farming bees: every attack flight left as stale, `attackTiming.accepted` stayed
// at 0 and the entity refresh sent `send_updates` every 10 s.
test('TC48: a selection change leaves the attack flight to its reply, which books it',()=>{
  const w=attackWorld();
  try{
    w.turns.pass('event');
    assert.deepEqual(w.sent.map(s=>s[1].id),['A']);
    w.select('B');
    w.turns.pass('event');
    assert.ok(w.turns.attackFlight(),'the flight on A waits for its reply');
    assert.deepEqual(w.sent.map(s=>s[1].id),['A'],'B waits for the attack family');
    w.reply({response:'data',place:'attack',attacker:'P',target:'A',type:'attack'});
    assert.deepEqual(w.booked,[['accepted','B']],'the acceptance books');
    // The acceptance starts the attack cooldown, one second over the frequency (functions.js skill_timeout).
    w.advance(1e3/global.character.frequency);
    w.turns.pass('event');
    assert.deepEqual(w.sent.map(s=>s[1].id),['A','B'],'the next pass attacks B');
  }finally{w.restore();}
});

// `skills.held` and `skills.released` follow the row in force, here the A/B
// pending row (H6), which the default fixture cannot plant; the loop's pass reads it.
test('skills.held: the A/B pending row holds and releases',async()=>{
  const {createRoleLoop}=require('../../runtime/characters/turns/loop.ts');
  const {hold}=require('../../runtime/characters/turns/rules.ts');
  let mode='pending';const notices=[];
  const keep={character:global.character,parent:global.parent};
  Object.assign(global,{character:{name:'P',ctype:'priest',s:{}},parent:{}});
  try{
    const facts=()=>hold({active:true,rip:false,held:false,hand:null,abtesting:()=>mode,revive:false,roleCombat:true,merchant:false,merchantEventFight:false,dungeonOwned:false,occupied:[]});
    // The loop's run scope handle and the role runner's epoch; no game packet or timer comes in this row.
    const scope={on(){},off(){},setTimeout:()=>0,clearTimeout(){}};
    const loop=createRoleLoop({scope,epoch:()=>0,pass:()=>({hold:facts(),target:null}),armAttack:()=>{},nextReady:()=>null,role:()=>({}),turn:{},feed:async()=>false,
      revival:async()=>false,notify:(hook,payload)=>notices.push([hook,payload.row,payload.by]),report:e=>{throw e;}});
    loop.start();
    await loop.tick();
    mode='none';
    await loop.tick();
    loop.stop();
    assert.deepEqual(notices.filter(n=>n[0]!=='skills.passed'),[['skills.held','H6','06 (S-06c), the A/B test is pending'],['skills.released','H6','06 (S-06c), the A/B test is pending']]);
    assert.equal(notices.filter(n=>n[0]==='skills.passed').length,2,'one skills.passed per pass');
  }finally{Object.assign(global,keep);}
});

// The live row's case in a unit row: Manual with Combat off (H4) is a narrowing row, not a stop,
// and still holds and releases.
test('skills.released: Manual with Combat off holds and releases',async()=>{
  const {createRoleLoop}=require('../../runtime/characters/turns/loop.ts');
  const {hold}=require('../../runtime/characters/turns/rules.ts');
  let hand={on:true,combat:false};const notices=[];
  const keep={character:global.character,parent:global.parent};
  Object.assign(global,{character:{name:'W',ctype:'warrior',s:{}},parent:{}});
  try{
    const facts=()=>hold({active:true,rip:false,held:false,hand,abtesting:()=>'none',revive:false,roleCombat:true,merchant:false,merchantEventFight:false,dungeonOwned:false,occupied:[]});
    const scope={on(){},off(){},setTimeout:()=>0,clearTimeout(){}};
    const loop=createRoleLoop({scope,epoch:()=>0,pass:()=>({hold:facts(),target:null}),armAttack:()=>{},nextReady:()=>null,role:()=>({}),turn:{},feed:async()=>false,
      revival:async()=>false,notify:(hook,payload)=>notices.push([hook,payload.row,payload.by]),report:e=>{throw e;}});
    loop.start();
    await loop.tick();
    hand={on:false,combat:true};
    await loop.tick();
    loop.stop();
    assert.deepEqual(notices.filter(n=>n[0]!=='skills.passed'),[['skills.held','H4','01, Manual with Combat off'],['skills.released','H4','01, Manual with Combat off']]);
  }finally{Object.assign(global,keep);}
});

// TC47's computation: a step toward the target arms the edge at the moment the step's line
// first comes within range, from the step's start, its end and the character's speed.
test('TC47: the in-range time of a step is the first point on its line within range',()=>{
  const {inRangeAfter}=require('../../runtime/characters/turns/loop.ts');
  assert.equal(inRangeAfter({x:0,y:0},{x:100,y:0},50,{x:120,y:0},30),1800,'90 units at 50 per second');
  assert.equal(inRangeAfter({x:0,y:0},{x:100,y:0},50,{x:20,y:0},30),0,'already in range');
  assert.equal(inRangeAfter({x:0,y:0},{x:50,y:0},50,{x:120,y:0},30),null,'the step stops short');
  assert.equal(inRangeAfter({x:0,y:0},{x:100,y:0},0,{x:120,y:0},30),null,'a character with no speed');
});

// C1's spend action: the turn facts for an add-on's spend lift
// H9 and H10 for that spend only, while H4 and the occupied rows still hold; the emote action spends
// only a G.skills emote whose look the character unlocked.
test('C1: an action spend lifts H9 and H10 and keeps H4 and the occupied rows; an emote needs its unlocked look',()=>{
  const {hold,actionHold,refuses,emoteRefusal}=require('../../runtime/characters/turns/rules.ts');
  const facts=(f={})=>({active:true,rip:false,hand:null,abtesting:()=>undefined,revive:false,roleCombat:true,merchant:false,merchantEventFight:false,dungeonOwned:false,occupied:[],...f});
  const row=h=>refuses(h,{rank:'damage'})?.row;
  assert.equal(row(hold(facts({roleCombat:false}))),'H9','the role that does not fight holds a core damage spend');
  assert.equal(row(actionHold(facts({roleCombat:false}))),undefined,'an action spend lifts H9');
  assert.equal(row(hold(facts({merchant:true}))),'H10');
  assert.equal(row(actionHold(facts({merchant:true}))),undefined,'an action spend lifts H10');
  assert.equal(row(actionHold(facts({roleCombat:false,hand:{combat:false}}))),'H4','Manual with Combat off still holds');
  assert.equal(actionHold(facts({occupied:[{row:'O11',source:'05',read:()=>true}]})).stop?.row,'O11','an occupied row still holds');
  const skills={boop:{emote:'boop'},charge:{}};
  assert.equal(emoteRefusal(skills,{boop:1},'boop'),null);
  assert.equal(emoteRefusal(skills,{},'boop'),'the look boop is not unlocked');
  assert.equal(emoteRefusal(skills,{boop:1},'charge'),'charge is no emote skill');
});

// SV16: the server answers a regeneration `use` before the game moves `next_skill`, and survival asks
// again on the next `player` packet. The potion family waits its cooldown from the send, so the other
// regeneration does not go out into the shared cooldown and read `not_ready` (game data 18285:
// regen_hp and regen_mp share the potion cooldown, 4000 ms after a regeneration).
test('SV16: a regeneration accepted before next_skill moves holds the potion family its cooldown',()=>{
  let skill='regen_mp';
  const skills={use_hp:{cooldown_group:'potion',cooldown:2000},use_mp:{cooldown_group:'potion',share:'use_hp',cooldown:2000},
    regen_hp:{cooldown_group:'potion',share:'use_hp',cooldown_multiplier:2},regen_mp:{cooldown_group:'potion',share:'use_mp',cooldown_multiplier:2}};
  const actor={name:'W',ctype:'warrior',hp:999,max_hp:1000,mp:900,max_mp:1000,mp_cost:10,frequency:1,rip:false,items:[],level:80};
  const w=turnsWorld({actor,skills,asks:()=>[{skill,rank:'survival',category:'survival',reason:'regeneration'}]});
  try{
    global.parent.next_skill={attack:0};
    w.turns.pass('tick');
    assert.deepEqual(w.sent.map(s=>s[1]),['regen_mp']);
    w.reply({used:'mp',success:true,response:'data',place:'use'});
    skill='regen_hp';
    w.turns.pass('tick');
    assert.deepEqual(w.sent.map(s=>s[1]),['regen_mp'],'regen_hp waits the shared cooldown');
    w.advance(4100);w.turns.pass('tick');
    assert.deepEqual(w.sent.map(s=>s[1]),['regen_mp','regen_hp'],'and goes once it has passed');
  }finally{w.restore();}
});

// SV16 case A (live run on 1166d93dc): the escape reset the BankBoi's targeting between its MP
// potion's send and the reply. The epoch change dropped the flight as stale, the next pass sent a
// second potion 248 ms after the first, and the server answered `not_ready` with 2000 ms left. The
// potion reached the server, so its family waits the cooldown from that send.
test('SV16: a potion in flight at a target reset holds the potion family its cooldown',()=>{
  let epoch=0;
  // With no potion in the bag the ask goes as regeneration, which holds the family 4000 ms.
  const skills={use_hp:{cooldown_group:'potion',cooldown:2000},use_mp:{cooldown_group:'potion',share:'use_hp',cooldown:2000},
    regen_hp:{cooldown_group:'potion',share:'use_hp',cooldown_multiplier:2},regen_mp:{cooldown_group:'potion',share:'use_mp',cooldown_multiplier:2}};
  const actor={name:'M',ctype:'merchant',hp:1000,max_hp:1000,mp:100,max_mp:1000,mp_cost:10,frequency:1,rip:false,items:[],level:80};
  const w=turnsWorld({actor,skills,epoch:()=>epoch,asks:()=>[{skill:'use_mp',rank:'survival',category:'survival',reason:'class potion'}]});
  try{
    global.parent.next_skill={attack:0};
    w.turns.pass('tick');
    assert.equal(w.sent.length,1,'the potion goes');
    epoch++;
    w.advance(250);w.turns.pass('tick');
    assert.equal(w.sent.length,1,'the reset leaves the potion family waiting its cooldown');
    w.advance(3800);w.turns.pass('tick');
    assert.equal(w.sent.length,2,'and the next potion goes once it has passed');
  }finally{w.restore();}
});

// Call cost: the decisions follow the game's update, so a burst of passes
// inside one update sends a family at most once, and the next update sends it again. Isolated: a
// live row cannot hold one update while replies and passes arrive.
test('cadence: passes inside one game update send each family at most once',()=>{
  const w=attackWorld({frequency:100});
  try{
    // The browser host's draw: the game clock's reading at its last draw.
    const drawn=Date.now();
    global.parent.last_draw=new Date(drawn);
    w.turns.pass('event');
    assert.equal(w.sent.length,1,'the first pass sends the attack');
    // The reply comes and the cooldown ends inside the same update.
    w.reply({response:'data',place:'attack',target:'A'});
    w.advance(1000);
    for(let i=0;i<4;i++)w.turns.pass(i%2?'edge':'event');
    assert.equal(w.sent.length,1,'a second attack went in the same update');
    global.parent.last_draw=new Date(drawn+16);
    w.turns.pass('event');
    assert.equal(w.sent.length,2,'the next update sends the attack again');
  }finally{w.restore();}
});

// The e2e stack's game clock stands still for each 250 ms window, while the browser draws at the
// renderer's pace, and its server answered `ms: 9` to 44 resends inside one window. These rows freeze
// the clock: a `cooldown` reply holds the family to the next update, on every host.
function frozen(make){
  const {mock}=require('node:test');
  mock.timers.enable({apis:['Date'],now:100_000});
  const w=make();
  return {w,done(){w.restore();mock.timers.reset();}};
}
function earlyAttacks(w,draw){
  for(let i=0;i<20;i++){
    draw?.(i);
    w.turns.pass('edge');
    if(w.turns.attackFlight())w.reply({response:'cooldown',place:'attack',failed:true,id:'A',ms:9});
  }
}
test('a cooldown reply holds the family to the next update on a host with no draw',()=>{
  const {w,done}=frozen(()=>attackWorld({frequency:1}));
  try{
    assert.equal(global.parent.last_draw,undefined,'the host draws nothing');
    earlyAttacks(w);
    assert.equal(w.sent.length,1,'a resend went at the clock reading of the cooldown reply');
    w.advance(1);
    w.turns.pass('edge');
    assert.equal(w.sent.length,2,'the next clock reading resends');
  }finally{done();}
});
test('a cooldown reply holds the family to the next update on a browser host that keeps drawing',()=>{
  const {w,done}=frozen(()=>attackWorld({frequency:1}));
  try{
    const drawn=new Date(Date.now());
    earlyAttacks(w,i=>{global.parent.draws=i;global.parent.last_draw=drawn;});
    assert.equal(w.sent.length,1,'a draw at the same clock reading resent');
    global.parent.last_draw=new Date(Date.now()+250);
    w.advance(250);
    w.turns.pass('edge');
    assert.equal(w.sent.length,2,'the next update resends');
  }finally{done();}
});
// The rate: a 759 ms cooldown on 250 ms windows. The ping-compensated send lands 9 ms before the
// server's edge, and the resend at the next window lands after it, so the attack goes every 1000 ms,
// v1.5.0's cycle on the same stack.
test('a cooldown reply 9 ms before the edge keeps the attack at its cooldown cycle',()=>{
  const {w,done}=frozen(()=>attackWorld({frequency:1000/759}));
  try{
    global.parent.pings=[9];
    const start=Date.now();let edge=0,accepted=0,most=0;
    for(let step=0;step<80;step++){
      const at=start+step*250,before=w.sent.length;
      w.advance(at-Date.now());
      global.parent.last_draw=new Date(at);
      // Each window draws several times, and each draw runs a pass.
      for(let draw=0;draw<5;draw++){
        global.parent.draws=step*5+draw;
        w.turns.pass('edge');
        if(!w.turns.attackFlight())continue;
        if(at>=edge){accepted++;edge=at+759;w.reply({response:'data',place:'attack',target:'A'});}
        else w.reply({response:'cooldown',place:'attack',failed:true,id:'A',ms:edge-at});
      }
      most=Math.max(most,w.sent.length-before);
    }
    assert.equal(most,1,'more than one attack went in one update');
    assert.equal(accepted,20,'the attack fell behind one per 1000 ms over 20 s');
    assert.equal(w.sent.length,40,'each cycle sends more than the early attack and its resend');
  }finally{done();}
});

// The one exception to the cadence: a reply to our own call runs the next decision at once, and that
// decision sends only once the family's cooldown has ended. Isolated as above.
test('cadence: an own-call reply runs the next pass at once, which sends nothing before the cooldown ends',async()=>{
  const {createRoleLoop}=require('../../runtime/characters/turns/loop.ts');
  const {testScope}=require('./helpers/run-scope.cjs');
  const w=attackWorld();
  try{
    const loop=createRoleLoop({scope:testScope('03','act'),epoch:()=>0,pass:()=>w.turns.pass('event'),armAttack:()=>{},nextReady:()=>null,role:()=>({beforeAttack:async()=>{}}),turn:{},
      feed:async()=>false,revival:async()=>false,notify:()=>{},report:e=>{throw e;}});
    loop.start();
    await loop.tick();
    assert.equal(w.sent.length,1,'the first pass sends the attack');
    const passes=w.turns.meter().passes;
    global.parent.next_skill.attack=new Date(Date.now()+60_000);
    w.reply({response:'data',place:'attack',target:'A'});
    loop.listeners['skills.settled']({character:global.character.name,family:'attack'});
    assert.equal(w.turns.meter().passes,passes+1,'the reply did not run a pass at once');
    assert.equal(w.sent.length,1,'the pass sent before the cooldown ended');
    await new Promise(resolve=>setImmediate(resolve));
    loop.stop();
  }finally{w.restore();}
});

// A lost reply (3.4): an attack whose reply never comes leaves its flight once the cooldown it would
// have started and the family's reply margin have passed from its send, through the named bound
// that the status owner's bound record hears, and the next pass sends again. Isolated: a live row cannot drop one
// reply on the network.
test('a dropped attack reply releases the flight through its bound, and the next pass sends',()=>{
  const {mock}=require('node:test');
  const {boundsPending}=require('../../runtime/status/api.ts');
  let w;
  try{
    mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:100_000});
    w=attackWorld({frequency:1,own:['setTimeout','clearTimeout']});
    const fired=()=>boundsPending().filter(f=>f.bound==='flightLostReply'&&f.owner==='03').length,before=fired();
    w.turns.pass('event');
    assert.equal(w.sent.length,1,'the attack goes');
    for(let i=0;i<200&&w.sent.length===1;i++)mock.timers.tick(10);
    assert.equal(w.sent.length,2,'the next pass did not send after the lost reply');
    assert.equal(fired(),before+1,'the lost reply did not tell the bound record');
  }finally{w?.restore();mock.timers.reset();}
});

test('the attack request reads the pass\'s one target answer and asks targeting nothing more', () => {
  const {createAttackController} = require('../../runtime/characters/turns/attack.ts');
  const {createCrabRangeRecovery} = require('../../runtime/characters/targeting/gates.ts');
  const keys = ['__partyHooks', 'is_in_range', 'parent'], saved = Object.fromEntries(keys.map(k => [k, global[k]]));
  const target = {id: 'm1', x: 0, y: 0}, range = {id: 'm1', distance: 40};
  const pass = {target, passing: false, support: true, due: false, range, revision: 'r7'};
  let asked = 0;
  try {
    Object.assign(global, {parent: {}, is_in_range: () => true,
      __partyHooks: {turns: {target: () => { asked++; return pass; }}}});
    const controller = createAttackController({recovery: createCrabRangeRecovery(), target: () => target, selected: () => 'm1',
      active: () => true, state: () => ({}), report: assert.fail, dropped: () => undefined});
    const ask = controller.request(pass, {});
    assert.equal(asked, 0, 'the request reads the answer it was handed');
    assert.equal(ask.skill, 'attack');
    assert.equal(ask.context.range, range);
    // The reply's check still asks targeting at reply time, against the pass's revision.
    assert.equal(ask.context.current(), true);
    pass.revision = 'r8';
    assert.equal(ask.context.current(), false);
  } finally { for (const k of keys) if (saved[k] === undefined) delete global[k]; else global[k] = saved[k]; }
});

test('every spend table ask inside a pass reads the table the pass ran on', () => {
  let reads = 0, w;
  const facts = {get active() { reads++; return true; }};
  const actor = {name: 'P', ctype: 'priest', mp: 1000, max_mp: 1000, mp_cost: 10, frequency: 1, rip: false, items: [], level: 80};
  const inside = [];
  try {
    w = turnsWorld({actor, skills: {attack: {}}, facts, selected: () => 'A',
      asks: () => { for (let i = 0; i < 3; i++) inside.push(w.turns.hold()); return []; }});
    w.turns.pass('tick');
    assert.equal(reads, 1, 'one table read for the pass and its three asks');
    assert.ok(inside.every(h => h === inside[0]));
    // Outside a pass an ask reads the table at the ask.
    w.turns.hold(); w.turns.hold();
    assert.equal(reads, 3);
  } finally { w?.restore(); }
});

// The loop's cadence: the game updates once per clock window, and a pass reads the update, so a
// burst of packets inside one update runs one pass, and a packet inside an update already passed
// runs its pass at the next update.
function cadenceLoop() {
  const {createRoleLoop} = require('../../runtime/characters/turns/loop.ts');
  const {hold} = require('../../runtime/characters/turns/rules.ts');
  const keep = {character: global.character, parent: global.parent};
  Object.assign(global, {character: {name: 'P', ctype: 'priest', s: {}}, parent: {socket: {}}});
  const handlers = {}, timers = [], updates = [];
  let update = 1, passes = 0;
  const scope = {on: (_, event, fn) => { handlers[event] = fn; }, off() {}, clearTimeout() {},
    setTimeout: fn => timers.push(fn), afterUpdate: fn => updates.push(fn)};
  const facts = () => hold({active: true, rip: false, held: false, hand: null, abtesting: () => 'none', revive: false, roleCombat: true, merchant: false,
    merchantEventFight: false, dungeonOwned: false, occupied: []});
  const loop = createRoleLoop({scope, epoch: () => 0, update: () => update, pass: () => { passes++; return {hold: facts(), target: null}; },
    armAttack: () => {}, nextReady: () => null, role: () => ({}), turn: {}, feed: async () => false, revival: async () => false, notify: () => {}, report: e => { throw e; }});
  loop.start();
  // Runs the deferred timers and the draws they wait for, once.
  const draw = async () => { for (const fn of timers.splice(0)) fn(); for (const fn of updates.splice(0)) fn(); await new Promise(r => setImmediate(r)); };
  return {loop, handlers, draw, passes: () => passes, next() { update++; },
    done() { loop.stop(); Object.assign(global, keep); }};
}
test('cadence: a burst of packets inside one game update runs one pass', async () => {
  const c = cadenceLoop();
  try {
    for (let i = 0; i < 10; i++) for (const event of ['player', 'entities', 'action', 'hit']) c.handlers[event]({});
    await c.draw(); await c.draw();
    assert.equal(c.passes(), 1, 'more than one pass in one update');
  } finally { c.done(); }
});
test('cadence: a packet inside an update already passed runs its pass at the next update', async () => {
  const c = cadenceLoop();
  try {
    c.handlers.entities({}); await c.draw();
    assert.equal(c.passes(), 1);
    c.handlers.entities({}); await c.draw(); await c.draw();
    assert.equal(c.passes(), 1, 'the second packet waits for the next update');
    c.next(); await c.draw(); await c.draw();
    assert.equal(c.passes(), 2, 'the next update runs the waiting pass');
    await c.draw();
    assert.equal(c.passes(), 2, 'one waiting packet runs one pass');
  } finally { c.done(); }
});

// Every pass reads all the families at its update, so an edge inside an update already passed runs
// once at the next update: the priest's edges ran 2747 passes over 747 updates in the farm profile.
test('an edge inside an update already passed runs once at the next update', async () => {
  const {update} = require('./helpers/run-scope.cjs');
  const {w, done} = frozen(() => attackWorld({frequency: 1}));
  const timers = [], keep = global.setTimeout;
  try {
    global.setTimeout = fn => timers.push(fn);
    global.parent.last_draw = new Date(Date.now());
    w.turns.pass('edge');
    const passes = w.turns.meter().passes;
    for (let i = 0; i < 5; i++) w.turns.pass('edge');
    const step = async () => { for (const fn of timers.splice(0)) fn(); await update(); };
    await step(); await step();
    assert.equal(w.turns.meter().passes, passes, 'an edge ran inside the update already passed');
    global.parent.last_draw = new Date(Date.now() + 250);
    await step(); await step(); await step();
    assert.equal(w.turns.meter().passes, passes + 1, 'the waiting edges run one pass at the next update');
  } finally { global.setTimeout = keep; done(); }
});

test('afterNextUpdate runs its callback once, at the first draw of a later update', async () => {
  const {update} = require('./helpers/run-scope.cjs');
  const timers = [];
  const actor = {name: 'P', ctype: 'priest', mp: 1000, max_mp: 1000, mp_cost: 10, frequency: 1, rip: false, items: [], level: 80};
  const w = turnsWorld({actor, skills: {attack: {}}, own: ['setTimeout'], asks: () => []});
  const keep = global.setTimeout;
  try {
    global.setTimeout = fn => timers.push(fn);
    global.parent.last_draw = new Date(1000);
    let ran = 0;
    w.turns.afterNextUpdate(() => { ran++; });
    // One step: the timers fire, then the draws they queued.
    const step = async () => { for (const fn of timers.splice(0)) fn(); await update(); };
    for (let i = 0; i < 5; i++) await step();
    assert.equal(ran, 0, 'a draw at the same clock reading is the same update');
    global.parent.last_draw = new Date(1250);
    for (let i = 0; i < 5; i++) await step();
    assert.equal(ran, 1);
  } finally { global.setTimeout = keep; w.restore(); }
});
test('cadence: a reply to the character own call inside an update already passed runs its pass at the next update', async () => {
  const c = cadenceLoop();
  try {
    c.handlers.entities({}); await c.draw();
    assert.equal(c.passes(), 1);
    c.loop.listeners['skills.settled']({character: 'P'}); await c.draw(); await c.draw();
    assert.equal(c.passes(), 1, 'the reply waits for the next update');
    c.next(); await c.draw(); await c.draw();
    assert.equal(c.passes(), 2, 'the next update runs the reply pass');
    c.next(); c.loop.listeners['skills.settled']({character: 'P'}); await c.draw();
    assert.equal(c.passes(), 3, 'a reply in an update with no pass yet runs at once');
  } finally { c.done(); }
});
