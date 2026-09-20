const {test}=require('node:test'),assert=require('node:assert/strict');
const {itemActionBanner}=require('../../dashboard/features/party/item-action-banner.ts');
test('processing is the only banner over collection and bank preferences on fighters and merchant',()=>{
 for(const merchant of [false,true])for(const action of ['upgrade','compound']){
  const label=action==='compound'?'Auto compound → +3':'Auto → +3';
  const result=itemActionBanner([{action:'bank',label:'Auto bank'},{action:'merchant',label:'Auto merchant'},{action,automatic:true,label}],merchant);
  assert.equal(result.label,label);assert.match(result.border,/violet|fuchsia/);
 }
});
test('NPC sale hides merchant pickup and merchant never shows its own collection banner',()=>{
 assert.equal(itemActionBanner([{action:'merchant',label:'Mark for merchant'},{action:'npc',label:'NPC sale'}],false).label,'NPC sale');
 assert.equal(itemActionBanner([{action:'merchant',label:'Auto merchant'}],true),null);
 assert.equal(itemActionBanner([{action:'merchant',label:'Auto merchant'}],false).label,'Auto merchant');
});
test('real automatic rule conflicts show one conflict banner; bank is not a conflict',()=>{
 assert.equal(itemActionBanner([{action:'compound',label:'Auto compound',automatic:true},{action:'npc',label:'NPC sale',automatic:true}],false).label,'Rule conflict');
 assert.equal(itemActionBanner([{action:'bank',label:'Auto bank'},{action:'npc',label:'NPC sale',automatic:true}],false).label,'NPC sale');
});
