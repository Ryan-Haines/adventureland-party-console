import { test, expect } from './live-fixtures';

// Failure modes: orb eligibility hides Equip; menu/command changes the item;
// native equip chooses another slot or silently ignores it; replacement destroys
// the old orb; restarting the coordinator replays or loses the equipped result.
test('Loaded Die equips through the priest inventory menu into the native orb slot',async({live,page},info)=>{
  test.setTimeout(240_000);
  const name='E2EPriest';
  const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
    if(!p||p.items[10])throw Error('Loaded Die fixture requires empty inventory cell 10');
    if(G.items.cave_loaded_die.type!=='orb')throw Error('Native Loaded Die must be orb equipment');
    p.items[10]={name:'cave_loaded_die',level:0};
    p.slots.orb={name:'orbofint',level:0};
    cache_player_items(p);p.cslots.orb=cache_item(p.slots.orb);resend(p,'reopen+cid');
    return {definition:G.items.cave_loaded_die,items:p.items,orb:p.slots.orb};})()`);
  await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='cave_loaded_die'),{timeout:30_000}).toBe(true);
  await page.goto(live.url);
  const priest=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
  const inventory=priest.getByRole('button',{name:/^Inventory/});
  if(await inventory.getAttribute('aria-expanded')!=='true')await inventory.click();
  const die=priest.getByLabel('Loaded Die',{exact:true});
  await expect(die).toBeVisible();await die.click({button:'right'});
  await expect(page.getByRole('menuitem',{name:'Equip',exact:true})).toBeVisible();
  await page.getByRole('menuitem',{name:'Equip',exact:true}).click();
  await expect.poll(()=>live.admin(`output=get_player('${name}').slots.orb`),{timeout:30_000}).toMatchObject({name:'cave_loaded_die',level:0});
  const cargo=()=>live.admin(`output=(()=>{const p=get_player('${name}');return {items:p.items,slots:p.slots}})()`);
  const after=await cargo();
  expect(after.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
  expect([...after.items,...Object.values(after.slots)].filter((item:any)=>item?.name==='cave_loaded_die')).toHaveLength(1);
  await live.restartCoordinator();
  const restarted=await cargo();expect(restarted.slots.orb).toMatchObject({name:'cave_loaded_die',level:0});
  expect(restarted.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
  await info.attach('loaded-die-native-equipment',{body:JSON.stringify({seed,after,restarted,events:await live.clients[name].events()}),contentType:'application/json'});
  await info.attach('loaded-die-priest-inventory',{body:await page.screenshot({fullPage:true}),contentType:'image/png'});
});
