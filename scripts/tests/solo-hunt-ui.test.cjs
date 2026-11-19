const test=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {QueryClientProvider}=load.dashboardRequire('@tanstack/react-query');
const {createDashboardClient}=load('query-cache.tsx');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
const {FarmingModeControl}=load('farming-mode-control.tsx',{
 '@/components/ui/dialog':Object.fromEntries(['Dialog','DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(name=>[name,props=>React.createElement('section',props)])),
 '@/components/ui/checkbox':{Checkbox:props=>React.createElement('input',{...props,type:'checkbox'})}});
global.IS_REACT_ACT_ENVIRONMENT=true;
// The control's add-on slots read the query client, so every render sits under one.
const client=createDashboardClient();
const inClient=props=>React.createElement(QueryClientProvider,{client},React.createElement(FarmingModeControl,props));
// The two mode rows' core entries with their declared buttons (runtime/hooks/core.ts).
const entries=slot=>require('../../runtime/hooks/core.ts').coreRegistrations.flatMap(r=>(r.slots??[]).filter(s=>s.slot===slot).map(s=>({mode:s.mode,addon:r.name,button:s.button})));
test('following keeps saved Hunt selected, allows saved mode edits while keeping inherited settings read-only',async()=>{
 let selected;
 const props={combatEntries:entries('combat-mode'),targetEntries:entries('target-mode'),combatMode:'auto',targetMode:'hunt',effectiveTarget:'farming',effectiveMode:'default',followingLeader:'W',settingsOwner:'W',blacklist:{rat:{at:1,deaths:1}},catalog:[],onSelect(mode){selected=mode},onClearBlacklist:async()=>{},onHuntSettingsSave:async()=>{}};
 let tree;
 await act(async()=>{tree=create(inClient(props))});
 await act(async()=>tree.root.findAllByType('button').find(b=>b.props['aria-expanded']!==undefined).props.onClick());
 const buttons=tree.root.findAllByType('button').filter(b=>b.props['aria-pressed']!==undefined);
 assert.equal(buttons.length,5); assert.ok(buttons.every(b=>!b.props.disabled));
 assert.equal(buttons.find(b=>b.children.includes('Hunt')).props['aria-pressed'],true);
 await act(async()=>buttons.find(b=>b.children.includes('Scatter')).props.onClick());
 assert.deepEqual(selected,{combatMode:'scatter'});
 assert.match(JSON.stringify(tree.toJSON()),/Copy leader/);
 assert.match(JSON.stringify(tree.toJSON()),/Used when Follow is off/);
 assert.ok(tree.root.findAllByType('input').filter(i=>i.props.type==='number').every(i=>i.props.disabled));
 const clear=tree.root.findAllByType('button').filter(b=>b.children.includes('Clear')||b.children.includes('Clear all'));
 assert.ok(clear.length); assert.ok(clear.every(b=>b.props.disabled));
 await act(async()=>tree.update(inClient({...props,followingLeader:undefined,effectiveTarget:'hunt',settingsOwner:'R'})));
 assert.ok(tree.root.findAllByType('button').filter(b=>b.props['aria-pressed']!==undefined).every(b=>!b.props.disabled));
 // With Follow off the Hunt settings belong to this character: the number inputs and Clear buttons unlock.
 assert.ok(tree.root.findAllByType('input').filter(i=>i.props.type==='number').every(i=>!i.props.disabled),'a number input stayed read-only after Follow went off');
 const cleared=tree.root.findAllByType('button').filter(b=>b.children.includes('Clear')||b.children.includes('Clear all'));
 assert.ok(cleared.length); assert.ok(cleared.every(b=>!b.props.disabled),'a Clear button stayed disabled after Follow went off');
 await act(async()=>tree.unmount());
});
