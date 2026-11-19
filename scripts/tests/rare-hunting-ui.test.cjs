const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
const {farmingAreas,defaultPhoenixOrder,defaultHuntSettings}=require('../../runtime/hunting/api.ts');
global.IS_REACT_ACT_ENVIRONMENT=true;
// The real components render through react-test-renderer. The ui kit, the icons and the leaf
// views each component draws render as tags named after their export.
const tags=new Proxy({},{get:(_,key)=>String(key)});
const stubs={'@/components/ui/*':tags,'lucide-react':tags,'./sprite-crop':tags,'./sprite':tags,'./farming-area-preview':tags,
  './monster-spawns':tags,'./passive-hunting-menu':tags};
const {FarmingAreaPicker}=load('farming-area-picker.tsx',stubs),{MonsterFocusPicker}=load('monster-focus-picker.tsx',stubs);
const {FarmingModeControl}=load('farming-mode-control.tsx',stubs),{HuntSettingsControl,RelocationControl}=load('hunt-settings-control.tsx',stubs);
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
async function mount(Component,props){
  let view;await act(async()=>{view=create(React.createElement(Component,props));});
  return {root:()=>view.root,unmount:()=>act(async()=>view.unmount())};
}
const badge=button=>button.find(n=>n.type==='span'&&n.props.className?.includes('absolute')).props.children;
const start=view=>view.root().find(n=>n.type==='Button'&&text(n).includes('Start Phoenix patrol'));

test('Phoenix picker preselects screenshot order and preserves a valid saved custom order',async()=>{
  const boxes=[['main',708,-300,1668,-86],['main',378,1686,904,1920],['main',-1358,-118,-1010,1680],['halloween',-166,453,182,808],['cave',-375,-1287,14,-1041]];
  const catalog=[{id:'phoenix',locations:boxes.map(([map,...boundary])=>({map,boundary,x:(boundary[0]+boundary[2])/2,y:(boundary[1]+boundary[3])/2}))}];
  const areas=farmingAreas(catalog,['phoenix']);
  for(const saved of [[],[areas[0].id],areas.map(a=>a.id).reverse()]) {
    const view=await mount(FarmingAreaPicker,{catalog,ids:['phoenix'],radius:400,phoenixRouteOrder:saved,override:false,busy:false,onClose(){},onStart:async()=>{}});
    try {
      const expected=saved.length===5?saved:defaultPhoenixOrder(areas);
      view.root().findAllByType('button').forEach((b,i)=>assert.equal(badge(b),expected.indexOf(areas[i].id)+1));
      assert.equal(start(view).props.disabled,false);
    } finally { await view.unmount(); }
  }
});
test('Phoenix picker numbers click order, renumbers removal, requires all five and saves exact order',async()=>{
  const locations=Array.from({length:5},(_,i)=>({map:`map${i}`,x:0,y:0,boundary:[-20,-20,20,20]}));
  const catalog=[{id:'phoenix',name:'Phoenix',locations}];let saved;
  const view=await mount(FarmingAreaPicker,{catalog,ids:['phoenix'],radius:400,override:true,busy:false,onClose(){},onStart:async(...args)=>saved=args});
  try {
    const buttons=()=>view.root().findAllByType('button');
    const click=i=>act(async()=>buttons()[i].props.onClick());
    // The default order holds every region, so the player clears it to pick their own.
    await act(async()=>view.root().find(n=>n.type==='Button'&&text(n).startsWith('Clear order')).props.onClick());
    assert.equal(start(view).props.disabled,true);
    for(const i of [2,0,4,1,3])await click(i);
    assert.equal(start(view).props.disabled,false);
    assert.equal(badge(buttons()[2]),1);assert.equal(badge(buttons()[3]),5);
    await click(0);assert.equal(start(view).props.disabled,true);assert.equal(badge(buttons()[4]),2);
    await click(0);await act(async()=>start(view).props.onClick());
    const all=farmingAreas(catalog,['phoenix']);assert.deepEqual(Array.from(saved[1]),[2,4,1,3,0].map(i=>all[i].id));
    assert.equal(saved[0].id,all[2].id);
  } finally { await view.unmount(); }
});
test('Fairy stays searchable but only exposes an explanation, never a focus toggle',async()=>{
  let changes=0;
  const view=await mount(MonsterFocusPicker,{monsters:[{id:'tinyp',name:'Fairy'}],selected:[],priorities:{},onChange:()=>changes++,onPriorityChange(){}});
  try {
    const button=view.root().find(n=>n.type==='button'&&n.props['aria-disabled']==='true');
    await act(async()=>button.props.onClick());assert.equal(changes,0);
    assert.ok(view.root().findAll(n=>n.props.role==='status').some(n=>text(n).includes('Passively hunt fairy')));
  } finally { await view.unmount(); }
});
test('passive menu forwards independent rule patches without replacing other settings',async()=>{
  const writes=[];
  const view=await mount(FarmingModeControl,{policy:'auto',effectiveMode:'default',blacklist:{},catalog:[],passiveRareHunts:{tinyp:false,phoenix:true},
    combatEntries:[],targetEntries:[],combatMode:'default',targetMode:'default',settingsOpen:true,onSettingsOpenChange(){},onSelect(){},
    onClearBlacklist:async()=>{},onRareChange:async patch=>writes.push(patch)});
  try {
    const menu=view.root().findByType('PassiveHuntingMenu');
    assert.equal(menu.props.settings.rules.phoenix.enabled,true);
    const patch={rules:{tinyp:{enabled:true}}};await act(async()=>menu.props.onSave(patch));
    assert.deepEqual(writes,[patch]);assert.equal(view.root().findByType('PassiveHuntingMenu').props.settings.rules.phoenix.enabled,true);
  } finally { await view.unmount(); }
});

// Moved relocation to its own control, so the hunt settings hold the two blacklist rules.
test('Hunt settings default enabled, save thresholds, reject invalid values and preserve disabled thresholds',async()=>{
  const saved=[],props={value:{...defaultHuntSettings},onSave:async patch=>{saved.push(patch);Object.assign(props.value,patch);}};
  let view;await act(async()=>{view=create(React.createElement(HuntSettingsControl,props));});
  const rerender=()=>act(async()=>view.update(React.createElement(HuntSettingsControl,{...props,value:{...props.value}})));
  const checks=()=>view.root.findAllByType('Checkbox'),input=()=>view.root.findByProps({'aria-label':'Deaths before blacklisting'});
  try {
    assert.equal(checks().length,2);assert.ok(checks().every(n=>n.props.checked));
    assert.equal(input().props.value,'1');
    await act(async()=>input().props.onChange({target:{value:'3'}}));
    await act(async()=>input().props.onBlur());assert.equal(saved.at(-1).deathThreshold,3);await rerender();
    await act(async()=>checks()[0].props.onCheckedChange(false));await rerender();
    assert.equal(input().props.disabled,true);assert.equal(input().props.value,'3');
    await act(async()=>checks()[0].props.onCheckedChange(true));await rerender();
    await act(async()=>input().props.onChange({target:{value:'0'}}));
    const before=saved.length;await act(async()=>input().props.onBlur());assert.equal(saved.length,before);
    assert.ok(view.root.findAll(n=>n.props.role==='alert').length>0);
  } finally { await act(async()=>view.unmount()); }
});

test('the relocation switch is on unless saved false, saves its change and shows a refused save',async()=>{
  const saved=[];let refuse=false;
  const onSave=async on=>{saved.push(on);if(refuse)throw new Error('Writer refused the change');};
  let view;await act(async()=>{view=create(React.createElement(RelocationControl,{value:undefined,onSave}));});
  const box=()=>view.root.findByType('Checkbox'),rerender=value=>act(async()=>view.update(React.createElement(RelocationControl,{value,onSave})));
  try {
    assert.equal(box().props.checked,true,'an unsaved switch is on');
    await rerender(false);assert.equal(box().props.checked,false);
    await rerender(true);assert.equal(box().props.checked,true);
    await act(async()=>box().props.onCheckedChange(false));assert.deepEqual(saved,[false]);
    assert.equal(view.root.findAll(n=>n.props.role==='alert').length,0);
    refuse=true;await act(async()=>box().props.onCheckedChange(true));
    assert.match(text(view.root.findByProps({role:'alert'})),/Writer refused the change/);
  } finally { await act(async()=>view.unmount()); }
});
