const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {createRequire}=require('node:module');
const assert=require('node:assert/strict');
const {after}=require('node:test');
const {inspect}=require('node:util');
const os=require('node:os');
const esbuild=require('esbuild');
const root=path.resolve(__dirname,'../../..');
const installed=require('./installed-game.cjs');
const resolve=createRequire(path.resolve('.caracal/standalones/CharacterCoordinator.js'));
// caracAL runs the coordinator from its install folder, so the start's relative paths
// (./game_files/<version>/data.js, runtime/movement/coordinator/runtime.ts) read from there.
const caracal=path.join(root,'.caracal');
const installFs=Object.assign(Object.create(fs),{readFileSync:(file,...rest)=>fs.readFileSync(typeof file==='string'?path.resolve(caracal,file):file,...rest)});
const applicationFile=path.join(root,'runtime/coordinator/application.ts');

// The bundles the start requires through the launcher, by the names and entries tools/build-runtime.mts
// publishes them under, so a run loads each the way the installed coordinator does.
const BUNDLES={
  '../../.build/runtime/coordinator-application.cjs':'runtime/coordinator/application.ts',
  '../../.build/runtime/grouped-combat.cjs':'runtime/coordinator/targeting/queue.ts',
  '../../.build/runtime/roster.cjs':'runtime/lifecycle/roster/index.ts',
};

// application.ts's own relative imports resolve through hostImport, so a row replaces one by its
// specifier as application.ts writes it, with a function of the bundled module.
const hostImports={name:'host-imports',setup(build) {
  build.onResolve({filter:/^\.\.?\//},args=>args.importer===applicationFile&&args.kind==='import-statement'
    ?{path:args.path,namespace:'host-import',pluginData:args.resolveDir}:undefined);
  build.onLoad({filter:/.*/,namespace:'host-import'},args=>({loader:'js',resolveDir:args.pluginData,
    contents:`module.exports=hostImport(${JSON.stringify(args.path)},require(${JSON.stringify(args.path)}));`}));
}};

// Each owner door (an api.ts) the start loads hands its bundled instance to hostDoor, so a row reads
// an owner's state through the run's door (host.door('runtime/status/coordinator/api.ts')).
const hostDoors={name:'host-doors',setup(build) {
  build.onResolve({filter:/(^|\/)api\.ts$/},args=>args.namespace==='host-door'?undefined
    :{path:path.resolve(args.resolveDir,args.path),namespace:'host-door'});
  build.onLoad({filter:/.*/,namespace:'host-door'},args=>{
    const file=JSON.stringify(args.path),name=JSON.stringify(path.relative(root,args.path).split(path.sep).join('/'));
    return {loader:'js',resolveDir:path.dirname(args.path),
      contents:`import * as door from ${file};export * from ${file};hostDoor(${name},door);`};
  });
}};

// The harness builds the source once per test file, as tools/build-runtime.mts builds the node
// bundles, and every run evaluates that build in a fresh scope.
function evaluate(text,filename,scope) {
  const names=Object.keys(scope);
  return vm.runInThisContext('(function('+names.join(',')+'){'+text+'\n})',{filename})(...names.map(name=>scope[name]));
}

const application='../../.build/runtime/coordinator-application.cjs';
let built;
function buildSources() {
  built??=Promise.all(Object.entries(BUNDLES).map(async([name,entry])=>{
    const result=await esbuild.build({entryPoints:[path.join(root,entry)],bundle:true,external:['alpathfinder'],
      format:'cjs',platform:'node',target:'node22',write:false,plugins:entry===BUNDLES[application]?[hostImports,hostDoors]:[]});
    return [name,{text:result.outputFiles[0].text,filename:entry}];
  })).then(Object.fromEntries);
  return built;
}

// A row replaces a launcher require by its name with a value, and one of application.ts's imports
// by its specifier with a function of the bundled module (hostImports). A bundled run evaluates the
// published bundles in the run's scope too, so grouped-combat.cjs reads the same globalThis hooks
// registry the application bundle's start published the core answers into, as one installed
// coordinator process does.
const published=name=>{const filename=name.replace(/^(\.\.\/)+/,'');return {text:fs.readFileSync(path.join(root,filename),'utf8'),filename};};
async function run(now, overrides = {}, bundled = false, launcherDirectory) {
  const doors=new Map();
  const sources=bundled?Object.fromEntries(Object.keys(BUNDLES).map(name=>[name,published(name)])):await buildSources(),loaded=new Map();
  const errors=[],warnings=[],routes=[],timers=[],listeners=[],handlers=new Map(),signals=new Map(),fetches=[];
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'coordinator-host-'));
  let exited;
  const exit=new Promise(resolve=>{exited=resolve;});
  after(async()=>{
    if(signals.has('SIGTERM')) {signals.get('SIGTERM')();await exit;}
    fs.rmSync(directory,{recursive:true,force:true});
  });
  let finished=false;
  // The start reports a failure it continues past as a warning (the metrics service's open, for one),
  // so a row reads those too.
  const logger={log(){},warn(...args){warnings.push(args);},error(...args){errors.push(args);},info(){}};
  const router={use(){},listen(){},get(route,...handlers){routes.push(['get',route,handlers.length]);},post(route,...callbacks){routes.push(['post',route,callbacks.length]);handlers.set(route,callbacks.at(-1));},delete(route,...handlers){routes.push(['delete',route,handlers.length]);}};
  const express=()=>router;
  express.json=express.text=express.static=()=>()=>{};
  const account={response:{characters:[{name:"P",ctype:"priest"}],servers:[]},resolve_char(){},resolve_realm(){},updateInfo:async()=>{},add_listener(){finished=true;}};
  // P, the account's character, is a configured caracAL character, so the coordinator manages it
  // (character_manage) and takes its commands. It stays disabled, so the start launches no worker.
  const config={characters:{P:{realm:'SR_USII',enabled:false,version:0}},merchant:'GoldMajesty',web_app:{party_dashboard:true,port:0}};
  function stubRequire(name) {
    if(Object.hasOwn(overrides,name))return overrides[name];
    if(Object.hasOwn(sources,name)) {
      if(!loaded.has(name)) {
        const bundle={exports:{}};
        loaded.set(name,bundle.exports);
        evaluate(sources[name].text,sources[name].filename,{...scope,module:bundle,exports:bundle.exports});
        loaded.set(name,bundle.exports);
      }
      return loaded.get(name);
    }
    if(name==='../config')return config;
    if(name==='../account_info')return async()=>account;
    if(name==='../game_files')return {ensure_latest:async()=>installed.version,cull_versions:async()=>{}};
    if(name==='../api')return async()=>[];
    if(name==='../src/CONSTANTS')return {LOCALSTORAGE_PATH:path.join(directory,'state.jsonl'),LOCALSTORAGE_ROTA_PATH:path.join(directory,'rotation.jsonl'),STAT_BEAT_INTERVAL:1000};
    if(name==='../src/LogUtils')return {log:logger,console:logger,ctype_to_clid:{}};
    if(name==='node:child_process')return {fork(){throw Error('Unexpected worker launch in empty-roster smoke test');}};
    if(name==='node:fs')return installFs;
    if(name==='express')return express;
    if(name==='bot-web-interface'||name==='../monitoring_util')return {};
    return resolve(name);
  }
  const clock=now===undefined?Date:class extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const hostModule={exports:{}};
  // The bundle compiles in this realm, as Node's module wrapper compiles the installed one, so an
  // error Node's fs throws is an instance of the bundle's Error (legacy-storage.ts reads ENOENT that
  // way). Each global the start reads is a wrapper parameter, so console, the clock, the timers and
  // globalThis, which holds the hooks registry (runtime/hooks/index.ts), are this run's.
  const scope={module:hostModule,exports:hostModule.exports,require:stubRequire,Date:clock,__dirname:launcherDirectory || path.resolve('.caracal/standalones'),Buffer,URL,URLSearchParams,structuredClone,console:logger,
    performance,fetch:async url=>{fetches.push(String(url));return {ok:true,json:async()=>[],text:async()=>'',headers:{get(){return null;}}};},
    process:{env:{AL_SESSION:'fixture'},pid:process.pid,kill:process.kill,on(name,handler){listeners.push(name);signals.set(name,handler);},exit(){exited();},stdout:{},stderr:{}},
    setTimeout(callback,ms){timers.push(['timeout',ms]);return {unref(){}};},clearTimeout(){},
    setInterval(callback,ms){timers.push(['interval',ms,callback]);return {unref(){}};},clearInterval(){},AbortController,AbortSignal,
    hostImport:(specifier,module)=>Object.hasOwn(overrides,specifier)?overrides[specifier](module):module,
    hostDoor:(file,door)=>doors.set(file,door)};
  // The run's globalThis holds only its own globals, so no owner registry (globalThis.__partyHooks,
  // __partyTasks and the other __party answers) comes from an earlier run or this test file.
  scope.globalThis={...scope,queueMicrotask,crypto};
  if (launcherDirectory) {
    const launcher=fs.readFileSync(path.join(root,'tools/caracal/CharacterCoordinator.cjs'),'utf8');
    evaluate(launcher,'CharacterCoordinator.js',scope);
    await hostModule.exports;
  } else {
    await stubRequire(application).startCoordinatorApplication({require:stubRequire,directory:scope.__dirname,
      loadFetch:async()=>{throw Error("Unexpected fetch in fixture");}});
  }
  assert.equal(finished,true,inspect(errors,{depth:5}));
  assert.equal(errors.filter(args=>args[0]==='failed to start caracAL').length,0);
  return {routes,timers,listeners,handlers,fetches,warnings,hooks:scope.globalThis.__partyHooks,door:file=>doors.get(file)};
}

// The status heartbeat (POST /party-api/status) of P, a priest at main 0,0 on USII with an empty bag,
// on a started host; `fields` replaces report fields. It returns the route's 200 answer.
function heartbeat(host,fields={}) {
  let response;
  host.handlers.get('/party-api/status')({body:{name:'P',ctype:'priest',map:'main',x:0,y:0,server:'USII',gold:0,items:Array(42).fill(null),hp:100,max_hp:100,...fields}},
    {status(code){assert.equal(code,200);return this;},json(value){response=value;}});
  return response;
}

module.exports={run,runBundled:(now,overrides)=>run(now,overrides,true),
  runLauncher:(directory,now,overrides)=>run(now,overrides,true,directory),heartbeat};

