import {test,expect} from './fixtures';

test('release-only refresh opens update details for a development checkout',async({page},info)=>{
  await page.route('**/console-update',route=>route.fulfill({json:{managed:false,current:'1.4.0',displayVersion:'1.4.0 + 1.5-feature-branch',available:'1.5.0',automatic:false,phase:'available'}}));
  await page.route('**/console-build',route=>route.fulfill({status:503,json:{error:'No local build service'}}));
  await page.goto('/');
  await page.getByRole('button',{name:'Update Party Console',exact:true}).click();
  await expect(page.getByText('Local build',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'View release update',exact:true}).click();
  await expect(page.locator('#console-updates')).toBeFocused();
  await expect(page.getByText(/Development checkout: update notifications only/)).toBeVisible();
  await info.attach('development-release-update-details',{body:await page.screenshot(),contentType:'image/png'});
});

test('one refresh menu offers the stable release alongside a completed local build',async({page},info)=>{
  // Failure inventory: duplicate header icons; release action loads local code;
  // download unexpectedly restarts; ready updates cannot be restarted; errors vanish.
  const active='a'.repeat(64),candidate='b'.repeat(64),requests:string[]=[];
  let phase='available';
  await page.route('**/console-update**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    if(request.method()==='POST'){
      requests.push(path);
      if(path.endsWith('/download'))phase='ready';
      if(path.endsWith('/restart'))phase='restarting';
    }
    await route.fulfill({json:{managed:true,current:'1.4.0',available:'1.5.0',automatic:false,phase}});
  });
  await page.route('**/console-build',route=>route.fulfill({json:{active,available:candidate,builds:[active,candidate].map((id,i)=>({id,sourceHash:id,createdAt:new Date(2026,0,i+1).toISOString(),components:{dashboard:id,coordinator:id,characters:id}}))}}));
  await page.route('**/console-build/deploy',route=>{requests.push('/console-build/deploy');return route.fulfill({status:500,json:{error:'A release update must not deploy the local candidate'}});});
  await page.goto('/');
  const refresh=page.getByRole('button',{name:'Update Party Console',exact:true});
  await expect(refresh).toHaveCount(1);
  await expect(page.getByRole('button',{name:'New version available',exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Deploy new console build',exact:true})).toHaveCount(0);
  await refresh.click();
  await expect(page.getByText('Latest release · 1.5.0',{exact:true})).toBeVisible();
  await expect(page.getByText('Local build',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Download release 1.5.0',exact:true}).click();
  await expect(page.getByRole('button',{name:'Restart on release 1.5.0',exact:true})).toBeVisible();
  expect(requests).toEqual(['/console-update/download']);
  await info.attach('combined-refresh-release-ready',{body:await page.screenshot(),contentType:'image/png'});
  await page.getByRole('button',{name:'Restart on release 1.5.0',exact:true}).click();
  await expect.poll(()=>requests).toEqual(['/console-update/download','/console-update/restart']);
  await info.attach('combined-refresh-release-requests',{body:JSON.stringify(requests),contentType:'application/json'});
});
