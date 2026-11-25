const {test}=require('node:test'),assert=require('node:assert/strict'),load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react'),{create,act}=require('../../dashboard/node_modules/react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT=true;
const {PassiveHuntingMenu}=load('passive-hunting-menu.tsx',{'@/components/ui/*':new Proxy({},{get:(_,key)=>String(key)})});
const text=n=>typeof n==='string'?n:(n.children||[]).map(text).join('');
test('searchable menu saves separate enable, movement, priority and generator choices with readable controls',async()=>{
 const calls=[],props={renderMonsterDetails:(id,onClose)=>React.createElement('MonsterDetails',{id,onClose}),settings:{version:1,rules:{},useFieldGenerators:true},catalog:[{id:'bee',name:'Bee'},{id:'phoenix',name:'Phoenix'},{id:'fieldgen0',name:'Generator'}],onSave:async patch=>calls.push(patch)};
 let view;try{
  await act(async()=>view=create(React.createElement(PassiveHuntingMenu,props)));
  assert.ok(text(view.toJSON()).includes('Monsters that are automatically attacked when spotted on the map'));
  const button=view.root.findByType('Button');assert.equal(text(button),'Open passive hunting menu');
  await act(async()=>button.props.onClick());assert.equal(view.root.findByType('Dialog').props.open,true);
  assert.ok(text(view.root.findByType('PopoverContent')).includes('Priority affects both active and passive hunting targets'));
  assert.equal(view.root.findAllByType('Checkbox').some(n=>n.props['aria-label']==='Passively hunt Generator'),false);
  const enabled=view.root.findAllByType('Checkbox').find(n=>n.props['aria-label']==='Passively hunt Bee');
  await act(async()=>enabled.props.onCheckedChange(true));assert.deepEqual(calls.pop(),{rules:{bee:{enabled:true}}});
  const moving=view.root.findAllByType('Checkbox').find(n=>n.props['aria-label']==='Keep moving to destination for Bee');assert.equal(moving.props.checked,false);
  await act(async()=>moving.props.onCheckedChange(true));assert.deepEqual(calls.pop(),{rules:{bee:{keepMoving:true}}});
  const interrupts=view.root.findAllByType('Checkbox').find(n=>n.props['aria-label']==='Bee May interrupt Hunt');assert.equal(interrupts.props.checked,true,'a rare interrupts the Hunt unless its rule says otherwise');
  await act(async()=>interrupts.props.onCheckedChange(false));assert.deepEqual(calls.pop(),{rules:{bee:{interruptsHunt:false}}});
  const input=()=>view.root.findAllByType('input').find(n=>n.props['aria-label']==='Bee passive priority');
  await act(async()=>input().props.onChange({target:{value:'123'}}));await act(async()=>input().props.onBlur());assert.deepEqual(calls.pop(),{rules:{bee:{priority:123}}});
  await act(async()=>input().props.onChange({target:{value:'-1'}}));await act(async()=>input().props.onBlur());assert.equal(calls.length,0);assert.ok(view.root.findByProps({role:'alert'}));
  await act(async()=>view.root.findAllByType('Checkbox')[0].props.onCheckedChange(false));assert.deepEqual(calls.pop(),{useFieldGenerators:false});
  await act(async()=>view.root.findByProps({'aria-label':'Filter passive hunting monsters'}).props.onChange({target:{value:'PHOENIX'}}));
  assert.equal(view.root.findAllByType('Checkbox').some(n=>n.props['aria-label']==='Passively hunt Bee'),false);
  assert.equal(view.root.findAllByType('Checkbox').some(n=>n.props['aria-label']==='Passively hunt Phoenix'),true);
  await act(async()=>view.root.findByProps({'aria-label':'Inspect Phoenix'}).props.onClick());
  assert.equal(view.root.findByType('MonsterDetails').props.id,'phoenix');
  assert.equal(view.root.findByType('Dialog').props.open,true);
  await act(async()=>view.root.findByType('MonsterDetails').props.onClose());
  assert.equal(view.root.findAllByType('MonsterDetails').length,0);
  assert.equal(view.root.findByType('Dialog').props.open,true);
  assert.equal(view.root.findByProps({'aria-label':'Filter passive hunting monsters'}).props.value,'PHOENIX');
  assert.equal(calls.length,0);
 }finally{await act(async()=>view?.unmount());}
});


const {farmingSection,farmingModel}=require('./helpers/farming-section.cjs');
const FarmingSettingsSection=farmingSection({'@/components/ui/*':new Proxy({},{get:(_,key)=>String(key)})});
test('closing nested monster details preserves both passive hunting and the settings menu',async()=>{
 // The outer Dialog stands for the settings menu, which draws the Farming section in its body.
 const model=farmingModel({},{monsters:[{id:'bee',name:'Bee'}]});
 let view;try{
  await act(async()=>view=create(React.createElement('Dialog',{open:true},React.createElement(FarmingSettingsSection,{model,name:'R'}))));
  await act(async()=>view.root.findAllByType('Button').find(n=>text(n)==='Open passive hunting menu').props.onClick());
  const search=()=>view.root.findByProps({'aria-label':'Filter passive hunting monsters'});
  await act(async()=>search().props.onChange({target:{value:'bee'}}));
  // A second inspect opens and closes the same way.
  for(let round=0;round<2;round++) {
   await act(async()=>view.root.findAllByType('button').find(n=>n.props['aria-label']==='Inspect Bee').props.onClick());
   const dialogs=view.root.findAllByType('Dialog').filter(dialog=>dialog.props.open);assert.equal(dialogs.length,3);
   assert.ok(dialogs[1].findAllByType('Dialog').includes(dialogs[2]),'monster dialog must be nested inside passive hunting');
   await act(async()=>dialogs[2].props.onOpenChange(false));
   const remaining=view.root.findAllByType('Dialog').filter(dialog=>dialog.props.open);assert.equal(remaining.length,2);assert.equal(search().props.value,'bee');
  }
  assert.deepEqual(model.calls.filter(([name])=>name==='openSettings'),[],'closing the monster details leaves the settings menu open');
 }finally{await act(async()=>view?.unmount());}
});
