// The member's formation recovery client (runtime/movement/character/formation.ts
// createFormationRecoveryClient) for the formation recovery tests. The module keeps the factory
// private, so the loader transpiles the file once and adds one export; the runtime file stays as it is.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
const {identity}=require('./formation-recovery-scenario.cjs');
let factory;
function createClientFactory(){
 if(factory)return factory;
 const file=path.join(__dirname,'../../../runtime/movement/character/formation.ts');
 const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const loaded=new Module(file,module);loaded.filename=file;loaded.paths=Module._nodeModulePaths(path.dirname(file));
 loaded._compile(source+'\nexports.createFormationRecoveryClient=createFormationRecoveryClient;\n',file);
 return factory=loaded.exports.createFormationRecoveryClient;
}
// The detour journey carries its own gate: `journey.driver` is the driver the client passed with its
// request, and it goes when the journey ends, by arrival or by the client's own stop. The follower
// defaults mirror the real ports with no priest in the party: terminals ring the leader point inside
// forty pixels, nearest to the follower first.
function recoveryClient(extra={}){
 let now=10000,allowed=true,covered=false,starts=0,stops=0,resolve,driver=null;
 const self={name:'P',map:'arena',x:0,y:0,moving:false};
 const smart={plot:[],found:false},journey={get driver(){return driver;}};
 const logs=[];let safe=()=>true;
 const ring=goal=>[39,20].flatMap(r=>Array.from({length:16},(_,i)=>({x:goal.x+Math.cos(i*Math.PI/8)*r,y:goal.y+Math.sin(i*Math.PI/8)*r})))
  .concat([{x:self.x,y:self.y}]).sort((a,b)=>Math.hypot(a.x-self.x,a.y-self.y)-Math.hypot(b.x-self.x,b.y-self.y));
 const api=createClientFactory()({now:()=>now,self:()=>self,context:()=>({allowed,key:'key',target:identity,covered}),smart:()=>smart,
  advance(){const next=smart.plot.shift();if(next){self.x=next.x;self.y=next.y;}else resolve();},
  safe:p=>safe(p),endpointSafe:()=>true,segmentClear:()=>true,coveredStep:()=>true,approachReady:()=>false,goals:()=>[],follow(){},
  followGoals:ring,followTerminalValid:(point,goal)=>Math.hypot(point.x-goal.x,point.y-goal.y)<=40,
  start(goal,d){starts++;driver=d;smart.found=false;return new Promise(r=>resolve=()=>{driver=null;r();});},
  stop(){stops++;driver=null;},hold(){},release(){},log:(...v)=>logs.push(v),position(){},debug:()=>false,draw:()=>[],...extra});
 const control={id:'r',key:'key',target:identity,mover:'P',goals:[{x:240,y:0}],phase:'routing',attempt:1,startedAt:now,phaseAt:now};
 return {api,self,smart,journey,control,logs,get starts(){return starts;},get stops(){return stops;},unsafe(){safe=()=>false;},cancel(){allowed=false;},advance(ms){now+=ms;}};
}
module.exports={recoveryClient};
