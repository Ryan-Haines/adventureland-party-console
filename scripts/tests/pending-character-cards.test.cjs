const {test}=require('node:test'),assert=require('node:assert/strict');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
const {restoreGlobals}=require('./helpers/test-registry.cjs');
const {pendingCharacters,PendingCharacterCards}=require('./helpers/dashboard-query-module.cjs')('pending-character-cards.tsx',{'./character-portrait':{CharacterPortrait:'Portrait'}});
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
test('pending cards show Steam progress without inventing telemetry; only a primary card offers the Steam recovery controls and no game command',async t=>{
 restoreGlobals(t,['IS_REACT_ACT_ENVIRONMENT']);global.IS_REACT_ACT_ENVIRONMENT=true;
 const model={chars:[{name:'Ready'}],state:{characterConnections:[
  {name:'Ready',status:'connected'}, {name:'Primary',status:'code',primary:true,delayed:true}, {name:'Mage',status:'loading',delayed:true,error:'Retrying connection'}
 ],activeSlots:[{character:'Primary',kind:'native'},{character:'Ready',kind:'native'},{character:'Healer',kind:'headless'}],roster:[]}};
 assert.deepEqual(pendingCharacters(model).map(entry=>entry.name),['Primary','Mage','Healer']);
 let view;try{
  await act(async()=>view=create(React.createElement(PendingCharacterCards,{model})));
  const output=JSON.stringify(view.toJSON());
  assert.match(output,/CODE active/);assert.match(output,/Loading in Steam/);assert.match(output,/finish loading/);assert.match(output,/Retrying connection/);
  assert.match(output,/Steam primary/);assert.match(output,/Steam companion/);assert.match(output,/Headless character/);
  const cards=view.root.findAll(node=>node.type==='article');
  const named=card=>text(card.findByType('h3'));
  assert.deepEqual(cards.map(named),['Primary','Mage','Healer']);
  const controls=card=>card.findAll(node=>typeof node.type==='string'&&(!!node.props.onClick||['button','input','a'].includes(node.type)));
  for(const card of cards.filter(card=>named(card)!=='Primary'))assert.deepEqual(controls(card).map(node=>node.type),[],named(card)+' offers a control');
  const primary=controls(cards.find(card=>named(card)==='Primary'));
  assert.deepEqual(primary.map(node=>[node.type,text(node)]),[['button','Retry Steam connection'],['a','Open connection setup']],'the primary card offers Steam recovery only');
  assert.equal(primary[1].props.href,'/setup');
  assert.equal(model.chars.length,1);
  assert.match(output,/click Disengage, then Engage/);
  for(const [status,message] of [['stopped',/Click Engage/],['lost',/Check that it is open/]]){
   model.state.characterConnections=[{name:'Primary',status,primary:true,delayed:true}];
   await act(async()=>view.update(React.createElement(PendingCharacterCards,{model:{...model}})));
   const rendered=JSON.stringify(view.toJSON());
   assert.match(rendered,message);assert.doesNotMatch(rendered,/click Disengage, then Engage/);
  }
 }finally{await act(async()=>view?.unmount());}
});
