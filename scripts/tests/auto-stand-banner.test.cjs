const test=require('node:test'),assert=require('node:assert/strict');
const React=require('../../dashboard/node_modules/react');
const {renderToStaticMarkup}=require('../../dashboard/node_modules/react-dom/server');
const load=require('./helpers/dashboard-query-module.cjs');
const {AutoStandBanner}=load('auto-stand-banner.tsx');
const {automaticCommerceRuleKey}=load('automatic-commerce-rule-key.tsx');
const {createStandMarks}=require('../../runtime/coordinator/merchant/stand-marks.ts');

test('Auto Stand follows item identity through bank and inventory transfers without requiring a listing',()=>{
 const item={name:'frankypants',level:2};const key=automaticCommerceRuleKey(item);
 const rules={[key]:{item,price:12345,createdAt:1}};
 for(const carried of [item,{...item,q:3},{...item,rid:'new',price:12345}]) {
   const html=renderToStaticMarkup(React.createElement(AutoStandBanner,{item:carried,rules}));
   assert.match(html,/Auto<br\/>stand/);assert.match(html,/12,345g/);
 }
 assert.equal(renderToStaticMarkup(React.createElement(AutoStandBanner,{item:{...item,level:3},rules})), '');
});
test('removing one bank-backed queued sale preserves the automatic rule and its price',()=>{
 const item={name:'frankypants',level:2},rule={item,price:12345,createdAt:1};
 const state={autoStandMarks:{pants:rule},merchantCharacter:'M',standListings:[{id:'sale',item,bankPack:'items0',bankSlot:2,state:'waiting'}],withdrawals:{M:[{pack:'items0',slot:2,item}]},statuses:{},bankSnapshot:null};
 createStandMarks(state,{now:()=>1,nextCommand:()=>1}).remove(0,'items0',2,item);
 assert.equal(state.standListings.length,0);assert.equal(state.withdrawals.M.length,0);
 assert.equal(state.autoStandMarks.pants,rule);assert.equal(rule.price,12345);
});
