const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),Module=require('node:module');
const {buildSync}=require('esbuild'),React=require('../../dashboard/node_modules/react');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
const filename=path.resolve('dashboard/features/party/merchant-visit-control.tsx');
const bundle=buildSync({entryPoints:[filename],bundle:true,packages:'external',external:['@/components/ui/dialog','@/hooks/use-clock','./query-actions'],platform:'node',format:'cjs',write:false});
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=Module._nodeModulePaths(path.dirname(filename));
let calls=[],finish;
const action={isPending:false,error:null,reset(){},mutateAsync(value){calls.push(value);return new Promise(resolve=>{finish=resolve})}};
compiled.require=function(id){
 if(id==='@/components/ui/dialog')return Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogTitle'].map(name=>[name,props=>React.createElement('section',props)]));
 if(id==='@/hooks/use-clock')return {useClock:()=>100000};
 if(id==='./query-actions')return {usePartyAction:()=>action};
 return Module.prototype.require.call(this,id);
};
compiled._compile(bundle.outputFiles[0].text,filename);
global.IS_REACT_ACT_ENVIRONMENT=true;
test('merchant picker excludes offline/merchant characters and queues one visit for repeated clicks',async()=>{
 let tree;
 await act(async()=>{tree=create(React.createElement(compiled.exports.MerchantVisitControl,{merchant:'M',characters:[{name:'M',ctype:'merchant',seenAt:99999},{name:'W',ctype:'warrior',seenAt:99999},{name:'P',ctype:'priest',seenAt:1}]}))});
 const targets=tree.root.findAllByType('button').filter(b=>b.children.includes('W'));
 assert.equal(targets.length,1);assert.ok(!tree.root.findAllByType('button').some(b=>b.children.includes('P')));
 await act(async()=>{targets[0].props.onClick();targets[0].props.onClick()});
 assert.deepEqual(calls,[{path:'/command',body:{character:'W',type:'bank'}}]);
 await act(async()=>finish({ok:true}));
 assert.match(JSON.stringify(tree.toJSON()),/Merchant visit queued for W/);
 await act(async()=>tree.unmount());
});
