import {test,expect} from './fixtures';
import {build} from 'esbuild';
import path from 'node:path';

// Failure inventory: docs/testing-release-1.5.md; native catalog input is declared,
// maintained dialogs and navigation run in the actual console browser/styles.
test('monster rewards separate home drops and explain independent rolls with ratio odds',async({page,app},info)=>{
  const bundle=await build({bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:path.resolve('dashboard/tsconfig.json'),stdin:{resolveDir:path.resolve('dashboard'),loader:'tsx',contents:`
    import React from 'react';import {createRoot} from 'react-dom/client';import {MonsterDetailsDialog} from './features/party/monster-details-dialog';import {ItemDetails} from './features/party/item-details';
    const root=createRoot(document.getElementById('root'));window.openItemRewards=()=>{root.render(null);setTimeout(()=>root.render(<ItemDetails selected={{character:'W',entry:{slot:1,item:{name:'xpants'},meta:{definition:{name:'Pants of the Fallen Master'},world:{drops:[{monsterId:'mrgreen',monsterName:'Mr. Green',sourceType:'home',rate:0.004,quantity:1},{monsterId:'mrpumpkin',monsterName:'Mr. Pumpkin',sourceType:'monster',rate:0.001,quantity:1},{monsterId:'mrpumpkin',monsterName:'Mr. Pumpkin',sourceType:'monster',rate:0.004,quantity:2}]}}}}} catalog={[]} exchanges={[]} monsters={[]} characters={[]} achievements={{}} standFull={false} onOpenChange={()=>{}} onNavigate={()=>{}} onAddWTB={()=>{}} onAddStand={()=>{}} onCompare={()=>{}} onCompareCatalog={()=>{}}/>),0);};window.openRewards=()=>root.render(<MonsterDetailsDialog monster={{id:'mrgreen',name:'Mr. Green',hp:100,attack:1,xp:1,range:1,threat:1,definition:{cooperative:true},
      drops:[{id:'broom',name:'Broom',rate:0.001,quantity:1},{id:'broom',name:'Broom',rate:0.004,quantity:2},{id:'gift',name:'Gift',rate:5,quantity:1}],
      homeRewards:[{id:'xpants',name:'Pants of the Fallen Master',rate:0.004,quantity:1}]}} catalog={[]} achievement={null} onOpenChange={()=>{}} onNavigate={()=>{}} onInspectDrop={id=>{document.getElementById('selected').textContent=id;}}/>);
  `}});
  await page.goto(app.url);const styles=await page.locator('style,link[rel="stylesheet"]').evaluateAll(nodes=>nodes.map(n=>n.outerHTML).join('\n'));
  await page.route('**/drop-rewards-harness',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><head>${styles}</head><body><div id="root"></div><div id="selected"></div></body>`}));
  await page.goto(app.url+'/drop-rewards-harness');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>(window as any).openRewards());
  const dialog=page.getByRole('dialog');await expect(dialog.getByRole('heading',{name:/Home rewards/})).toBeVisible();
  await expect(dialog.getByText(/Home-server bonus required/)).toBeVisible();
  const pants=dialog.getByRole('button',{name:/Pants of the Fallen Master/});await expect(pants).toContainText('1/250');
  const broom=dialog.getByRole('button',{name:/Broom/});await expect(broom).toHaveCount(1);await expect(broom).toContainText('1/1,000');await expect(broom).toContainText('1/250');await expect(broom).toContainText('\u00d72');
  await expect(dialog.getByText(/Independent rolls/)).toBeVisible();await expect(dialog.getByText(/contribution, luck and monster level/)).toBeVisible();
  const gift=dialog.getByRole('button',{name:/Gift/});await expect(gift).toContainText('1/1');await expect(gift).toContainText('roll weight \u00d75');await expect(gift).not.toContainText('\u00d75 items');
  await pants.click();await expect(page.locator('#selected')).toHaveText('xpants');await info.attach('monster-home-rewards',{body:await dialog.screenshot(),contentType:'image/png'});
  await page.evaluate(()=>(window as any).openItemRewards());const itemDialog=page.getByRole('dialog',{name:'Pants of the Fallen Master',exact:true});
  await expect(itemDialog.getByRole('heading',{name:'Home rewards',exact:true})).toBeVisible();await expect(itemDialog.getByRole('button',{name:/Mr. Green/})).toContainText('1/250');
  const pumpkin=itemDialog.getByRole('button',{name:/Mr. Pumpkin/});await expect(pumpkin).toHaveCount(1);await expect(pumpkin).toContainText('1/1,000');await expect(pumpkin).toContainText('1/250');
  const headings=await itemDialog.getByRole('heading').allTextContents();expect(headings.indexOf('Home rewards')).toBeLessThan(headings.indexOf('Monster drops'));
  await info.attach('item-home-rewards',{body:await itemDialog.screenshot(),contentType:'image/png'});
});
