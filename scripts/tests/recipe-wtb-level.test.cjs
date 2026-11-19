const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadModule = require('./helpers/dashboard-query-module.cjs');
const React = require('../../dashboard/node_modules/react');
const { create, act } = require('../../dashboard/node_modules/react-test-renderer');

class TestActionError extends Error { constructor(details) { super(details.error); this.details=details; } }
// The real feature logic with the browser UI primitives replaced.
const load = name => loadModule(name + '.tsx', { './query-actions': { PartyActionError: TestActionError },
  '@/components/ui/*': new Proxy({}, { get: (_, name) => name === 'Button' ? 'button' : String(name) }) });
const { ItemDetails } = load('item-details');
const { WTBOrderDialog } = load('wtborder-dialog');
const { pontyPrice } = require('../../runtime/items/rules.ts');
global.IS_REACT_ACT_ENVIRONMENT = true;
const text = node => typeof node === 'string' ? node : (node.children || []).map(text).join('');

test('recipe +7 cape keeps its level through inspection, WTB, Ponty price and saving', async t => {
  // ItemCard listens on the page for its "i" shortcut (item-card.tsx).
  const previousDocument = global.document;
  global.document = new EventTarget();
  t.after(() => { global.document = previousDocument; });
  const meta = { definition: { name: 'Cape', type: 'cape', g: 10000, upgrade: {}, grades: [7, 9] }, upgradeable: true };
  const mantle = { character: 'Catalog', entry: { slot: -1, item: { name: 'beastmantle' }, meta: {
    definition: { name: 'Beast Mantle', type: 'cape' }, world: { recipe: { cost: 1000, materials: [
      { id: 'cape', name: 'Cape', quantity: 1, level: 7 },
    ] } },
  } } };
  let requested, saved, details, order;
  try {
    await act(async () => { details = create(React.createElement(ItemDetails, {
      selected: mantle, catalog: [{ id: 'cape', meta }], monsters: [], characters: [], achievements: {},
      onAddWTB: (item, meta) => { requested = { item, meta }; }, onOpenChange() {},
    })); });
    await act(async () => details.root.findAllByType('button').find(button => text(button).includes('1 × Cape +7')).props.onClick());
    await act(async () => details.root.findAllByType('button').find(button => text(button).includes('Add to WTB')).props.onClick());
    assert.equal(requested.item.name, 'cape');
    assert.equal(requested.item.level, 7);
    await act(async () => { order = create(React.createElement(WTBOrderDialog, {
      item: requested, buyable: [], existing: { minimumQuality: 0, price: 1, quantity: 1 },
      onOpenChange() {}, onSave: async (...args) => { saved = args; },
    })); });
    assert.match(text(order.root.findByType('DialogTitle')), /Cape \+7$/);
    const preferences=order.root.findAllByType('input').filter(node=>node.props.type==='checkbox');
    assert.deepEqual(preferences.map(control=>control.props.checked),[false,true]);
    const help=order.root.findAllByType('PopoverTrigger');
    assert.equal(help[0].props.openOnHover,true);
    assert.match(text(order.root.findAllByType('PopoverContent')[0]),/Automatic shopping continues/);
    await act(async()=>preferences[1].props.onChange({currentTarget:{checked:false}}));
    const expected = pontyPrice({ name: 'cape', level: 7 }, meta);
    assert.ok(expected > pontyPrice({ name: 'cape', level: 0 }, meta));
    await act(async () => order.root.findAllByType('button').find(button => text(button).includes('Ponty price')).props.onClick());
    await act(async () => order.root.findAllByType('button').find(button => text(button).includes('Place WTB')).props.onClick());
    assert.deepEqual(saved.slice(0,5), ['cape', expected, 1, 7, null]);
    assert.equal(saved[5].acceptHigherLevels,false); assert.equal(saved[5].useStandSlot,false);
  } finally {
    await act(async () => { details?.unmount(); order?.unmount(); });
  }
});

test('merchant routines show gathering modes, include mail, count enabled routines and save keyboard priority changes',async()=>{
 const {RoutinePrioritiesDialog}=load('routine-priorities-dialog');let view,saved;
 const previousWindow=global.window;global.window={matchMedia:()=>({matches:true})};
 try {
  await act(async()=>{view=create(React.createElement(RoutinePrioritiesDialog,{open:true,onOpenChange(){},priorities:{fishing:60,mining:50,'send mail':90},enabled:{fishing:false,mining:true},onSave:async(...args)=>{saved=args;}}));});
  const control=label=>view.root.findAllByType('Checkbox').find(node=>node.props['aria-label']===label);
  assert.equal(control('Enable Fishing').props.checked,false);assert.equal(control('Enable Mining').props.checked,true);
  assert.ok(view.root.findAllByType('Input').some(node=>node.props['aria-label']==='Send mail priority'));
  await act(async()=>control('Enable Fishing').props.onCheckedChange(true));
  const fishing=view.root.findAllByType('button').find(node=>node.props['aria-label']==='Move Fishing');
  const rows=view.root.findAll(node=>Boolean(node.props['data-routine']));
  const total=rows.length;assert.match(text(view.root.findByType('DialogTitle')),new RegExp(`${total}/${total} enabled`));
  for(let i=0;i<total;i++)await act(async()=>fishing.props.onKeyDown({key:'ArrowDown',preventDefault(){}}));
  await act(async()=>view.root.findAllByType('button').find(node=>text(node)==='Save routines').props.onClick());
  assert.equal(saved[1].fishing,true);assert.equal(saved[1].mining,true);assert.ok(saved[0].fishing<saved[0].mining);
 } finally {await act(async()=>view?.unmount());global.window=previousWindow;}
});

for (const label of ['Automatically fill empty stand slots with highest priority buy order','Accept higher levels']) test(label+' can toggle in both directions after asynchronous saves',async()=>{
 const {WTBPreference}=load('wtb-preferences');let view,confirm;const calls=[];
 function Harness(){const [checked,setChecked]=React.useState(false);return React.createElement(WTBPreference,{label,description:'Help',checked,onChange:value=>{calls.push(value);confirm=()=>setChecked(value);}});}
 try {
  await act(async()=>{view=create(React.createElement(Harness));});
  for(const checked of [true,false,true]) {
   await act(async()=>view.root.findByType('input').props.onChange({currentTarget:{checked}}));
   await act(async()=>confirm());
   assert.equal(view.root.findByType('input').props.checked,checked);
  }
  assert.deepEqual(calls,[true,false,true]);
 } finally {await act(async()=>view?.unmount());}
});
test('full stand replacement shows catalog sprites and retains selection until confirmed',async()=>{
 const {useWTBReplacement}=load('wtb-preferences');let api,view;const calls=[];
 const catalog=[{id:'cape',name:'Cape',sprite:{url:'/cape.png',columns:1,rows:1,x:0,y:0,tileSize:20}}];
 function Harness(){api=useWTBReplacement(catalog);return api.dialog;}
 const action=async selection=>{calls.push(selection);if(!selection)throw new TestActionError({error:'Full',occupants:[{id:'sale:1',itemId:'cape',kind:'sale',quantity:2,price:1000}]});};
 try {
  await act(async()=>{view=create(React.createElement(Harness));});await act(async()=>api.save(action));
  assert.equal(text(view.root.findByType('DialogTitle')),'Make room for a buy order');
  assert.ok(view.root.findAllByType('span').some(node=>node.props.style?.backgroundImage==='url("/cape.png")'));
  assert.ok(view.root.findAllByType('span').some(node=>text(node)==='Cape'));
  const replace=()=>view.root.findAllByType('button').find(node=>text(node)==='Replace listing');
  assert.equal(replace().props.disabled,true);
  await act(async()=>view.root.findByType('input').props.onChange());assert.deepEqual(calls,[undefined]);
  await act(async()=>replace().props.onClick());assert.deepEqual(calls,[undefined,'sale:1']);
  assert.equal(view.root.findAllByType('Dialog').length,0);
 } finally {await act(async()=>view?.unmount());}
});
