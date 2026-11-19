// Actual connected components with visual leaf controls stubbed: measures data
// subscriptions/render boundaries, not layout, painting, or total browser CPU.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {execFileSync}=require('node:child_process');
const {build}=require('esbuild'),ts=require('typescript');
const React=require('../../../dashboard/node_modules/react');
const {create,act}=require('../../../dashboard/node_modules/react-test-renderer');
const leaves=['character-session-controls','event-selection-control','monster-details-dialog','farming-mode-control',
 'gold-target-control','merchant-card-controls','meter','monster-focus-picker','restock-controls','character-stats-trigger',
 'xp-meter','monster-route-button','connected-combat-log','upgrade-offering-controls','shared-rule-conflicts',
 'inventory-panel','lucky-slot-tracker','deconstruction-confirmation','map-canvas','sprite-crop'];
// The counted components by file: the export the replay wraps and the count it adds to.
// active-statuses.tsx holds the status row at older refs, which the benchmark compares against.
const COUNTED={'connected-character-card.tsx':['ConnectedCharacterCard','card'],'connected-inventory.tsx':['ConnectedInventory','inventory'],
 'character-map-section.tsx':['CharacterMapSection','map'],'active-statuses.tsx':['ActiveStatuses','status'],'status-icon-row.tsx':['StatusIconRow','status']};
const MEMO=Symbol.for('react.memo');
// The suffixes esbuild tries on a bare relative import, in its order.
const REF_EXTENSIONS=['','.tsx','.ts','.jsx','.js','.cjs','.mjs','/index.tsx','/index.ts','/index.js'];
const MODEL_FILE='dashboard/features/party/use-party-console.tsx';
// One no-op for every unsupplied field, so each model the replay builds hands the cards the same
// identities and a memo sees no change.
const noop=()=>{};
const show=(ref,file)=>execFileSync('git',['show',ref+':'+file],{encoding:'utf8',windowsHide:true});

// modelShape names PartyConsoleModel's fields: the keys of usePartyConsole's returned object, at the
// ref or in the working tree (PartyConsoleModel is `ReturnType<typeof usePartyConsole>`).
function modelShape(ref){
 const source=ts.createSourceFile(MODEL_FILE,ref?show(ref,MODEL_FILE):fs.readFileSync(MODEL_FILE,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const hook=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='usePartyConsole');
 const returned=hook?.body?.statements.find(node=>ts.isReturnStatement(node)&&node.expression&&ts.isObjectLiteralExpression(node.expression));
 if(!returned)throw Error(`replay: ${MODEL_FILE} returns no object literal from usePartyConsole`);
 return new Set(returned.expression.properties.map(property=>{
  if(!property.name)throw Error(`replay: usePartyConsole's return spreads ${property.getText(source)}, so its fields are unnamed`);
  return property.name.getText(source);
 }));
}

// cardModel is the one replay model: `fields` hold the values the replay drives, every other
// PartyConsoleModel field is a no-op action, and a field outside the shape throws, at build or on read.
function cardModel(shape,fields){
 for(const key of Object.keys(fields))if(!shape.has(key))throw Error(`replay: PartyConsoleModel has no field ${key}`);
 const model=Object.fromEntries([...shape].map(key=>[key,Object.hasOwn(fields,key)?fields[key]:noop]));
 return new Proxy(model,{get(target,key){
  // React's element check reads $$typeof on every prop value.
  if(typeof key==='symbol'||key==='$$typeof'||Object.hasOwn(target,key))return target[key];
  throw Error(`replay: a card read ${key}, which PartyConsoleModel lacks`);
 }});
}

// counter wraps one counted component so each call of its function adds to its count. A memo keeps
// its own compare, so the wrapper renders exactly when the component would.
function counter(counts,wrapped){
 return (key,component,file,name)=>{
  const inner=component?.$$typeof===MEMO?component.type:component;
  if(typeof inner!=='function')throw Error(`replay: ${file} exports no ${name} component`);
  wrapped.add(key);
  const count=props=>{counts[key]++;return inner(props);};
  return component.$$typeof===MEMO?React.memo(count,component.compare):count;
 };
}

async function replay({ref,steps=20}={}){
 const root=path.resolve('dashboard/features/party'),filename=path.join(root,'replay.cjs');
 const counts={card:0,inventory:0,map:0,status:0},wrapped=new Set(),props={},sources=new Map(),shape=modelShape(ref);
 const refFiles=ref&&new Set(execFileSync('git',['ls-tree','-r','--name-only',ref],{encoding:'utf8',windowsHide:true,maxBuffer:1<<26}).split('\n'));
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
  external:['@/components/ui/*','replay:count',...leaves.map(n=>'./'+n)],plugins:[{name:'replay-source',setup(b){
   // At a ref every import inside the repo resolves among the ref's files, so the baseline is the
   // ref's code whole, files that are gone today included. The ui kit and the leaves stay stubs.
   const located=async args=>{
    if(!ref)return (await b.resolve(args.path,{resolveDir:args.resolveDir,kind:args.kind,importer:args.importer,pluginData:{real:true}})).path;
    if(args.path.startsWith('@/components/ui/')||leaves.some(n=>args.path==='./'+n))return null;
    const base=args.path.startsWith('@/')?'dashboard/'+args.path.slice(2)
     :path.posix.join(path.relative(process.cwd(),args.resolveDir).replaceAll('\\','/'),args.path);
    const hit=REF_EXTENSIONS.map(extension=>base+extension).find(file=>refFiles.has(file));
    if(!hit)throw Error(`replay: ${args.path} from ${args.importer} names no file at ${ref}`);
    return path.resolve(hit);
   };
   // An import of a counted file resolves to a module that re-exports the file with its component
   // wrapped; that module names the file as `replay-real:<path>`.
   b.onResolve({filter:/^(\.\.?\/|@\/)/},async args=>{
    if(args.pluginData?.real)return;
    const file=await located(args);
    if(!file)return ref?{path:args.path,external:true}:undefined;
    if(COUNTED[path.basename(file)])return {path:file,namespace:'replay-count'};
    return ref?{path:file}:undefined;
   });
   b.onResolve({filter:/^replay-real:/},args=>({path:args.path.slice('replay-real:'.length)}));
   b.onLoad({filter:/.*/,namespace:'replay-count'},args=>{
    const file=path.basename(args.path),[name,key]=COUNTED[file],real=JSON.stringify('replay-real:'+args.path);
    return {contents:`import * as real from ${real};import {counted} from 'replay:count';export * from ${real};`+
     `export const ${name}=counted(${JSON.stringify(key)},real.${name},${JSON.stringify(file)},${JSON.stringify(name)});`,resolveDir:root,loader:'js'};
   });
   b.onLoad({filter:/\.[cm]?[jt]sx?$/},args=>{
    if(!ref)return;
    const relative=path.relative(process.cwd(),args.path).replaceAll('\\','/');
    if(!sources.has(relative))sources.set(relative,show(ref,relative));
    return {contents:sources.get(relative),loader:/\.[jt]sx$/.test(args.path)?'tsx':/\.[cm]?js$/.test(args.path)?'js':'ts'};
   });}}]});
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(root);
 m.require=function(id){
  if(id==='replay:count')return {counted:counter(counts,wrapped)};
  if(id.startsWith('@/components/ui/')||leaves.some(n=>id==='./'+n))return new Proxy({},{get:(_,name)=>{
   if(name==='__esModule')return true;
   return p=>{props[String(name)]=p;return React.createElement('div',null,p.children);};
  }});
  return Module.prototype.require.call(this,id);
 };
 m._compile(result.outputFiles[0].text,filename);
 const unwrapped=Object.keys(counts).filter(key=>!wrapped.has(key));
 if(unwrapped.length)throw Error(`replay: no loaded file holds the ${unwrapped.join(', ')} component, so its renders would read 0`);
 const {Cards,createDashboardClient,characterKey,writeVitals}=m.exports;
 const {QueryClientProvider}=m.require('@tanstack/react-query');
 const client=createDashboardClient();
 // The cards' stored preferences (dashboard/hooks/use-stored-boolean.ts) listen on window.
 const oldDocument=global.document,oldWindow=global.window,listeners={addEventListener(){},removeEventListener(){}};
 global.document={hidden:false,...listeners};global.window={...listeners,dispatchEvent(){}};
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const characters={A:{name:'A',ctype:'warrior',level:1,gold:1,hp:100,max_hp:100,mp:100,max_mp:100,map:'main',x:0,y:0},M:{name:'M',ctype:'merchant',level:1,gold:1,hp:100,max_hp:100,mp:100,max_mp:100,map:'main',x:0,y:0}};
 const state={characters,marked:{},merchantCharacter:'M',activeSlots:[],monsterFocus:['goo']};
 let actionValue='first',called;
 const fields={state,chars:Object.values(characters),standItem:null,monsters:[],monsterAchievements:{},selectedFocus:state.monsterFocus,
   threshold:'100',itemCollectionThreshold:'2',thresholdError:null,itemCollectionThresholdError:null,save:()=>{called=actionValue;}};
 const model=cardModel(shape,fields);
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
  for(let i=0;i<steps;i++)await act(async()=>{tree.update(render(cardModel(shape,{...fields,donationAmount:String(i),save:()=>{called='unrelated-latest';}})));});
  const unrelated=delta(before);
  props.MerchantCardControls.collectionSettings.onThresholdSave();const unrelatedCalled=called;
  before={...counts};
  const next=cardModel(shape,{...fields,thresholdError:'Invalid threshold',save:()=>{called='latest';}});
  await act(async()=>tree.update(render(next)));
  const errors=delta(before),error=props.MerchantCardControls.collectionSettings.thresholdError;
  props.MerchantCardControls.collectionSettings.onThresholdSave();
  before={...counts};await act(async()=>{updateVitals('A',{...characters.A,x:steps,hp:50,conditions:[]});await flush();});
  const hp=delta(before);
  before={...counts};await act(async()=>{client.setQueryData(characterKey('A','inventory'),{items:[],slots:{},inventorySize:1});await flush();});
  const inventory=delta(before);
  return {cacheMs,movement,unrelated,unrelatedCalled,errors,error,called,hp,inventory};
 }finally{if(tree)await act(async()=>tree.unmount());client.clear();global.document=oldDocument;global.window=oldWindow;}
}
module.exports={replay,modelShape,cardModel};
