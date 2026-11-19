const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const React=require('../../dashboard/node_modules/react'), {create,act}=require('../../dashboard/node_modules/react-test-renderer'),ts=require('../../node_modules/typescript');
global.IS_REACT_ACT_ENVIRONMENT=true;
function load(file){const context={exports:{},require(name){
 if(name==='react')return React;
 if(name==='./item-selection')return load('item-selection');
 if(name==='./stand-capacity')return require('../../dashboard/features/party/stand-capacity.ts');
 if(name==='react/jsx-runtime')return require('../../dashboard/node_modules/react/jsx-runtime');
 if(name==='@tanstack/react-query')return {useQuery:()=>({data:{gold:1}}),useQueryClient:()=>({})};
 if(name==='./query-cache')return {useVisible:()=>true,useReferenceRevision:()=>'0',useReferenceRetry:()=>{},pollOf:()=>({})};
 if(name==='./mail-query')return {useInbox:()=>({})};
 if(name==='./query-actions')return {usePartyAction:()=>({})};
 if(name==='../../../runtime/items/api.ts')return require('../../runtime/items/api.ts');
 return new Proxy({}, {get:(_,key)=>String(key)});
}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('dashboard/features/party/'+file+'.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;}
const text=n=>n.children.map(c=>typeof c==='string'?c:text(c)).join('');
const findButton=(view,label)=>view.root.findAll(n=>n.type==='Button'||n.type==='button').find(n=>text(n)===label);
test('mail filters attachments, inspection leaves draft open, and clear retains the message',async()=>{
 const {SendMailDialog}=load('send-mail-dialog');let view,closed=0,inspected;
 const item=(slot,name)=>({slot,item:{name},meta:{definition:{name},sprite:{url:'/item.png'}}});
 await act(async()=>view=create(React.createElement(SendMailDialog,{open:true,onOpenChange:()=>closed++,onCount(){},onSend(){},onInspect:e=>inspected=e,merchant:{name:'M',items:[item(0,'Sword'),item(1,'Coat')]},bank:null,bankbois:[],catalog:[]})));
 await act(async()=>view.root.findByProps({'aria-label':'Search attachments'}).props.onChange({target:{value:'Sword'}}));
 assert.equal(view.root.findAllByProps({title:'Coat'}).length,0);
 await act(async()=>view.root.findByProps({title:'Sword'}).props.onClick());
 await act(async()=>view.root.findByProps({title:'View attachment details'}).props.onClick());
 assert.equal(closed,0);assert.equal(inspected.item.name,'Sword');
 await act(async()=>findButton(view,'Clear attachment').props.onClick());
 assert.equal(view.root.findAllByProps({title:'View attachment details'}).length,0);
 assert.equal(view.root.findByProps({'aria-label':'Search attachments'}).props.value,'Sword');
 await act(async()=>view.unmount());
});
test('first BankBoi creation waits for confirmation, reports failures, and blocks duplicate submission',async()=>{
 const {BankSheet}=load('bank-sheet');let view,calls=0,finish;
 const props={open:true,bankboiPrefix:'Bank',onOpenChange(){},bank:null,bankbois:[],bankboiQueue:[],vaults:[],withdrawals:{},standListings:[],npcSaleMarks:[],catalog:[],buyable:[],priceHistory:{},onCreateBankboi:()=>{calls++;return new Promise(resolve=>finish=resolve)}};
 await act(async()=>view=create(React.createElement(BankSheet,props)));
 await act(async()=>findButton(view,'Create bankboi').props.onClick());assert.equal(calls,0);
 assert.ok(view.root.findAllByType('DialogDescription').some(n=>text(n).includes('reserve the final 7 slots')));
 const confirm=findButton(view,'Create BankBoi');await act(async()=>{confirm.props.onClick();confirm.props.onClick()});assert.equal(calls,1);
 await act(async()=>finish('Bank0'));
 assert.equal(view.root.findAllByType('Dialog').find(n=>n.props.open===true)?.props.open,true);
 await act(async()=>view.unmount());
});

// One update poller at its `dashboardPolls` row, and the elixir countdown on the status
// row's one display clock.
test('the console updates poll once a period',async t=>{
 // React Query polls only where a window exists, and reads that when it first loads.
 global.window??=new EventTarget();
 const {load:loadModule,queryRoot}=require('./helpers/dashboard-query-module.cjs');
 const {polls}=loadModule('query-cache.tsx');
 // Updates: one mounted updater reads once at mount and once per poll period, never twice.
 const {ConsoleUpdateIndicator}=loadModule('console-updates.tsx');
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});
 const reads=[],previousFetch=global.fetch,previousDocument=global.document;
 global.fetch=async url=>{if(String(url).includes('console-update'))reads.push(String(url));return {ok:true,status:200,json:async()=>({available:false}),text:async()=>'{"available":false}'};};
 global.document=Object.assign(new EventTarget(),{visibilityState:'visible',hidden:false});
 const {client,wrap}=queryRoot();let view;
 try {
  await act(async()=>{view=create(wrap(React.createElement(ConsoleUpdateIndicator,{open(){}})));});
  await act(async()=>{await new Promise(resolve=>setImmediate(resolve));});
  const mounted=reads.length;assert.equal(mounted,1,'one read at mount');
  await act(async()=>{t.mock.timers.tick(polls.updates.interval);await new Promise(resolve=>setImmediate(resolve));});
  assert.equal(reads.length,mounted+1,'one read for one poll period');
 } finally {await act(async()=>view?.unmount());client.clear();global.fetch=previousFetch;global.document=previousDocument;t.mock.timers.reset();}
});
test('the elixir countdown reads the shared display clock and nothing of its own',async()=>{
 const {load:loadModule}=require('./helpers/dashboard-query-module.cjs');
 const listeners=new Set();let now=1000000;
 const {EquipSlot}=loadModule('equip-slot.tsx',{
  '@/hooks/use-clock':{useClock:()=>React.useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>now,()=>0)},
  '@/components/ui/*':new Proxy({},{get:(_,key)=>String(key)}),'./query-actions':{usePartyAction:()=>({})},
 });
 const equipped={slot:'elixir',item:{name:'elixirluck',expires:new Date(now+3000).toISOString()},meta:{definition:{name:'Luck Elixir'}}};
 let view;
 try {
  await act(async()=>{view=create(React.createElement(EquipSlot,{slot:'elixir',equipped,autoUpgradeMarks:{},statScrollInventory:{}}));});
  const label=()=>view.root.findAll(node=>node.type==='span'&&/^\d+[smhd]$/.test(String(node.children[0]))).map(node=>node.children[0]);
  const title=()=>view.root.findAll(node=>node.props.title&&node.props['aria-label']==='Equipped elixir').map(node=>node.props.title);
  assert.deepEqual(label(),['3s']);
  await act(async()=>{now+=1000;listeners.forEach(listener=>listener());});
  assert.deepEqual(label(),['2s'],'the label moves when the shared clock ticks');
  assert.equal(title().length>0,true);
 } finally {await act(async()=>view?.unmount());}
});

// The Escape button's burst guard, planted click gaps. The play half is the tasks
// owner's e2e spec (e2e/live-movement-owner.spec.ts).
test('a burst aimed at Escape never resumes, and a press after the burst acts',()=>{
 const file='dashboard/features/party/escape-control.tsx';
 const code=require('esbuild').transformSync(fs.readFileSync(file,'utf8'),{loader:'tsx',format:'cjs'}).code;
 const m={exports:{}};new Function('module','exports','require',code)(m,m.exports,()=>new Proxy({},{get:()=>()=>null}));
 const guard=m.exports.createBurstGuard();
 // Three presses aimed at Escape, gaps 100 and 150, then the button changes to Resume.
 assert.equal(guard.ignored(0),false);assert.equal(guard.ignored(100),false);assert.equal(guard.ignored(250),false);
 guard.changed();
 assert.equal(guard.ignored(300),true,'a press within the burst after the change does not resume');
 assert.equal(guard.ignored(440),true,'the burst keeps its longest gap');
 assert.equal(guard.ignored(1000),false,'a press after the burst acts');
 // A single press before the change has no gap, so the next press acts.
 const single=m.exports.createBurstGuard();single.ignored(0);single.changed();
 assert.equal(single.ignored(5),false);
 // Resume at 60 acts, Escape at 660 starts a new burst, and Resume at 700 after the change acts,
 // though its gap is shorter than the 600 between the first two presses.
 const cycle=m.exports.createBurstGuard();
 assert.equal(cycle.ignored(0),false);cycle.changed();
 assert.equal(cycle.ignored(60),false,'the Resume past the burst acts');
 cycle.reset();
 assert.equal(cycle.ignored(660),false);cycle.changed();
 assert.equal(cycle.ignored(700),false,'a later Resume is not held by the gap before the escape');
 // The button back on Escape with no press seen here (another browser resumed) clears the burst.
 const elsewhere=m.exports.createBurstGuard();
 elsewhere.ignored(0);elsewhere.ignored(500);elsewhere.changed();elsewhere.reset();
 assert.equal(elsewhere.ignored(700),false,'an Escape press after the reset acts');
});
// How a raw value prints in the details views.
test('displayValue prints None for null, joins lists, and keeps objects as JSON',()=>{
 const {displayValue}=load('display-value');
 assert.equal(displayValue(null),'None');
 assert.equal(displayValue([1,null,'a']),'1, None, a');
 assert.equal(displayValue({a:1}),'{"a":1}');
 assert.equal(displayValue(undefined),'');
});
// A tinted cell the last frame did not draw leaves the canvas's cache.
test('endMapSpriteFrame drops the tinted cells the frame did not draw',()=>{
 let made=0;const ctx={save(){},restore(){},transform(){},drawImage(){},globalAlpha:1};
 const paint={drawImage(){},fillRect(){}};
 const context={exports:{},document:{createElement:()=>(made++,{getContext:()=>paint})},require(name){
  if(name==='./cached-map-image')return {cachedMapImage:()=>({complete:true,naturalWidth:8})};
  throw Error('unexpected import '+name);
 }};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('dashboard/features/party/draw-map-sprites.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 const {drawMapSprites,endMapSpriteFrame}=context.exports;
 const layer=tint=>({url:'/a.png',sx:0,sy:0,sw:4,sh:4,dx:0,dy:0,alpha:1,transform:[1,0,0,1,0,0],tint});
 const frame=tint=>{drawMapSprites(ctx,[layer(tint)]);endMapSpriteFrame(ctx);};
 frame(0xff0000);frame(0xff0000);
 assert.equal(made,1,'a cell drawn in consecutive frames stays cached');
 frame(0x00ff00);frame(0xff0000);
 assert.equal(made,3,'the red cell left the cache in the frame that drew only green');
});
