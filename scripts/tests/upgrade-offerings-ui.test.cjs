const {test,after}=require('node:test'),assert=require('node:assert/strict'),{load,queryRoot}=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const {UpgradeActions,UpgradeOfferingProvider,UpgradeOfferingRules}=load(['upgrade-actions','upgrade-offering-controls'],{'@/components/ui/*':new Proxy({},{get:(_,key)=>String(key)})});
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
// An unmounted view's queries wait out their cache time on a timer; clearing each client ends
// them, so the file exits when its rows finish.
const roots=[];after(()=>roots.forEach(root=>root.client.clear()));
async function render({rules=[],stock={offeringp:1},executor,post=async()=>{}}={}){
 const root=queryRoot();roots.push(root);
 let view;await act(async()=>{view=create(root.wrap(React.createElement(UpgradeOfferingProvider,{character:'M',executor,stock,rules,catalog:[{id:'sword',name:'Sword',meta:{upgradeable:true,maxLevel:13,definition:{}}}],post},
  React.createElement(UpgradeActions,{item:{name:'sword',level:8},meta:{upgradeable:true,maxLevel:13,definition:{}},offeringSource:{slot:2},onMark(){},onAutoMark(){},onBuy(){}}),React.createElement(UpgradeOfferingRules))));});return view;
}
function button(view,label){return view.root.findAllByType('Button').find(n=>text(n)===label);}
function menu(view,label){return view.root.findAllByType('ContextMenuItem').find(n=>text(n)===label);}
test('manual offering options are last and individually disabled; confirmation sends one exact attempt',async()=>{
 const calls=[],v=await render({post:async(...args)=>calls.push(args)});
 try{
  const sub=v.root.findAllByType('ContextMenuSubContent')[0],labels=sub.findAllByType('ContextMenuItem').map(text);
  assert.deepEqual(labels.filter(label=>label.startsWith('Upgrade with ')),['Upgrade with Primling','Upgrade with Primordial Essence','Upgrade with Primordial X']);
  assert.equal(menu(v,'Upgrade with Primling').props.disabled,false);assert.equal(menu(v,'Upgrade with Primordial Essence').props.disabled,true);
  await act(async()=>menu(v,'Upgrade with Primling').props.onClick());
  assert.match(text(v.root.findByType('DialogDescription')),/Use Primling to upgrade Sword from \+8 to \+9/);
  await act(async()=>button(v,'Cancel').props.onClick());assert.equal(calls.length,0);
  await act(async()=>menu(v,'Upgrade with Primling').props.onClick());await act(async()=>button(v,'Confirm').props.onClick());
  assert.deepEqual(calls,[['/command',{character:'M',type:'upgrade-mark',item:{name:'sword',level:8},slot:2,tiers:1,offering:'offeringp'}]]);
 }finally{await act(async()=>v.unmount());}
});

test('preview opens stored results without queueing and explicit refresh queues a job',async()=>{
 const previous=global.fetch,calls=[];
 global.fetch=async(url,options)=>{calls.push([url,JSON.parse(options.body)]);return {ok:true,status:200,text:async()=>JSON.stringify({status:'complete',result:{executor:'M',item:{name:'sword',level:8},options:{
  none:{preview:{chance:0.15321},observedAt:1000},offeringp:{preview:{chance:0.24256},observedAt:1000},
  offering:{reason:'Offering not in merchant inventory'},offeringx:{reason:'Offering not in merchant inventory'},
 }}})};};
 let v;
 try {
  v=await render({executor:'M'});assert.equal(calls.length,0);
  await act(async()=>v.root.findAllByType('ContextMenuSub')[0].props.onOpenChange(true));
  assert.equal(calls.length,1);assert.deepEqual(calls[0][1],{character:'M',slot:2,item:{name:'sword',level:8},refresh:false});
  const panel=v.root.findByProps({'aria-label':'Upgrade chances'});assert.match(text(panel),/15\.32%/);assert.match(text(panel),/24\.26%/);assert.match(text(panel),/Offering not in merchant inventory/);
  assert.doesNotMatch(text(panel), /[\u00c2\u00e2]/);assert.match(text(panel), /Next attempt: \+8 \u2192 \+9/);
  assert.equal(menu(v,'Refresh chances').props.closeOnClick,false);
  await act(async()=>menu(v,'Refresh chances').props.onClick());assert.equal(calls.length,2);assert.equal(calls[1][1].refresh,true);
  await act(async()=>v.root.findAllByType('ContextMenuSub')[0].props.onOpenChange(false));assert.equal(calls.length,2);
 } finally {if(v)await act(async()=>v.unmount());global.fetch=previous;}
});
test('overlap is visible before confirmation and adjacent ranges can be saved with no owned offering',async()=>{
 const calls=[],v=await render({stock:{},rules:[{id:'old',name:'sword',floor:7,ceiling:9,offering:'offeringp',required:true}],post:async(...args)=>calls.push(args)});
 try{
  await act(async()=>menu(v,'Add upgrade rule').props.onClick());
  assert.match(text(v.root.findByProps({role:'alert'})),/already a rule.*\+7 to \+9/);assert.equal(button(v,'Confirm').props.disabled,true);
  await act(async()=>v.root.findByProps({'aria-label':'Starting level'}).props.onChange({target:{value:'9'}}));
  // An upgrade rule ends at +12.
  await act(async()=>v.root.findByProps({'aria-label':'Ending level'}).props.onChange({target:{value:'12'}}));
  await act(async()=>v.root.findByProps({'aria-label':'Upgrade offering'}).props.onChange({target:{value:'offering'}}));
  await act(async()=>v.root.findAllByType('input')[1].props.onChange());assert.equal(button(v,'Confirm').props.disabled,false);
  await act(async()=>button(v,'Confirm').props.onClick());assert.deepEqual(calls[0][1].rule,{id:'',name:'sword',floor:9,ceiling:12,offering:'offering',required:false});
  await act(async()=>v.root.findByProps({'aria-label':'Upgrade rules'}).props.onClick());assert.ok(button(v,'Edit'));assert.ok(button(v,'Remove'));assert.match(text(v.root),/Required/);
 }finally{await act(async()=>v.unmount());}
});
test('server rejection remains visible in the dialog',async()=>{
 const v=await render({post:async()=>{throw Error('Offering no longer available');}});
 try{await act(async()=>menu(v,'Upgrade with Primling').props.onClick());await act(async()=>button(v,'Confirm').props.onClick());assert.match(text(v.root.findByProps({role:'alert'})),/Offering no longer available/);assert.ok(button(v,'Cancel'));}
 finally{await act(async()=>v.unmount());}
});


test('a failed calculation shows unavailable instead of a stored-preview success or loading text',async()=>{
 const previous=global.fetch;global.fetch=async()=>({ok:true,status:200,text:async()=>JSON.stringify({status:'unavailable',result:{executor:'M',item:{name:'sword',level:8},options:Object.fromEntries(['none','offeringp','offering','offeringx'].map(k=>[k,{reason:'Missing scroll1 in merchant inventory or accessible bank'}]))}})});
 let v;try {
  v=await render({executor:'M'});await act(async()=>v.root.findAllByType('ContextMenuSub')[0].props.onOpenChange(true));
  const panel=v.root.findByProps({'aria-label':'Upgrade chances'});
  assert.match(text(panel),/No chances calculated/);assert.doesNotMatch(text(panel),/Stored preview|Loading/);
  assert.equal(menu(v,'Refresh chances').props.disabled,false);
 } finally {if(v)await act(async()=>v.unmount());global.fetch=previous;}
});
