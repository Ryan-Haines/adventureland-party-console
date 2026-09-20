const test = require('node:test'), assert = require('node:assert/strict');
const { merchantJobLabel: label } = require('../../dashboard/features/party/merchant-job-label.ts');
const { projectMerchantJob } = require('../../runtime/coordinator/telemetry/merchant-projection.ts');
const ports = {stamp:j=>j,slots:()=>1,threshold:()=>4,nearby:()=>true};
for (const [reason, expected] of Object.entries({
 'marked items':'Item collection','party collection':'Item collection',
 'manual visit':'Manual visit','inventory cleanout':'Emergency cleanout','gold threshold':'Auto gold collection',
 'npc sales':'NPC sales','npc sale pickup':'NPC sales','auto npc sales':'Auto NPC sales','auto npc sale pickup':'Auto NPC sales',
 'manual crafting':'Craft','manual bank exchange':'Bank exchange','stand maintenance':'Stand maintenance','merchant idle':'Idle',
 'auto upgrade':'Auto upgrade','manual upgrades':'Manual upgrades','manual compounds':'Manual compounds','collect mail':'Collect mail','send mail':'Send mail',
 'ALData marketplace sales':'ALData marketplace sales',fishing:'Fishing',mining:'Mining',
})) test(reason+' uses agreed label',()=>{
 const job={reason,target:'QwenTina',collectionLabel:'nearby collection'};
 assert.equal(label(job),expected);assert.equal(label(projectMerchantJob(job,ports)),expected);
});
for(const reason of ['stand purchases','stand bid purchases','ALData marketplace purchases','Ponty purchases']) {
 for(const manual of [true,false]) test(`${reason}: manual=${manual}`,()=>{
  const job={reason,target:'M',manual,bidItemId:'sword',listings:[{item:{name:'sword',level:2},quantity:3,serverRegion:'US',serverIdentifier:'II'}]};
  const view=projectMerchantJob(job,ports);
  assert.equal(view.routine,manual?'manual marketplace purchases':'stand bid purchases');
  assert.equal(job.routine,undefined);
  assert.equal(label(view,[{id:'sword',name:'Sword'}]),`${manual?'Manual':'Auto'} purchase · ${reason==='Ponty purchases'?'Ponty · ':''}3 × Sword +2 · US II`);
 });
}
test('commerce uses resolved routine and buy-upgrade intent',()=>{
 assert.equal(label({reason:'merchant commerce',order:{buys:[{desiredLevel:0}]}}),'Buy');
 assert.equal(label({reason:'merchant commerce',order:{buys:[{desiredLevel:4}]}}),'Buy and upgrade');
 assert.equal(label({reason:'merchant commerce',routine:'manual crafting',order:{buys:[{desiredLevel:4}],crafts:[{}]}}),'Craft');
});
test('giveaway names retain host and item capitalization and omit unavailable details',()=>{
 const job={reason:'join giveaway',seller:'Callidron',expectedItem:{name:'mpot0'}};
 assert.equal(label(job,[{id:'mpot0',name:'MP Potion'}]),"Join Callidron's giveaway for MP Potion");
 assert.equal(label({reason:'join giveaway',seller:'Callidron'}),"Join Callidron's giveaway");
 assert.equal(label({reason:'join giveaway'}),'Join giveaway');
});

test('bank activity replaces processing labels',()=>{assert.equal(label({reason:'auto compound',target:'M',operationStage:'retrieving'}),'Bank retrieval');assert.equal(label({reason:'auto upgrade',target:'M',operationStage:'storing'}),'Bank storage');assert.equal(label({reason:'auto compound',target:'M',operationStage:'processing'}),'Auto compound');});
