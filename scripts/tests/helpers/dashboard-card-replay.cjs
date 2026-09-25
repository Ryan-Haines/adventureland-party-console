// Actual connected components with visual leaf controls stubbed: measures data
// subscriptions/render boundaries, not layout, painting, or total browser CPU.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {execFileSync}=require('node:child_process');
const {build}=require('esbuild');
const React=require('../../../dashboard/node_modules/react');
const {create,act}=require('../../../dashboard/node_modules/react-test-renderer');
const leaves=['character-session-controls','event-selection-control','monster-details-dialog','farming-mode-control',
 'gold-target-control','merchant-card-controls','meter','monster-focus-picker','restock-controls','character-stats-trigger',
 'xp-meter','monster-route-button','connected-combat-log','upgrade-offering-controls','shared-rule-conflicts',
 'inventory-panel','lucky-slot-tracker','deconstruction-confirmation','map-canvas','sprite-crop'];
async function replay({ref,steps=20}={}){
 const root=path.resolve('dashboard/features/party'),filename=path.join(root,'replay.cjs');
 const counts={card:0,inventory:0,map:0,status:0},props={},sources=new Map();
 const source=ref?`
 import {ConnectedCharacterCard} from './connected-character-card';
 export function Cards({model}) { return <>{model.chars.map(c=><ConnectedCharacterCard key={c.name} name={c.name} model={model}/>)}</>; }
 `:`
 import {ConnectedCharacterCard} from './connected-character-card';
 import {useCharacterCardModels} from './character-card-model';
 export function Cards({model}) {const models=useCharacterCardModels(model);return <>{model.chars.map(c=><ConnectedCharacterCard key={c.name} name={c.name} model={models.card} inventoryModel={models.inventory}/>)}</>;}
 export {writeVitals} from './character-cache';
 `;
 const result=await build({stdin:{contents:source+`export {createDashboardClient} from './query-cache';export {characterKey} from './dashboard-live';`,resolveDir:root,loader:'tsx'},
  bundle:true,packages:'external',platform:'node',format:'cjs',write:false,jsx:'automatic',
  external:['@/components/ui/*',...leaves.map(n=>'./'+n)],plugins:[{name:'replay-source',setup(b){
   b.onLoad({filter:/\.[cm]?[jt]sx?$/},args=>{
    if(!args.path.includes(path.join('dashboard','features','party')))return;
    let code=fs.readFileSync(args.path,'utf8');
    if(ref){const relative=path.relative(process.cwd(),args.path).replaceAll('\\','/');
     if(!sources.has(relative))sources.set(relative,execFileSync('git',['show',ref+':'+relative],{encoding:'utf8',windowsHide:true}));code=sources.get(relative);}
    const base=path.basename(args.path);
    const markers={'connected-character-card.tsx':['  const diagnostics', 'card'],'connected-inventory.tsx':['  const model =','inventory'],
     'character-map-section.tsx':['  const [open,','map'],'active-statuses.tsx':['  const [open,','status']};
    if(markers[base]){const [marker,key]=markers[base];code=code.replace(marker,`  globalThis.__dashboardReplayCounts.${key}++;\n`+marker);}
    return {contents:code,loader:base.endsWith('tsx')?'tsx':'ts'};
   });}}]});
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);
 m.require=function(id){if(id.startsWith('@/components/ui/')||leaves.some(n=>id==='./'+n))return new Proxy({},{get:(_,name)=>{
  if(name==='__esModule')return true;
  return p=>{props[String(name)]=p;return React.createElement('div',null,p.children);};
 }});return Module.prototype.require.call(this,id);};
 m._compile(result.outputFiles[0].text,filename);
 const {Cards,createDashboardClient,characterKey,writeVitals}=m.exports;
 const {QueryClientProvider}=m.require('@tanstack/react-query');
 const client=createDashboardClient();
 const oldDocument=global.document,oldCounts=global.__dashboardReplayCounts;
 global.document={hidden:false,addEventListener(){},removeEventListener(){}};
 global.__dashboardReplayCounts=counts;global.IS_REACT_ACT_ENVIRONMENT=true;
 const characters={A:{name:'A',ctype:'warrior',level:1,gold:1,hp:100,max_hp:100,mp:100,max_mp:100,map:'main',x:0,y:0},M:{name:'M',ctype:'merchant',level:1,gold:1,hp:100,max_hp:100,mp:100,max_mp:100,map:'main',x:0,y:0}};
 const state={characters,marked:{},merchantCharacter:'M',activeSlots:[],monsterFocus:['goo']};
 let actionValue='first',called;const noop=()=>{};
 const model=new Proxy({state,chars:Object.values(characters),standItem:null,monsters:[],monsterAchievements:{},selectedFocus:state.monsterFocus,
   threshold:'100',itemCollectionThreshold:'2',thresholdError:null,itemCollectionThresholdError:null,detailMeta:noop,
   save:()=>{called=actionValue;}},{get:(obj,key)=>key in obj?obj[key]:noop});
 const updateVitals=(name,value)=>writeVitals?writeVitals(client,name,value):client.setQueryData(characterKey(name,'vitals'),value);
 const cacheMs=[];
 for(let round=0;round<6;round++){
  const condition={id:'buff',remainingMs:10000,definition:{duration:20000}};
  const start=performance.now();
  for(let i=0;i<2000;i++)updateVitals('A',{...characters.A,x:i,conditions:[condition]});
  if(round)cacheMs.push(performance.now()-start);
 }
 for(const [name,char] of Object.entries(characters)){
  updateVitals(name,{...char,conditions:[]});client.setQueryData(characterKey(name,'diagnostics'),{});
  client.setQueryData(characterKey(name,'presence'),{seenAt:1});client.setQueryData(characterKey(name,'inventory'),{items:[],slots:{}});
 }
 let tree;const render=model=>React.createElement(QueryClientProvider,{client},React.createElement(Cards,{model}));
 const flush=()=>new Promise(resolve=>setTimeout(resolve,2));
 const delta=before=>Object.fromEntries(Object.keys(counts).map(k=>[k,counts[k]-before[k]]));
 try{
  await act(async()=>{tree=create(render(model));await flush();});
  await act(async()=>{await flush();});
  let before={...counts};const start=performance.now();
  for(let i=1;i<=steps;i++)await act(async()=>{updateVitals('A',{...characters.A,x:i,conditions:[]});await flush();});
  const movement={renders:delta(before),elapsedMs:performance.now()-start};
  before={...counts};
  for(let i=0;i<steps;i++)await act(async()=>{tree.update(render(new Proxy({...model,donationAmount:String(i),save:()=>{called='unrelated-latest';}},{get:(o,k)=>k in o?o[k]:noop})));});
  const unrelated=delta(before);
  props.MerchantCardControls.collectionSettings.onThresholdSave();const unrelatedCalled=called;
  before={...counts};
  const next=new Proxy({...model,thresholdError:'Invalid threshold',save:()=>{called='latest';}},{get:(o,k)=>k in o?o[k]:noop});
  await act(async()=>tree.update(render(next)));
  const errors=delta(before),error=props.MerchantCardControls.collectionSettings.thresholdError;
  props.MerchantCardControls.collectionSettings.onThresholdSave();
  before={...counts};await act(async()=>{updateVitals('A',{...characters.A,x:steps,hp:50,conditions:[]});await flush();});
  const hp=delta(before);
  before={...counts};await act(async()=>{client.setQueryData(characterKey('A','inventory'),{items:[],slots:{},inventorySize:1});await flush();});
  const inventory=delta(before);
  return {cacheMs,movement,unrelated,unrelatedCalled,errors,error,called,hp,inventory};
 }finally{if(tree)await act(async()=>tree.unmount());client.clear();global.document=oldDocument;global.__dashboardReplayCounts=oldCounts;}
}
module.exports={replay};
