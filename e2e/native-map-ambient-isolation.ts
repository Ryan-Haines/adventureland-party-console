import type {LiveGame} from './live-fixtures';

// Reversible declared world-input isolation; all construction remains native.
export async function isolateNativeMapAmbient(live:LiveGame,map:string,types:string[]=[]){
 return live.admin(`output=(()=>{
  if(globalThis.__e2eAmbientIsolation)throw Error('Ambient isolation already owned');
  const state={map:${JSON.stringify(map)},types:${JSON.stringify(types)},original:new_monster,objects:new Map(),created:[],respawns:[]};
  const matches=m=>m?.map===state.map&&(!state.types.length||state.types.includes(m.type));
  const retain=m=>{if(!matches(m))return;state.objects.set(String(m.id),m);remove_monster(m,{method:'disappear',nospawn:true});};
  state.wrapper=function(...args){const m=state.original.apply(this,args);if(!(args[2]?.temp&&args[1]?.__e2eAmbientExempt)&&matches(m)){state.created.push({id:String(m.id),type:m.type,map:m.map,in:m.in});retain(m);}return m;};
  globalThis.__e2eAmbientIsolation=state;new_monster=state.wrapper;
  for(const m of Object.values(instances[state.map].monsters))retain(m);
  for(let i=monster_respawns.length-1;i>=0;i--)if(matches(monster_respawns[i][0]))state.respawns.push(monster_respawns.splice(i,1)[0]);
  return {map:state.map,types:state.types,retained:[...state.objects.values()].map(m=>({id:String(m.id),type:m.type,map:m.map,in:m.in})),queued:state.respawns.length};
 })()`);
}
export async function restoreNativeMapAmbient(live:LiveGame,allowAbsent=false){
 return live.admin(`output=(()=>{
  const s=globalThis.__e2eAmbientIsolation;if(!s){if(${JSON.stringify(allowAbsent)})return {absent:true};throw Error('Missing ambient isolation owner');}
  const identity=new_monster===s.wrapper;new_monster=s.original;
  try{
   if(!identity)throw Error('Native constructor ownership changed during isolation');
   const monsters=[...s.objects.values()],types=[...new Set(monsters.map(m=>m.type))],packs=[...new Set(monsters.map(m=>m.map_def))];
   const before={counts:types.map(type=>[type,monster_c[type]]),live:packs.map(pack=>pack.live)};
   let firstError;const restored=[];for(const m of monsters){try{const r=new_monster(m.oin,m.map_def,{last_state:m});if(!r||String(r.id)!==String(m.id)||r.type!==m.type||(m.map_def.stype==='randomrespawn'?!m.map_def.boundaries.some(b=>b[0]===r.in)||instances[r.in]?.map!==r.map:r.map!==m.map||r.in!==m.in))throw Error('Native ambient reconstruction identity mismatch: '+m.id);restored.push({id:String(r.id),type:r.type,map:r.map,in:r.in,originalMap:m.map,originalInstance:m.in,nativeRandomRespawn:m.map_def.stype==='randomrespawn'});}catch(error){firstError??=error;}}
   const after={counts:types.map(type=>[type,monster_c[type]]),live:packs.map(pack=>pack.live)};
   if(JSON.stringify(before)!==JSON.stringify(after))firstError??=Error('Native ambient reconstruction changed population accounting');
   if(firstError)throw firstError;
   return {map:s.map,created:s.created,restored,before,after,queued:s.respawns.length,constructorRestored:new_monster===s.original};
  }finally{monster_respawns.push(...s.respawns);delete globalThis.__e2eAmbientIsolation;}
 })()`);
}
