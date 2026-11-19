const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('../../dashboard/node_modules/typescript');
const { standSaleRows, standBuyRows } = require('../../dashboard/features/party/stand-inspection.ts');
const bid = {price: 100, quantity: 15000, minimumQuality: 2, useStandSlot: true};
const entry = (name, b=false) => ({item:{name, level:2, price:100, q:99, b}});

test('only placed buys get a row, not pending explicit reservations',()=>{
 const sales=Array.from({length:12},(_,i)=>({tradeSlot:`trade${i+1}`,state:'live'}));
 const bids={vitscroll:bid,slice_blueberry:bid,shopping:{...bid,useStandSlot:false}};
 const offers={offers:{v:{itemId:'vitscroll',slot:'trade13',phase:'live'},b:{itemId:'slice_blueberry',slot:'trade14',phase:'live'}}};
 for(const native of [{offers:{}},offers])
  assert.equal(standBuyRows(bids,native,{standOpen:false},sales).length,native === offers ? 2 : 0);
 assert.equal(standBuyRows({slice_blueberry:bid},{offers:{}},{standOpen:false},sales).length,0);
});

test('twelve sales and four buys exclude a paused stale seventeenth listing',()=>{
 const listings=Array.from({length:12},(_,i)=>({id:String(i),tradeSlot:`trade${i+1}`,state:'live',item:{name:'item'+i,level:2}}));
 listings.push({id:'paused',tradeSlot:'trade12',state:'paused',item:{name:'pants',level:2}});
 const slots=Object.fromEntries(Array.from({length:16},(_,i)=>[`trade${i+1}`,entry(i<12?'item'+i:'buy'+i,i>=12)]));
 const native={offers:Object.fromEntries([13,14,15,16].map(i=>[i,{slot:`trade${i}`,phase:'live'}]))};
 for(const standOpen of [true,false]) {
   const merchant={standOpen,slots:standOpen?slots:{}};
   assert.equal(standBuyRows({},native,merchant,listings).length,4);
   const rows=standSaleRows(listings,merchant,native);
   assert.equal(rows.filter(r=>r.occupied).length,12);
   assert.deepEqual(rows.filter(r=>!r.occupied).map(r=>r.key),['paused']);
 }
 // An observed buy slot takes precedence over a stale sale reference, even closed.
 const buyFirst={standOpen:false,slots:{trade1:entry('buy',true)}};
 assert.equal(standSaleRows([listings[0]],buyFirst,{}).filter(r=>r.occupied).length,0);
 assert.equal(standBuyRows({},{},buyFirst,[listings[0]]).length,1);
});

test('waiting and placing orders get no occupied row',()=>{
 assert.equal(standSaleRows([{state:'waiting',item:{name:'cap'}}],{standOpen:false},{offers:{}}).filter(r=>r.occupied).length,0);
 assert.equal(standBuyRows({},{offers:{q:{itemId:'cap',slot:'trade2',phase:'placing'}}},{standOpen:false}).length,0);
});

// The game gives 24 and 30 cell stands (get_trade_slots); a cell past trade16 is a cell.
test('a sale and a buy past trade16 get their rows on a 30 cell stand',()=>{
 const listings=[{id:'far',tradeSlot:'trade24',state:'live',item:{name:'cap',level:2},price:100}];
 const merchant={standOpen:true,slots:{trade24:entry('cap'),trade30:entry('vitscroll',true)}};
 assert.deepEqual(standSaleRows(listings,merchant).map(r=>[r.key,r.status]),[['far','Live']]);
 assert.deepEqual(standBuyRows({vitscroll:bid},{offers:{}},merchant,listings).map(r=>r.key),['trade30']);
});
test('sales exclude buys, consume matches once, retain queued/paused and unmatched slots', () => {
 const listings = [{id:'one',slot:0,item:{name:'cap',level:2},price:100,quantity:1}, {id:'two',slot:1,item:{name:'cap',level:2},price:100,quantity:1}, {id:'three',slot:2,item:{name:'paused'},price:10,quantity:1,state:'paused'}];
 const merchant = {standOpen:true,slots:{trade1:entry('cap'),trade2:entry('buy',true),trade3:entry('extra')}};
 const rows = standSaleRows(listings,merchant);
 assert.deepEqual(rows.map(r=>r.status),['Live','Queued','Paused','Live']);
 assert.equal(rows[3].editable,false);
 assert.equal(standSaleRows(listings,{...merchant,standOpen:false})[0].status,'Queued');
});
test('buys include observed explicit and automatic batches, excluding waiting orders',()=>{
 const bids={cap:bid,auto:{...bid,useStandSlot:false},waiting:bid,shopping:{...bid,useStandSlot:false}};
 const native={offers:{a:{itemId:'cap',slot:'trade1',auto:false,phase:'live',level:2,price:100},b:{itemId:'auto',slot:'trade2',auto:true,phase:'placing',level:2,price:100}},problems:{waiting:'Price exceeds limit'}};
 const merchant={standOpen:true,slots:{trade1:entry('cap',true),trade2:entry('auto',true)}};
 const rows=standBuyRows(bids,native,merchant);
 assert.equal(rows.length,2);assert.equal(rows[0].observed.item.q,99); assert.equal(rows[0].bid.quantity,15000);
 assert.equal(rows[1].offer.auto,true);assert.equal(rows[1].bid.useStandSlot,false);
 assert.equal(standBuyRows(bids,native,{...merchant,standOpen:false}).length,2);
 assert.equal(standBuyRows(bids,native,{...merchant,slots:{trade1:entry('cap')}}).length,0);
});
const React = require('../../dashboard/node_modules/react');
const renderer = require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;
const code=ts.transpileModule(fs.readFileSync('dashboard/features/party/stand-sheet.tsx','utf8'),{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
// The open panel holds a market watch stream; this stand-in opens no connection.
const context={exports:{},EventSource:class{close(){}},require(name){
 if(name==='react')return React;
 if(name==='react/jsx-runtime')return require('../../dashboard/node_modules/react/jsx-runtime');
 if(name==='../../../runtime/items/rules')return require('../../runtime/items/rules.ts');
 if(name==='../../../runtime/items/identity')return require('../../runtime/items/identity.ts');
 if(name==='../../../runtime/items/api.ts')return require('../../runtime/items/api.ts');
 if(name==='./stand-inspection')return {standSaleRows,standBuyRows};
 if(name==='./stand-bid-save')return require('../../dashboard/features/party/stand-bid-save.ts');
 if(name==='./level-price-history')return {levelPriceHistory:()=>({})};
 if(name==='./market-age')return {marketAge:()=>''};
 if(name==='@/hooks/use-clock')return {useClock:()=>1000};
 if(name==='@/hooks/use-stored-boolean')return {useStoredBoolean:(_,v)=>React.useState(v)};
 if(name==='./query-actions')return {usePartyAction:()=>({})};
 // No add-on is installed here, so the Market's add-on slots draw nothing and its filters keep every row.
 if(name==='../../../runtime/hooks/dashboard/slots')return {AddonSlot:()=>null,useAddonListView:()=>({declared:false,values:{},set(){},keep:()=>true,sort:items=>items})};
 if(name==='./wtb-preferences')return {WTBPreference:'WTBPreference',useWTBReplacement:()=>({save:fn=>fn(),dialog:null})};
 return new Proxy({}, {get:(_,key)=>String(key)});
}};
vm.runInNewContext(code,context);
const props=()=>({open:true,marketOpen:true,stand:{slots:16,used:0,free:16},merchant:{standOpen:true,slots:{trade1:entry('cap',true)}},onOpenChange(){},onMarketOpenChange(){},catalog:[{id:'cap',name:'Cap'}],buyable:[],bids:{cap:bid},listings:[],priceHistory:{},blacklist:{},marketIgnoredItems:[],onBid:async()=>{},onInspect(){}});

test('WTB catalog is a narrow name-and-add picker opening the regular order editor',async()=>{
 const p=props(),opened=[];let saves=0,root;
 p.onEditBuy=(item,meta)=>opened.push({item,meta});p.onBid=async()=>{saves++};
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const picker=root.root.findAllByType('DialogContent').find(n=>n.findAllByType('DialogTitle').some(t=>t.children.includes('WTB orders')));
 assert.equal(picker.findAllByType('Input').length,1);
 assert.equal(picker.findAllByType('span').filter(n=>['Bid','Quantity','Minimum quality','Lowest seen','Most recent'].includes(n.children.join(''))).length,0);
 const add=picker.findAllByType('Button').find(n=>n.children.includes('Add'));
 await renderer.act(async()=>add.props.onClick());
 assert.equal(saves,0);assert.equal(opened[0].item.name,'cap');assert.equal(opened[0].item.level,2);
 assert.equal(picker.parent.props.open,false);
 await renderer.act(async()=>root.unmount());
});

test('stand amounts open pricing and inline priority saves without changing buy price or quantity',async()=>{
 const p=props(),calls=[];p.listings=[{id:'sale',slot:0,item:{name:'cap',level:2},price:250,quantity:1}];
 p.onEdit=listing=>calls.push(['sale',listing.id]);p.onEditBuy=item=>calls.push(['buy',item.name]);p.onBid=async(...args)=>calls.push(['priority',...args]);
 let root;await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const button=label=>root.root.findAll(n=>n.type==='Button'&&n.props['aria-label']===label)[0];
 await renderer.act(async()=>button('Edit sale price for cap').props.onClick());
 await renderer.act(async()=>button('Edit buy price for Cap').props.onClick());
 assert.deepEqual(calls,[['sale','sale'],['buy','cap']]);
 const priority=()=>root.root.findAll(n=>n.type==='WTBPriorityInput'&&n.props.onBlur)[0];
 await renderer.act(async()=>priority().props.onChange('99'));
 await renderer.act(async()=>priority().props.onBlur());
 assert.deepEqual(calls[2].slice(0,7),['priority','cap',100,15000,2,false,99]);
 assert.equal(root.root.findAll(n=>n.type==='p'&&n.children.join('').includes('stand closed')).length,0);
 await renderer.act(async()=>root.unmount());
});
test('both cancellation views require two clicks, reset on close/order removal, and expose failures', async()=>{
 let calls=0;const p=props();p.onBid=async()=>{calls++;throw Error('Request failed')};let root;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const buttons=()=>root.root.findAll(n=>n.type==='Button' && n.children.some(c=>c==='Cancel'||c==='Really cancel?'));
 // The picker only adds orders; stand and active-order cancellation share a handler.
 const orderButtons=()=>buttons().filter(n=>n.props.className?.includes('border-rose-700'));
 assert.equal(orderButtons().length,2);
 for(let i=0;i<2;i++){
  await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,{...p,open:false}))});
  await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,p))});
  const before=calls;
  await renderer.act(async()=>{orderButtons()[i].props.onClick()});assert.equal(calls,before);
  assert.ok(orderButtons()[i].children.includes('Really cancel?'));
  await renderer.act(async()=>{orderButtons()[i].props.onClick()});assert.equal(calls,before+1);
  assert.ok(root.root.findAll(n=>n.props.role==='alert').length);
 }
 await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,{...p,bids:{}}))});
 await renderer.act(async()=>{root.update(React.createElement(context.exports.StandSheet,p))});
 assert.ok(orderButtons().every(n=>n.children.includes('Cancel')));
 await renderer.act(async()=>{root.unmount()});
});
test('selecting another order resets confirmation; successful submission locks all cancellation controls', async()=>{
 let calls=[];let finish;const p=props();p.bids={cap:bid,other:bid};p.merchant.slots.trade2=entry('other',true);p.onBid=(...args)=>{calls.push(args);return new Promise(resolve=>{finish=resolve})};let root;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const controls=()=>root.root.findAll(n=>n.type==='Button' && n.props.className?.includes('border-rose-700'));
 await renderer.act(async()=>{controls()[0].props.onClick()});
 await renderer.act(async()=>{controls()[1].props.onClick()});
 assert.equal(calls.length,0);assert.ok(controls()[0].children.includes('Cancel'));assert.ok(controls()[1].children.includes('Really cancel?'));
 await renderer.act(async()=>{controls()[1].props.onClick()});
 assert.equal(calls.length,1);assert.equal(calls[0][0],'other');assert.equal(calls[0][4],true);
 assert.ok(controls().every(n=>n.props.disabled));
 await renderer.act(async()=>{finish()});
 assert.ok(controls().every(n=>n.children.includes('Cancel')));
 await renderer.act(async()=>root.unmount());
});
test('pending price edits do not duplicate the observed sale',()=>{
 const listing={slot:0,item:{name:'cap',level:2},price:200,quantity:1};
 const rows=standSaleRows([listing],{standOpen:true,slots:{trade1:entry('cap')}});
 assert.equal(rows.length,1);assert.equal(rows[0].status,'Queued');
});
test('empty stand keeps section headings and only the header close control',async()=>{
 const p={...props(),merchant:undefined,bids:{},catalog:[]};let root;
 await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
 const dialog=root.root.findAll(n=>n.type==='DialogContent')[0];
 assert.equal(dialog.props.showCloseButton,false);
 assert.ok(dialog.findAll(n=>n.type==='h2').some(n=>n.children.join('').includes('Items for sale')));
 assert.ok(dialog.findAll(n=>n.type==='h2').some(n=>n.children.join('').includes('Buy orders')));
 assert.equal(dialog.findAllByType('DialogFooter').length,0);
 assert.equal(dialog.findAllByProps({'aria-label':'Close stand'}).length,1);
 await renderer.act(async()=>root.unmount());
});
test('sale removal requires two clicks and resets when a buy cancellation is selected',async()=>{
 const p=props();let removed=0,root;p.listings=[{id:'sale',slot:1,item:{name:'cap'},quantity:1,price:10}];p.onRemove=async()=>{removed++};
 await renderer.act(async()=>root=renderer.create(React.createElement(context.exports.StandSheet,p)));
 const remove=()=>root.root.findAllByType('Button').find(n=>String(n.props['aria-label']).startsWith('Remove '));
 await renderer.act(async()=>remove().props.onClick());assert.equal(removed,0);assert.ok(remove().children.includes('Really remove?'));
 const cancel=root.root.findAllByType('Button').find(n=>n.children.includes('Cancel')&&n.props.className?.includes('border-rose-700'));
 await renderer.act(async()=>cancel.props.onClick());assert.ok(remove().children.includes('Remove'));
 await renderer.act(async()=>remove().props.onClick());await renderer.act(async()=>remove().props.onClick());assert.equal(removed,1);
 await renderer.act(async()=>root.unmount());
});

test('queued sales render between occupied sales and buy orders',async()=>{
 const p=props();p.merchant={standOpen:true,slots:{trade1:entry('cap'),trade2:entry('buy',true)}};
 p.listings=[{id:'live',slot:0,item:{name:'cap',level:2},price:100,state:'live',tradeSlot:'trade1'},{id:'paused',slot:1,item:{name:'pants'},price:10,state:'paused',tradeSlot:'trade1'}];
 let root;await renderer.act(async()=>root=renderer.create(React.createElement(context.exports.StandSheet,p)));
 const dialog=root.root.findAllByType('DialogContent')[0];
 assert.deepEqual(dialog.findAllByType('h2').map(n=>n.children.join('')),['Items for sale · 1/16 slots','Queued sales for stand','Buy orders · 1/16 slots']);
 const sections=dialog.findAllByType('section');assert.equal(sections.length,2);
 assert.equal(sections[0].findAllByType('Tooltip').length,1);assert.equal(sections[1].findAllByType('Tooltip').length,1);
 await renderer.act(async()=>root.unmount());
});

function fullStandFixture() {
 const listings=Array.from({length:12},(_,i)=>({id:`sale${i}`,tradeSlot:`trade${i+1}`,state:'live',item:{name:'sale'+i,level:2},price:100}));
 const bids=Object.fromEntries(Array.from({length:6},(_,i)=>['buy'+i,{...bid,useStandSlot:i>=4}]));
 const offers=Object.fromEntries(Array.from({length:6},(_,i)=>[i,{itemId:'buy'+i,slot:'trade'+(i<4?13+i:i-3),phase:i<4?'live':i===4?'placing':'blocked',auto:true,level:2,price:100,quantity:99,acknowledged:0}]));
 const slots=Object.fromEntries(Array.from({length:16},(_,i)=>['trade'+(i+1),entry(i<12?'sale'+i:'buy'+(i-12),i>=12)]));
 return {listings,bids,native:{offers,problems:{}},slots};
}
test('twelve sale slots and four buy slots show exactly four of six candidate buys open or closed',()=>{
 const {listings,bids,native,slots}=fullStandFixture();
 for(const merchant of [{standOpen:true,slots},{standOpen:false,slots},{standOpen:false,slots:{}}]) {
  const rows=standBuyRows(bids,native,merchant,listings);
  assert.equal(rows.length,4);
  assert.deepEqual(rows.map(r=>r.id),['buy0','buy1','buy2','buy3']);
  assert.equal(standSaleRows(listings,merchant,native).filter(r=>r.occupied).length,12);
 }
});
test('slot collisions, stale offers and invalid slots cannot add buy cards',()=>{
 const {listings,bids,native,slots}=fullStandFixture();
 native.offers.extra={...native.offers[0],slot:'trade1',itemId:'buy4'};
 native.offers.invalid={...native.offers[0],slot:'trade0'};
 slots.trade0=entry('buy4',true);
 for(const standOpen of [true,false]) {
  const merchant={standOpen,slots};
  assert.equal(standBuyRows(bids,native,merchant,listings).length,4);
  assert.equal(standSaleRows(listings,merchant,native).filter(r=>r.occupied).length,12);
 }
 native.offers[0].phase='removing';
 assert.equal(standBuyRows(bids,native,{standOpen:false},listings).find(r=>r.key==='trade13').offer.phase,'removing');
 assert.equal(standBuyRows(bids,native,{standOpen:true,slots:{}},listings).length,0);
});
test('observed buy slots survive missing orders and duplicate item names with distinct keys',()=>{
 const merchant={standOpen:true,slots:{trade1:entry('unknown',true),trade2:entry('unknown',true)}};
 const rows=standBuyRows({},undefined,merchant);
 assert.deepEqual(rows.map(r=>r.key),['trade1','trade2']);
 assert.ok(rows.every(r=>!r.bid && r.price===100 && r.quantity===99));
});
test('stand dialog matches four occupied cards and renders open/closed badges without queued sale badges',async()=>{
 const {listings,bids,native,slots}=fullStandFixture();let root;
 for(const standOpen of [true,false]) {
  const p={...props(),listings,bids,nativeStand:native,merchant:{standOpen,slots:standOpen?slots:{}}};
  await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
  const dialog=root.root.findAllByType('DialogContent')[0];
  assert.deepEqual(dialog.findAllByType('h2').map(n=>n.children.join('')),['Items for sale · 12/16 slots','Buy orders · 4/16 slots']);
  assert.equal(dialog.findAllByType('WTBPreference').length,4);
  assert.equal(dialog.findAllByType('span').filter(n=>n.children.includes('Queued')).length,0);
  assert.ok(dialog.findAllByType('span').some(n=>n.children.includes(standOpen?'Stand open':'Stand closed')));
  await renderer.act(async()=>root.unmount());
 }
});
test('unconfigured occupied buys display terms without editable order controls',async()=>{
 let root;const p={...props(),bids:{}};
 await renderer.act(async()=>root=renderer.create(React.createElement(context.exports.StandSheet,p)));
 const dialog=root.root.findAllByType('DialogContent')[0];
 assert.equal(dialog.findAllByType('WTBPreference').length,0);
 assert.equal(dialog.findAllByType('WTBPriorityInput').length,0);
 assert.equal(dialog.findAllByType('Button').find(n=>n.props['aria-label']==='Edit buy price for Cap').props.disabled,true);
 assert.ok(dialog.findAllByType('span').some(n=>n.children.join('')==='99 wanted'));
 await renderer.act(async()=>root.unmount());
});

test('missing stand observation is unknown rather than closed',async()=>{
 let root;
 await renderer.act(async()=>root=renderer.create(React.createElement(context.exports.StandSheet,{...props(),merchant:{slots:{}}})));
 const dialog=root.root.findAllByType('DialogContent')[0];
 assert.ok(dialog.findAllByType('span').some(node=>node.children.includes('Stand status unknown')));
 assert.ok(!dialog.findAllByType('span').some(node=>node.children.includes('Stand closed')));
 await renderer.act(async()=>root.unmount());
});

// The merchant reports the game's get_trade_slots count and every planner plans to
// the report. Red on an earlier build: every planner planned 16.
test('the stand counts 24 at level 70 and 30 at level 80, and plans to the report',()=>{
 const {planted}=require('./helpers/items-character.cjs');
 const {createBagReads}=require('../../runtime/items/character/bag.ts');
 const {standSlotUse}=require('../../runtime/items/rules.ts');
 const G={items:{stand0:{type:'stand'},cstand:{type:'stand'}}};
 const slotsAt=(level,stand='stand0')=>{
  const character={ctype:'merchant',level,items:[{name:stand}]};
  return createBagReads(planted({character:()=>character,G:()=>G,margin:()=>100,now:()=>0})).standSlots();
 };
 assert.deepEqual([slotsAt(60),slotsAt(60,'cstand'),slotsAt(70),slotsAt(80)],[16,24,24,30]);
 const listings=n=>Array.from({length:n},(_,i)=>({tradeSlot:'trade'+(i+1),state:'live'}));
 for(const slots of [24,30]){
  const state={merchantCharacter:'M',statuses:{M:{standSlots:slots}},standListings:listings(slots+2)};
  assert.deepEqual(standSlotUse(state),{slots,used:slots,free:0});
  assert.deepEqual(standSlotUse({...state,standListings:listings(20)}),{slots,used:20,free:slots-20});
 }
 assert.equal(standSlotUse({merchantCharacter:'M',statuses:{M:{}},standListings:[]}).slots,16);
});

// A configured listing finds its stand cell by the items owner's markMatches, so the cell's price,
// count and stack id never split them, and a different title does.
test('a listing matches its stand cell by 10s mark identity',()=>{
 const listing={id:'one',state:'live',item:{name:'cap',level:2,p:'shiny'},price:100};
 const cell=item=>({standOpen:true,slots:{trade1:{item:{...item,price:100,q:3,rid:'r1'}}}});
 assert.equal(standSaleRows([listing],cell({name:'cap',level:2,p:'shiny'}))[0].occupied,true);
 assert.equal(standSaleRows([listing],cell({name:'cap',level:2,p:'glitched'}))[0].occupied,false);
});

// Live WTB's List button offers only a cell the bank section counted, so a bag copy that the
// items owner's claim keeps (counted 0 by items.stock) shows no List button.
test('a claimed bag copy shows no List button',async()=>{
 const order={buyer:'B',item:{name:'cap',level:2},price:500,quantity:1,seenAt:-1e9,serverRegion:'US',serverIdentifier:'I',key:'k'};
 const copy={slot:4,item:{name:'cap',level:2,q:1}};
 const lists=[];
 const render=async ownedStock=>{
  const p={...props(),merchant:{name:'M',standOpen:true,slots:{},items:[copy]},aldata:{buyOrders:[order]},ownedStock,
   onListForWTB:(...args)=>lists.push(args)};
  let root;await renderer.act(async()=>{root=renderer.create(React.createElement(context.exports.StandSheet,p))});
  const tab=root.root.findAll(n=>n.type==='Button'&&n.children.some(c=>String(c).startsWith('Live WTB')))[0];
  await renderer.act(async()=>tab.props.onClick());
  const list=root.root.findAll(n=>n.type==='Button'&&n.children.includes('List'));
  if(list[0])await renderer.act(async()=>list[0].props.onClick());
  await renderer.act(async()=>root.unmount());
  return list.length;
 };
 assert.equal(await render({}),0);
 assert.equal(await render({'cap@2@':{count:1,sources:[{entry:copy}]}}),1);
 assert.deepEqual(lists.map(args=>[args[0].slot,args[1]]),[[4,undefined]]);
});
