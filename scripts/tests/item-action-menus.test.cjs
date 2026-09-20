const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
function load(name){const filename=path.resolve('dashboard/features/party/'+name+'.tsx'),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));m.require=function(id){if(id==='./query-actions')return {usePartyAction:()=>({})};if(id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});return Module.prototype.require.call(this,id)};m._compile(buildSync({entryPoints:[filename],bundle:true,packages:'external',external:['@/components/ui/*','./query-actions'],platform:'node',format:'cjs',write:false}).outputFiles[0].text,filename);return m.exports;}
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
const {InventoryPanel}=load('inventory-panel'),{EquipSlot}=load('equip-slot');
function props(type){const entry={slot:0,item:{name:'test'},meta:{definition:{name:'Test',type,stat:type==='weapon'?1:0},sprite:null}};return {character:{name:'M',ctype:'merchant',items:[entry],slots:{},seenAt:1},characters:[{name:'M',seenAt:1},{name:'F',seenAt:1}],merchant:'M',marked:[],merchantMarked:[],autoItemMarks:{},autoUpgradeMarks:{},allAutoUpgradeMarks:{},merchantDeliveries:{},standListings:[],autoNpcSales:{},autoStandMarks:{},buyable:[],catalog:[],priceHistory:{},upgradeMarks:[],statScrollMarks:[],statScrollInventory:{},compoundGroups:[],autoCompoundMarks:[],allAutoCompoundMarks:{},autoExchanges:{}};}
for(const type of ['tracker','stone','spawner','elixir','weapon'])test(type+' gets only its valid inventory actions',async()=>{let view;try{await act(async()=>view=create(React.createElement(InventoryPanel,props(type))));const labels=view.root.findAllByType('ContextMenuItem').map(text);assert.equal(labels.includes('Equip'),type==='weapon');assert.equal(labels.includes('Use elixir'),type==='elixir');assert.equal(labels.includes('Use'),type==='spawner');assert.ok(labels.indexOf('Mark for bank')<labels.indexOf('Mark for stand'));assert.ok(labels.indexOf('Auto mark for bank')<labels.indexOf('Mark for stand'));if(type==='weapon'){const trigger=view.root.findAllByType('ContextMenuSubTrigger').find(n=>text(n)==='Add stat scroll');assert.ok(trigger.findAllByType('svg').length);}}finally{await act(async()=>view?.unmount());}});
test('equipped gear omits primary-stat action, active elixir has no Unequip or Use',async()=>{for(const type of ['weapon','elixir']){let view;try{await act(async()=>view=create(React.createElement(EquipSlot,{slot:type==='elixir'?'elixir':'mainhand',equipped:props(type).character.items[0],isMerchant:true,autoUpgradeMarks:{},statScrollInventory:{}})));const labels=view.root.findAllByType('ContextMenuItem').map(text);assert.equal(labels.includes('Unequip'),type==='weapon');assert.ok(!labels.some(label=>label.includes('primary-stat')||label.startsWith('Use')));}finally{await act(async()=>view?.unmount());}}});


test('overlapping marks use one aligned red footer and active creation actions cannot toggle off',async()=>{
 const p=props('weapon'),item=p.character.items[0].item,calls=[];
 p.marked=[{slot:0,item}];p.autoItemMarks={'test@+0':'bank'};p.upgradeMarks=[{slot:0,item,tiers:1}];p.autoUpgradeMarks={'test@+0':1};
 p.character.items[0].meta.upgradeable=true;p.character.items[0].meta.definition.upgrade={};p.onCommand=(...args)=>calls.push(args);
 let view;try{await act(async()=>view=create(React.createElement(InventoryPanel,p)));
 const entries=view.root.findAllByType('ContextMenuItem'),footer=entries.filter(n=>text(n)==='Clear all marks');assert.equal(footer.length,1);
 assert.match(footer[0].props.className,/!text-\[#b91c1c\]/);assert.match(footer[0].props.className,/!pl-14/);
 assert.equal(entries.find(n=>text(n)==='Auto mark for bank').props.disabled,true);
 assert.ok(!entries.some(n=>/^(Unmark|Remove .*mark|Stop auto|Disable auto)/.test(text(n))));
 await act(async()=>footer[0].props.onClick());assert.deepEqual(calls,[['M','clear-item-marks',item,{slot:0}]]);
 }finally{await act(async()=>view?.unmount());}
});
test('equipped marks use the same clear footer',async()=>{
 const p=props('weapon'),item=p.character.items[0].item,calls=[];let view;
 try{await act(async()=>view=create(React.createElement(EquipSlot,{slot:'mainhand',equipped:p.character.items[0],mark:{slot:'mainhand',equipped:true,item,tiers:1},autoUpgradeMarks:{},statScrollInventory:{},onClearMarks:(...args)=>calls.push(args)})));
 const footer=view.root.findAllByType('ContextMenuItem').filter(n=>text(n)==='Clear all marks');assert.equal(footer.length,1);await act(async()=>footer[0].props.onClick());assert.deepEqual(calls,[['mainhand',item]]);
 }finally{await act(async()=>view?.unmount());}
});

test('fighter menus offer upgrades and compounds while management sections stay on merchant',async()=>{
 const p=props('weapon');p.character.name='F';p.character.ctype='warrior';p.sharedRules=true;
 p.character.items[0].meta.upgradeable=true;p.character.items[0].meta.compoundable=true;p.character.items[0].meta.definition.upgrade={};
 p.autoItemMarks={'test@+0':'bank'};p.autoUpgradeMarks={'test@+0':{tiers:1,quantity:2}};p.allAutoUpgradeMarks={M:p.autoUpgradeMarks};
 p.upgradeMarks=[{slot:0,item:p.character.items[0].item,tiers:1}];let view;
 try{await act(async()=>view=create(React.createElement(InventoryPanel,p)));
  const triggers=view.root.findAllByType('ContextMenuSubTrigger').map(text);
  assert.ok(triggers.some(t=>t.startsWith('Mark for upgrade')));assert.ok(triggers.some(t=>t.startsWith('Auto mark for upgrade')));assert.ok(triggers.some(t=>t.includes('Auto compound')));
  const banners=view.root.findAllByType('span').filter(n=>n.props['data-item-action-banner']);assert.equal(banners.length,1);assert.equal(text(banners[0]),'+0 → +1');
  assert.equal(view.root.findAllByType('details').length,0);
  const footer=view.root.findAllByType('ContextMenuItem').find(n=>text(n)==='Clear all marks');
  assert.equal(footer.findAllByType('svg').length,1);assert.match(footer.findByType('svg').props.className,/lucide-eraser/);assert.doesNotMatch(footer.findByType('svg').props.className,/rotate/);
 }finally{await act(async()=>view?.unmount());}
});

test('equipped fighter upgrade shows only the target banner without bold or uppercase',async()=>{
 const p=props('weapon');let view;try{await act(async()=>view=create(React.createElement(EquipSlot,{slot:'mainhand',equipped:p.character.items[0],mark:{item:p.character.items[0].item,tiers:2,auto:true,equipped:true},isMerchant:false,autoUpgradeMarks:{},statScrollInventory:{}})));
 const banners=view.root.findAllByType('span').filter(n=>n.props['data-item-action-banner']);assert.equal(banners.length,1);assert.equal(text(banners[0]),'Auto → +2');assert.doesNotMatch(banners[0].props.className,/uppercase|font-bold|font-semibold/);
 }finally{await act(async()=>view?.unmount());}
});


test('compound banners replace storage and collection on both inventories',async()=>{
 for(const owner of ['F','M']){const p=props('ring');p.character.name=owner;p.autoItemMarks={'test@+0':'bank'};p.autoCompoundMarks=[{name:'test',targetTier:3,quantity:-1}];p.merchantMarked=[{slot:0,item:p.character.items[0].item}];let view;
 try{await act(async()=>view=create(React.createElement(InventoryPanel,p)));const banners=view.root.findAllByType('span').filter(n=>n.props['data-item-action-banner']);assert.equal(banners.length,1);assert.equal(text(banners[0]),'Auto compound → +3');}finally{await act(async()=>view?.unmount());}}
});
