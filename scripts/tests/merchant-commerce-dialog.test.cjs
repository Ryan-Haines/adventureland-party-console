const test=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
const {restoreGlobals}=require('./helpers/test-registry.cjs');
const tags=new Proxy({},{get:(_,key)=>String(key)});
// One bundle, so the dialog's instanceof check sees the test's PartyActionError class.
const {MerchantCommerceDialog,PartyActionError}=load(['merchant-commerce-dialog.tsx','query-actions.ts'],{'@/components/ui/*':tags,'lucide-react':tags});
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
// The material is buyable, so the recipe adds without owned stock.
const catalog={buyable:[{id:'intring',name:'Int ring',cost:10,sprite:null}],craftable:[{id:'tri',name:'Tri',cost:5,sprite:null,materials:[{id:'intring',name:'Int ring',level:0,quantity:1,sprite:null}]}]};
// Renders the craft dialog with four Tri in the cart, runs `check` and unmounts.
async function withCart(t,onSubmit,check){
 restoreGlobals(t,['IS_REACT_ACT_ENVIRONMENT']);global.IS_REACT_ACT_ENVIRONMENT=true;
 let view;try{
  await act(async()=>view=create(React.createElement(MerchantCommerceDialog,{mode:'craft',onClose(){},catalog,characters:[],bank:null,bankbois:[],onInspect(){},onSubmit})));
  const add=view.root.findAllByType('Button').find(n=>text(n)==='Add');
  for(let i=0;i<4;i++)await act(async()=>add.props.onClick());
  const quantity=()=>view.root.findAllByType('Input').find(n=>n.props['aria-label']==='Tri quantity')?.props.value;
  assert.equal(quantity(),4);
  await check({view,quantity,submit:view.root.findAllByType('Button').find(n=>text(n)==='Craft')});
 }finally{await act(async()=>view?.unmount());}
}
test('dialog catches rejection, preserves cart and renders shortage text without an unhandled rejection',t=>withCart(t,
 async()=>{throw new PartyActionError(409,{error:'Materials unavailable',missing:[{id:'intring',level:0,required:4,available:3}]})},async f=>{
 await act(async()=>f.submit.props.onClick());assert.equal(f.quantity(),4);
 // The unavailable-gold confirmation holds a second alert line; the open commerce Dialog holds this one.
 assert.match(text(f.view.root.findAllByType('Dialog').find(n=>n.props.open).findByProps({role:'alert'})),/intring \+0: 4 required, 3 available/);
 assert.equal(f.submit.props.disabled,false);assert.equal(text(f.submit),'Craft');
}));
test('dialog suppresses duplicate pending submissions and clears its cart only on success',t=>{
 let resolve,calls=0;return withCart(t,()=>{calls++;return new Promise(done=>resolve=done)},async f=>{
  const click=f.submit.props.onClick;
  await act(async()=>{click();click();});assert.equal(calls,1);assert.equal(f.quantity(),4);
  assert.equal(f.submit.props.disabled,true);assert.equal(text(f.submit),'Queuing…');
  await act(async()=>click());assert.equal(calls,1);
  await act(async()=>resolve());assert.equal(f.quantity(),undefined);assert.match(text(f.view.root),/Nothing selected/);
  assert.equal(text(f.submit),'Craft');
 });
});
