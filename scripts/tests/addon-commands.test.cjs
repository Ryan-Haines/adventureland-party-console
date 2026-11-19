// The add-on commands and the build's discovery of add-on folders. The commands are build tools
// with no game run, so they run here as the player's agent would run them, on a scratch checkout
// (helpers/addon-folders.cjs).
const test=require('node:test'), assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process'), fs=require('node:fs'), path=require('node:path');
const {scratchRoot,addFolder,registrationSource}=require('./helpers/addon-folders.cjs');
const root=path.resolve(__dirname,'../..');
const run=(command,...args)=>spawnSync(process.execPath,[path.join(root,'runtime/hooks/cli',command+'.mts'),...args],{cwd:root,encoding:'utf8'});

test('item 9: addon:map prints every hook, tier and answerer',()=>{
  // The map reads a scratch checkout with no add-on folders, so the test add-on is the only one
  // that answers the anchor and a formation mover, whatever this checkout has installed.
  const scratch=scratchRoot();
  let r;
  try{r=run('map','--root',scratch.dir,'--with',path.join(root,'scripts/tests/fixtures/anchor-addon.ts'));}finally{scratch.cleanup();}
  assert.equal(r.status,0,r.stderr);
  for(const hook of ['movement.request','group.anchor','journey.started','journey.paused','journey.ended'])assert.match(r.stdout,new RegExp(hook.replace('.','\.')));
  assert.match(r.stdout,/group\.anchor .*answered by anchor-fixture/);
  // The map prints each tier of the rank table (runtime/protocol/ranks.ts TIERS) at its rank, highest first.
  const {TIERS}=require('../../runtime/protocol/ranks.ts');
  const tiers=[...r.stdout.matchAll(/^ {2}(\d+) ([a-z-]+)/gm)].map(m=>[m[2],Number(m[1])]);
  assert.deepEqual(tiers.map(([name])=>name).sort(),Object.keys(TIERS).sort());
  for(const [name,rank] of tiers)assert.equal(rank,TIERS[name].rank,name);
  assert.deepEqual(tiers.map(([,rank])=>rank),tiers.map(([,rank])=>rank).sort((a,b)=>b-a));
  assert.match(r.stdout,new RegExp(TIERS.formation.rank+' formation: .*anchor-fixture/hold'));
});

// to: installing is copying a folder in, removing is deleting it, and neither edits a core
// file.
test('to: addon:new writes only its folder, the next build loads it, and a deleted folder no longer loads',()=>{
  const scratch=scratchRoot();
  try{
    const made=run('new','boss-zones','--root',scratch.dir);
    assert.equal(made.status,0,made.stderr);
    assert.deepEqual(scratch.status(),['runtime/addons/boss-zones/README.md','runtime/addons/boss-zones/index.ts'],'AS3: only the folder changed');
    const readme=fs.readFileSync(path.join(scratch.dir,'runtime/addons/boss-zones/README.md'),'utf8');
    assert.match(readme,/Is this a new feature or a bug fix\?/);assert.match(readme,/Movement tier \(02\)/);
    assert.match(fs.readFileSync(path.join(scratch.dir,'runtime/addons/boss-zones/index.ts'),'utf8'),/export const registration: Registration = \{\n {2}name: 'boss-zones', folder: 'addons'/);
    assert.match(run('map','--root',scratch.dir).stdout,/^ {2}boss-zones \[addons\]/m,'AS1: the folder loads');
    const again=run('new','boss-zones','--root',scratch.dir);
    assert.equal(again.status,1);assert.match(again.stderr,/boss-zones already exists/);
    assert.equal(run('new','Bad Name','--root',scratch.dir).status,1);
    fs.rmSync(path.join(scratch.dir,'runtime/addons/boss-zones'),{recursive:true});
    assert.doesNotMatch(run('map','--root',scratch.dir).stdout,/boss-zones/,'AS2: a deleted folder does not load');
    assert.deepEqual(scratch.status(),[],'AS3: removing edits nothing else');
  }finally{scratch.cleanup();}
});

// A half-copied add-on stops the build with its folder named.
test('a folder with no index.ts or README.md, a bad name or a loose file stops the build, named',()=>{
  const {installedFolders}=require('../../runtime/hooks/build/installed.mts');
  for(const [what,set,message] of [
    ['no index.ts',dir=>addFolder(dir,'half',{'README.md':'# half\n'}),/runtime\/addons\/half has no index\.ts, so it is not an add-on/],
    ['no README.md',dir=>addFolder(dir,'half',{'index.ts':true}),/runtime\/addons\/half has no README\.md/],
    ['a bad name',dir=>addFolder(dir,'Half_Copy'),/runtime\/addons\/Half_Copy is not an add-on name/],
    ['a loose file',dir=>fs.writeFileSync(path.join(dir,'runtime/addons/notes.ts'),''),/runtime\/addons\/ holds only add-on folders/],
  ]){
    const scratch=scratchRoot({ok:{'index.ts':true,'README.md':'# ok\n'}});
    try{set(scratch.dir);assert.throws(()=>installedFolders(scratch.dir),message,what);
      const built=run('map','--root',scratch.dir);assert.equal(built.status,1,what);assert.match(built.stderr,message,what);}
    finally{scratch.cleanup();}
  }
});

// A conflict between two add-ons is refused at load, named with both, by addon:check and by GET
// /party-api/addons for the dashboard notice.
test('two add-ons on one target mode entry: addon:check exits 1 naming both, and the route returns the refusal',async()=>{
  const entry=[{slot:'target-mode',mode:'bosses',fills:'choice',button:{label:'Bosses',description:'Bosses',color:'slate'},status:{title:'Bosses',field:'message',idle:'Waiting'}}];
  const hooks="{ 'target.mode'() { return undefined; } }";
  const scratch=scratchRoot({'a-first':{'index.ts':registrationSource('a-first',{slots:entry,hooks}),'README.md':'#\n'},
    'b-second':{'index.ts':registrationSource('b-second',{slots:entry,hooks}),'README.md':'#\n'}});
  try{
    const r=run('check','--root',scratch.dir);
    assert.equal(r.status,1);assert.match(r.stdout,/^Refused b-second: b-second and a-first both fill the target mode entry "bosses"\.$/m);
    const {loadRegistry}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/cli/load.mts')).href);
    const registry=await loadRegistry(['--root',scratch.dir]);
    const {createAddonRoutes}=require('../../runtime/hooks/http.ts');
    globalThis.__partyHooks=registry;
    try{
      let body;createAddonRoutes({write:()=>({ok:true,changed:[]}),fighters:()=>[]}).list({},{json:value=>(body=value)});
      assert.deepEqual(body.refusals,[{name:'b-second',message:'b-second and a-first both fill the target mode entry "bosses"'}]);
    }finally{delete globalThis.__partyHooks;}
  }finally{scratch.cleanup();}
});

// And the naming rule reads code, not words: the check flags an import into the add-on's
// folder and a string literal that is its name, `addon:<name>`, a ring id or its status field. A
// comment, Markdown, an identifier, a longer string, build output and a test file's own fixture
// literal pass; a test file's import still counts.
test('the naming check reads imports and exact string ids, not words',()=>{
  const {namingFindings,BUILD_BANNER}=require('../../runtime/hooks/build/naming.mts');
  const sources=new Map([
    ['characters/party-member.js',BUILD_BANNER+'\nconst x = "boss-zones";\n'],
    ['runtime/coordinator/application.ts','// boss-zones is named here only in a comment\nif (mode === "boss-zones") start();\n'],
    ['runtime/coordinator/wired.ts',"import { registration } from '../addons/boss-zones/index.ts';\nconst s = 'addon:boss-zones', ring = `boss-zones.seen`;\n"],
    ['dashboard/features/party/card.tsx','const shown = store["bossZoneMessage"];\n'],
    ['docs/guide.md','The boss-zones screen.\n'],
    ['runtime/addons/boss-zones/index.ts','export const name = "boss-zones";\n'],
    ['runtime/coordinator/words.ts','const bossZones = 0; const say = "boss-zones are near"; // a longer string is not the name\n'],
    ['scripts/tests/zones.test.cjs',"register({name:'boss-zones'});\nrequire('../../runtime/addons/boss-zones/index.ts');\n"],
  ]);
  assert.deepEqual(namingFindings(sources,[{name:'boss-zones',ids:['bossZoneMessage']}]).map(f=>f.split(': names')[0]+' '+f.split('(')[1].split(')')[0]),
    ['runtime/coordinator/application.ts:2 "boss-zones"','runtime/coordinator/wired.ts:1 imports ../addons/boss-zones/index.ts',
      'runtime/coordinator/wired.ts:2 "addon:boss-zones"','runtime/coordinator/wired.ts:2 "boss-zones.seen"',
      'dashboard/features/party/card.tsx:1 "bossZoneMessage"','scripts/tests/zones.test.cjs:2 imports ../../runtime/addons/boss-zones/index.ts']);
  // The four outside builds' names stand in core as words and fixture names, and none of them counts.
  const tree=new Map(spawnSync('git',['ls-files','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).stdout.split('\n')
    .filter(f=>/\.(ts|tsx|mts|cjs|mjs|js)$/.test(f)&&!f.startsWith('runtime/addons/')).map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.deepEqual(namingFindings(tree,['cosmetics','tank-hold','market-filters','npc-orders'].map(name=>({name}))),[]);
});

// The installed list builds itself: a command entry imports only build/installed.mts statically,
// so its closure reaches no .build/ file before it writes the list; an entry that loads its body
// statically is named with the chain.
test('C6: the add-on command entries reach no .build/ file before they write the installed list',async()=>{
  const {entryFindings}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/rules/uses.mts')).href);
  const tree=new Map(spawnSync('git',['ls-files','--cached','--others','--exclude-standard','runtime'],{cwd:root,encoding:'utf8'}).stdout.split('\n')
    .filter(f=>/\.(ts|tsx|mts)$/.test(f)).map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.deepEqual(entryFindings(tree),[]);
  tree.set('runtime/hooks/cli/eager.mts',"import { main } from './run/check.mts';\n");
  const [finding,...rest]=entryFindings(tree);
  assert.deepEqual(rest,[]);
  assert.match(finding,/^runtime\/hooks\/cli\/eager\.mts: imports \.build\/addons\/runtime\.ts before it writes the installed list \(runtime\/hooks\/cli\/eager\.mts -> runtime\/hooks\/cli\/run\/check\.mts -> .* -> runtime\/hooks\/index\.ts -> \.build\/addons\/runtime\.ts\)/);
});
// Rule 9 (slot-coverage.md "The standing check"): an unmarked dialog, an unmarked outer section, a
// repeated id, an id with no row, a row whose file lacks it, a reason off the list or with no cite, a
// slotted area with no draw and a slot nothing draws each fail; a section inside a marked area takes its
// decision, and the console's own dashboard passes.
test('rule 9: the slot coverage check names each unmarked, undecided or undrawn area and each undrawn slot',async()=>{
  const {areaFindings}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/rules/areas.mts')).href);
  const a='dashboard/features/party/a.tsx',b='runtime/hooks/dashboard/b.tsx';
  const sources=new Map([[a,`export const A=()=><><section data-area="bar"><section>inner</section><AddonSlot name="top-bar" part="views" /></section>
<article data-area="card"><DialogContent>x</DialogContent></article><header>top</header><aside data-area="bar">again</aside>
<div data-addon-slot="card-line"/><section data-area="loose"/></>;`],[b,'export const B=()=><details data-area="kept"/>;'],
    ['dashboard/features/other.tsx','export const C=()=><section/>;']]);
  const rows={AREA_CORE_REASONS:['security','frame'],AREAS:{bar:{file:a,slot:'top-bar',part:'views'},card:{file:a,slot:'card-section',part:'foot'},
    kept:{file:b,core:'taste',cite:''},gone:{file:a,core:'frame',cite:'x'},inner:{file:b,within:'nowhere'}}};
  const slots={'top-bar':{},'card-section':{},'card-line':{},'rare-list':{}},at='runtime/hooks/rows/12-status.ts AREAS';
  assert.deepEqual(areaFindings(rows,slots,sources),[
    `${a}:2 draws a DialogContent with no data-area`,`${a}:2 draws a header with no data-area`,`${a}:2 repeats the area id "bar" of ${a}:1`,
    `${a}:3 marks the area "loose", which no AREAS row decides`,
    `${at} card: the area holds no <AddonSlot name="card-section" part="foot">`,
    `${at} kept: "taste" is not a core-only reason (security, frame)`,`${at} kept: its core-only reason cites nothing`,
    `${at} gone: ${a} draws no data-area="gone"`,`${at} inner: ${b} draws no data-area="inner"`,
    'card-section is declared but no dashboard area draws it','rare-list is declared but no dashboard area draws it']);
  const {SLOTS}=require('../../runtime/hooks/registry.ts'),status=require('../../runtime/hooks/rows/12-status.ts');
  const tree=new Map(spawnSync('git',['ls-files','--cached','--others','--exclude-standard','dashboard','runtime/hooks/dashboard'],{cwd:root,encoding:'utf8'}).stdout.split('\n')
    .filter(f=>f.endsWith('.tsx')).map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.deepEqual(areaFindings(status,SLOTS,tree),[],'every dashboard area is marked and decided, and every slot is drawn');
});

// Rule 8 (hook-coverage.md "The standing check"): a rule file's export in neither DECISIONS nor PLAIN,
// a stale or outside entry, a notice or core hook, a reason off the list or with no cite, a PLAIN kind
// off the list, a rows file with no coverage block and a request no decision names each fail; the
// console's own rows pass.
test('rule 8: the coverage check names each unlisted, stale or bad entry and each orphan hook',async()=>{
  const {coverageFindings}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/rules/coverage.mts')).href);
  const rules='runtime/x/rules.ts',sources=new Map([[rules,"export function decided() {}\nexport const shown = () => '';\nexport function unlisted() {}\nexport const BOUND = 3;\n"]]);
  const hooks={'a.req':{kind:'request'},'a.notice':{kind:'notice'},'b.req':{kind:'request'},'c.core':{kind:'request',core:true}};
  const files={'rows/01-tasks.ts':{HOOKS:{},RULE_FILES:[rules],PLAIN:{shown:'label',ghost:'read',decided:'helper'},DECISIONS:{
    ok:{at:rules+'#decided',hook:'a.req'},stale:{at:rules+'#gone',core:'game',cite:'the game'},outside:{at:'runtime/y.ts#f',core:'safety',cite:'runtime/x/rules.ts:1'},
    notice:{site:'runtime/x/rules.ts:1',hook:'a.notice'},core:{site:'runtime/x/rules.ts:2',hook:'c.core'},taste:{site:'runtime/gone.ts:3',core:'taste',cite:''}}},
    'rows/02-movement.ts':{HOOKS:{}}};
  const at='runtime/hooks/rows/01-tasks.ts';
  assert.deepEqual(coverageFindings(files,hooks,sources),[
    `${at} decision "stale": ${rules} exports no function gone`,`${at} decision "outside": runtime/y.ts#f names a file outside RULE_FILES`,
    `${at} decision "notice": names a.notice, a notice, which decides nothing`,`${at} decision "core": names c.core, which only core answers`,
    `${at} decision "taste": its site runtime/gone.ts:3 names no file of the tree`,
    `${at} decision "taste": core reason "taste" is not one of game, safety, call-budget, tier-table, integrity`,
    `${at} decision "taste": its core reason cites nothing`,`${at} PLAIN ghost: no rule file of rows/01-tasks.ts exports it`,
    `${at} PLAIN decided: kind "helper" is not one of label, read, validator, migration, format`,
    `${rules} exports unlisted, a decision with no hook and no core-only reason`,'runtime/hooks/rows/02-movement.ts exports no RULE_FILES, DECISIONS and PLAIN',
    'the hook b.req is named by no decision of its owner\'s DECISIONS']);
  const {ROW_FILES,HOOKS}=require('../../runtime/hooks/registry.ts');
  const tree=new Map(spawnSync('git',['ls-files','--cached','--others','--exclude-standard','runtime'],{cwd:root,encoding:'utf8'}).stdout.split('\n').filter(Boolean)
    .map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.deepEqual(coverageFindings(ROW_FILES,HOOKS,tree),[],"every owner's decision has a hook or a core-only reason");
});

// and: addon:check fails a row with no fixture, a fixture
// row its file lacks, or a request with no addonMayAsk, in every owner's row file, and the
// console's own movement rows pass.
test('the contract rule names a row with no fixture, a missing fixture row or no addonMayAsk',async()=>{
  const {contractFindings}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/cli/run/check.mts')).href);
  const sources=new Map([['e2e/table.spec.ts',"const rows=[\n['a.hook: fires once',async()=>{}],\n['b.hook: the row\\'s title',async()=>{}],\n];\n"]]);
  const files={'rows/02-movement.ts':{HOOKS:{'a.hook':{kind:'notice',fixture:'e2e/table.spec.ts#a.hook: fires once'},
    'b.hook':{kind:'request',addonMayAsk:false,fixture:"e2e/table.spec.ts#b.hook: the row's title"},
    'c.hook':{kind:'notice',fixture:'e2e/table.spec.ts#c.hook: not written'},
    'd.hook':{kind:'notice'},
    'e.hook':{kind:'notice',fixture:'e2e/missing.spec.ts#e.hook: anything'}},SLOTS:{}},
    'rows/04-targeting.ts':{HOOKS:{'f.hook':{kind:'request',fixture:'e2e/table.spec.ts#a.hook: fires once'}},
      SLOTS:{'g-slot':{fixture:'e2e/table.spec.ts#a.hook: fires once'}}}};
  const at='runtime/hooks/rows/';
  assert.deepEqual(contractFindings(files,sources),[`${at}02-movement.ts hook c.hook: e2e/table.spec.ts has no row "c.hook: not written"`,`${at}02-movement.ts hook d.hook: names no fixture row`,
    `${at}02-movement.ts hook e.hook: its fixture file e2e/missing.spec.ts is not in the tree`,
    `${at}04-targeting.ts hook f.hook: states no addonMayAsk`]);
  // A fixture file that does not parse runs none of its rows, so a title in it proves nothing.
  const broken=new Map([['e2e/table.spec.ts',"test('a.hook: fires once's',()=>{});\n"]]);
  assert.deepEqual(contractFindings({'rows/02-movement.ts':{HOOKS:{'a.hook':files['rows/02-movement.ts'].HOOKS['a.hook']},SLOTS:{}}},broken),
    [`${at}02-movement.ts hook a.hook: its fixture file e2e/table.spec.ts does not parse (',' expected.), so none of its rows runs`]);
  // A fixture file that requires a module the tree lacks throws at load, so it runs none of its rows
  // either; a require that resolves with the file's extension passes.
  const loads=new Map([['e2e/table.spec.ts',"const {a}=require('./helpers/gone.cjs');\nconst {b}=require('./helpers/here');\ntest('a.hook: fires once',()=>{});\n"],
    ['e2e/helpers/here.cjs','']]);
  assert.deepEqual(contractFindings({'rows/02-movement.ts':{HOOKS:{'a.hook':files['rows/02-movement.ts'].HOOKS['a.hook']},SLOTS:{}}},loads),
    [`${at}02-movement.ts hook a.hook: its fixture file e2e/table.spec.ts requires ./helpers/gone.cjs, which is not in the tree, so none of its rows runs`]);
  const {ROW_FILES}=require('../../runtime/hooks/registry.ts');
  const tree=new Map(spawnSync('git',['ls-files','--cached','--others','--exclude-standard','e2e','scripts','runtime'],{cwd:root,encoding:'utf8'}).stdout.split('\n').filter(Boolean)
    .map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.deepEqual(contractFindings({'rows/02-movement.ts':ROW_FILES['rows/02-movement.ts']},tree),[],'every movement row names a row that exists');
  // A table that builds its titles at run time from a template and its own strings
  // holds each title it can spell; a word the file lacks spells none.
  const built=new Map([['scripts/tests/reads.test.cjs',"const FILE='scripts/tests/reads.test.cjs';\nconst READS=[['r.hook','oldRead']];\n"+
    "for(const [hook,name] of READS)assert.equal(row.fixture,`${FILE}#${hook}: answers as ${name} did`);\n"]]);
  const reads=(title)=>({'rows/04-targeting.ts':{HOOKS:{'r.hook':{kind:'notice',fixture:`scripts/tests/reads.test.cjs#${title}`}},SLOTS:{}}});
  assert.deepEqual(contractFindings(reads('r.hook: answers as oldRead did'),built),[]);
  assert.deepEqual(contractFindings(reads('r.hook: answers as anyRead did'),built),
    [`${at}04-targeting.ts hook r.hook: scripts/tests/reads.test.cjs has no row "r.hook: answers as anyRead did"`]);
});

// and: the committed list matches the code, a row added without regenerating it makes the check
// fail, and the list names every hook, event, slot, setting kind and published export.
test('the hook list drifts with an unregenerated row, and names every row, kind and export',async()=>{
  const {listFindings}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/cli/run/check.mts')).href);
  const {hookList}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/cli/run/hook-list.mts')).href);
  const {ROW_FILES,HOOKS,SLOTS}=require('../../runtime/hooks/registry.ts'),{ADDON_KINDS}=require('../../runtime/settings/api.ts');
  assert.deepEqual(listFindings(root,ROW_FILES),[],'the committed list is the code\'s');
  const added={...ROW_FILES,'rows/14-addons.ts':{HOOKS:{...ROW_FILES['rows/14-addons.ts'].HOOKS,'fixture.added':{kind:'notice',part:'the add-on system (14)',answers:'many',
    fixture:'scripts/tests/addon-commands.test.cjs#AS19, AS24',receives:'nothing',returns:'nothing'}},SLOTS:{}}};
  assert.deepEqual(listFindings(root,added),['runtime/addons/HOOKS.md differs from the code; run node runtime/hooks/cli/hook-list.mts']);
  const list=hookList(root);
  for(const name of [...Object.keys(HOOKS),...Object.keys(SLOTS)])assert.ok(list.includes('`'+name+'`'),name);
  for(const kind of ADDON_KINDS)assert.ok(list.includes('`'+kind+'`'),kind);
  // Every exported name of both published modules, its api/ files and the kit, types included.
  const ts=require('typescript'),published=['runtime/hooks/addon-api.ts','dashboard/features/party/addon-kit.ts',
    ...fs.readdirSync(path.join(root,'runtime/hooks/api')).map(f=>'runtime/hooks/api/'+f)];
  for(const file of published){
    const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);
    for(const s of source.statements){
      const names=ts.isExportDeclaration(s)?(s.exportClause&&ts.isNamedExports(s.exportClause)?s.exportClause.elements.map(e=>e.name.text):[])
        :ts.getModifiers?.(s)?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&s.name?[s.name.text]:[];
      for(const name of names)assert.ok(list.includes(name),`${file} exports ${name}`);
    }
  }
});

// (0.4 part 3): an add-on asks only a row marked addonMayAsk, and names it as a string literal.
test('an ask of an unflagged or unknown row, or by a value, is a finding',async()=>{
  const {askFindings}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/rules/uses.mts')).href);
  const {HOOKS}=require('../../runtime/hooks/registry.ts');
  const file='runtime/addons/planted/index.ts';
  const sources=new Map([['runtime/hooks/addon-api.ts',''],[file,"import { ask, ask as read } from '../../hooks/addon-api.ts';\nimport * as api from '../../hooks/addon-api.ts';\n"+
    "ask('settings.read', {field: 'x'});\nread('settings.write', {changes: [], by: 'addon:planted'});\nconst name = 'skills.ready';\napi.ask(name);\nask('no.such');\n"]]);
  assert.deepEqual(askFindings(sources,HOOKS),[`${file}:4: ask names settings.write, which is not marked addonMayAsk: it writes or acts`,
    `${file}:6: ask names its row with a value, not a string literal, so the check cannot read which row it asks`,
    `${file}:7: ask names no.such, which the hook table does not declare`]);
});

// (0.2 "One check keeps it one module"): a catalog/14 function outside runtime/hooks/ fails unless the
// table of outside pieces lists its file or it sits in the add-on folder its behaviour names.
test('a catalog/14 function outside the module and the outside table is a finding',async()=>{
  const {moduleFindings}=await import(require('node:url').pathToFileURL(path.join(root,'runtime/hooks/rules/uses.mts')).href);
  const sources=new Map(['runtime/hooks/registry.ts','tools/build-runtime.mts','runtime/addons/hunt/index.ts','runtime/coordinator/status/activity.ts','dashboard/features/party/addon-jsx/jsx-runtime.ts'].map(f=>[f,'']));
  assert.deepEqual(moduleFindings([{id:'ADD-1',functions:['runtime/hooks/registry.ts#createRegistry','tools/build-runtime.mts#build','dashboard/features/party/addon-jsx/jsx-runtime.ts#jsx',
    'runtime/coordinator/status/activity.ts#addonLine']},{id:'HNT-1',addon:'hunt',functions:['runtime/addons/hunt/index.ts#tick']},{id:'ADD-2',functions:['runtime/addons/hunt/index.ts#tick']}],sources),
    ['runtime/coordinator/status/activity.ts: catalog/14 ADD-1 claims addonLine there, outside runtime/hooks/ and outside the add-on system\'s table of outside pieces (AS34)',
      'runtime/addons/hunt/index.ts: catalog/14 ADD-2 claims tick there, outside runtime/hooks/ and outside the add-on system\'s table of outside pieces (AS34)']);
});

// The runtime and dashboard modules list the same folders, the dashboard module only those that
// ship a section.
test('a folder with dashboard.tsx shows in both generated modules, one without in the runtime module only',()=>{
  const {installedModules}=require('../../runtime/hooks/build/installed.mts');
  const modules=installedModules([{folder:'with-section',dashboard:true,rows:false},{folder:'no-section',dashboard:false,rows:false}]);
  for(const folder of ['with-section','no-section'])assert.match(modules['runtime.ts'],new RegExp(`runtime/addons/${folder}/index\.ts`));
  assert.match(modules['dashboard.ts'],/runtime\/addons\/with-section\/dashboard\.tsx/);
  assert.doesNotMatch(modules['dashboard.ts'],/no-section/);
  assert.equal(JSON.parse(modules['package.json']).type,'module','the generated folder loads as ES modules');
});

// The folder name is the add-on's one name; the add-on manager shows it title-cased with its
// dashes as spaces.
test('the add-on manager shows a folder name title-cased, dashes as spaces',()=>{
  const {addonTitle}=require('../../runtime/hooks/dashboard/title.ts');
  assert.equal(addonTitle('boss-zones'),'Boss Zones');
  assert.equal(addonTitle('tank-hold'),'Tank Hold');
  assert.equal(addonTitle('pull2-mode'),'Pull2 Mode');
});

// Rules 10 to 13 land off until the merged head passes them; each names its
// planted breaks here, so the rule itself is proven before it is turned on.
const load=file=>import(require('node:url').pathToFileURL(path.join(root,file)).href);
const moduleOf=file=>file.startsWith('runtime/items/')?'10':file.startsWith('runtime/movement/')?'02':file.startsWith('runtime/events/')?'06':null;
test('rule 10: an unplaced, doubled or misowned game call, a bad closing and a missing door are findings',async()=>{
  const {actionFindings}=await load('runtime/hooks/rules/actions.mts');
  const files={'rows/10-items.ts':{HOOKS:{},ACTIONS:{'gold.donate':{events:['donate'],functions:['donate_gold'],door:'donate',args:'{gold}',bound:'b'},
    'look':{events:['cx'],functions:[],closed:'ZZ',cite:'x'},'stash':{events:['bank'],functions:[],closed:'CL',cite:''}}},
    'rows/02-movement.ts':{HOOKS:{},ACTIONS:{walk:{events:['move','bank'],functions:[],door:'walk',args:'{to}',bound:'b'}}}};
  const sources=new Map([['runtime/characters/call-budget.ts',"export function price(method) { switch (method) { case 'move': return 1; case 'tracker': return 50; } }\n"],
    ['runtime/items/api.ts','export function donate() {}\nexport type Grade = number;\n'],['runtime/movement/api/character.ts','export const step = () => 1;\n'],
    ['runtime/items/character/calls.ts','type Untyped = (...args: any[]) => any;\ndeclare const donate_gold: Untyped, auto_craft: Untyped;\n']]);
  const scan=[{file:'runtime/events/chat.ts',line:3,kind:'game-call',call:'donate_gold',owner:'06'},{file:'runtime/items/x.ts',line:1,kind:'socket-emit',call:'emit(donate)',owner:'10'}];
  assert.deepEqual(actionFindings(files,['donate','move','bank','cx','emotion'],scan,sources,moduleOf),[
    'runtime/hooks/rows/10-items.ts ACTIONS look: closed with "ZZ", which is not one of CL, SV, KY, AS, FW',
    'runtime/hooks/rows/10-items.ts ACTIONS stash: its closing code CL cites nothing',
    "runtime/hooks/rows/02-movement.ts ACTIONS walk: its door walk is not an export of owner 02's door",
    'the game event bank sits in 2 ACTIONS rows: runtime/hooks/rows/10-items.ts ACTIONS stash, runtime/hooks/rows/02-movement.ts ACTIONS walk',
    'the game event emotion (typed-adventureland) has no ACTIONS row','the game event tracker (runtime/characters/call-budget.ts price) has no ACTIONS row',
    'the game function auto_craft (runtime/items/character/calls.ts:2) has no ACTIONS row',
    'runtime/events/chat.ts:3: owner 06 calls the game function donate_gold, which runtime/hooks/rows/10-items.ts ACTIONS gold.donate gives to owner 10']);
});
test('rule 11: a door export with no row, a bad door-only row, a PLAIN read with no READS row and a report field outside StatusReport are findings',async()=>{
  const {readFindings}=await load('runtime/hooks/rules/reads.mts');
  const files={'rows/10-items.ts':{HOOKS:{},PLAIN:{itemGrade:'read',label:'label',fateOf:'read'},READS:{'items.grade':{side:'both',type:'number',door:'runtime/items/api.ts#itemGrade'}},
    DOOR_ONLY:{'runtime/items/api.ts#writeFate':{kind:'write'},'runtime/items/api.ts#apiKey':{closed:'CL',cite:'x'},'runtime/items/api.ts#odd':{kind:'helper'}},
    ACTIONS:{'gold.donate':{events:[],functions:[],door:'donate'}}}};
  const sources=new Map([['runtime/items/api.ts','export function itemGrade() {}\nexport function writeFate() {}\nexport const donate = () => 1, hidden = 2;\nexport type Fate = string;\n'],
    ['runtime/status/api.ts','export interface StatusReport extends Base { name: string }\n'],['runtime/status/base.ts','interface Base { seenAt?: number }\n']]);
  assert.deepEqual(readFindings(files,['name','seenAt','gold'],sources,moduleOf),[
    'runtime/hooks/rows/10-items.ts DOOR_ONLY runtime/items/api.ts#apiKey: closed with "CL"; a door export closes only as KY',
    'runtime/hooks/rows/10-items.ts DOOR_ONLY runtime/items/api.ts#odd: kind "helper" is not one of write, port, command',
    "runtime/items/api.ts#hidden: owner 10's door exports it, and runtime/hooks/rows/10-items.ts has no READS row, DOOR_ONLY row or offered action for it",
    'runtime/hooks/rows/10-items.ts PLAIN fateOf: a read with no READS row',
    'runtime/status/rules.ts characterFields gold: the published StatusReport (runtime/status/api.ts) has no member gold']);
  // A mapped type over table F names every field it holds, so the report and the table are one list.
  sources.set('runtime/status/api.ts','export type ReportFields = { [K in keyof typeof characterFields]?: unknown };\nexport interface StatusReport extends ReportFields { name: string }\n');
  assert.deepEqual(readFindings({},['name','seenAt','gold'],sources,moduleOf),[]);
});
test('rule 12: a hook with no side, an answer with no AddonContext and a signature type addon-api.ts does not export are findings',async()=>{
  const {viewFindings}=await load('runtime/hooks/rules/views.mts');
  const registry=["import type { Entity } from './entity.ts';","export interface AddonContext { side: string }","interface Hidden { x: number }",
    "export interface PublishedReads { 'a.read'(): Entity }","export interface Mover { name: string; answer(view: unknown, settings: unknown, ctx: AddonContext): void }",
    "export type OwnHook = 'b.own';","export interface Registration {","  hooks: {","    'a.ask'?(view: Hidden, settings: unknown): void;",
    "    'a.ok'?(view: unknown, settings: unknown, ctx: AddonContext): void;","    'a.late'?(view: unknown, to: unknown, settings: unknown, ctx: AddonContext): void;","    'a.movers'?: readonly Mover[];",
    "  } & { [hook in OwnHook]?: (view: unknown, settings: unknown) => unknown } & Partial<PublishedReads> & Partial<Record<string, (payload: unknown, settings: unknown, ctx: AddonContext) => void>>;","}"].join('\n')+'\n';
  const sources=new Map([['runtime/hooks/registry.ts',registry],['runtime/hooks/addon-api.ts',"export * from './api/14-addons.ts';\nexport type { Mover } from './registry.ts';\n"],
    ['runtime/hooks/api/14-addons.ts',"export type { AddonContext, PublishedReads, Registration } from '../registry.ts';\n"]]);
  const hooks={'a.ask':{kind:'request',side:'both'},'a.ok':{kind:'request',side:'character'},'a.late':{kind:'request',side:'character'},'a.movers':{kind:'request',side:'character'},'b.own':{kind:'request',side:'coordinator'},
    'a.read':{kind:'request',core:true,side:'both'},'a.heard':{kind:'notice'},'c.gone':{kind:'request',side:'both'}};
  assert.deepEqual(viewFindings(hooks,sources),['the hook a.heard names no side (character, coordinator or both)',
    'runtime/hooks/registry.ts:9 a.ask: the answer takes no AddonContext after its settings',
    'runtime/hooks/registry.ts:13 b.own: the answer takes no AddonContext after its settings',
    'runtime/hooks/registry.ts: Registration hooks declare no answer for c.gone',
    'runtime/hooks/registry.ts:9: a hook signature names the type Hidden, which runtime/hooks/addon-api.ts does not export',
    'runtime/hooks/registry.ts:13: a hook signature names the type OwnHook, which runtime/hooks/addon-api.ts does not export',
    'runtime/hooks/registry.ts:4: a hook signature names the type Entity, which runtime/hooks/addon-api.ts does not export']);
  // The console's own signatures name only types addon-api.ts exports.
  const {HOOKS}=require('../../runtime/hooks/registry.ts');
  const tree=new Map(spawnSync('git',['ls-files','--cached','--others','--exclude-standard','runtime'],{cwd:root,encoding:'utf8'}).stdout.split('\n')
    .filter(f=>/\.tsx?$/.test(f)).map(f=>[f,fs.readFileSync(path.join(root,f),'utf8')]));
  assert.deepEqual(viewFindings(HOOKS,tree).filter(f=>f.includes('does not export')),[]);
});
test('rule 13: a piece without the base, a list-view part with no row type and a setting kind the manager does not draw are findings',async()=>{
  const {pieceFindings}=await load('runtime/hooks/rules/pieces.mts');
  const kit=["export const ADDON_PLACES = { 'top-bar': ['views'], 'list-view': ['market:wts', 'market:wtb', 'market:ponty'] } as const;",
    "export interface AddonPieceBase { reload(): void }","export interface MarketRow { item: string }","interface PontyRow { item: string }",
    "export type AddonPieceProps<S> = { part: S } & AddonPieceBase;","export interface AddonDialogProps { close(): void }",
    "export interface AddonListRows { 'market:wts': MarketRow; 'market:ponty': PontyRow }"].join('\n')+'\n';
  const manager="function control(setting) { switch (setting.kind) { case 'boolean': return 1; case 'monsters': case 'items': return 2; } }\n";
  assert.deepEqual(pieceFindings(['boolean','monsters','items','records'],new Map([['dashboard/features/party/addon-kit.ts',kit],['runtime/hooks/dashboard/settings-page.tsx',manager]])),[
    'dashboard/features/party/addon-kit.ts:6: AddonDialogProps does not take AddonPieceBase, so its pieces lack the powers every piece gets',
    'dashboard/features/party/addon-kit.ts AddonListRows: the list-view part market:wtb names no published row type',
    "dashboard/features/party/addon-kit.ts:7: the list-view part market:ponty's row type PontyRow is not a type dashboard/features/party/addon-kit.ts exports",
    'runtime/hooks/dashboard/settings-page.tsx: the add-on manager draws no records setting (no case "records" in its switch on the kind)']);
});
