const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const React=require('../../dashboard/node_modules/react');
const {create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
test('spawn popup lists multiple zones, saves radio preferences and reports failed saves',async()=>{
  const exports={};
  const code=ts.transpileModule(fs.readFileSync('dashboard/features/party/hunt-spawn-settings.tsx','utf8'),{
    compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,Error,require(id){
    if(id==='react')return React;
    if(id==='react/jsx-runtime')return require('../../dashboard/node_modules/react/jsx-runtime');
    // The dashboard reads 07 through its door (owner:check), so the test loads that door.
    if(id.endsWith('hunting/api.ts'))return require('../../runtime/hunting/api.ts');
    return new Proxy({},{get:(_,name)=>name});
  }});
  const a={map:'main',x:0,y:0},b={map:'arena',x:384,y:-420};
  const catalog=[{id:'cgoo',name:'Goo',locations:[a,b]},{id:'bee',name:'Bee',locations:[a]}];
  let patch,fail=false,tree;
  try{
    await act(async()=>{tree=create(React.createElement(exports.HuntSpawnSettings,{catalog,onSave:async p=>{
      if(fail)throw Error('Save unavailable');patch=p;
    }}));});
    assert.equal(tree.root.findAllByType('details').length,0);
    await act(async()=>tree.root.findByType('Button').props.onClick());
    assert.equal(tree.root.findAllByType('details').length,1);
    const radios=tree.root.findAllByType('input');
    assert.equal(radios.length,3);assert.equal(radios[0].props.checked,true);
    await act(async()=>radios[2].props.onChange());
    assert.equal(patch.preferredSpawns.cgoo,JSON.stringify(['arena',384,-420]));
    await act(async()=>radios[0].props.onChange());assert.equal(patch.preferredSpawns.cgoo,'');
    fail=true;await act(async()=>radios[1].props.onChange());
    assert.equal(tree.root.findByProps({role:'alert'}).props.children,'Save unavailable');
  }finally{if(tree)await act(async()=>tree.unmount());}
});
