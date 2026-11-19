const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const ts=require('../../node_modules/typescript');
test('pending cards show Steam progress without inventing telemetry; only a primary card offers the Steam recovery controls and no game command',()=>{
 const source=fs.readFileSync('dashboard/features/party/pending-character-cards.tsx','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export function','function');
 const code=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022}}).outputText;
 // The stub runs a function component, so the recovery controls a child draws reach the tree.
 const createElement=(type,props,...children)=>typeof type==='function'?type({...props,children}):{type,props:props||{},children:children.flat(Infinity)};
 const c=vm.createContext({CharacterPortrait:'Portrait',useState:value=>[value,()=>{}],React:{createElement}});
 vm.runInContext(code,c);
 const model={chars:[{name:'Ready'}],state:{characterConnections:[
  {name:'Ready',status:'connected'}, {name:'Primary',status:'code',primary:true,delayed:true}, {name:'Mage',status:'loading',delayed:true,error:'Retrying connection'}
 ],activeSlots:[{character:'Primary',kind:'native'},{character:'Ready',kind:'native'},{character:'Healer',kind:'headless'}],roster:[]}};
 const pending=c.pendingCharacters(model);
 assert.deepEqual(Array.from(pending,entry=>entry.name),['Primary','Mage','Healer']);
 const cards=c.PendingCharacterCards({model});
 const nodes=tree=>tree&&typeof tree==='object'?[tree,...tree.children.flatMap(nodes)]:[];
 const text=JSON.stringify(cards);
 assert.match(text,/CODE active/);assert.match(text,/Loading in Steam/);assert.match(text,/finish loading/);assert.match(text,/Retrying connection/);
 assert.match(text,/Steam primary/);assert.match(text,/Steam companion/);assert.match(text,/Headless character/);
 const controls=card=>nodes(card).filter(node=>node.props.onClick||['button','Button','input','a'].includes(node.type));
 const label=node=>JSON.stringify(node.children);
 for(const card of cards.filter(card=>card.props.key!=='Primary'))assert.deepEqual(controls(card),[],card.props.key+' offers a control');
 const primary=controls(cards.find(card=>card.props.key==='Primary'));
 assert.deepEqual(primary.map(node=>[node.type,label(node)]),[['button','["Retry Steam connection"]'],['a','["Open connection setup"]']],'the primary card offers Steam recovery only');
 assert.equal(primary[1].props.href,'/setup');
 assert.equal(model.chars.length,1);
 assert.match(text,/click Disengage, then Engage/);
 for(const [status,message] of [['stopped',/Click Engage/],['lost',/Check that it is open/]]){
  model.state.characterConnections=[{name:'Primary',status,primary:true,delayed:true}];
  const rendered=JSON.stringify(c.PendingCharacterCards({model}));
  assert.match(rendered,message);assert.doesNotMatch(rendered,/click Disengage, then Engage/);
 }
});
