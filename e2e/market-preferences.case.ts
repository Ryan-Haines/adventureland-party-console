import type {Page} from '@playwright/test';

import {test,expect} from './fixtures';
import { fetchFullState } from './state-route';



async function marketFeed(page:Page,clock:{classifiedsStale:boolean;wtbDisplay?:boolean}){

  await page.route('**/party-api/state*',async(route)=>{

    const response=await fetchFullState(route),state=await response.json(),now=Date.now();

    const entries=[0,8,1].map(level=>({key:'market-'+level,source:'aldata',seller:'Seller'+level,buyer:'Buyer'+level,slot:'trade1',

      serverRegion:'US',serverIdentifier:'II',map:'main',x:0,y:0,item:{name:'sword',level},quantity:1,price:1000,

      seenAt:now-(level===1?240000:0),lastSeen:new Date(now-(level===1?240000:0)).toISOString()}));

    await route.fulfill({response,json:{...state,...(clock.wtbDisplay?{standBids:{sword:{price:1000,quantity:3,minimumQuality:8,useStandSlot:true,acceptHigherLevels:false}},

      nativeStand:{sequence:1,offers:{'test-auto-sword':{id:'test-auto-sword',itemId:'sword',level:8,price:1000,quantity:3,slot:'trade1',phase:'live',auto:true}},problems:{}},

      ...(state.characters?{characters:{...state.characters,M:{...state.characters.M,standOpen:false}}}:{})}:{}),aldata:{...state.aldata,listings:entries,buyOrders:entries,

      tradesUpdatedAt:now-(clock.classifiedsStale?240000:0),trades:[{owner:'external-market-test',label:'Test classifieds',lastUpdated:now-86400000,

        listings:entries.map(e=>({name:e.item.name,level:e.item.level,wts:{price:1000,quantity:1}}))}]},

      ponty:{...state.ponty,listings:entries.map(e=>({...e,rid:e.key,unitPrice:1000,groupKey:e.key}))}}});

  });

}



test.describe('Market preferences',()=>{
  test.use({marketStand:true});
  const errors=new WeakMap<Page,string[]>();
  test.beforeEach(async({page})=>{const collected:string[]=[];errors.set(page,collected);page.on('pageerror',error=>collected.push(error.message));});
  test.afterEach(async({page},info)=>{await info.attach('market-browser-errors',{body:JSON.stringify(errors.get(page)||[]),contentType:'application/json'});});
test('market listing filters hide stale observations on all four tabs',async({page},info)=>{

  const clock={classifiedsStale:false};await marketFeed(page,clock);await page.goto('/');await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();

  await page.getByRole('button',{name:'Market',exact:true}).click();

  const market=page.getByRole('dialog',{name:'ALData merchant market',exact:true});

  for(const tab of ['Live WTS','Live WTB','Ponty']){

    await market.getByRole('button',{name:new RegExp('^'+tab+' \\(')}).click();

    await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +1',exact:true})).toBeVisible();

    await market.getByRole('checkbox',{name:'Hide stale listings',exact:true}).check();

    await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +1',exact:true})).toHaveCount(0);

    await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +8',exact:true})).toBeVisible();

  }

  await market.getByRole('button',{name:/^Classifieds \(/}).click();

  await market.getByRole('checkbox',{name:'Hide stale listings',exact:true}).check();

  await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +1',exact:true})).toBeVisible();

  clock.classifiedsStale=true;

  await expect(market.getByRole('button',{name:/^Ignore listings of/})).toHaveCount(0);

  await market.getByRole('checkbox',{name:'Hide stale listings',exact:true}).uncheck();

  await expect(market.getByRole('button',{name:/^Ignore listings of/})).toHaveCount(3);

  await info.attach('market-stale-classifieds',{body:await page.screenshot(),contentType:'image/png'});

});



test('market ignores preserve exact levels across tabs, refresh and coordinator restart',async({page,app},info)=>{

  await marketFeed(page,{classifiedsStale:false});await page.goto('/');await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();

  const open=async()=>{await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();await page.waitForResponse(r=>r.url().includes('/party-api/state')&&r.url().includes('section=core')&&r.ok());await page.getByRole('button',{name:'Market',exact:true}).click();};await open();

  const market=page.getByRole('dialog',{name:'ALData merchant market',exact:true});
  const block=await page.request.post(app.url+'/party-api/merchant/blacklist',{headers:{Origin:app.url},data:{action:'add',seller:'TestBlockedSeller',minutes:60}});expect(block.ok()).toBe(true);

  await market.getByRole('button',{name:/^Live WTS \(/}).click();

  await market.getByRole('button',{name:'Ignore listings of Short Sword +0',exact:true}).click();

  await expect.poll(async()=>(await app.state()).marketIgnoredItems).toEqual([{name:'sword',level:0}]);

  for(const tab of ['Live WTS','Live WTB','Classifieds','Ponty']){

    await market.getByRole('button',{name:new RegExp('^'+tab+' \\(')}).click();

    await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +0',exact:true})).toHaveCount(0);

    await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +8',exact:true})).toBeVisible();

  }

  await app.restartCoordinator();await page.reload();await open();

  await market.getByRole('button',{name:'Marketplace settings',exact:true}).click();

  const settings=page.getByRole('dialog',{name:'Marketplace settings',exact:true});

  const ignored=settings.getByRole('button',{name:'Ignored items',exact:true});

  await expect(ignored).toHaveAttribute('aria-expanded','false');

  await expect(settings.getByRole('button',{name:'Marketplace merchant blacklist',exact:true})).toHaveAttribute('aria-expanded','false');

  await info.attach('market-settings-collapsed',{body:await settings.screenshot(),contentType:'image/png'});
  const blacklist=settings.getByRole('button',{name:'Marketplace merchant blacklist',exact:true}),clearBlacklist=settings.getByRole('button',{name:'Clear all merchant blacklist entries',exact:true});
  const titleBox=await blacklist.boundingBox(),clearBox=await clearBlacklist.boundingBox();expect(clearBox!.x).toBeGreaterThan(titleBox!.x+titleBox!.width);expect(Math.abs(clearBox!.y-titleBox!.y)).toBeLessThan(10);
  await clearBlacklist.click();await settings.getByRole('button',{name:'Confirm clearing all merchant blacklist entries',exact:true}).click();
  await expect.poll(async()=>(await app.state()).merchantBlacklist).toEqual({});


  await ignored.click();await settings.getByRole('button',{name:'Remove Short Sword +0 from ignored items',exact:true}).click();

  await expect.poll(async()=>(await app.state()).marketIgnoredItems).toEqual([]);

  await settings.getByRole('button',{name:'Close',exact:true}).first().click();

  await market.getByRole('button',{name:/^Live WTS \(/}).click();

  await market.getByRole('button',{name:'Ignore listings of Short Sword +0',exact:true}).click();

  await market.getByRole('button',{name:'Ignore listings of Short Sword +8',exact:true}).click();

  await market.getByRole('button',{name:'Marketplace settings',exact:true}).click();

  await settings.getByRole('button',{name:'Clear all ignored items',exact:true}).click();

  await expect.poll(async()=>(await app.state()).marketIgnoredItems).toEqual([]);
  await settings.getByRole('button',{name:'Close',exact:true}).first().click();
  await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +0',exact:true})).toBeVisible();
  await expect(market.getByRole('button',{name:'Ignore listings of Short Sword +8',exact:true})).toBeVisible();

  await info.attach('market-preference-ledger',{body:JSON.stringify(await app.state()),contentType:'application/json'});

});





test('WTB stand and market show Keep on stand and the selected level without Auto or minimum badges',async({page},info)=>{

  await marketFeed(page,{classifiedsStale:false,wtbDisplay:true});await page.goto('/');await expect(page.getByRole('heading',{name:'M',exact:true})).toBeVisible();

  await page.getByRole('button',{name:/^Stand/}).click();

  const stand=page.getByRole('dialog',{name:'Stand',exact:true});

  await expect(stand.getByText('Auto',{exact:true})).toHaveCount(0);

  await expect(stand.getByRole('checkbox',{name:'Keep on stand',exact:true})).toBeVisible();

  await info.attach('stand-wtb-labels',{body:await stand.screenshot(),contentType:'image/png'});

  await page.keyboard.press('Escape');await page.getByRole('button',{name:'Market',exact:true}).click();

  const market=page.getByRole('dialog',{name:'ALData merchant market',exact:true});

  const active=market.getByRole('button',{name:/^Active WTB orders/});if(await active.getAttribute('aria-expanded')!=='true')await active.click();

  await expect(market.getByRole('button',{name:'Inspect Short Sword',exact:true})).toContainText('+8');

  await expect(market.getByText(/\+8 minimum/)).toHaveCount(0);

  await expect(market.getByText('Auto',{exact:true})).toHaveCount(0);

  await expect(market.getByRole('checkbox',{name:'Keep on stand',exact:true})).toBeVisible();

  await info.attach('market-wtb-labels',{body:await market.screenshot(),contentType:'image/png'});

});


});
