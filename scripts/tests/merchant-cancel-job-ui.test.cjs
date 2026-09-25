const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
const filename=path.resolve('dashboard/features/party/merchant-cancel-job-control.tsx');
const bundle=buildSync({entryPoints:[filename],bundle:true,packages:'external',external:['@/components/ui/dialog','@/components/ui/button'],platform:'node',format:'cjs',write:false});
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));
compiled.require=function(id){
 if(id==='@/components/ui/button')return {Button:props=>React.createElement('button',props)};
 if(id==='@/components/ui/dialog')return {
  Dialog:props=>props.open?React.createElement('section',props):null,
  ...Object.fromEntries(['DialogContent','DialogDescription','DialogFooter','DialogHeader','DialogTitle'].map(name=>[name,props=>React.createElement('section',props)]))};
 return Module.prototype.require.call(this,id);
};
compiled._compile(bundle.outputFiles[0].text,filename);
global.IS_REACT_ACT_ENVIRONMENT=true;
test('automatic cancellation requires confirmation; dismissing leaves the routine alone and repeated confirms send once',async()=>{
 let tree,finish;const calls=[];
 await act(async()=>{tree=create(React.createElement(compiled.exports.MerchantCancelJobControl,{id:'job',reason:'auto compound',label:'Auto compound',onCancel:id=>{calls.push(id);return new Promise(resolve=>finish=resolve);}}));});
 const open=()=>tree.root.findByProps({'aria-label':'Cancel Auto compound'}).props.onClick();
 const button=label=>tree.root.findAllByType('button').find(b=>b.children.includes(label));
 await act(async()=>open());assert.deepEqual(calls,[]);
 assert.match(JSON.stringify(tree.toJSON()),/disable this routine until you re-enable it in Routines/);
 await act(async()=>button('Cancel').props.onClick());assert.deepEqual(calls,[]);assert.equal(button('Confirm'),undefined);
 await act(async()=>open());
 const confirm=button('Confirm').props.onClick;
 await act(async()=>{confirm();confirm();});assert.deepEqual(calls,['job']);
 assert.equal(button('Cancel').props.disabled,true);
 await act(async()=>finish());assert.equal(button('Confirm'),undefined);
 await act(async()=>tree.unmount());
});
test('manual compound cancellation does not claim to disable automatic routines',async()=>{
 let tree;const calls=[];
 await act(async()=>{tree=create(React.createElement(compiled.exports.MerchantCancelJobControl,{id:'manual',reason:'manual compounds',label:'Manual compounds',onCancel:async id=>calls.push(id)}));});
 await act(async()=>tree.root.findByProps({'aria-label':'Cancel Manual compounds'}).props.onClick());
 assert.deepEqual(calls,['manual']);assert.doesNotMatch(JSON.stringify(tree.toJSON()),/disable this routine/);
 await act(async()=>tree.unmount());
});
