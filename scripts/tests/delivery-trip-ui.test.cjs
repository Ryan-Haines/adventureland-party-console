const {test}=require('node:test'),assert=require('node:assert/strict');
const path=require('node:path'),Module=require('node:module'),{buildSync}=require('esbuild');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
function load(name,action) {
 const filename=path.resolve('dashboard/features/party',name+'.tsx');
 const bundle=buildSync({entryPoints:[filename],bundle:true,packages:'external',external:['@/components/ui/*','./query-actions'],platform:'node',format:'cjs',write:false});
 const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));
 compiled.require=function(id){
  if(id==='./query-actions')return {usePartyAction:action};
  if(id.startsWith('@/components/ui/'))return new Proxy({},{get:(_,name)=>String(name)});
  return Module.prototype.require.call(this,id);
 };
 compiled._compile(bundle.outputFiles[0].text,filename);return compiled.exports;
}
const text=node=>typeof node==='string'?node:(node.children||[]).map(text).join('');

test('delivery checkbox defaults on, saves only its setting, blocks pending edits and reports failure inline',async()=>{
 let finish,fail=true,saved,updates;
 function action(){
  const [isPending,pending]=React.useState(false),[error,setError]=React.useState(null);
  return {isPending,error,reset:()=>setError(null),mutate:request=>{
   saved=request;pending(true);finish=()=>{pending(false);if(fail)setError(Error('Save rejected'));else updates(false);};
  }};
 }
 const {DeliveryTripSetting}=load('delivery-trip-setting',action);
 function Harness(){const [enabled,setEnabled]=React.useState(undefined);updates=setEnabled;return React.createElement(DeliveryTripSetting,{enabled});}
 let view;await act(async()=>{view=create(React.createElement(Harness));});
 assert.equal(view.root.findByType('input').props.checked,true);
 assert.match(text(view.root),/Send to party/);assert.match(text(view.root),/specific character/);
 await act(async()=>view.root.findByType('input').props.onChange({target:{checked:false}}));
 assert.deepEqual(saved,{path:'/merchant/routine-priorities',body:{priorities:{},enabled:{deliveries:false}}});
 assert.equal(view.root.findByType('fieldset').props.disabled,true);
 await act(async()=>finish());assert.equal(view.root.findByType('input').props.checked,true);
 assert.equal(view.root.findByProps({role:'alert'}).children[0],'Save rejected');
 fail=false;await act(async()=>view.root.findByType('input').props.onChange({target:{checked:false}}));
 assert.equal(view.root.findAllByProps({role:'alert'}).length,0);
 await act(async()=>finish());assert.equal(view.root.findByType('input').props.checked,false);
 await act(async()=>view.unmount());
});

test('disabled delivery routine stays visible and inaccessible to edits, reordering or stale saves',async()=>{
 const previous=global.window;global.window={matchMedia:()=>({matches:true})};
 const {RoutinePrioritiesDialog}=load('routine-priorities-dialog');let view,saved;
 const props={open:true,onOpenChange(){},priorities:{deliveries:90,fishing:20,mining:10},enabled:{deliveries:true},onSave:async(...args)=>{saved=args;}};
 try {
  await act(async()=>{view=create(React.createElement(RoutinePrioritiesDialog,props));});
  assert.equal(view.root.findByProps({'aria-label':'Marked deliveries priority'}).props.disabled,false);
  assert.equal(view.root.findAllByProps({'aria-label':'Enable Marked deliveries'}).length,0);
  await act(async()=>view.root.findByProps({'aria-label':'Marked deliveries priority'}).props.onChange({target:{value:'97'}}));
  await act(async()=>view.update(React.createElement(RoutinePrioritiesDialog,{...props,enabled:{deliveries:false}})));
  const row=view.root.findByProps({'data-routine':'deliveries'});
  assert.equal(row.props['aria-disabled'],true);assert.match(text(row),/Enable in Merchant settings/);
  assert.equal(row.findByType('Input').props.disabled,true);assert.equal(row.findByType('Input').props.value,90);
  assert.equal(row.findByType('button').props.disabled,true);
  await act(async()=>row.findByType('button').props.onKeyDown({key:'ArrowDown',preventDefault(){}}));
  await act(async()=>view.root.findByProps({'aria-label':'Move Fishing'}).props.onKeyDown({key:'ArrowUp',preventDefault(){}}));
  assert.equal(row.findByType('Input').props.value,90);
  await act(async()=>view.root.findAllByType('Button').find(node=>text(node)==='Save routines').props.onClick());
  assert.equal('deliveries' in saved[0],false);assert.equal('deliveries' in saved[1],false);
  await act(async()=>view.update(React.createElement(RoutinePrioritiesDialog,props)));
  assert.equal(view.root.findByProps({'aria-label':'Marked deliveries priority'}).props.disabled,false);
 }finally{if(view)await act(async()=>view.unmount());global.window=previous;}
});
