// The role loop against today's order
// (b9b5c91e runner.ts `tick`): one pass reads the turn facts once, the occupied rows before
// the A/B mode, and a fired emergency Stomp leaves the class decisions to the same pass.
// Its rows are read the same way by the pass and by
// `skills.allows` (TC41), and on the pass where the Cave revival holds the priest no attack and no
// class decision goes (TC46). Isolated: no live row plants the A/B feed with a hold, or a Stomp in
// the same pass as a class decision.
const assert=require('node:assert/strict');
const test=require('node:test');
const vm=require('node:vm');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const {formationScenario,roleRunnerBundle,survivalHalf,turnsPorts}=require('./fixtures/formation-scenario.cjs');
const { routineModule } = require('./helpers/targeting-module.cjs');

const { movementTick } = require('./helpers/movement-tick.cjs');
const {plantCallsWhenCreated}=require('./helpers/planted-calls.cjs');
const {hold,refuses}=require('../../runtime/characters/turns/rules.ts');
const {update}=require('./helpers/run-scope.cjs');

// The runner on the warrior; a `report.sent` notice, the loop's backstop event, runs one pass once
// the game's update lands (run.ts, the cadence).
// `log` keeps the order of the reads and casts.
async function run(r,{occupied,mode,stomp,revival}){
  const {c,warrior,monster}=r;
  let now=10000;const timers=[],log=[];
  Object.assign(warrior,{x:0,y:0,frequency:2,slots:{},items:[],damage_type:'physical'});Object.assign(monster,{x:28,hp:100});
  // The Stomp's danger: a basher and two monsters on the warrior.
  if(stomp){Object.assign(c.G,{skills:{...c.G.skills,stomp:{range:400,mp:0,class:['warrior']}},items:{...c.G.items,basher:{wtype:'basher'}}});
    warrior.slots={mainhand:{name:'basher'}};c.parent.entities.B={...monster,id:'B',x:30};}
  c.use_skill=(skill)=>{log.push('use:'+skill);return Promise.resolve();};
  c.is_in_range=()=>true;c.can_attack=()=>true;c.attack=async()=>{log.push('attack');};c.game_log=()=>{};
  c.setTimeout=(fn,ms)=>{const t={fn,at:now+ms};timers.push(t);return t;};c.clearTimeout=t=>{if(t)t.off=true;};
  c.setInterval=()=>({});c.clearInterval=()=>{};
  const ports=function(){const p=turnsPorts.call(this);return {...p,feed:{...p.feed,strategy:()=>{log.push('feed');return null;}},
    escape:()=>{log.push('occupied');return occupied;}};};
  // Turns asks the events owner's facts for the A/B mode (api.ts `eventFacts().abtestingMode`); the facts
  // answer a plain farm otherwise.
  c.__partyEventFacts={...c.__partyEventFacts,abtestingMode:()=>{log.push('mode');return mode;},merchantFightsEvent:()=>false,
    exitRunning:()=>false,eventTravelling:()=>false};
  c.sharedRoutine={isAllowedTarget:()=>true,getFarmingMode:()=>'default',setCombatTarget:()=>{},followLeaderIfFar:()=>{},resetCombatMovement:()=>{},
    formationMove:()=>{},groupedMovement:()=>{},kiteIfNeeded:async()=>false,approachCombatTarget:async()=>{},pollRareHunting:()=>{},
    groupedAttackAllowed:()=>true,noteAttack:()=>{},smartLoot:async()=>{},getAbtestingMode:()=>mode,isLeader:()=>false,
    survival:survivalHalf({cave:{reserved:()=>!!revival,tick:async()=>{log.push('revival');return !!revival;}}}),
    isAttackingPartyMember:()=>false,getNearestPartyAttacker:()=>null,classTarget:()=>monster};
  // The warrior farms alone, so its class role supplies the target.
  c.sharedRoutine.targeting=routineModule(c,c.sharedRoutine,{hunting:{farm:{grouped:()=>false}}});
  c.partyTurns={facts:()=>ports.call(c.sharedRoutine)};
  // The Cave revival answers through the character half the module publishes on the realm.
  c.__partySurvivalCharacter=c.sharedRoutine.survival;
  c.partyMovement={startMovementTick:movementTick(c),resetCombatMovement:()=>c.sharedRoutine.resetCombatMovement()};
  plantCallsWhenCreated(c);
  vm.runInContext(roleRunnerBundle(),c);
  // The targeting owner's published reads the Stomp's hold asks (survival/needs.ts `stompHeld`), which
  // shared.js publishes at load, before the runner starts: a plain farm with no Franky fight,
  // graveyard or rare. The runner's start then publishes core:targeting's live answers over them.
  c.partyTargeting.publish({...c.sharedRoutine.targeting.reads(),'targeting.graveyardAreaAllows':()=>true,
    'targeting.rareTarget':()=>null,'targeting.unfinished':()=>false,'targeting.lockAllows':()=>true,'targeting.attacking':()=>false},c.__partyHooks);
  c.RunnerTest.installRoleRunner({combat:true,beforeAttack:async()=>{log.push('class');return false;}});
  c.partyRoleRunner.start();
  try{
    for(let k=0;k<12;k++)await Promise.resolve();
    log.length=0;
    now+=250;r.now(now);
    c.__partyHooks.notify('report.sent',{character:warrior.name,by:'core:lifecycle'});
    await update();
    for(let k=0;k<12;k++)await Promise.resolve();
    return log.slice();
  }finally{c.partyRoleRunner.stop();}
}

scenarioTable('the role loop keeps today\'s order (TRN-001, 3.2)',formationScenario,[
  ['the hold is read before the A/B mode: an occupied character runs no feed',async r=>{
    const log=await run(r,{occupied:true,mode:'feed',stomp:false});
    assert.ok(!log.includes('feed'),`the feed ran while an occupied row held: ${log}`);
    assert.ok(log.indexOf('occupied')>=0&&(log.indexOf('mode')<0||log.indexOf('occupied')<log.indexOf('mode')),`order: ${log}`);
  }],
  ['the Stomp and the class decisions go in one pass (TRN-Q21 (a))',async r=>{
    const log=(await run(r,{occupied:false,mode:'none',stomp:true})).filter(e=>e==='use:stomp'||e==='class');
    assert.deepEqual(log,['use:stomp','class'],`the pass sends the Stomp, then the class decisions run: ${log}`);
  }],
  ['TC46: on the pass where the Cave revival holds the priest no attack and no class decision goes',async r=>{
    r.c.character.cave={};r.c.character.ctype='priest';
    const log=await run(r,{occupied:false,mode:'none',stomp:false,revival:true});
    assert.ok(log.includes('revival'),`the revival's tick runs after the pass: ${log}`);
    assert.ok(!log.includes('attack')&&!log.includes('class'),`nothing of the attack or the class decisions: ${log}`);
  }],
]);

// TC41: a hold reads the same answer in the pass as in `skills.allows` for the same moment,
// one row per fact row, read both ways.
const facts=over=>({active:true,rip:false,held:false,hand:null,abtesting:()=>'none',revive:false,roleCombat:true,merchant:false,
  merchantEventFight:false,dungeonOwned:false,occupied:[],...over});
const occupiedRow=(row,read)=>[{row,source:'test',read}];
const rows=[
  ['H1',{active:false},{asks:false,attack:false,passing:false}],
  ['H2',{rip:true},{asks:false,attack:false,passing:false}],
  ['H4',{hand:{combat:false}},{asks:true,attack:false,passing:false,combat:false}],
  ['H5',{hand:{usePotions:false}},{asks:true,attack:true,passing:true,potions:false}],
  ['H6',{abtesting:()=>'pending'},{asks:false,pulse:true,attack:false,passing:false}],
  ['H7',{abtesting:()=>'feed'},{asks:false,attack:false,passing:false,feed:true}],
  ['H8',{revive:true},{asks:true,attack:true,classes:false,revive:true}],
  ['H9',{roleCombat:false},{asks:true,attack:false,passing:false}],
  ['H10',{merchant:true},{asks:true,attack:false,passing:false}],
  ['H11',{dungeonOwned:true},{asks:true,attack:true,passing:false}],
  ['O11 holds',{occupied:occupiedRow('O11',()=>true)},{asks:true,roleLoop:false,attack:false,passing:true}],
  ['O1 clears the rows after it',{occupied:[...occupiedRow('O1',()=>false),...occupiedRow('O2',()=>true)]},{asks:true,roleLoop:true,attack:true}],
  ['an occupied row before the A/B feed',{abtesting:()=>'feed',occupied:occupiedRow('O4',()=>true)},{asks:true,roleLoop:false,feed:false,passing:false}],
];
scenarioTable('TC41: each T1 row reads the same in the pass and in skills.allows',()=>undefined,rows.map(([name,over,want])=>
 [`TC41: T1 ${name} reads the same in the pass and in skills.allows`,()=>{
  const h=hold(facts(over));
  for(const [key,value] of Object.entries(want))assert.equal(h[key],value,`${name} ${key}`);
  assert.equal(!refuses(h,{rank:'damage'}),h.attack,`${name}: skills.allows for damage`);
  assert.equal(!refuses(h,{rank:'damage',passing:true}),h.passing,`${name}: skills.allows for a passing attack`);
  assert.equal(!!refuses(h,{rank:'damage',occupied:true}),/^O/.test(h.stop?.row??''),`${name}: the occupied read`);
 }]));

// C-4: shared.js's routine publishes the generation's start
// and stop, canReload, the survival owner's survival half and the targeting owner's targeting module; every other read sits on its
// owner's door (partyTasks, partyTurns, partyStatus.character, partyLifecycle.drain, partyHunting,
// partyMovement). A key outside the five in the routine, or a read of one in runtime/, e2e/ or
// shared.js, fails. Test plants under scripts/tests stay the tests' own.
test('C-4: the shared routine holds only start, stop, canReload, survival and targeting', () => {
  const fs=require('node:fs'),path=require('node:path'),repo=path.join(__dirname,'..','..');
  const five=['canReload','start','stop','survival','targeting'];
  const shared=fs.readFileSync(path.join(repo,'characters','shared.js'),'utf8');
  const literal=shared.match(/root\.sharedRoutine = \{([\s\S]*?)\n  \};/);
  assert.ok(literal,'shared.js builds root.sharedRoutine as one object literal');
  assert.deepEqual([...literal[1].matchAll(/^ {4}(\w+):/gm)].map(m=>m[1]).sort(),five);
  const reads=[];
  const scan=(file,text)=>{for(const m of text.matchAll(/\bsharedRoutine\??\.(\w+)/g))if(!five.includes(m[1]))reads.push(`${path.relative(repo,file).split(path.sep).join("/")}: ${m[1]}`);};
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules')walk(file);}else if(/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name))scan(file,fs.readFileSync(file,'utf8'));}};
  walk(path.join(repo,'runtime'));walk(path.join(repo,'e2e'));scan(path.join(repo,'characters','shared.js'),shared);
  assert.deepEqual(reads,[]);
});
