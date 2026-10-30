import {test,expect} from './fixtures';
import {build} from 'esbuild';
import path from 'node:path';

// Failure inventory: docs/testing-release-1.5.md; native catalog input is declared,
// maintained dialogs and navigation run in the actual console browser/styles.
// Additional failures: reciprocal formatting produces fractional denominators;
// derivation labels obscure the final reward odds; long ratios cover sprites or
// adjacent cards; removing roll labels accidentally loses distinct drop lines.
// Event failures: ingredient links missing outside the gathering window; active
// ingredients duplicated as ordinary loot; unrelated monsters inheriting drops;
// event cards losing item navigation; tiny nonzero odds rounding to zero percent.
test('monster rewards separate home drops and explain independent rolls with ratio odds',async({page,app},info)=>{
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:path.resolve('dashboard/tsconfig.json'),stdin:{resolveDir:path.resolve('dashboard'),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {MonsterDetailsDialog} from './features/party/monster-details-dialog';import {ItemDetails} from './features/party/item-details';
    const root=createRoot(document.getElementById('root'));window.openItemRewards=()=>{root.render(null);setTimeout(()=>root.render(<ItemDetails selected={{character:'W',entry:{slot:1,item:{name:'xpants'},meta:{definition:{name:'Pants of the Fallen Master'},world:{drops:[{monsterId:'mrgreen',monsterName:'Mr. Green',sourceType:'home',rate:0.004,quantity:1},{monsterId:'mrpumpkin',monsterName:'Mr. Pumpkin',sourceType:'monster',rate:0.001,quantity:1},{monsterId:'mrpumpkin',monsterName:'Mr. Pumpkin',sourceType:'monster',rate:0.004,quantity:2},...[3,2,1].map(n=>({monsterId:'snowman',monsterName:'Snowman',sourceType:'monster',rate:n/155,originRate:0.3,quantity:1,acquisitionPath:['open native-loot','hotchocolate'],sprite:{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',columns:1,rows:1,x:0,y:0}})),{monsterId:'exchangeonly',monsterName:'Exchange Only',sourceType:'monster',rate:0.01,quantity:1,acquisitionPath:['candycane','hotchocolate']},{monsterId:'homeexchange',monsterName:'Home Exchange',sourceType:'home',rate:0.01,quantity:1,acquisitionPath:['mistletoe','hotchocolate']},{monsterId:'xscorpion',monsterName:'Scorpion',sourceType:'monster',rate:1/202182000,quantity:1,acquisitionPath:['open 1glitch','hotchocolate']}]}}}}} catalog={[]} exchanges={[]} monsters={[]} characters={[]} achievements={{}} standFull={false} onOpenChange={()=>{}} onNavigate={()=>{}} onAddWTB={()=>{}} onAddStand={()=>{}} onCompare={()=>{}} onCompareCatalog={()=>{}}/>),0);};window.openRewards=()=>root.render(<MonsterDetailsDialog monster={{id:'mrgreen',name:'Mr. Green',hp:100,attack:1,xp:1,range:1,threat:1,definition:{cooperative:true},
      drops:[{id:'broom',name:'Broom',rate:0.001,quantity:1},{id:'broom',name:'Broom',rate:0.004,quantity:2},{id:'gift',name:'Gift',rate:5,quantity:1},{id:'cxjar',name:'CX Jar',rate:15/100000,quantity:1}],
      homeRewards:[{id:'xpants',name:'Pants of the Fallen Master',rate:0.004,quantity:1}]}} catalog={[{id:'hotchocolate',name:'Hot Chocolate',meta:{world:{drops:[{monsterId:'mrgreen',rate:0.1,quantity:1,sourceType:'zone',acquisitionPath:['candycane','hotchocolate']}]}}},{id:'essence',name:'Direct shared loot',meta:{world:{drops:[{monsterId:'mrgreen',rate:0.01,quantity:1,sourceType:'world',acquisitionPath:['World drop','open native-loot','essence']},{monsterId:'mrgreen',rate:0.02,quantity:2,sourceType:'world',acquisitionPath:['World drop','open native-loot','essence']}]}}}]} achievement={null} onOpenChange={()=>{}} onNavigate={()=>{}} onInspectDrop={id=>{document.getElementById('selected').textContent=id;}}/>);
    window.openEventRewards=(active=false)=>root.render(<MonsterDetailsDialog monster={{id:'arcticbee',name:'Arctic Bee',hp:1600,attack:1,xp:1,range:1,threat:1,definition:{},drops:active?[{id:'frostscale',name:'Frost Scale',rate:36/625,quantity:1}]:[]}} catalog={[{id:'frostscale',name:'Frost Scale',sprite:null,meta:{world:{drops:[{monsterId:'arcticbee',monsterName:'Arctic Bee',sourceType:'monster',rate:36/625,quantity:1,acquisitionPath:["Witch's Cipher: gathering window only"]}]}}},{id:'verdantspore',name:'Verdant Spore',sprite:null,meta:{world:{drops:[{monsterId:'goo',sourceType:'monster',rate:0.01,quantity:1,acquisitionPath:["Witch's Cipher: gathering window only"]}]}}}]} achievement={null} onOpenChange={()=>{}} onNavigate={()=>{}} onInspectDrop={id=>{document.getElementById('selected').textContent=id;}}/>);
  `}});
  await page.goto(app.url);const styles=await page.locator('style,link[rel="stylesheet"]').evaluateAll(nodes=>nodes.map(n=>n.outerHTML).join('\n'));
  await page.route('**/drop-rewards-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><head>${styles}</head><body><div id="root"></div><div id="selected"></div></body>`}));
  await page.goto(app.url+'/drop-rewards-harness');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>(window as any).openRewards());
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:/Home rewards/})).toBeVisible();
  await expect(dialog.getByText(/Home-server bonus required/)).toBeVisible();
  const pants=dialog.getByRole('button',{name:/Pants of the Fallen Master/});await expect(pants).toContainText('1/250');
  const broom=dialog.getByRole('button',{name:/Broom/});await expect(broom).toHaveCount(1);await expect(broom).toContainText('1/1,000');await expect(broom).toContainText('1/250');await expect(broom).toContainText('\u00d72');
  await expect(dialog.getByText(/contribution, luck and monster level/)).toBeVisible();
  await expect(dialog.getByRole('button',{name:/CX Jar/})).toContainText('3/20,000');
  await expect(dialog.getByText(/Roll \d|Independent rolls|roll weight/i)).toHaveCount(0);
  await expect(dialog.getByRole('button',{name:/Hot Chocolate/})).toHaveCount(0);
  const shared=dialog.getByRole('button',{name:/Direct shared loot/});await expect(shared).toHaveCount(1);
  await expect(shared).toContainText('1/100 (1%)');await expect(shared).toContainText('1/50 (2%) \u00d72');
  const gift=dialog.getByRole('button',{name:/Gift/});await expect(gift).toContainText('1/1');await expect(gift).not.toContainText('\u00d75');
  await pants.click();await expect(page.locator('#selected')).toHaveText('xpants');await info.attach('monster-home-rewards',{body:await dialog.screenshot(),contentType:'image/png'});
  await page.evaluate(()=>(window as any).openItemRewards());const itemDialog=page.getByRole('dialog',{name:'Pants of the Fallen Master',exact:true});
  await expect(itemDialog.getByRole('heading',{name:'Home rewards',exact:true})).toBeVisible();await expect(itemDialog.getByRole('button',{name:/Mr. Green/})).toContainText('1/250');
  const pumpkin=itemDialog.getByRole('button',{name:/Mr. Pumpkin/});await expect(pumpkin).toHaveCount(1);await expect(pumpkin).toContainText('1/1,000');await expect(pumpkin).toContainText('1/250');
  const headings=await itemDialog.getByRole('heading').allTextContents();expect(headings.indexOf('Home rewards')).toBeLessThan(headings.indexOf('Monster drops'));
  await expect(itemDialog.getByRole('button',{name:/Exchange Only|Home Exchange/})).toHaveCount(0);
  const snowman=itemDialog.getByRole('button',{name:/Snowman/});
  await expect(snowman).toContainText('3/155');await expect(snowman).toContainText('2/155');await expect(snowman).toContainText('1/155');
  await expect(itemDialog.getByRole('button',{name:/Scorpion/})).toContainText('1/202,182,000');
  await expect(itemDialog.getByText(/candycane|hotchocolate|open 1glitch|Roll \d|Independent rolls|roll weight/i)).toHaveCount(0);
  for(const width of [1440,640,390]){
    await page.setViewportSize({width,height:1000});
    const sprite=snowman.getByRole('img',{name:'Snowman sprite'}),odds=snowman.getByLabel('Snowman drop chances');
    const bounds=await Promise.all([snowman.boundingBox(),sprite.boundingBox(),odds.boundingBox()]);
    expect(bounds.every(Boolean)).toBe(true);const[card,art,chances]=bounds as {x:number;y:number;width:number;height:number}[];
    expect(chances.x).toBeGreaterThanOrEqual(art.x+art.width);
    expect(chances.x+chances.width).toBeLessThanOrEqual(card.x+card.width);
    expect(chances.y+chances.height).toBeLessThanOrEqual(card.y+card.height);
    await info.attach('drop-card-layout-'+width,{body:await itemDialog.screenshot(),contentType:'image/png'});
  }
  await info.attach('item-home-rewards',{body:await itemDialog.screenshot(),contentType:'image/png'});
  await expect(itemDialog.getByRole('button',{name:/Scorpion/})).toContainText('(0.000000494604%)');
  for(const active of [false,true]){
    await page.evaluate(active=>(window as any).openEventRewards(active),active);
    const eventDialog=page.getByRole('dialog',{name:'Arctic Bee',exact:true});
    await expect(eventDialog.getByRole('heading',{name:'Event drops (1)',exact:true})).toBeVisible();
    await expect(eventDialog.getByRole('heading',{name:'Monster-specific drops (0)',exact:true})).toBeVisible();
    const ingredient=eventDialog.getByRole('button',{name:/Frost Scale/});
    await expect(ingredient).toHaveCount(1);await expect(ingredient).toContainText('36/625 (5.76%)');
    await expect(ingredient).toContainText("Witch's Cipher: gathering window only");
    await expect(eventDialog.getByRole('button',{name:/Verdant Spore/})).toHaveCount(0);
    await ingredient.click();await expect(page.locator('#selected')).toHaveText('frostscale');
    await info.attach('monster-event-drops-'+(active?'active':'inactive'),{body:await eventDialog.screenshot(),contentType:'image/png'});
  }
});
