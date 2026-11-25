import {test,expect} from './fixtures';
test('refresh restores deployment animation and gameplay-only completion does not reload the page',async({page},info)=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  const requests:string[]=[];page.on('request',request=>{if(request.url().includes('console-build'))requests.push(request.url());});
  const id='a'.repeat(64),next='b'.repeat(64),hash='c'.repeat(64),manifest=(buildId:string)=>({schema:1,id:buildId,sourceHash:buildId,createdAt:new Date().toISOString(),components:{dashboard:hash,coordinator:buildId,characters:buildId}});
  let status:any={active:id,latest:next,available:next,builds:[manifest(id),manifest(next)],pendingBuildCount:1,operation:{id:'recover',target:next,previous:id,startedAt:new Date().toISOString(),phase:'preparing',mode:'safe'}};
  await page.route('**/console-build',route=>route.fulfill({json:status}));
  await page.addInitScript((value)=>{(window as any).__partyDashboardHash=value;},hash);
  await page.goto('/');const icon=page.getByRole('button',{name:'Deploy new console build'});
  try{await expect(icon).toBeVisible();}finally{await info.attach('browser-initialization',{body:JSON.stringify({errors,requests}),contentType:'application/json'});}
  const spins=()=>icon.locator('svg').first().evaluate(el=>getComputedStyle(el).animationName);
  await expect.poll(spins).not.toBe('none');await page.getByRole('button',{name:'Show logs'}).click();await expect(page.getByRole('complementary',{name:'Live logs'})).toBeVisible();
  await page.reload();await expect.poll(spins).not.toBe('none');await expect(page.getByRole('complementary',{name:'Live logs'})).toBeVisible();
  const documents:any[]=[];page.on('request',request=>{if(request.isNavigationRequest()&&request.frame()===page.mainFrame())documents.push(request.url());});
  status={...status,active:next,available:undefined,pendingBuildCount:0,operation:{...status.operation,phase:'complete'}};
  // The only reload runs inside the refresh that drops the icon (console-build-control.tsx), so
  // no document request after the icon goes means none came.
  await expect(icon).toHaveCount(0);expect(documents).toEqual([]);
  await info.attach('recovered-deployment-complete',{body:await page.screenshot(),contentType:'image/png'});
});

test('Cave disables safe and Main loading without additional explanatory text',async({page},info)=>{
  const id='a'.repeat(64),next='b'.repeat(64),manifest=(buildId:string)=>({schema:1,id:buildId,sourceHash:buildId,createdAt:new Date().toISOString(),components:{dashboard:buildId,coordinator:buildId,characters:buildId}});
  await page.route('**/console-build',route=>route.fulfill({json:{active:id,latest:next,available:next,cave:true,builds:[manifest(id),manifest(next)],pendingBuildCount:1}}));
  await page.goto('/');await page.getByRole('button',{name:'Deploy new console build'}).click();
  await expect(page.getByRole('button',{name:'Load now',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Load when safe',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Load at Main',exact:true})).toBeDisabled();
  await info.attach('cave-load-modes',{body:await page.screenshot(),contentType:'image/png'});
  // Load now during a Cave run sends nothing until the player ticks that the run
  // ends; the tick enables it.
  const sent:string[]=[];page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('console-build'))sent.push(request.url());});
  await page.getByRole('button',{name:'Load now',exact:true}).click();
  const confirm=page.getByRole('dialog',{name:'Load console build now?'});
  const load=confirm.getByRole('button',{name:'Load now',exact:true});
  await expect(confirm).toContainText('A Cave run is active. Loading now ends the run');
  await expect(load).toBeDisabled();
  await confirm.getByRole('checkbox').check();
  await expect(load).toBeEnabled();
  expect(sent).toEqual([]);
});
