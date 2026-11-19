// The turns executor's pass on the real clock: ChronAL's performance.now does not advance inside a synchronous turn, so the live meter
// reads 0. This runs the pass over the engine's unit world sized like a steps window, the priest's
// core sources (Absorb, support, offense, the attack) and a heal ask, with the combat context
// copied once per pass as shared.js `combatContext` copies every visible monster.
// Usage: node scripts/bench/turns-pass.cjs [monsters=30] [passes=5000]
const {fixture}=require('../tests/helpers/skill-world.cjs');
const {turnsWorld}=require('../tests/fixtures/turns-world.cjs');
const {createSkillEngine}=require('../../runtime/characters/turns/skills/engine.ts');
const {createCoreSources}=require('../../runtime/characters/turns/sources.ts');
const monsters=Number(process.argv[2]||30),passes=Number(process.argv[3]||5000);
for(const ctype of ['priest','warrior']){
  const r=fixture(ctype);for(let i=0;i<monsters;i++)r.add('m'+i,{x:20+i,target:i%3?null:'Hero'});
  const ally=r.ally('W',{hp:9000});
  const base=r.w.context;
  // Each pass's world is fresh, its context built on first read from a copy of every monster.
  const world=()=>{let context;return {...r.w,get context(){return context??={...base,monsters:base.monsters.map(m=>({...m})),allies:base.allies.map(a=>({...a}))};}};};
  const engine=createSkillEngine({...r.ports,world,ledger:{mp:()=>0,flying:()=>false}});
  const target=base.monsters[0];
  const sources=createCoreSources(engine,{request:()=>({skill:'attack',targets:[target],rank:'damage',category:'damage',reason:'basic attack'})});
  const view=w=>({kind:'tick',now:Date.now(),character:r.actor,role:{},roleLoop:true,pulse:false,attack:true,combat:true,potions:true,
    target:{target,passing:false,support:true},healFirstBelow:80,world:()=>w,inFlightMp:0,flying:()=>false});
  const asks=()=>{const w=world(),v=view(w),out=[];
    for(const s of ['absorb','support','attack','offense']){const a=sources[s](v);if(a)out.push(...(Array.isArray(a)?a:[a]));}
    out.push({skill:'heal',targets:[ally],rank:'maintenance',category:'survival',reason:'top-off'});return out;};
  const t=turnsWorld({actor:r.actor,skills:r.w.skills,asks,selected:()=>target.id,world});
  // Every family stays on cooldown, so each pass ranks and refuses as at most edges, and sends nothing.
  t.turns.pass('tick');global.parent.next_skill={attack:Date.now()+1e9};for(const k of Object.keys(r.w.skills))global.parent.next_skill[k]=Date.now()+1e9;
  for(let i=0;i<200;i++)t.turns.pass('tick');
  const from=performance.now();for(let i=0;i<passes;i++)t.turns.pass('tick');const ms=(performance.now()-from)/passes;
  // An edge pass: the families ready and nothing in flight, so the pass sends.
  global.parent.next_skill={};const sendFrom=performance.now();
  for(let i=0;i<passes;i++){t.turns.reset();t.turns.pass('edge');t.replies.length=0;t.sent.length=0;}
  const send=(performance.now()-sendFrom)/passes;
  t.restore();
  console.log(JSON.stringify({ctype,monsters,passes,msPerPass:Math.round(ms*1000)/1000,msPerSendingPass:Math.round(send*1000)/1000,
    msPerMinuteAt9PerSecond:Math.round(ms*9*60*10)/10,msPerMinuteAllSending:Math.round(send*9*60*10)/10}));
}
