const test = require('node:test'), assert = require('node:assert/strict');
const {scenarioTable}=require('./fixtures/scenarios.cjs');
const fs = require('node:fs'), vm = require('node:vm');
const { exchangeRewards } = require('../../runtime/items/character/market.ts');
const load = require('./helpers/dashboard-query-module.cjs');
const React = require('../../dashboard/node_modules/react');
const { renderToStaticMarkup } = require('../../dashboard/node_modules/react-dom/server');
const { ItemExchangeDetails } = load('item-exchange-details.tsx');
const game = vm.createContext({});
vm.runInContext(fs.readFileSync(require('node:path').join(require('./helpers/installed-game.cjs').directory,'data.js'), 'utf8'), game);

test('nested tables multiply probabilities and combine identical rewards without opening awarded boxes', () => {
  const data = { items: {}, drops: { box: [[2,'open','nested'],[2,'gold',100],[1,'armorbox']], nested: [[1,'gold',100],[3,'sword']] } };
  const results = exchangeRewards(data, 'box');
  assert.equal(results.find(r => r.id === 'gold').chance, 0.5);
  assert.ok(Math.abs(results.find(r => r.id === 'sword').chance - 0.3) < 1e-10);
  assert.equal(results.find(r => r.id === 'armorbox').chance, 0.2);
});

test('real Mystery Box and Armor Box tables expand into rewards whose probabilities sum to one', () => {
  for (const id of ['mysterybox','armorbox']) {
    const results = exchangeRewards(game.G, id);
    assert.ok(results.length > 10);
    assert.ok(results.every(r => r.kind !== 'open'));
    assert.ok(Math.abs(results.reduce((sum,r) => sum + r.chance,0) - 1) < 1e-10);
  }
  assert.equal(game.G.tokens.monstertoken.tracker, 4);
});

const token = {key:'monstertoken@0:tracker',id:'monstertoken',level:0,name:'Tracktrix',required:4,reward:'tracker',rewardQuantity:1,currencyName:'Monster Token',npc:'monsterhunter',results:[]};
const render = props => renderToStaticMarkup(React.createElement(ItemExchangeDetails,{level:0,box:false,onInspect(){},...props}));
scenarioTable('the exchange details show prices, rewards and sources from the same exchange list',null,[
 ['Tracktrix shows acquisition cost; tokens show guaranteed selectable rewards',() => {
  const price = render({id:'tracker',exchanges:[token]});
  assert.match(price,/Exchange price/);assert.match(price,/4 × Monster Token/);assert.doesNotMatch(price,/Exchange drops/);
  const reward = render({id:'monstertoken',exchanges:[token]});
  assert.match(reward,/Exchange drops/);assert.match(reward,/1 × Tracktrix/);assert.match(reward,/100%/);
  assert.equal(render({id:'tracker',level:1,exchanges:[token]}),'');
}],
 ['boxes label actual rewards and display tiny probabilities without rounding them to zero',() => {
  const html=render({id:'armorbox',box:true,exchanges:[{key:'armorbox@0',id:'armorbox',level:0,required:1,name:'Armor Box',results:[{id:'fury',kind:'fury',name:'Fury',quantity:1,chance:0.00005}]}]});
  assert.match(html,/>Rewards</);assert.match(html,/0.005%/);
}],
 ['Exchange reward finds both direct and nested box rewards, with sprites and percentages',() => {
  const ids=['armorbox','mysterybox'];
  const sprite={url:'/box.png',columns:1,rows:1,x:0,y:0};
  const catalog=ids.map(id=>({id,meta:{definition:game.G.items[id]}}));
  const exchanges=ids.map(id=>({id,key:id+'@0',level:0,name:game.G.items[id].name,required:1,sprite,results:exchangeRewards(game.G,id)}));
  const html=render({id:'hhelmet',catalog,exchanges});
  assert.match(html,/Exchange reward/);assert.match(html,/Armor Box/);assert.match(html,/Mystery Box/);
  // Shows six significant digits under each ratio. The heading and level assertions keep the
  // earlier console's text.
  assert.match(html,/15\.0654%/);assert.match(html,/box\.png/);
  // A source shows at every level of the item, since an exchange result names the item and not its level.
  assert.match(render({id:'hhelmet',level:1,catalog,exchanges}),/Exchange reward/);
}],
 ['Exchange reward includes non-box exchanges with their required quantity and reward odds',() => {
  const definition=game.G.items.seashell;
  const results=exchangeRewards(game.G,'seashell');
  const dexterity=results.find(result=>/dexterity/i.test(result.name));
  assert.ok(dexterity, 'seashell exchange awards a dexterity elixir');
  const sprite={url:'/seashell.png',columns:1,rows:1,x:0,y:0};
  const html=render({id:dexterity.id,exchanges:[{id:'seashell',key:'seashell@0',level:0,name:definition.name,required:definition.e,sprite,results}]});
  assert.match(html,/Exchange reward/);assert.match(html,/20 × Seashell/);
  assert.match(html,/seashell\.png/);
  assert.ok(html.includes(`${(dexterity.chance*100).toLocaleString('en-US',{maximumSignificantDigits:6})}%`));
  assert.doesNotMatch(html,/per box opened/);
}],
 ['Exchange reward combines alternate quantities, excludes token shops, and navigates to the box',async () => {
  const renderer=require('../../dashboard/node_modules/react-test-renderer');
  global.IS_REACT_ACT_ENVIRONMENT=true;
  const result=(quantity,chance)=>({id:'scroll3',kind:'scroll3',name:'Scroll',quantity,chance});
  const entry={id:'testbox',key:'testbox@0',level:0,name:'Test Box',required:1,results:[result(1,0.2),result(2,0.3)]};
  const props={id:'scroll3',level:0,box:false,catalog:[{id:'testbox'}],exchanges:[entry,{...token,reward:'scroll3'}]};
  const html=render(props);assert.match(html,/50%/);
  let root;const calls=[];
  await renderer.act(async()=>{root=renderer.create(React.createElement(ItemExchangeDetails,{...props,onInspect:(...args)=>calls.push(args)}));});
  const section=root.root.findAllByType('section').find(s=>s.findByType('h3').children.join('')==='Exchange reward');
  assert.equal(section.findAllByType('button').length,1);
  await renderer.act(async()=>section.findByType('button').props.onClick());
  assert.equal(calls[0][0],'testbox');assert.equal(calls[0][2],0);
  await renderer.act(async()=>root.unmount());
}],
]);

// The exchange route answers the settings writer's refusal, so a banked reward's rule the writer
// refused is never reported as saved.
test('a refused reward rule write answers 400 and leaves no bank rule',()=>{
  const {withDoor}=require('./helpers/coordinator-merchant.cjs');
  const {createMerchantExchangeRoutes}=require('../../runtime/items/coordinator/routes/production.ts');
  const state={merchantCharacter:'M',merchantCatalog:{exchangeable:[]},merchantCurrent:{id:'job',reason:'exchange',target:'M'},merchantQueue:[],
    merchantRules:{owner:'M',members:['M']},autoItemMarks:{M:{}},autoUpgradeMarks:{},autoCompounds:{},autoDeconstruction:{},autoStandMarks:{},autoExchanges:{},autoNpcSales:{}};
  const routes=createMerchantExchangeRoutes(state,withDoor(state,{write:()=>({ok:false,field:'autoItemMarks',error:'out of date'}),now:()=>100,nextCommand:()=>1,
    stamp:job=>job,log(){},persist(){},dispatch(){},queueStorage:()=>true}));
  const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  routes.progress({body:{jobId:'job',remaining:[],rewards:[{name:'leather',q:3}]}},res);
  assert.equal(res.code,400);assert.equal(res.body.error,'out of date');
  assert.deepEqual(state.autoItemMarks,{M:{}});
});
