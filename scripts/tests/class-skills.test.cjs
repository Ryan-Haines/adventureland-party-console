const test=require('node:test'),assert=require('node:assert/strict');
// The realm registry holds only the core registrations, so an installed add-on that answers a
// one-answer hook this file's own add-on answers leaves its rows as they are (helpers/core-hooks.cjs).
require('./helpers/core-hooks.cjs');
require('./fixtures/coordinator-core.cjs');
const {fixture}=require('./helpers/skill-world.cjs');
const {unlocked,blocked,cost,reserve}=require('../../runtime/characters/turns/skills/eligibility.ts');
const {rank}=require('../../runtime/characters/turns/skills/ranking.ts');
const {damage}=require('../../runtime/characters/turns/skills/damage.ts');
const {hitsAroundCaster}=require('../../runtime/characters/turns/skills/server.ts');
const {decision}=require('../../runtime/characters/turns/skills/types.ts');
const {createManaIncome}=require('../../runtime/characters/turns/skills/budget.ts');
const {createSkillEngine}=require('../../runtime/characters/turns/skills/engine.ts');
const protection=require('../../runtime/characters/turns/skills/protection.ts');
const {turnsWorld}=require('./fixtures/turns-world.cjs');
const {decisionAsk}=require('../../runtime/characters/turns/sources.ts');
const {skillRange}=require('../../runtime/characters/turns/skills/runtime.ts');

test('every catalog level and class gate is enforced at its boundary',()=>{
 for(const ctype of ['ranger','rogue','paladin','priest']){
  const {w}=fixture(ctype);
  for(const [id,s] of Object.entries(w.skills).filter(([,s])=>s.class?.includes(ctype)&&s.level&&!s.consume)){
   if(id==='quickpunch')continue;
   w.actor.level=s.level-1;assert.equal(unlocked(w,id),false,id+' locked');
   w.actor.level=s.level;assert.equal(unlocked(w,id),true,id+' unlocked');
  }
 }
});
// Game data lists the monsters' own skills beside the classes' with no `class` (design/skills.js
// "zap": type "monster", damage 1200, hostile). The server answered all 13 of them with success on
// a warrior and a priest in a bee farm, so the ranking sent them each pass: 1515 skill calls a
// minute on the warrior against v1.5.0's 7.
test('a monster skill of the game data is never unlocked or ranked for a character',()=>{
 for(const ctype of ['warrior','priest','ranger']){
  const r=fixture(ctype);
  r.w.skills.zap={name:'Zap',type:'monster',damage:1200,hostile:true,damage_type:'pure'};
  assert.equal(unlocked(r.w,'zap'),false,ctype);
  const t=r.add('a');
  assert.ok(!rank(r.w,t).casts.some(d=>d.skill==='zap'),ctype+' ranks no zap');
 }
});
test('equipment, INT, consumables, offhand and shared cooldown are enforced',()=>{
 const r=fixture('rogue');r.actor.int=63;assert.equal(unlocked(r.w,'mentalburst'),false);
 r.actor.int=64;assert.equal(unlocked(r.w,'mentalburst'),true);
 assert.equal(unlocked(r.w,'fanofknives'),true);r.actor.slots.belt=null;assert.equal(unlocked(r.w,'fanofknives'),false);
 assert.equal(unlocked(r.w,'quickpunch'),false);assert.equal(unlocked(r.w,'quickstab'),true);
 r.cooldowns.add('quickpunch');assert.equal(blocked(r.w,decision('quickstab',[r.add('a')])),'cooldown');
 assert.equal(unlocked(r.w,'pcoat'),false);assert.equal(unlocked(r.w,'shadowstrike'),false);
 const p=fixture('paladin');p.actor.slots.offhand=null;assert.equal(unlocked(p.w,'shield_slam'),false);
});
test('ranger chooses basic, 3shot, or 5shot by useful damage, not unlock order',()=>{
 for(const [n,expected] of [[1,null],[2,'3shot'],[3,'3shot'],[4,'3shot'],[5,'5shot']]){
  const r=fixture();const primary=r.add('0');for(let i=1;i<n;i++)r.add(''+i);
  assert.equal(rank(r.w,primary).attack?.skill||null,expected,'targets '+n);
 }
});
test('piercing shot beats basic only when armor makes it worthwhile',()=>{
 const r=fixture();const t=r.add('a',{armor:600});assert.equal(rank(r.w,t).attack?.skill,'piercingshot');
 t.armor=0;assert.equal(rank(r.w,t).attack,null);
});
test('multishot excludes unauthorized targets and refuses aggregate dangerous pulls',()=>{
 const r=fixture();const a=r.add('a',{attack:2000});r.add('b',{attack:2000});r.add('stranger',{authorized:false});
 const e=createSkillEngine(r.ports);assert.equal(e.choices.attack(r.w,a),null);
 r.w.context.monsters[0].attack=10;r.w.context.monsters[1].attack=10;
 assert.deepEqual(e.choices.attack(r.w,a).targets.map(t=>t.id),['a','b']);
});
test('damage accounts for shields, armor caps, resistance, overkill and pending hits',()=>{
 const r=fixture('paladin'),a=r.add('a');r.actor.armor=2000;
 assert.equal(damage(r.w,'shield_slam',a),15000);
 r.actor.crit=100;assert.equal(damage(r.w,'shield_slam',a),15000);
 const g=fixture('rogue'),t=g.add('a');t.resistance=600;assert.ok(damage(g.w,'mentalburst',t)<600);
 g.w.incoming=()=>t.hp;assert.equal(rank(g.w,t).casts.length,0);
});
test('MP cost reductions, pending reservations, and survival exceptions',()=>{
 const r=fixture('paladin');r.actor.mp_reduction=50;assert.equal(cost(r.w,'shield_slam'),1000);
 r.actor.mp=reserve(r.w)+900;assert.equal(blocked(r.w,decision('shield_slam',[r.add('a')])),'survival MP reserved');
 r.actor.mp=20;assert.equal(blocked(r.w,decision('selfheal',[],'survival')),null);
 assert.equal(blocked(r.w,decision('selfheal',[],'survival'),20),'insufficient MP');
});
// Absorb goes only from the leader. The engine's Absorb choice, asked through the core `absorb`
// source at `task`, reaches the executor and casts on the leader; the same setup sends nothing from
// a non-leader. A choice planted to skip the leader rule sends from the non-leader, so the check
// fails on that break.
test('the priest casts Absorb as leader and never from a non-leader',()=>{
 const {createCoreSources}=require('../../runtime/characters/turns/sources.ts');
 const sends=(decide,leader)=>{
  const r=fixture('priest');r.w.context.mode='grouped';const ally=r.ally('OtherPriest',{ctype:'priest'});r.add('a',{target:ally.name});
  r.w.context.leader=leader;
  const sources=createCoreSources({choices:{absorb:decide,support:()=>[],offense:()=>[]},book:()=>({})},{request:()=>null});
  const w=turnsWorld({actor:r.actor,skills:r.w.skills,world:()=>r.w,
   asks:()=>{const a=sources.absorb({roleLoop:true,combat:true,world:()=>r.w});return a?[a]:[];}});
  try{w.turns.pass('tick');return w.sent.filter(s=>s[0]==='skill').map(s=>[s[1],s[2]]);}finally{w.restore();}
 };
 assert.deepEqual(sends(protection.absorbDecision,'Hero'),[['absorb','OtherPriest']],'the leader casts Absorb on the ally its monster targets');
 assert.deepEqual(sends(protection.absorbDecision,'OtherPriest'),[],'a non-leader casts no Absorb');
 const planted=w=>protection.absorbDecision({...w,context:{...w.context,leader:w.actor.name}});
 assert.deepEqual(sends(planted,'OtherPriest'),[['absorb','OtherPriest']],'the planted break sends from the non-leader');
});
// Taunt half: the warrior's Taunt is a class decision
// (warrior-combat.ts `mayTaunt`, then warrior.ts `taunt`), cast through the skill runtime's class casts: the
// engine's `ready`, whose `ownsAggro` gives Taunt to the leader, then the executor's push at `task`
// (skills/runtime.ts `casts`, lifecycle/character/roles.ts `push`). The same cast sends from the leader and
// nothing from a non-leader, whatever the class code asked.
test('the warrior Taunt reaches the executor from the leader and never from a non-leader',async()=>{
 const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
 const sends=async leader=>{
  const r=fixture('warrior');r.w.context.mode='grouped';const ally=r.ally('Ally',{ctype:'priest'});const t=r.add('a',{target:ally.name});
  r.w.context.leader=leader;
  const e=createSkillEngine(r.ports),w=turnsWorld({actor:r.actor,skills:r.w.skills,asks:()=>[],world:()=>r.w});
  const cast=d=>e.ready(d)?w.turns.spend({...decisionAsk(e,d,'task'),by:'core:turns/class'}).then(()=>true,()=>false):Promise.resolve(false);
  try{void cast(decision('taunt',[t],'survival'));await flush();return w.sent.filter(s=>s[0]==='skill').map(s=>[s[1],s[2]?.id??s[2]]);}finally{w.restore();}
 };
 assert.deepEqual(await sends('Hero'),[['taunt','a']],'the leader taunts the monster on its ally');
 assert.deepEqual(await sends('Other'),[],'a non-leader sends no Taunt');
});
// Dropped the Hunter's Mark owner rule: the ranking scores the Mark by its condition's damage,
// which a mark already on the target does not add again.
// The damage-taken condition's value (ranking.ts `ampValue`): Curse adds the party's extra damage on a
// target that lacks the condition, and Purify loses it when it strips a condition that amplifies damage.
const withAmp=(r,id,amp)=>{const base=r.w.condition;r.w.condition=c=>c===id?{...base(c),cleansable:true,incdmgamp:amp,duration:30000}:base(c);};
test('Curse ranks while the target carries no damage-taken condition, and not once it carries it',()=>{
 const r=fixture('priest');
 r.w.skills.curse={name:'curse',class:['priest'],type:'skill',mp:100,target:true,hostile:true,condition:'cursed',level:1};
 withAmp(r,'cursed',20);r.ally('Hero',{attack:100,frequency:1});
 const t=r.add('a',{hp:100000,armor:0});
 assert.ok(rank(r.w,t).casts.some(d=>d.skill==='curse'),'the condition adds party damage');
 t.s={cursed:{ms:4000}};
 assert.ok(!rank(r.w,t).casts.some(d=>d.skill==='curse'),'a condition already on the target adds nothing');
});
test('Purify loses the value of a purifiable damage-taken condition it strips',()=>{
 const ranked=amp=>{
  const r=fixture('paladin');withAmp(r,'cursed',amp);r.ally('Hero',{attack:2000,frequency:1});
  const t=r.add('a',{hp:100000,armor:0});t.s={cursed:{ms:20000}};
  return rank(r.w,t).casts.some(d=>d.skill==='purify');
 };
 assert.equal(ranked(0),true,'a condition with no amplification costs nothing to strip');
 assert.equal(ranked(50),false,'stripping a 50% amplifier gives up more party damage than the hit deals');
});
test('auras coordinate duplicate classes deterministically',()=>{
 const r=fixture('paladin');r.ally('Second',{ctype:'paladin'});
 assert.equal(protection.aura(r.w).argument,'bulwark');
 r.w.context.leader='Second';assert.equal(protection.aura(r.w).argument,'zeal');
});
// The aura switched on a 10 s hold before. It now switches when its deciding condition changes,
// the threat mix's magical or physical verdict included. The verdict changes only when a monster
// enters or leaves the fight, and between fights the last verdict stands.
test('the paladin aura switches once when the fight turns magical and never on a stable mix',()=>{
 const r=fixture('paladin'),e=createSkillEngine(r.ports);
 const aura=()=>e.choices.support(r.w).find(d=>d.skill==='paladin_aura')?.argument;
 const set=()=>{const d=e.choices.support(r.w).find(d=>d.skill==='paladin_aura');e.book(d).accepted({});
  r.actor.s={['paladin_aura_'+d.argument]:{f:'Hero'}};return d.argument;};
 r.add('a',{target:'Hero',damage_type:'physical'});
 assert.equal(set(),'bulwark','a physical fight');
 r.add('b',{target:'Hero',damage_type:'physical'});
 for(let i=0;i<5;i++)assert.equal(aura(),undefined,'a stable physical mix never switches');
 r.add('c',{target:'Hero',damage_type:'magical'});r.add('d',{target:'Hero',damage_type:'magical'});r.add('e',{target:'Hero',damage_type:'magical'});
 assert.equal(set(),'sanctuary','the fight turning magical switches');
 for(let i=0;i<5;i++)assert.equal(aura(),undefined,'and only once');
 r.w.context.monsters.length=0;assert.equal(aura(),undefined,'the fight ending keeps the aura');
 r.add('f',{target:'Hero',damage_type:'magical'});assert.equal(aura(),undefined,'a magical next fight keeps it');
 r.actor.s.poisoned={};assert.equal(aura(),'warding','a cleansable condition switches at once');
});
// The income averages over the game's regeneration cycle (G.skills regen_mp, the server's 4 s potion
// hold), not over a picked 30 s window, so a gain stops counting one cycle after it arrived.
test('MP income counts only observed recovery over the regeneration cycle, never casts or expected refunds',()=>{
 const {cooldownOf}=require('../../runtime/characters/turns/api.ts');
 // G.skills' own rows (design/skills.js): regen_mp shares use_mp's cooldown at twice its length.
 const cycle=cooldownOf({use_mp:{cooldown:2000},regen_mp:{share:'use_mp',cooldown_multiplier:2,output:100}},'regen_mp',1);
 assert.equal(cycle,4000,"the game's regen_mp cycle");
 const b=createManaIncome();assert.equal(b.observe(0,1000,cycle),0);
 assert.equal(b.observe(1000,600,cycle),0,'a spend earns nothing');
 assert.equal(b.observe(2000,1000,cycle),400/4);
 assert.equal(b.observe(6000,1000,cycle),0,'the gain left the cycle');
 assert.equal(b.observe(7000,1100,0),0,'no regen_mp in the game data counts no income');
});
// The engine's booking settles a multishot's evidence only for the target IDs the server
// accepted.
test('engine settles only accepted target IDs of a multi-attack',()=>{
 const r=fixture();r.w.context.mode='event';const a=r.add('a');r.add('b');r.add('c');
 const e=createSkillEngine(r.ports),d=e.choices.attack(r.w,a);
 assert.ok(d&&d.targets.length===3,'a multishot on all three');
 const book=e.book(d);book.sent();book.accepted({targets:['a','c']});
 assert.deepEqual(r.evidence.slice(3).map(x=>[x.id,x.state]),[['a','engaged'],['b','rejected'],['c','engaged']]);
});
test('multiple pending cooldown families cannot spend the same MP',async()=>{
 const r=fixture('paladin');r.w.context.mode='event';r.actor.mp=5200;const t=r.add('a');
 const e=createSkillEngine(r.ports);
 // Shield Slam's 2000 MP in flight in the executor's ledger leaves too little for Smash.
 r.ledger.inFlight=2000;r.ledger.flying.add('shield_slam');
 assert.equal(e.ready(decision('smash',[t])),false);
 r.ledger.inFlight=0;r.ledger.flying.clear();
 assert.equal(e.ready(decision('smash',[t])),true);
 // The turns executor's one ledger holds the MP of a basic attack and a heal in flight, so a skill
 // of another family that needs that MP waits.
 await ledgerHoldsAttackAndHeal();
 await pushSettlesOnReply();
});
// part: a pushed spend settles only on the server's reply, resolving with an acceptance and
// rejecting with the reply's reason.
async function pushSettlesOnReply(){
 const r=fixture('priest'),t=r.add('a');
 r.w.skills.curse={name:'curse',class:['priest'],type:'skill',mp:400,target:true,hostile:true,cooldown:5000};
 r.w.skills.taunt={...r.w.skills.taunt,class:['priest']};
 const w=turnsWorld({actor:r.actor,skills:r.w.skills,asks:()=>[],selected:()=>'a',world:()=>r.w});
 const flush=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
 try{
  let settled=null;
  w.turns.spend({skill:'curse',targets:[t],rank:'damage',category:'survival',reason:'escape curse',by:'e2e'}).then(v=>settled=['ok',v],e=>settled=['failed',e.reason]);
  await flush();
  assert.deepEqual(w.sent.map(s=>s[0]),['skill'],'the push is sent');
  assert.equal(settled,null,'the push waits for the server');
  w.reply({place:'curse'});await flush();
  assert.deepEqual(settled,['ok',{place:'curse'}]);
  settled=null;
  w.turns.spend({skill:'taunt',targets:[t],rank:'task',category:'survival',reason:'taunt',by:'e2e'}).then(v=>settled=['ok',v],e=>settled=['failed',e.reason]);
  await flush();assert.equal(settled,null);
  w.reply({place:'taunt',failed:true,reason:'too_far'});await flush();
  assert.deepEqual(settled,['failed','too_far'],"a refused push rejects with the reply's reason");
 }finally{w.restore();}
}
async function ledgerHoldsAttackAndHeal(){
 const r=fixture('priest'),t=r.add('a'),ally=r.ally('W',{hp:5000});
 // MP for the attack's and the heal's mp_cost and Curse's cost, less one: with both in flight
 // Curse waits; with neither, it goes.
 // Game data 18285: heal shares the attack cooldown.
 r.w.skills.heal={...r.w.skills.heal,share:'attack'};
 r.w.skills.curse={name:'curse',class:['priest'],type:'skill',mp:400,target:true,hostile:true};
 r.actor.mp=2*r.actor.mp_cost+400-1;r.actor.max_mp=100000;
 let wanted=[{skill:'attack',targets:[t],rank:'damage',category:'damage',reason:'basic attack'},
  {skill:'heal',targets:[ally],rank:'survival',category:'survival',reason:'heal'}];
 const w=turnsWorld({actor:r.actor,skills:r.w.skills,asks:()=>wanted,selected:()=>'a',world:()=>r.w});
 try{
  w.turns.pass('tick');
  assert.deepEqual(w.sent.map(s=>s[0]),['heal'],'the heal outranks the basic attack in the attack family');
  assert.equal(w.turns.inFlightMp(),r.actor.mp_cost,'the heal in flight holds its mp_cost');
  wanted=[{skill:'curse',targets:[t],rank:'survival',category:'survival',reason:'curse'}];
  r.actor.mp=r.actor.mp_cost+400-1;
  w.turns.pass('tick');
  assert.deepEqual(w.sent.map(s=>s[0]),['heal'],'Curse waits for the MP the heal in flight holds');
  w.replies.shift().ok({});for(let i=0;i<6;i++)await Promise.resolve();
  w.advance(1000);
  wanted=[{skill:'attack',targets:[t],rank:'damage',category:'damage',reason:'basic attack'}];
  w.turns.pass('tick');
  assert.deepEqual(w.sent.map(s=>s[0]),['heal','attack']);
  assert.equal(w.turns.inFlightMp(),r.actor.mp_cost,'the basic attack in flight holds its mp_cost');
  wanted=[{skill:'curse',targets:[t],rank:'survival',category:'survival',reason:'curse'}];
  w.turns.pass('tick');
  assert.deepEqual(w.sent.map(s=>s[0]),['heal','attack'],'Curse waits for the MP the attack in flight holds');
  w.replies.shift().ok({});for(let i=0;i<6;i++)await Promise.resolve();
  w.advance(1000);r.actor.mp=400;w.turns.pass('tick');
  assert.deepEqual(w.sent.map(s=>s[0]),['heal','attack','skill'],'with nothing in flight Curse goes');
 }finally{w.restore();}
}
// Energize: no mage reaches a gate row, so the engine's unit world holds it. Energize sends its
// amount after its target (server.js `energize` takes `mp` and moves that much), the ledger holds
// the amount while it flies, and the class reserve, not a floor of its own, bounds it.
test('A36: Energize sends its amount after its target and keeps the class reserve',async()=>{
 const r=fixture('priest'),ally=r.ally('W',{hp:5000});
 r.actor.ctype='mage';r.actor.max_mp=1000;r.actor.mp=600;
 r.w.skills.energize={name:'energize',class:['mage'],type:'skill',cooldown:4000,target:true};
 let wanted=[{skill:'energize',targets:[ally],argument:350,rank:'maintenance',category:'maintenance',reason:'energize'}];
 const w=turnsWorld({actor:r.actor,skills:r.w.skills,asks:()=>wanted,world:()=>r.w});
 try{
  w.turns.pass('tick');
  assert.deepEqual(w.sent,[['skill','energize',ally.id||ally.name,350]],'the amount goes after the target');
  assert.equal(w.turns.inFlightMp(),350,'the ledger holds the amount in flight');
  w.replies.shift().ok({});for(let i=0;i<6;i++)await Promise.resolve();
  w.advance(5000);
  // The mage's reserve is 20% of its MP (eligibility.ts reserve): 600 - 450 leaves 150, below 200.
  wanted=[{skill:'energize',targets:[ally],argument:450,rank:'maintenance',category:'maintenance',reason:'energize'}];
  w.turns.pass('tick');
  assert.equal(w.sent.length,1,'an amount that leaves MP below the class reserve waits');
 }finally{w.restore();}
});
test('projectile tracker excludes strangers and expires or settles accepted actions',()=>{
 const r=fixture(),t=r.add('a');const p=require('../../runtime/characters/turns/skills/projectiles.ts').createProjectileTracker(()=>r.w);
 p.action({pid:'x',attacker:'Stranger',target:t.id,damage:100,eta:100});assert.equal(p.incoming(t.id,r.w.now),0);
 p.action({pid:'x',attacker:'Hero',target:t.id,damage:100,eta:100});assert.equal(p.incoming(t.id,r.w.now),90);
 p.hit({pid:'x'});assert.equal(p.incoming(t.id,r.w.now),0);
 p.action({pid:'y',attacker:'Hero',target:t.id,damage:100,eta:100});assert.equal(p.incoming(t.id,r.w.now+101),0);
 // With an attacker named, the sum counts that attacker's own hits only; an ally's hit is not
 // this character's, and each entry still ends at its hit or its eta.
 r.ally('Ally');
 p.action({pid:'h',attacker:'Hero',target:t.id,damage:100,eta:100});p.action({pid:'a',attacker:'Ally',target:t.id,damage:200,eta:100});
 assert.equal(p.incoming(t.id,r.w.now),270);
 assert.equal(p.incoming(t.id,r.w.now,'Hero'),90,"the Hero's own hit only");
 assert.equal(p.incoming(t.id,r.w.now,'Ally'),180,"the ally's hit is not the Hero's");
 p.hit({pid:'h'});assert.equal(p.incoming(t.id,r.w.now,'Hero'),0,'the own hit ends at its hit packet');
 assert.equal(p.incoming(t.id,r.w.now+101,'Ally'),0,"the ally's entry ends at its eta");
});
test('an add-on group.anchor answer centres the group on its member and keeps the priest range',()=>{
 // Step 9 (e2e/movement-owner-failures.md "Step 9" items 5 and 11): the `group.anchor` hook.
 // An add-on's answer centres the group on its member and keeps the priest's healing range,
 // the positioning it reads names a member stepping away, and an unavailable answer or a
 // switched-off add-on leaves the healing anchor.
 anchorByAddon();
});
function anchorByAddon(){
 const {evaluateGroup}=require('../../runtime/coordinator/targeting/queue.ts');
 const {partyHooks}=require('../../runtime/hooks/index.ts');
 const {registration,ANCHOR_ADDON}=require('./fixtures/anchor-addon.ts');
 const hooks=partyHooks();
 if(!hooks.registrations().some(r=>r.name===ANCHOR_ADDON))assert.deepEqual(hooks.register(registration),{ok:true});
 const members=['W','P','M'].map((name,i)=>({name,ctype:['warrior','priest','mage'][i],revision:1,status:{seenAt:1000,hp:100,map:'main',in:'main',server:'USII',x:i*20,y:0,range:[40,200,120][i],
  combatSelection:{runtimeId:name,id:null,revision:0,map:'main'},groupedCombat:{protocol:4,anchorVisible:true,ack:null,candidates:[],threats:[],evidence:[],deaths:[]}}}));
 const group=()=>{const g=evaluateGroup(null,members,'W',1000);return [g.anchor.name,g.range,g.priest];};
 try{
  assert.deepEqual(group(),['P',180,'P']);
  hooks.configure({[ANCHOR_ADDON]:{enabled:true,settings:{member:'W',second:'M'}}});
  assert.deepEqual(group(),['W',180,'P']);
  // The scope's placed value wins over the account's.
  assert.equal(evaluateGroup(null,members,'W',1000,0,false,null,[],{addonSettings:{[ANCHOR_ADDON]:{member:'M'}}}).anchor.name,'M');
  members[0].status.combat={positioning:{movementOwner:'addon:'+ANCHOR_ADDON,phase:'stepping-away'}};
  assert.deepEqual(group(),['M',180,'P']);
  members[0].status.combat=undefined;members[0].status.hp=0;
  assert.deepEqual(group().slice(0,1),['P']);
  members[0].status.hp=100;hooks.configure({[ANCHOR_ADDON]:{enabled:false,settings:{member:'W'}}});
  assert.deepEqual(group(),['P',180,'P']);
 }finally{hooks.configure({});}
}

// (and upstream issues"): "cleave as 1.5's warrior". The ranking proposes Cleave on every monster in
// range once two are in range: in Scatter, and in Default or an event only while two or more monsters attack party members
// (targeting's threat fact), and always at Franky. Outside Scatter it is the urgent cast that spends
// below the class reserve. Its range is the game's strict edge, and the send carries no target, since
// the game data names none.
{
  const rows=[
    ['Scatter with two monsters in range',{mode:'scatter',attackers:0},['cleave',false]],
    ['two attackers in Default',{mode:'grouped',attackers:2},['cleave',true]],
    ['one attacker in Default',{mode:'grouped',attackers:1},null],
    ['Franky',{mode:'event',event:'franky',attackers:0},['cleave',true]],
    ['below the reserve, two attackers in Default',{mode:'grouped',attackers:2,mp:900},['cleave',true]],
    ['below the reserve in Scatter',{mode:'scatter',attackers:0,mp:900},null],
    ['one monster in range in Scatter',{mode:'scatter',attackers:0,single:true},null],
  ];
  for(const [name,s,want] of rows)test(`cleave as 1.5's warrior: ${name}`,()=>{
    const r=fixture('warrior');r.actor.slots.mainhand={name:'axe'};r.actor.max_mp=4000;r.actor.mp=s.mp??4000;
    r.w.skills.cleave={name:'cleave',class:['warrior'],type:'skill',wtype:['axe','scythe'],range:160,level:52,mp:720,cooldown:1200,hostile:true,pierces_immunity:true,damage_type:'physical'};
    r.w.skills.hardshell={name:'hardshell',class:['warrior'],type:'skill',mp:480,level:60};
    Object.assign(r.w.context,{mode:s.mode,event:s.event??null});
    const a=r.add('a',{target:s.attackers>=1?'Hero':null});if(!s.single)r.add('b',{target:s.attackers>=2?'Hero':null});
    r.w.attacking=t=>t.target==='Hero';
    const got=rank(r.w,a).casts;
    if(!want)return assert.deepEqual(got,[]);
    assert.deepEqual(got.map(d=>[d.skill,!!d.belowReserve]),[want]);
    assert.deepEqual(got[0].targets.map(t=>t.id),['a','b'],'every monster in range');
  });
  test("cleave as 1.5's warrior: the strict edge and the send's arguments",()=>{
    const {skillRange}=require('../../runtime/characters/turns/skills/runtime.ts');
    const actor={x:0,y:0,range:20},s={range:160};
    assert.equal(skillRange(actor,{x:159.9,y:0},s,'cleave'),true);
    assert.equal(skillRange(actor,{x:160,y:0},s,'cleave'),false,'at the edge');
    assert.equal(skillRange(actor,{x:160,y:0},s,'agitate'),false,'Agitate, also centred on the caster, at the edge');
    assert.equal(skillRange(actor,{x:160,y:0},s,'taunt'),true,'a one-target skill keeps the inclusive edge');
    const {turnsWorld}=require('./fixtures/turns-world.cjs');
    const w=turnsWorld({actor:{name:'Hero',ctype:'warrior',level:80,mp:4000,max_mp:4000,mp_cost:10,rip:false,items:[],slots:{}},
      skills:{cleave:{class:['warrior'],type:'skill',mp:720,cooldown:1200,hostile:true}},
      asks:()=>[{skill:'cleave',targets:[{id:'a'},{id:'b'}],rank:'damage',category:'damage',reason:'cleave',belowReserve:true}],
      world:()=>({actor:{ctype:'warrior',level:80,mp:4000,max_mp:4000,slots:{}},skills:{cleave:{class:['warrior'],type:'skill',mp:720}},item:()=>undefined,context:{leader:'Hero',allies:[],monsters:[],mode:'grouped'}})});
    try{w.turns.pass('event');assert.deepEqual(w.sent,[['skill','cleave']],'use_skill("cleave") with no target');}finally{w.restore();}
  });
}

// Ranking (skills/ranking.ts; (a), default, unconfirmed), one scenario table on the skill world:
// the targets a cast hits, the MP horizon, Energize lost to a pool cast, a spot whose unengaged
// monster dies for certain, and a spot that would pull one.
{
  const mage=()=>{
    const r=fixture('mage');
    // Game data 18285: Mana Burst and Energize; `energized` gives 80 frequency for 800 ms.
    r.w.skills.burst={name:'burst',class:['mage'],type:'skill',mp:0,ratio:.555,cooldown:6000,target:true,hostile:true,damage_type:'pure',use_range:true};
    r.w.skills.energize={name:'energize',class:['mage'],type:'skill',range:320,cooldown:4000,condition:'energized',target:'player'};
    r.w.condition=id=>id==='energized'?{buff:true,frequency:80,duration:800}:undefined;
    return r;
  };
  const warrior=()=>{
    const r=fixture('warrior');r.actor.slots.mainhand={name:'axe'};r.actor.speed=500;
    r.w.skills.cleave={name:'cleave',class:['warrior'],type:'skill',wtype:['axe','scythe'],range:160,level:52,mp:720,cooldown:1200,hostile:true,pierces_immunity:true,damage_type:'physical'};
    return r;
  };
  const rows=[
    ['one target against five: no Cleave on one, and Cleave names every monster it hits',()=>{
      const r=warrior(),a=r.add('a');
      assert.ok(!rank(r.w,a).casts.some(d=>d.skill==='cleave'),'one monster in range');
      for(const id of ['b','c','d','e'])r.add(id);
      assert.deepEqual(rank(r.w,a).casts.find(d=>d.skill==='cleave').targets.map(t=>t.id),['a','b','c','d','e']);
    }],
    ['the MP horizon: Mana Burst waits until income refills the reserve within its cooldown',()=>{
      const r=mage(),t=r.add('a',{hp:100000});
      // The reserve is 2000 (20% of 10000) and the horizon Mana Burst's 6 s.
      assert.ok(!rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'no income: the pool would leave the reserve empty');
      assert.ok(rank(r.w,t,0,2000/6+1).casts.some(d=>d.skill==='burst'),'income refills the reserve inside 6 s');
      r.w.mpPotion=()=>2000;
      assert.ok(rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),"05's potion refills it");
    }],
    ['Energize lost: a pool cast that silences a strong ally\'s Energize loses',()=>{
      const r=mage(),t=r.add('a',{hp:100000});r.w.mpPotion=()=>2000;
      assert.ok(rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'no ally to energize');
      r.ally('W',{ctype:'warrior',attack:5000,frequency:2,mp:0,max_mp:1000});
      assert.ok(!rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'two Energizes lost outweigh the Burst');
    }],
    ['a certain-kill spot: the walk goes where the unengaged monster dies for certain',()=>{
      const r=warrior(),m1=r.add('m1',{x:300,y:0});r.add('m2',{x:320,y:0,hp:50,authorized:false});
      r.w.pullOnly=t=>t.id==='m2';
      assert.deepEqual(rank(r.w,m1).move,{to:{x:300,y:0},skill:'cleave',target:'m1'});
    }],
    ['a spot past the walk horizon asks targeting nothing and keeps the reachable walk',()=>{
      const r=warrior(),m1=r.add('m1',{x:300,y:0});r.add('m2',{x:320,y:0,hp:50,authorized:false});r.add('far',{x:100000,y:0});
      r.w.pullOnly=t=>t.id==='m2';
      const asked=[],allowed=r.w.allowed;r.w.allowed=(t,id)=>{asked.push(t.id+'|'+id);return allowed(t,id);};
      assert.deepEqual(rank(r.w,m1).move,{to:{x:300,y:0},skill:'cleave',target:'m1'});
      assert.ok(!asked.some(a=>a.startsWith('far|')),'the far monster is no candidate spot');
    }],
    ['a refused spot: no walk where the cast would pull a monster it may not kill',()=>{
      const r=warrior(),m1=r.add('m1',{x:300,y:0});r.add('m2',{x:320,y:0,hp:10000,authorized:false});
      r.w.pullOnly=t=>t.id==='m2';
      assert.equal(rank(r.w,m1).move,null);
    }],
    // Outside Scatter the ranking offers a caster-centred cast as damageChoices does.
    ['outside Scatter: Cleave and its walk go only while two monsters attack the party',()=>{
      const r=warrior(),a=r.add('a');r.add('b');r.add('m',{x:300,y:0});r.add('n',{x:310,y:0});
      r.w.context.mode='grouped';r.w.attacking=t=>t.target==='Hero';
      assert.ok(!rank(r.w,a).casts.some(d=>d.skill==='cleave'),'two idle monsters beside the target');
      assert.equal(rank(r.w,a).move,null,'no walk to cleave idle monsters');
      for(const m of r.w.context.monsters)m.target='Hero';
      assert.ok(rank(r.w,a).casts.some(d=>d.skill==='cleave'),'all four attack a member');
    }],
    // To (2026-11-12, part 2).
    ["a coming Energize: the ally's report of an Energize set on the character lets Mana Burst go",()=>{
      const r=mage(),t=r.add('a',{hp:100000});
      const report=(target,x)=>{r.w.context.allies=[r.actor];r.ally('M2',{x,y:0});
        r.w.reports=()=>[{name:'M2',turns:{damagePerMp:0,support:{energize:{readyAt:r.w.now+1000,target,mp:2000}}}}];};
      assert.ok(!rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'no income, no potion and no Energize coming');
      report('Hero',100);
      assert.ok(rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'the Energize lands in 1 s and refills the reserve');
      report('Other',100);
      assert.ok(!rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'an Energize set on another member is promised there');
      report('Hero',400);
      assert.ok(!rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'an ally beyond Energize\'s 320 cannot reach the character');
    }],
    ["the ally's damage per MP: the Energize a pool cast silences counts its MP at the ally's report",()=>{
      const r=mage(),t=r.add('a',{hp:100000});r.w.mpPotion=()=>2000;
      r.ally('W',{ctype:'warrior',attack:10,frequency:1,mp:0,max_mp:1000});
      r.w.support=()=>({energize:{target:'W',mp:200}});
      r.w.reports=()=>[{name:'W',turns:{damagePerMp:0,support:{}}}];
      assert.ok(rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'the MP is worth nothing to an ally with MP to spare');
      r.w.reports=()=>[{name:'W',turns:{damagePerMp:1000,support:{}}}];
      assert.ok(!rank(r.w,t,0,0).casts.some(d=>d.skill==='burst'),'two Energizes of 200 MP at 1000 damage per MP outweigh the Burst');
    }],
    ['the damage per MP: an option the MP leaves short sets it, MP to spare sets 0',()=>{
      const p=fixture('paladin'),t=p.add('a',{hp:1e9});
      assert.ok(rank(p.w,t,0,0).perMp>0,"Shield Slam's casts over Purify's 24 s horizon outrun the MP");
      assert.equal(rank(p.w,t,0,1e7).perMp,0);
    }],
    ['Controlled Mana Burst: each pair carries the MP its lowest roll needs for the remaining HP',()=>{
      const r=fixture('mage');
      // Game data 18285 `cburst`: 80 MP, `ratio` 0.5, 240 ms, magical.
      r.w.skills.cburst={name:'cburst',class:['mage'],type:'skill',level:75,mp:80,ratio:.5,cooldown:240,list:true,hostile:true,damage_type:'magical',use_range:true};
      const a=r.add('a',{hp:900});r.add('b',{hp:450});
      const d=rank(r.w,a).casts.find(c=>c.skill==='cburst');
      // 0.5 damage per MP at 0 resistance, 0.9 of it at the lowest roll: 900 / 0.45 and 450 / 0.45.
      assert.deepEqual(d.targets.map(t=>t.id),['a','b']);
      assert.deepEqual(d.argument,[2000,1000]);
    }],
    ['splash: a procs hit counts its splash and is refused when the splash reaches a refused monster',()=>{
      const r=fixture(),a=r.add('a'),b=r.add('b',{x:15});
      // `explosion` 36 splashes within 36 / 3.6 = 10 of the target (server.js:3984).
      r.actor.explosion=36;
      assert.ok(rank(r.w,a).casts.some(d=>d.skill==='supershot'),'the splash lands on an allowed monster');
      b.authorized=false;
      assert.ok(!rank(r.w,a).casts.some(d=>d.skill==='supershot'),'the splash would reach a refused monster');
      r.actor.explosion=0;
      assert.ok(rank(r.w,a).casts.some(d=>d.skill==='supershot'),'no explosion, no splash');
    }],
    ['a monster that respawns as another: the one-shot exception refuses it',()=>{
      const r=warrior(),m1=r.add('m1',{x:300,y:0});r.add('m2',{x:320,y:0,hp:50,authorized:false,respawn_as:'xmagen'});
      r.w.pullOnly=t=>t.id==='m2';
      assert.equal(rank(r.w,m1).move,null);
    }],
    // Stomp deals no damage, and its stun is worth the HP it keeps the monsters from dealing, priced
    // by the healer's report, or with no healer by the MP potions the attacked member's HP potions
    // not drunk leave room for.
    ['stomp: the stun counts the HP it saves at the healer price, or at the potion trade with no healer',()=>{
      const r=fixture('warrior');r.actor.slots.mainhand={name:'basher'};
      r.w.skills.stomp={name:'stomp',class:['warrior'],type:'skill',wtype:'basher',range:400,mp:120,duration:3200,condition:'stunned',hostile:true,damage_type:'physical'};
      const base=r.w.condition;r.w.condition=id=>id==='stunned'?{...base(id),blocked:true,duration:3200}:base(id);
      const a=r.add('a',{target:'Hero',attack:2000,frequency:1});r.add('b',{target:'Hero',attack:2000,frequency:1});
      assert.ok(!rank(r.w,a).casts.some(d=>d.skill==='stomp'),'no report prices the saved HP');
      r.w.reports=()=>[{name:'Hero',turns:{damagePerMp:0,potionMpPerHp:.5,support:{}}}];
      assert.ok(!rank(r.w,a).casts.some(d=>d.skill==='stomp'),'a member with MP to spare gains nothing from a freed potion');
      r.w.reports=()=>[{name:'Hero',turns:{damagePerMp:5,potionMpPerHp:.5,support:{}}}];
      assert.ok(rank(r.w,a).casts.some(d=>d.skill==='stomp'),'with no healer, the HP potions not drunk leave room for MP potions');
      r.w.reports=()=>[{name:'Priest',turns:{damagePerMp:5,healPerMp:2,support:{}}}];
      assert.ok(rank(r.w,a).casts.some(d=>d.skill==='stomp'),'the stun on two attackers is worth its MP');
      a.s.stunned={};
      const b=r.w.context.monsters.find(m=>m.id==='b');b.s.stunned={};
      assert.ok(!rank(r.w,a).casts.some(d=>d.skill==='stomp'),'monsters already stunned save nothing more');
    }],
    ["targeting's area read: Cleave and Shadow Strike land damage around the caster, Stomp and Agitate deal none",()=>{
      assert.deepEqual(['cleave','shadowstrike','stomp','agitate','3shot','burst'].map(hitsAroundCaster),[true,true,false,false,false,false]);
    }],
  ];
  for(const [name,run] of rows)test(`TRN-Q-DPS ranking: ${name}`,run);
}