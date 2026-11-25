const {scenarioTable}=require('./fixtures/scenarios.cjs'),test=require('node:test'),assert=require('node:assert/strict'),loadModule=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
global.window=new EventTarget();
const preferences=new Map();
global.localStorage={getItem:key=>preferences.get(key)??null,setItem:(key,value)=>preferences.set(key,String(value))};
const stubs={'@base-ui/react/menu':{Menu:new Proxy({},{get:(_,key)=>'LuckyMenu'+String(key)})},'./query-actions':{usePartyAction:()=>({}),performAction:async()=>undefined},
 './merchant-visit-control':{MerchantVisitControl:()=>null},'@/components/ui/*':new Proxy({},{get:(_,key)=>String(key)})};
const load=name=>loadModule(name+'.tsx',stubs);
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
const {InventoryPanel}=load('inventory-panel'),{EquipSlot}=load('equip-slot');
function props(type){const entry={slot:0,item:{name:'test'},meta:{definition:{name:'Test',type,stat:type==='weapon'?1:0},sprite:null}};return {character:{name:'M',ctype:'merchant',items:[entry],slots:{},seenAt:1},characters:[{name:'M',seenAt:1},{name:'F',seenAt:1}],merchant:'M',marked:[],merchantMarked:[],autoItemMarks:{},autoUpgradeMarks:{},allAutoUpgradeMarks:{},merchantDeliveries:{},standListings:[],autoNpcSales:{},autoStandMarks:{},buyable:[],catalog:[],priceHistory:{},upgradeMarks:[],statScrollMarks:[],statScrollInventory:{},compoundGroups:[],autoCompoundMarks:[],allAutoCompoundMarks:{},autoExchanges:{}};}
// The e2e specs (lucky-slot-lock, console) drive the menu paths: opening the lucky slot data, the
// next-slot marker label and a Clear all marks click. These rows hold what no e2e reaches.
const {wrap}=loadModule.queryRoot();
const mount=async element=>{let view;await act(async()=>view=create(wrap(element)));return view;};
const item=(view,label)=>view.root.findAllByType('LuckyMenuItem').find(n=>text(n)===label);
scenarioTable('item action menus show the choices only a component reaches',null,[
 ['an occupied lucky slot offers item details, which selects the entry without the large inventory banner',async()=>{
  const p=props('weapon'),selected=[];p.onSelect=entry=>selected.push(entry);
  const view=await mount(React.createElement(InventoryPanel,p));
  try{
   const trigger=view.root.findAllByType('TooltipTrigger').find(n=>n.props.render?.props['aria-label']==='Test').props.render;
   await act(async()=>trigger.props.onClick({currentTarget:{}}));assert.equal(selected.length,0);
   assert.equal(item(view,'Show item details').props.disabled,false);
   await act(async()=>item(view,'Show item details').props.onClick());assert.deepEqual(selected,[p.character.items[0]]);
   assert.equal(view.root.findByType('LuckyMenuRoot').props.open,false);
   assert.ok(!view.root.findAllByType('button').some(n=>text(n).includes('View testing statistics')));
   assert.ok(!view.root.findAllByType('ContextMenuItem').some(n=>text(n)==='Item details'));
  }finally{await act(async()=>view.unmount());}
 }],
 ['an empty next-test slot disables Show item details',async()=>{
  const p=props('weapon');p.character.items=[];let opened=0;p.onLuckySlot=()=>opened++;
  const view=await mount(React.createElement(InventoryPanel,p));
  try{
   const marker=view.root.findAllByType('TooltipTrigger').find(n=>n.props.render?.props['aria-label']?.includes('Open lucky slot options'));
   await act(async()=>marker.props.render.props.onClick({currentTarget:{}}));assert.equal(opened,0);
   assert.equal(view.root.findByType('LuckyMenuRoot').props.open,true);
   assert.equal(item(view,'Show item details').props.disabled,true);
  }finally{await act(async()=>view.unmount());}
 }],
 ['overlapping marks share one clear footer, and the active auto mark action cannot toggle off',async()=>{
  const p=props('weapon'),marked=p.character.items[0].item;
  p.marked=[{slot:0,item:marked}];p.autoItemMarks={'test@+0':'bank'};p.upgradeMarks=[{slot:0,item:marked,tiers:1}];p.autoUpgradeMarks={'test@+0':1};
  p.character.items[0].meta.upgradeable=true;p.character.items[0].meta.definition.upgrade={};
  const view=await mount(React.createElement(InventoryPanel,p));
  try{
   const entries=view.root.findAllByType('ContextMenuItem');
   assert.equal(entries.filter(n=>text(n)==='Clear all marks').length,1);
   assert.equal(entries.find(n=>text(n)==='Auto mark for bank').props.disabled,true);
   assert.ok(!entries.some(n=>/^(Unmark|Remove .*mark|Stop auto|Disable auto)/.test(text(n))));
  }finally{await act(async()=>view.unmount());}
 }],
]);
test('equipped marks use the same clear footer',async()=>{
 const p=props('weapon'),item=p.character.items[0].item,calls=[];let view;
 try{await act(async()=>view=create(React.createElement(EquipSlot,{slot:'mainhand',equipped:p.character.items[0],mark:{slot:'mainhand',equipped:true,item,tiers:1},autoUpgradeMarks:{},statScrollInventory:{},onClearMarks:(...args)=>calls.push(args)})));
 const footer=view.root.findAllByType('ContextMenuItem').filter(n=>text(n)==='Clear all marks');assert.equal(footer.length,1);await act(async()=>footer[0].props.onClick());assert.deepEqual(calls,[['mainhand',item]]);
 }finally{await act(async()=>view?.unmount());}
});
