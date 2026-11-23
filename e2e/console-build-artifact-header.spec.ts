import {test,expect} from './fixtures';

test('header uses the loaded build release and branch instead of stale host metadata',async({page},info)=>{
  const old='a'.repeat(64),next='b'.repeat(64);let active=old;
  await page.route('**/console-update',route=>route.fulfill({json:{managed:false,current:'1.4.0',displayVersion:'1.4.0 + 1.5-feature-branch',available:'1.5.0',automatic:false,phase:'available'}}));
  await page.route('**/console-build',route=>route.fulfill({json:{active,available:active===old?next:undefined,builds:[{id:old,displayVersion:'1.4.0 + 1.5-feature-branch'},{id:next,displayVersion:'1.5.0 + codex/1.6-release'}].map(build=>({...build,createdAt:'2026-10-31T00:00:00Z',sourceHash:build.id,components:{dashboard:build.id,coordinator:build.id,characters:build.id}}))}}));
  await page.goto('/');
  await expect(page.locator('header')).toContainText('Console v1.4.0 + 1.5-feature-branch');
  await expect(page.locator('header')).not.toContainText('Console v1.5.0');
  active=next;
  await expect(page.locator('header')).toContainText('Console v1.5.0 + codex/1.6-release');
  await expect(page.getByRole('button',{name:'Update Party Console',exact:true})).toHaveCount(0);
  await info.attach('loaded-build-release-label',{body:await page.screenshot(),contentType:'image/png'});
});

// Failure inventory: candidate shown instead of deployed build; stale hash after
// activation; added flow height shifting header/content; overflow on small screens.
test('deployed artifact hash updates below the version without moving the header',async({page},info)=>{
  let active:string|undefined;
  const first='123456789abc'+'0'.repeat(52),next='abcdef987654'+'1'.repeat(52);
  await page.route('**/console-build',route=>route.fulfill({json:{active,latest:'f'.repeat(64),builds:[],pendingBuildCount:0,building:false}}));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Party Console',exact:true})).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  const observations=[];
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});active=undefined;
    const label=page.locator('[data-console-artifact]');
    await expect(label).toHaveCount(0);
    const bounds=()=>page.locator('header').evaluate(el=>({header:el.getBoundingClientRect().toJSON(),contentTop:el.nextElementSibling?.getBoundingClientRect().top}));
    const before=await bounds();active=first;
    await expect(label).toHaveText('Artifact 123456789abc');await expect(label).toHaveAttribute('title',first);
    expect(await bounds()).toEqual(before);
    const position=await label.boundingBox(),version=await label.evaluate(el=>el.previousElementSibling!.getBoundingClientRect().toJSON());
    expect(position!.y).toBeGreaterThanOrEqual(version!.y+version!.height);
    expect(position!.x+position!.width).toBeLessThanOrEqual(width);
    active=next;await expect(label).toHaveText('Artifact abcdef987654');expect(await bounds()).toEqual(before);
    observations.push({width,before,after:await bounds(),position});
    await info.attach(`artifact-header-${width}`,{body:await page.screenshot(),contentType:'image/png'});
  }
  await info.attach('artifact-header-layout',{body:JSON.stringify(observations),contentType:'application/json'});
});
