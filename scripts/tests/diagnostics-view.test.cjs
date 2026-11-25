// The Diagnostics view and button (dashboard/features/party/diagnostics-dialog.tsx). Failure list:
// 1. Opening the view marks records read, so the badge clears with nothing read (the record icon's
//    old behaviour: it lit only while a save was unread and the view's open cleared it).
// 2. The button leaves the header when nothing is unread, so the player has no way back.
// 3. A record cannot be marked read on its own, or "Mark all as read" misses one.
// 4. Routine records show on their own, beside the errors, before "Show all records" is on.
// The view's own setup (a React tree under the query client and the page address) shares no run
// with another test, so it is its own file.
const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
const {QueryClientProvider}=load.dashboardRequire('@tanstack/react-query');
global.IS_REACT_ACT_ENVIRONMENT=true;
const tags=new Proxy({},{get:(_,key)=>String(key)});
const view=load('diagnostics-dialog.tsx',{'@/components/ui/*':tags,'@/components/ui/button':{buttonVariants:()=>''},'lucide-react':tags,
 '../../../runtime/hooks/dashboard/slots':{useAddonSlots:()=>({rings:[]}),addonRing:()=>null}});
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');

test('the Diagnostics view lists only alerts, marks nothing read on open, and marks each one read on request',async()=>{
 const listeners={},previous=globalThis.window;
 globalThis.window={location:{hash:'#diagnostics',pathname:'/',search:''},addEventListener:(name,f)=>{listeners[name]=f;},removeEventListener(){},setInterval:()=>0,clearInterval(){}};
 const client=load('query-cache.tsx').createDashboardClient();
 const alerts=[{id:'W/1-1-stuck',subject:'W',trigger:'stuck',at:2000},{id:'group:W/1-2-task-failed',subject:'group:W',trigger:'task-failed',at:1000}];
 const marked=[];
 const model={alerts,read:new Set([alerts[1].id]),unread:[alerts[0]],markRead:ids=>marked.push([...ids])};
 let tree;
 try{
  await act(async()=>{tree=create(React.createElement(QueryClientProvider,{client},React.createElement(view.DiagnosticsDialog,{characters:['W'],alerts:model})));});
  assert.deepEqual(marked,[],'opening the view marks nothing read');
  const rows=tree.root.findAll(node=>node.type==='article');
  assert.deepEqual(rows.map(row=>row.props['aria-label']),alerts.map(alert=>alert.id),'each alert is one row, newest first');
  assert.equal(rows[0].props['data-unread'],true);assert.equal(rows[1].props['data-unread'],undefined);
  assert.match(text(rows[0]),/Stuck/);assert.match(text(rows[1]),/Task failed/);
  const mark=row=>row.findAll(node=>node.type==='button'&&text(node)==='Mark as read');
  assert.equal(mark(rows[1]).length,0,'a read alert offers no Mark as read');
  await act(async()=>mark(rows[0])[0].props.onClick());
  assert.deepEqual(marked,[[alerts[0].id]]);
  await act(async()=>tree.root.find(node=>node.type==='button'&&text(node)==='Mark all as read').props.onClick());
  assert.deepEqual(marked[1],[alerts[0].id],'Mark all as read marks every unread alert');
  // The routine logs wait behind "Show all records", which starts off.
  const all=tree.root.find(node=>node.type==='input'&&node.props.type==='checkbox');
  assert.equal(all.props.checked,false);
  assert.equal(tree.root.findAll(node=>node.props.role==='tablist').length,0,'no ring log shows while Show all is off');
  await act(async()=>all.props.onChange({target:{checked:true}}));
  assert.equal(tree.root.findAll(node=>node.props.role==='tablist').length,1);
  assert.equal(tree.root.findAll(node=>node.type==='article'&&node.props['data-unread']!==undefined).length,0);
 }finally{if(tree)await act(async()=>tree.unmount());client.clear();globalThis.window=previous;}
 // The button stays with nothing unread and counts what is.
 const button=async n=>{let drawn;await act(async()=>{drawn=create(React.createElement(view.DiagnosticsButton,{unread:n}));});return drawn.root;};
 const none=await button(0),three=await button(3);
 assert.equal(none.findByType('a').props['aria-label'],'Diagnostics');
 assert.equal(none.findAll(node=>node.props['data-unread']).length,0);
 assert.equal(text(three.find(node=>node.props['data-unread'])),'3');
});

// v1.5.0 kept a read time, a number, under `party-ui:diagnostics-read`. A browser that opened that
// view still holds it, and the dashboard drew nothing until the read marks moved to their own key.
test('the read marks start empty in a browser that holds v1.5.0\'s read time',async()=>{
 const previous={window:globalThis.window,localStorage:globalThis.localStorage};
 const stored=new Map([['party-ui:diagnostics-read','1795345432687']]);
 globalThis.localStorage={getItem:key=>stored.has(key)?stored.get(key):null,setItem:(key,value)=>stored.set(key,String(value))};
 globalThis.window={location:{hash:'',pathname:'/',search:''},addEventListener(){},removeEventListener(){},dispatchEvent(){},setInterval:()=>0,clearInterval(){}};
 const client=load('query-cache.tsx').createDashboardClient();
 let model,tree;
 const Probe=()=>{model=view.useDiagnosticsAlerts(undefined);return null;};
 try{
  await act(async()=>{tree=create(React.createElement(QueryClientProvider,{client},React.createElement(Probe)));});
  assert.equal(model.read.size,0);
  assert.equal(stored.get('party-ui:diagnostics-read'),'1795345432687','the old key is left as it was');
 }finally{if(tree)await act(async()=>tree.unmount());client.clear();globalThis.window=previous.window;globalThis.localStorage=previous.localStorage;}
});
