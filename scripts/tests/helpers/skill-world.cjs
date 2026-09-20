const {mitigation}=require('../../../runtime/characters/skills/runtime.ts');
function fixture(ctype='ranger') {
 const actor={id:'Hero',name:'Hero',ctype,type:'character',level:80,hp:10000,max_hp:10000,mp:10000,max_mp:10000,
  attack:1000,armor:100,resistance:0,frequency:2,range:200,mp_cost:10,mp_reduction:0,crit:0,critdamage:0,int:100,
  x:0,y:0,map:'main',in:'main',s:{},slots:{mainhand:{name:ctype==='ranger'?'bow':ctype==='rogue'?'dagger':'mace'},offhand:{name:'shield'},belt:{name:'knifebelt'}}};
 const skill=(klass,extra)=>({name:'fixture',class:[klass],type:'skill',mp:0,...extra});
 const attackSkill=(klass,extra)=>skill(klass,{target:true,hostile:true,use_range:true,damage_type:'physical',procs:true,...extra});
 const skills={
  attack:{name:'attack',type:'skill'},
  '3shot':attackSkill('ranger',{mp:200,level:60,damage_multiplier:.7,multi:true,share:'attack',wtype:['bow','crossbow']}),
  '5shot':attackSkill('ranger',{mp:320,level:75,damage_multiplier:.5,multi:true,share:'attack',wtype:['bow','crossbow']}),
  piercingshot:attackSkill('ranger',{mp:64,level:72,damage_multiplier:.75,apiercing:500,share:'attack',wtype:['bow','crossbow']}),
  supershot:attackSkill('ranger',{mp:400,damage_multiplier:1.5,cooldown:30000}),
  huntersmark:attackSkill('ranger',{mp:240,cooldown:10000}),
  fanofknives:attackSkill('rogue',{mp:180,level:65,damage_multiplier:.85,multi:true,share:'attack',max_targets:5,procs:false,slot:[['belt','knifebelt']]}),
  quickstab:attackSkill('rogue',{mp:320,damage_multiplier:.36,cooldown:250,share:'quickpunch',wtype:'dagger'}),
  quickpunch:attackSkill('rogue',{mp:240,damage_multiplier:.25,cooldown:250,wtype:'fist',procs:false}),
  mentalburst:attackSkill('rogue',{mp:180,damage_multiplier:.6,damage_type:'magical',requirements:{int:64},cooldown:900,procs:false}),
  invis:skill('rogue',{}),rspeed:skill('rogue',{mp:320,level:40,target:'player'}),
  pcoat:skill('rogue',{mp:600,consume:'poison'}),shadowstrike:skill('rogue',{mp:320,level:70,consume:'shadowstone'}),
  selfheal:skill('paladin',{mp:20,output:400,levels:[[0,400],[60,600],[72,720],[80,800]]}),
  mshield:skill('paladin',{}),aether_shield:skill('paladin',{level:60,share:'mshield'}),
  guardians_oath:skill('paladin',{mp:320,level:50,target:'player',no_self:true}),
  cleansing_light:skill('paladin',{mp:320,level:30,target:'player',no_self:true}),
  beacon_of_resolve:skill('paladin',{mp:640,level:70}),paladin_aura:skill('paladin',{level:60}),
  purify:attackSkill('paladin',{mp:360,level:60,damage:2000,damage_type:'pure',cooldown:24000,procs:false}),
  smash:attackSkill('paladin',{mp:380,level:10,damage_multiplier:.36,cooldown:320,wtype:'mace'}),
  shield_slam:attackSkill('paladin',{mp:2000,level:60,damage_multiplier:3,armor_multiplier:12,armor_cap:1000,offhand_type:'shield',cooldown:600,procs:false}),
  absorb:skill('priest',{mp:200,level:55,target:'player'}),heal:skill('priest',{mp:100}),partyheal:skill('priest',{mp:400}),
  taunt:attackSkill('warrior',{mp:40}),stomp:skill('warrior',{mp:120,wtype:'basher'}),
 };
 const cooldowns=new Set(),calls=[],diagnostics=[],evidence=[];
 const w={actor,skills,now:10000,context:{leader:'Hero',allies:[actor],monsters:[],mode:'scatter',event:null,observedAt:10000},
  item:name=>({wtype:name,type:name}),condition:id=>({cleansable:['poisoned','stunned'].includes(id),debuff:['cursed','marked'].includes(id),bad:['cursed','marked'].includes(id)}),
  cooldown:id=>cooldowns.has(id),range:()=>true,allowed:t=>t.authorized!==false,incoming:()=>0,damageMultiplier:mitigation};
 const add=(id,extra={})=>{const m={id,type:'monster',mtype:'goo',hp:10000,max_hp:10000,armor:0,resistance:0,attack:10,frequency:1,s:{},x:10,y:0,...extra};w.context.monsters.push(m);return m;};
 const ally=(name,extra={})=>{const a={...actor,id:name,name,s:{},...extra};w.context.allies.push(a);return a;};
 const ports={world:()=>w,cast:async d=>{calls.push(d);actor.mp-=skills[d.skill].mp||0;cooldowns.add(skills[d.skill].share||d.skill);return {targets:d.targets.map(t=>t.id)};},
  evidence:(t,state,action)=>{const id=action||'action-'+evidence.length;evidence.push({id:t.id,state,action:id});return id;},diagnostic:d=>diagnostics.push(d)};
 return {w,actor,add,ally,cooldowns,calls,diagnostics,evidence,ports};
}
module.exports={fixture};
