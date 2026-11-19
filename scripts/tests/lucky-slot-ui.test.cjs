const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/dashboard-query-module.cjs');
const React=require('../../dashboard/node_modules/react');
const {renderToStaticMarkup}=require('../../dashboard/node_modules/react-dom/server');
const {physicalInventory}=load('lucky-upgrade-slot.tsx');
const {validLuckySlot}=require('../../runtime/items/api.ts');
test('physical slots preserve index 7 and do not compact empty cells',()=>{
 const entries=[{slot:8,item:{name:'sword'}},{slot:0,item:{name:'tracker'}}];
 const cells=physicalInventory(entries);assert.equal(cells.length,42);assert.equal(cells[7],null);
 assert.equal(cells[8],entries[0]);assert.equal(cells[0],entries[1]);
 assert.equal(validLuckySlot(0),true);for(const value of [null,undefined,-1,42,7.5,'7'])assert.equal(validLuckySlot(value),false);
});
test('slot search UI distinguishes missing evidence, inference, and verified slot zero',()=>{
 const {LuckySlotStatistics}=load('lucky-slot-tracker.tsx');
 const render=props=>renderToStaticMarkup(React.createElement(LuckySlotStatistics,props));
 assert.match(render({}),/Testing starts at slot 0/);
 const {luckySlotAnswer}=require('../../runtime/items/api.ts');
 assert.match(render({lucky:luckySlotAnswer({luckyUpgradeSlots:{M:0}},'M')}),/Verified slot: 0/);
 const markup=render({tracking:{version:1,slots:{7:{totalRolls:1,sumRolls:0,rollsAbove96_3:0,perfectRolls:1}}}});
 assert.match(markup,/Leading candidate: slot 7/);assert.doesNotMatch(markup,/Statistically inferred:/);
 assert.match(markup,/No extra upgrades are queued/);
 assert.equal((markup.match(/<tr\b[^>]*\bdata-slot=/g)||[]).length,42);
 assert.match(markup,/Next upgrade will test for lucky upgrade/);
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

// The card's label and the dialog draw a locked and a resuming slot from the items owner's one
// answer.
test('a locked slot and a resuming slot draw from luckySlotAnswer',()=>{
 const {luckySlotAnswer}=require('../../runtime/items/api.ts');
 const {LuckySlotStatistics}=load('lucky-slot-tracker.tsx');
 const render=lucky=>renderToStaticMarkup(React.createElement(LuckySlotStatistics,{lucky}));
 const locked=luckySlotAnswer({luckySlotLocks:{M:5},luckySlotResume:{M:{slot:9}},luckyUpgradeSlots:{M:3}},'M');
 assert.deepEqual(locked,{slot:5,locked:5,resuming:false,verified:3});
 assert.match(render(locked),/Locked slot: 5/);
 const resuming=luckySlotAnswer({luckySlotResume:{M:{slot:9}},luckyUpgradeSlots:{M:3}},'M');
 assert.deepEqual(resuming,{slot:9,locked:null,resuming:true,verified:3});
 const markup=render(resuming);
 assert.doesNotMatch(markup,/Verified slot/);assert.match(markup,/slot 9 \(inventory position 10\)/);
});
