// The turns executor over a unit world, in
// the shared harness: each pass asks the planted requests, the call
// budget sends, and each game call the harness makes stays in flight until the test answers it.
// `own` names the game functions the test plants itself, and `band` answers each call budget
// question. The executor settles on the replies the test sends with `reply`, as on the game's
// socket (`socket: false` plants none, as after a disconnect); `epoch` is the target epoch. `facts` plants the facts (rules.ts `hold`), and
// `notices` collects every notice the executor sends.
const {createExecutor}=require('../../../runtime/characters/turns/executor.ts');
// The skill world a test that plants none spends in: the actor and the planted skills, a party of one
// that this character leads, and no monster (skills/types.ts `SkillWorld`).
const plainWorld=(actor,skills)=>({actor:{slots:{},s:{},...actor},skills,now:Date.now(),
 context:{leader:actor.name,allies:[],monsters:[],mode:'grouped',event:null,observedAt:0},
 item:()=>undefined,condition:()=>undefined,cooldown:()=>false,range:()=>true,allowed:()=>true,incoming:()=>0,attacking:()=>false,damageMultiplier:()=>1});
const {hold}=require('../../../runtime/characters/turns/rules.ts');
const {testScope}=require('../helpers/run-scope.cjs');
function turnsWorld({actor,skills={},asks,allows=()=>undefined,band=()=>'send',selected=()=>null,world,own=[],socket=true,epoch=()=>0,facts={},refuses=()=>undefined}){
 const keys=['parent','character','G','attack','heal','use_skill','reduce_cooldown','setTimeout','clearTimeout'];
 const saved=Object.fromEntries(keys.map(k=>[k,global[k]])),sent=[],replies=[],now=Date.now;
 // `advance` moves the executor's clock past a cooldown.
 let offset=0;Date.now=()=>now()+offset;
 const listeners={};
 // The attack family's edge has passed; a test moves it to hold the family.
 global.parent={next_skill:{attack:0},pings:[50],...(socket?{socket:{on:(event,fn)=>{(listeners[event]??=[]).push(fn);},off:()=>{}}}:{})};
 global.character=actor;global.G={skills,items:{}};
 // The executor times on its run scope, whose frame is this process: the stubs are that frame's timers.
 if(!own.includes('setTimeout'))global.setTimeout=()=>0;if(!own.includes('clearTimeout'))global.clearTimeout=()=>{};global.reduce_cooldown=()=>{};
 const call=name=>(...args)=>{sent.push([name,...args]);return new Promise((ok,fail)=>replies.push({ok,fail}));};
 for(const [key,name] of [['attack','attack'],['heal','heal'],['use_skill','skill']])if(!own.includes(key))global[key]=call(name);
 const root={partyCombatState:{}},notices=[];
 // The call budget's margin and window: the largest of the game's pings.
 const {CALL_WINDOW_MS}=require('../../../runtime/characters/call-budget-limits.ts');
 const margin=()=>Math.max(0,...(global.parent.pings||[]));
 const read=()=>hold({active:true,rip:false,hand:null,abtesting:()=>'none',revive:false,roleCombat:true,merchant:false,merchantEventFight:false,dungeonOwned:false,occupied:[],...facts});
 world??=()=>plainWorld(actor,skills);
 const turns=createExecutor(root,{hooks:{
   skillRequests:()=>asks().map(answer=>({registration:'e2e',requester:{name:'planted',rank:'survival'},answer})),
   turns:{target:()=>selected()?{target:{id:selected()},passing:false,support:true}:undefined,allows},skills:{refuses},calls:{band,margin,window:()=>CALL_WINDOW_MS},
   notify:(hook,payload)=>{notices.push({hook,...payload});}},
  // The turns owner's `act` handle on the run scope of this borrowed game window.
  scope:testScope('03','act'),epoch,hold:read,role:()=>({}),world,state:()=>root.partyCombatState,healFirstBelow:()=>undefined});
 turns.start();
 return {turns,sent,replies,notices,state:root.partyCombatState,advance(ms){offset+=ms;},
  reply(data,event='game_response'){for(const fn of listeners[event]??[])fn(data);},
  restore(){turns.stop();Date.now=now;for(const key of keys)if(own.includes(key))continue;else if(saved[key]===undefined)delete global[key];else global[key]=saved[key];}};
}
module.exports={turnsWorld};
