const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const policy=require('../../runtime/settings/coordinator/persistence/dashboard-import.ts');
const {stateKeys}=require('../../runtime/settings/coordinator/persistence/snapshots.ts');
const {settingsWriter}=require('./helpers/settings-writer.cjs');
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
 assert.deepEqual(parsed.skippedCharacters,{Deleted:['deconstructionMarks','marked','upgrades']});
 const state={upgrades:{W:[{item:{name:'coat'},tiers:1}]}};
 assert.equal(policy.applyDashboardImport(state,parsed,settingsWriter(state).write),null);
 assert.equal(state.upgrades.W.length,1);
 assert.deepEqual(policy.parseDashboardImport(source({marked:{}}),()=>true).values.marked,{});
 assert.throws(()=>policy.parseDashboardImport(source({threshold:30,marked:{Deleted:123}}),()=>false),/Invalid saved marked/);
});

test('character-specific sale rules are skipped without dropping shared item rules',()=>{
 const parsed=policy.parseDashboardImport(source({autoNpcSales:{shared:{item:{name:'coat'}},old:{character:'Deleted',item:{name:'coat'}}},
  npcSaleMarks:[{id:'old',character:'Deleted',item:{name:'coat'}}]}),()=>false);
 assert.deepEqual(parsed.values,{autoNpcSales:{shared:{item:{name:'coat'}}}});
 assert.deepEqual(parsed.skippedCharacters,{Deleted:['autoNpcSales','npcSaleMarks']});
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
 assert.equal(policy.applyDashboardImport(state,parsed,settingsWriter(state).write),null);
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
 const c={party,ownedCharacter:n=>n==='W',LOCALSTORAGE_PATH:'state.jsonl',
  crypto:require('node:crypto'),express:{text:()=>null},
  express_inst:{get:(p,f)=>handlers[p]=f,post:(p,...f)=>handlers[p]=f.at(-1)},
  fs_regular:{realpathSync:()=>'/data/localStorage/caraGarage.jsonl',constants:{COPYFILE_EXCL:1},copyFileSync:(...args)=>writes.push(args)},
  persistSettings:()=>saved.push(party.threshold)};
 const routes=require('../../runtime/settings/coordinator/routes/import.ts').createCoordinatorDashboardImport(party,c.LOCALSTORAGE_PATH,{
  owned:name=>c.ownedCharacter(name),roster:()=>c.ready===false?[]:['W'],hooks:{registrations:()=>[],notify(){}},crypto:{...c.crypto,randomBytes:size=>{assert.equal(size,4);return Buffer.from('01020304','hex');}},
  files:c.fs_regular,header:(req,name)=>req.get(name),now:()=>1234,persist:()=>c.persistSettings(),write:settingsWriter(party).write,
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

// v1.5.0's failed apply answered 500 with no cause, and its
// restore persisted again in a catch that dropped a second failure (http/dashboard-import.ts:41-50,
// 68-74). The reply names the apply's cause, and the restore is the assignment alone, with nothing
// to drop.
test('X1: a failed import names its cause and restores without another save',()=>{
 const f=routes(),data=source({threshold:25});const preview=f.call('/party-api/dashboard-state/preview',data);
 let saves=0;f.c.persistSettings=()=>{saves++;throw Error('disk full');};
 const failed=f.call('/party-api/dashboard-state/import',data,preview.body.digest);
 assert.equal(failed.status,500);assert.match(failed.body.error,/\(disk full\)/);
 assert.equal(saves,1,'the restore saves nothing after the failed save');assert.equal(f.party.threshold,10);
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

for(const metadataFailure of [false,true])test(metadataFailure ? 'loading import settings cannot claim a file import failed' : 'Settings import previews a file before confirmation and shows its canonical path and backup',async t=>{
 const ts=require('../../node_modules/typescript');
 // The view sends through the real query-actions.ts performAction on a dashboard query client, which
 // calls the process fetch; the row plants its fetch there.
 const {load,queryRoot}=require('./helpers/dashboard-query-module.cjs'),{performAction}=load('query-actions.ts'),{client}=queryRoot();
 const code=ts.transpileModule(fs.readFileSync('dashboard/features/party/dashboard-state-import.tsx','utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export function','function'),
  {compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
 const slots=[],effects=[],requests=[];let cursor=0;
 const c=vm.createContext({Button:'Button',StateExportButton:'StateExportButton',AbortController,useQueryClient:()=>client,performAction,
  useState:v=>{const i=cursor++;if(!(i in slots))slots[i]=v;return[slots[i],v=>slots[i]=v];},
  useRef:v=>{const i=cursor++;return slots[i] ||= {current:v};},useEffect:fn=>{const i=cursor++;if(!slots[i]){slots[i]=true;effects.push(fn);}},
  React:{createElement:(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity)})},
  fetch:async(url,options)=>{requests.push({url,options});if(metadataFailure)return {ok:false,text:async()=>JSON.stringify({error:'Service unavailable'})};const data=url.endsWith('/preview')?
   {fields:['marked'],characters:['W'],digest:'hash'}:url.endsWith('/import')?
   {fields:['marked'],characters:['W'],digest:'hash',backupPath:'/data/localStorage/backup.jsonl'}:
   {canonicalPath:'/data/localStorage/caraGarage.jsonl',maxBytes:128*1024*1024};return {ok:true,json:async()=>data,text:async()=>JSON.stringify(data)};}});
 const processFetch=globalThis.fetch;globalThis.fetch=c.fetch;t.after(()=>{globalThis.fetch=processFetch;});
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
});

// The import shows the server's Docker path and checks the server's size limit, and
// waits for them.
test('the import reads the route\'s path and size limit', () => {
  const view = require('node:fs').readFileSync('dashboard/features/party/dashboard-state-import.tsx', 'utf8');
  assert.match(view, /if \(!info\) \{ setError\("Waiting for the server's import limits\."\); return; \}/);
  assert.match(view, /if \(file\.size > info\.maxBytes\)/);
  assert.match(view, /\{info\?\.dockerPath \|\| "Loading…"\}/);
  assert.doesNotMatch(view, /128 \* 1024 \* 1024|\/data\/localStorage\/caraGarage\.jsonl/);
});

// The preferences route answers a refused value with its declaration's refusal line,
// v1.5.0's words (http/dashboard-import.ts:90:92), and writes neither field.
test('the preferences route refuses with each declaration\'s words and writes neither field',()=>{
 const {createDashboardImportRoutes}=require('../../runtime/settings/coordinator/routes/import.ts');
 const state={bankboiPrefix:'Bank',anniversaryAutoChat:false};
 const {preferences}=createDashboardImportRoutes(state,{write:settingsWriter(state).write});
 const answer=body=>{const out={};preferences({body},{status(code){out.code=code;return this;},json(value){out.value=value;return this;}});return out;};
 assert.deepEqual(answer({bankboiPrefix:'a',anniversaryAutoChat:true}),{code:400,value:{error:'Use 3–11 letters, numbers, or underscores'}});
 assert.deepEqual(answer({anniversaryAutoChat:'yes'}),{code:400,value:{error:'Invalid chat setting'}});
 assert.deepEqual([state.bankboiPrefix,state.anniversaryAutoChat],['Bank',false]);
 // Any other writer of the field, as the settings route and the import, answers the same words.
 assert.equal(settingsWriter(state).write({by:'dashboard:settings',changes:[{field:'bankboiPrefix',value:'a'}]}).error,'Use 3–11 letters, numbers, or underscores');
});

// An imported item collection threshold past the bag reads as the bag, as the load holds a saved one
// (v1.5.0's import took any positive count); a count below 1 still refuses the import.
test('an imported item collection threshold above 42 reads as 42, and 0 still refuses',()=>{
 assert.equal(policy.parseDashboardImport(source({itemCollectionThreshold:60}),()=>true).values.itemCollectionThreshold,42);
 assert.equal(policy.parseDashboardImport(source({itemCollectionThreshold:7}),()=>true).values.itemCollectionThreshold,7);
 assert.throws(()=>policy.parseDashboardImport(source({itemCollectionThreshold:0}),()=>true),/itemCollectionThreshold/);
});

// An add-on setting declares its own import fit, as a core field does. The registry's load check
// takes the declaration, and the import reads a level past the add-on's max as its fit; the fitted
// value still goes to the writer's check by kind.
test('an add-on setting past its max imports as its fit',()=>{
 const {addonSettingProblem}=require('../../runtime/settings/rules.ts');
 const settings={level:{label:'Level',kind:'number',default:1,min:1,max:10,importable:true,fit:v=>typeof v==='number'&&v>10?10:v}};
 assert.equal(addonSettingProblem({name:'cap',folder:'addons',settings}),undefined);
 const file=v=>source({addons:{cap:{settings:{level:v}}}});
 assert.equal(policy.parseDashboardImport(file(60),()=>true,[{name:'cap',settings}]).values.addons.cap.settings.level,10);
 assert.equal(policy.parseDashboardImport(file(4),()=>true,[{name:'cap',settings}]).values.addons.cap.settings.level,4);
});

// Each field's import rule sits on its owner's declaration, and the import reads it there.
test('the import reads character keys and conversions from the declarations',()=>{
 const {table}=require('../../runtime/settings/coordinator/table.ts').coordinatorSettings();
 assert.deepEqual(['deconstructionMarks','npcSaleMarks','autoNpcSales'].map(f=>table.fields.get(f).setting.characterKey),['owner','character','character']);
 assert.deepEqual(['merchantRoutinePriorities','farmingProfiles','passiveHunting','passiveRareHunts'].map(f=>typeof table.fields.get(f).setting.imported),['function','function','function','function']);
 const state={farmingProfiles:{W:{huntSettings:{keep:1},farmingPolicy:'own'}}};
 const file={merchantRoutinePriorities:{'npc sales':40},passiveRareHunts:{},farmingProfiles:{W:{huntBlacklist:{}}}};
 const parsed=policy.parseDashboardImport(source(file),()=>true);
 assert.equal(policy.applyDashboardImport(state,parsed,settingsWriter(state).write),null);
 assert.equal(state.merchantRoutinePriorities['auto npc sales'],40,'the routine priorities migrate their older keys');
 assert.equal(state.passiveHunting?.version,1,'the passive switches derive the rules beside them');
 assert.deepEqual(Object.keys(state.farmingProfiles.W).sort(),['farmingPolicy','huntBlacklist','huntSettings'],'an imported profile merges into the saved one');
 assert.deepEqual(policy.exportDashboardSettings({farmingProfiles:{W:{huntBlacklist:{},farmingPolicy:'own'}}}).settings.farmingProfiles,{W:{huntBlacklist:{}}},'the export carries preferences only');
});

// A console that has its spawn catalog exports the empty Phoenix order it starts with; the import
// carries it back through the writer's catalog check, which reads the empty default as no patrol.
test('an exported empty Phoenix order imports back with the spawn catalog loaded',()=>{
 const boxes=[['main',708,-300,1668,-86],['main',378,1686,904,1920]];
 const spawns=[{id:'phoenix',locations:boxes.map(([map,...boundary])=>({map,boundary,x:(boundary[0]+boundary[2])/2,y:(boundary[1]+boundary[3])/2}))}];
 const state={phoenixRouteOrder:[],threshold:10};
 const parsed=policy.parseDashboardImport(JSON.stringify(policy.exportDashboardSettings(state)),()=>true);
 assert.ok(parsed.fields.includes('phoenixRouteOrder'));
 assert.equal(policy.applyDashboardImport(state,parsed,settingsWriter(state,{spawns:()=>spawns}).write),null);
 // A saved order is still held to the catalog.
 assert.equal(settingsWriter(state,{spawns:()=>spawns}).write({by:'test',changes:[{field:'phoenixRouteOrder',value:['nowhere']}]}).ok,false);
});
