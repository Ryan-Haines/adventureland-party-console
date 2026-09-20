const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const filename=path.resolve('dashboard/features/party/upgrade-offerings-ui-fixture.cjs'),m=new Module(filename,module);
m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
m.require=function(id){if(id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,key)=>String(key)});return Module.prototype.require.call(this,id);};
m._compile(buildSync({stdin:{contents:"export {UpgradeActions} from './upgrade-actions'; export {UpgradeOfferingProvider, UpgradeOfferingRules} from './upgrade-offering-controls';",resolveDir:path.dirname(filename),loader:'tsx'},bundle:true,packages:'external',external:['@/components/ui/*'],platform:'node',format:'cjs',write:false}).outputFiles[0].text,filename);
const {UpgradeActions,UpgradeOfferingProvider,UpgradeOfferingRules}=m.exports;
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
async function render({rules=[],stock={offeringp:1},post=async()=>{}}={}){
 let view;await act(async()=>{view=create(React.createElement(UpgradeOfferingProvider,{character:'M',stock,rules,catalog:[{id:'sword',name:'Sword',meta:{upgradeable:true,maxLevel:13,definition:{}}}],post},
  React.createElement(UpgradeActions,{item:{name:'sword',level:8},meta:{upgradeable:true,maxLevel:13,definition:{}},offeringSource:{slot:2},onMark(){},onAutoMark(){},onBuy(){}}),React.createElement(UpgradeOfferingRules)));});return view;
}
function button(view,label){return view.root.findAllByType('Button').find(n=>text(n)===label);}
function menu(view,label){return view.root.findAllByType('ContextMenuItem').find(n=>text(n)===label);}
test('manual offering options are last and individually disabled; confirmation sends one exact attempt',async()=>{
 const calls=[],v=await render({post:async(...args)=>calls.push(args)});
 try{
  const sub=v.root.findAllByType('ContextMenuSubContent')[0],labels=sub.findAllByType('ContextMenuItem').map(text);
  assert.deepEqual(labels.slice(-3),['Upgrade with Primling','Upgrade with Primordial Essence','Upgrade with Primordial X']);
  assert.equal(menu(v,'Upgrade with Primling').props.disabled,false);assert.equal(menu(v,'Upgrade with Primordial Essence').props.disabled,true);
  await act(async()=>menu(v,'Upgrade with Primling').props.onClick());
  assert.match(text(v.root.findByType('DialogDescription')),/Use Primling to upgrade Sword from \+8 to \+9/);
  await act(async()=>button(v,'Cancel').props.onClick());assert.equal(calls.length,0);
  await act(async()=>menu(v,'Upgrade with Primling').props.onClick());await act(async()=>button(v,'Confirm').props.onClick());
  assert.deepEqual(calls,[['/command',{character:'M',type:'upgrade-mark',item:{name:'sword',level:8},slot:2,tiers:1,offering:'offeringp'}]]);
 }finally{await act(async()=>v.unmount());}
});
test('overlap is visible before confirmation and adjacent ranges can be saved with no owned offering',async()=>{
 const calls=[],v=await render({stock:{},rules:[{id:'old',name:'sword',floor:7,ceiling:9,offering:'offeringp',required:true}],post:async(...args)=>calls.push(args)});
 try{
  await act(async()=>menu(v,'Add upgrade rule').props.onClick());
  assert.match(text(v.root.findByProps({role:'alert'})),/already a rule.*\+7 to \+9/);assert.equal(button(v,'Confirm').props.disabled,true);
  await act(async()=>v.root.findByProps({'aria-label':'Starting level'}).props.onChange({target:{value:'9'}}));
  await act(async()=>v.root.findByProps({'aria-label':'Ending level'}).props.onChange({target:{value:'13'}}));
  await act(async()=>v.root.findByProps({'aria-label':'Upgrade offering'}).props.onChange({target:{value:'offering'}}));
  await act(async()=>v.root.findAllByType('input')[1].props.onChange());assert.equal(button(v,'Confirm').props.disabled,false);
  await act(async()=>button(v,'Confirm').props.onClick());assert.deepEqual(calls[0][1].rule,{id:'',name:'sword',floor:9,ceiling:13,offering:'offering',required:false});
  await act(async()=>button(v,'Show upgrade rules (1)').props.onClick());assert.ok(button(v,'Edit'));assert.ok(button(v,'Remove'));assert.match(text(v.root),/Required/);
 }finally{await act(async()=>v.unmount());}
});
test('server rejection remains visible in the dialog',async()=>{
 const v=await render({post:async()=>{throw Error('Offering no longer available');}});
 try{await act(async()=>menu(v,'Upgrade with Primling').props.onClick());await act(async()=>button(v,'Confirm').props.onClick());assert.match(text(v.root.findByProps({role:'alert'})),/Offering no longer available/);assert.ok(button(v,'Cancel'));}
 finally{await act(async()=>v.unmount());}
});
