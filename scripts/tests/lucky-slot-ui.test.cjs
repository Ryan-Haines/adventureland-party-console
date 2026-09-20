const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {renderToStaticMarkup}=require('../../dashboard/node_modules/react-dom/server');
const {physicalInventory,validLuckySlot,LuckySlotOutline}=load('lucky-upgrade-slot.tsx');
test('physical slots preserve index 7 and do not compact empty cells',()=>{
 const entries=[{slot:8,item:{name:'sword'}},{slot:0,item:{name:'tracker'}}];
 const cells=physicalInventory(entries);assert.equal(cells.length,42);assert.equal(cells[7],null);
 assert.equal(cells[8],entries[0]);assert.equal(cells[0],entries[1]);
 assert.equal(validLuckySlot(0),true);for(const value of [null,undefined,-1,42,7.5,'7'])assert.equal(validLuckySlot(value),false);
});
test('gold outline extends outside the cell and cannot intercept pointer events',()=>{
 const markup=renderToStaticMarkup(React.createElement(LuckySlotOutline));
 assert.match(markup,/pointer-events-none/);assert.match(markup,/-inset-\[5px\]/);assert.match(markup,/overflow-visible/);assert.match(markup,/aria-hidden="true"/);
});
test('shared Tracktrix info renders a single account-wide bonus list',()=>{
 const req=require('node:module').createRequire(require('node:path').resolve('dashboard/package.json'));
 const {QueryClient,QueryClientProvider}=req('@tanstack/react-query');
 const {SharedTracktrixBonuses}=load('tracktrix-bonuses.tsx');
 const client=new QueryClient();
 client.setQueryData(['party','character','A','diagnostics'],{tracktrix:{active:false,bonuses:{}}});
 client.setQueryData(['party','character','B','diagnostics'],{tracktrix:{active:true,bonuses:{dex:7}}});
 const markup=renderToStaticMarkup(React.createElement(QueryClientProvider,{client},React.createElement(SharedTracktrixBonuses,{names:['A','B']})));
 assert.equal((markup.match(/Current bonuses for holding a tracktrix/g)||[]).length,1);assert.match(markup,/DEX/);assert.match(markup,/\+7/);assert.doesNotMatch(markup,/Inactive/);client.clear();
});
