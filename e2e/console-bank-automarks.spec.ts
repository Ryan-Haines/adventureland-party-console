import {test,expect} from './fixtures';
import {automaticCommerceRuleKey} from '../runtime/coordinator/inventory/item-identity';

test('bank tiles show every automatic action and distinguish manual NPC sales',async({page,app},info)=>{
  const initial=await app.state();
  const names=['helmet','coat','shoes','staff','strring','sword','gloves'];
  const entries=names.map((name,slot)=>({slot,item:{name,level:0},meta:initial.merchantCatalog.allItems.find((entry:any)=>entry.id===name).meta}));
  // Declared bank/rule read boundary: verify rendered tiles, not native receipts.
  await page.route('**/party-api/dashboard-stream',route=>route.abort());
  await page.route('**/party-api/state*',async route=>{
    const response=await route.fetch(),state=await response.json();
    await route.fulfill({response,json:{...state,bank:{gold:0,packs:{items0:entries}},
      autoItemMarks:{M:{'helmet@+0':'bank'}},autoNpcSales:{[automaticCommerceRuleKey(entries[1].item)]:{item:entries[1].item}},
      autoDeconstruction:{M:{[automaticCommerceRuleKey(entries[2].item)]:{item:entries[2].item}}},
      autoUpgradeMarks:{M:{'staff@+0':{tiers:2,quantity:-1}}},autoCompounds:{M:[{name:'strring',targetTier:2,quantity:-1}]},
      autoStandMarks:{[automaticCommerceRuleKey(entries[5].item)]:{item:entries[5].item,price:1000}},
      npcSaleMarks:[{id:'manual-npc',source:'bank',pack:'items0',slot:6,item:entries[6].item,state:'queued'}]}});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Inspect bank',exact:true}).click();
  const bank=page.getByRole('dialog',{name:'Bank',exact:true});
  await expect(bank).toBeVisible();
  for(const [index,label] of ['Auto bank','Auto NPC','Auto deconstruction','Auto upgrade → +2','Auto compound → +2','Auto stand','NPC sale'].entries()){
    const tile=bank.getByLabel(entries[index].meta.definition.name,{exact:true});
    await expect(tile.getByText(label,{exact:true})).toBeVisible();
  }
  await info.attach('bank-all-automatic-banners',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});
