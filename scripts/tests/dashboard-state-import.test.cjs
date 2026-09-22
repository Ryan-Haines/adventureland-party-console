const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../../runtime/coordinator/persistence/dashboard-import.ts');
const {stateKeys}=require('../../runtime/coordinator/persistence/snapshots.ts');
const record=(key,value)=>JSON.stringify({[key]:value===null?null:JSON.stringify(value)});
const source=value=>record(stateKeys.settings,value);

test('JSONL import replays latest entries, tombstones, and selections precedence',()=>{
 const data=[source({threshold:1,marked:{W:[]}}),source({threshold:2,marked:{W:[{name:'coat'}]}}),
  record(stateKeys.selections,{marked:{W:[]}})].join('\r\n');
 const parsed=policy.parseDashboardImport('\uFEFF'+data,n=>n==='W');
 assert.equal(parsed.values.threshold,2);assert.deepEqual(parsed.values.marked,{W:[]});
 const deleted=policy.parseDashboardImport(data+'\n'+record(stateKeys.selections,null),()=>true);
 assert.deepEqual(deleted.values.marked,{W:[{name:'coat'}]});
});

test('deleted characters are skipped, including empty maps, while owned and shared settings import',()=>{
 const parsed=policy.parseDashboardImport(source({threshold:30,marked:{W:[],Deleted:[]},upgrades:{Deleted:[]},
  deconstructionMarks:[{id:'old',owner:'Deleted',origin:'character',item:{name:'coat'},quantity:1}]}),name=>name==='W');
 assert.deepEqual(parsed.values,{marked:{W:[]},threshold:30});
 assert.deepEqual(parsed.skippedCharacters,{Deleted:['marked','upgrades','deconstructionMarks']});
 const state={upgrades:{W:[{item:{name:'coat'},tiers:1}]}};
 policy.applyDashboardImport(state,parsed);
 assert.equal(state.upgrades.W.length,1);
 assert.deepEqual(policy.parseDashboardImport(source({marked:{}}),()=>true).values.marked,{});
 assert.throws(()=>policy.parseDashboardImport(source({threshold:30,marked:{Deleted:123}}),()=>false),/Invalid saved marked/);
});

test('character-specific sale rules are skipped without dropping shared item rules',()=>{
 const parsed=policy.parseDashboardImport(source({autoNpcSales:{shared:{item:{name:'coat'}},old:{character:'Deleted',item:{name:'coat'}}},
  npcSaleMarks:[{id:'old',character:'Deleted',item:{name:'coat'}}]}),()=>false);
 assert.deepEqual(parsed.values,{autoNpcSales:{shared:{item:{name:'coat'}}}});
 assert.deepEqual(parsed.skippedCharacters,{Deleted:['npcSaleMarks','autoNpcSales']});
 const f=routes(),data=source({marked:{Deleted:[]}}),preview=f.call('/party-api/dashboard-state/preview',data);
 assert.deepEqual(preview.body.fields,[]);assert.deepEqual(preview.body.skippedCharacters,{Deleted:['marked']});
 assert.equal(f.call('/party-api/dashboard-state/import',data,preview.body.digest).status,400);
 assert.equal(f.writes.length,0);
});

test('imports marks and preferences while preserving credentials, roster, queues and event progress',()=>{
 const state={marked:{Old:[]},threshold:20,merchantQueue:[{id:'live'}],activeConvoy:{id:'travel'},
  leader:'Current',anniversary:{blacklist:['old'],round:123},secret:'keep'};
 const parsed=policy.parseDashboardImport(source({marked:{W:[{name:'coat'}]},threshold:10,
  merchantQueue:[{id:'old'}],activeConvoy:{id:'old'},leader:'Old',secret:'discard',anniversary:{blacklist:['new'],round:5}}),()=>true);
 policy.applyDashboardImport(state,parsed);
 assert.equal(state.threshold,10);assert.equal(state.secret,'keep');assert.equal(state.leader,'Current');
 assert.deepEqual(state.merchantQueue,[{id:'live'}]);assert.deepEqual(state.activeConvoy,{id:'travel'});
 assert.deepEqual(state.anniversary,{blacklist:['old'],round:123});
});

test('invalid JSON, malformed marks and unsafe keys reject the entire upload',()=>{
 for(const data of ['{bad',source({marked:{W:123}}),source({compounds:{W:[{id:'x',items:123}]}}),
  '{"party_dashboard_settings_state_v1":"{\\"__proto__\\":{},\\"threshold\\":1}"}'])
  assert.throws(()=>policy.parseDashboardImport(data,n=>n==='W'));
 assert.throws(()=>policy.parseDashboardImport(record(stateKeys.roster,{headlessSlots:['W']}),()=>true),/No supported/);
});

function routes() {
 const source=require('./helpers/coordinator-source.cjs').coordinatorSource();
 const handlers={},writes=[],saved=[];
 const party={threshold:10,anniversary:{blacklist:[],round:7},merchantQueue:[{id:'keep'}]};
 const c={party,coordinatorPolicies:policy,ownedCharacter:n=>n==='W',LOCALSTORAGE_PATH:'state.jsonl',
  crypto:require('node:crypto'),express:{text:()=>null},
  express_inst:{get:(p,f)=>handlers[p]=f,post:(p,...f)=>handlers[p]=f.at(-1)},
  fs_regular:{realpathSync:()=>'/data/localStorage/caraGarage.jsonl',constants:{COPYFILE_EXCL:1},copyFileSync:(...args)=>writes.push(args)},
  persistSettings:()=>saved.push(party.threshold)};
 const routes=require('../../runtime/coordinator/http/dashboard-import-composition.ts').createCoordinatorDashboardImport(party,c.LOCALSTORAGE_PATH,{
  owned:name=>c.ownedCharacter(name),rosterReady:()=>c.ready !== false,crypto:{...c.crypto,randomBytes:size=>{assert.equal(size,4);return Buffer.from('01020304','hex');}},
  files:c.fs_regular,header:(req,name)=>req.get(name),now:()=>1234,persist:()=>c.persistSettings(),
 });
 handlers['/party-api/dashboard-state']=routes.metadata;
 handlers['/party-api/dashboard-state/preview']=routes.preview;
 handlers['/party-api/dashboard-state/import']=routes.importState;
 function call(path,body,token){const result={status:200};handlers[path]({body,get:name=>{assert.equal(name,'X-State-Preview');return token;}},{status(n){result.status=n;return this;},json(data){result.body=data;return this;}});return result;}
 return {call,party,writes,saved,c};
}
test('preview is read-only; import requires matching preview and backs up before persistence',()=>{
 const f=routes(),data=source({threshold:25});
 const preview=f.call('/party-api/dashboard-state/preview',data);
 assert.match(preview.body.digest,/^[a-f0-9]{64}$/);
 assert.equal(f.party.threshold,10);assert.equal(f.writes.length,0);assert.equal(f.saved.length,0);
 assert.equal(f.call('/party-api/dashboard-state/import',data,'wrong').status,409);
 assert.equal(f.writes.length,0);
 const applied=f.call('/party-api/dashboard-state/import',data,preview.body.digest);
 assert.equal(applied.status,200);assert.equal(f.party.threshold,25);assert.equal(f.writes.length,1);assert.deepEqual(f.saved,[25]);
 assert.match(applied.body.backupPath,/caraGarage.before-import-.*\.jsonl$/);
 assert.deepEqual(f.writes[0],['state.jsonl','/data/localStorage/caraGarage.before-import-1234-01020304.jsonl',1]);
 assert.deepEqual(f.party.merchantQueue,[{id:'keep'}]);
});

test('roster changes invalidate preview and unavailable roster blocks import without a backup',()=>{
 const f=routes(),data=source({threshold:30,marked:{W:[],Deleted:[]}});
 const preview=f.call('/party-api/dashboard-state/preview',data);
 assert.deepEqual(preview.body.skippedCharacters,{Deleted:['marked']});
 f.c.ownedCharacter=()=>true;
 assert.equal(f.call('/party-api/dashboard-state/import',data,preview.body.digest).status,409);
 f.c.ready=false;
 assert.match(f.call('/party-api/dashboard-state/preview',data).body.error,/roster is still loading/);
 assert.equal(f.call('/party-api/dashboard-state/import',data,preview.body.digest).status,400);
 assert.equal(f.writes.length,0);assert.equal(f.party.threshold,10);
});
test('import metadata resolves the current installation path at request time',()=>{
 const f=routes();
 assert.equal(f.call('/party-api/dashboard-state').body.canonicalPath,'/data/localStorage/caraGarage.jsonl');
 f.c.fs_regular.realpathSync=path=>{assert.equal(path,'state.jsonl');return 'C:/installation/localStorage/caraGarage.jsonl';};
 const metadata=f.call('/party-api/dashboard-state').body;
 assert.equal(metadata.canonicalPath,'C:/installation/localStorage/caraGarage.jsonl');
 assert.equal(metadata.dockerPath,'/data/localStorage/caraGarage.jsonl');assert.equal(metadata.maxBytes,128*1024*1024);
});
test('a persistence failure restores in-memory settings and reports the recovery backup',()=>{
 const f=routes(),data=source({threshold:25});const preview=f.call('/party-api/dashboard-state/preview',data);
 f.c.persistSettings=()=>{throw Error('disk full');};
 const failed=f.call('/party-api/dashboard-state/import',data,preview.body.digest);
 assert.equal(failed.status,500);assert.equal(f.party.threshold,10);assert.match(failed.body.error,/Backup:/);
});

test('import refuses to mutate settings if its exclusive backup fails',()=>{
 const f=routes(),data=source({threshold:25}),preview=f.call('/party-api/dashboard-state/preview',data);
 f.c.fs_regular.copyFileSync=()=>{throw Error('backup unavailable');};
 const failed=f.call('/party-api/dashboard-state/import',data,preview.body.digest);
 assert.equal(failed.status,400);assert.equal(failed.body.error,'backup unavailable');assert.equal(f.party.threshold,10);assert.deepEqual(f.saved,[]);
});

test('legacy blacklist-only import is ignored without changing runtime state',()=>{
 const f=routes(),data=source({anniversary:{blacklist:['new']}}),preview=f.call('/party-api/dashboard-state/preview',data);
 f.c.persistSettings=()=>{throw Error('disk full');};
 assert.equal(f.call('/party-api/dashboard-state/import',data,preview.body.digest).status,400);
 assert.deepEqual(f.party.anniversary,{blacklist:[],round:7});assert.deepEqual(f.party.merchantQueue,[{id:'keep'}]);
});

for(const metadataFailure of [false,true])test(metadataFailure ? 'loading import settings cannot claim a file import failed' : 'Settings import previews a file before confirmation and shows its canonical path and backup',async()=>{
 const ts=require('../../node_modules/typescript');
 const code=ts.transpileModule(fs.readFileSync('dashboard/features/party/dashboard-state-import.tsx','utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export function','function'),
  {compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
 const slots=[],effects=[],requests=[];let cursor=0;
 const c=vm.createContext({API:'/party-api',Button:'Button',StateExportButton:'StateExportButton',AbortController,
  useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],v=>slots[i]=v];},
  useRef:v=>{const i=cursor++;return slots[i] ||= {current:v};},useEffect:fn=>{const i=cursor++;if(!slots[i]){slots[i]=true;effects.push(fn);}},
  React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})},
  fetch:async(url,options)=>{requests.push({url,options});if(metadataFailure)return {ok:false,text:async()=>JSON.stringify({error:'Service unavailable'})};const data=url.endsWith('/preview')?
   {fields:['marked'],characters:['W'],digest:'hash'}:url.endsWith('/import')?
   {fields:['marked'],characters:['W'],digest:'hash',backupPath:'/data/localStorage/backup.jsonl'}:
   {canonicalPath:'/data/localStorage/caraGarage.jsonl',maxBytes:128*1024*1024};return {ok:true,json:async()=>data,text:async()=>JSON.stringify(data)};}});
 vm.runInContext(code,c);const render=()=>{cursor=0;return c.DashboardStateImport();};
 const nodes=t=>t&&typeof t==='object'?[t,...t.children.flatMap(nodes)]:[];
 const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
 let tree=render();effects.forEach(fn=>fn());await flush();tree=render();
 if(metadataFailure){
  const alert=nodes(tree).find(n=>n.props.role==='alert');assert.ok(alert);
  assert.match(alert.children.join(''),/Could not load import\/export settings: Service unavailable/);
  assert.doesNotMatch(alert.children.join(''),/Error importing state file/);return;
 }
 assert.ok(nodes(tree).some(n=>n.children.includes('/data/localStorage/caraGarage.jsonl')));
 const input=nodes(tree).find(n=>n.type==='input');input.props.ref.current={value:''};
 input.props.onChange({target:{files:[{name:'caraGarage.jsonl',size:10,text:async()=>source({marked:{W:[]}})}]}});
 await flush();tree=render();assert.equal(requests.filter(r=>r.url.endsWith('/import')).length,0);
 const confirm=nodes(tree).find(n=>n.type==='Button'&&n.children.includes('Import dashboard state'));assert.ok(confirm);
 confirm.props.onClick();await flush();tree=render();
 assert.equal(requests.at(-1).options.headers['X-State-Preview'],'hash');
 assert.ok(nodes(tree).some(n=>n.type==='output'));
 for(const button of nodes(tree).filter(n=>n.type==='Button'))assert.match(button.props.className,/bg-.*text-.*hover:bg-/);
});
