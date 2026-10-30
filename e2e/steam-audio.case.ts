import { test, expect } from './fixtures';
import { build } from 'esbuild';

// Failure modes: initial native flags ignored; music and effects cross-toggle;
// native persistence bypassed; external settings go stale; roster operations
// disable audio; minimize/restore loses state; disposing leaves controls alive.
// Native audio functions are the declared boundary; real switcher DOM executes.
test('Steam Characters bar independently toggles native sounds and music', async ({page},info)=>{
  const bundle=await build({entryPoints:['runtime/steam/switcher.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'Switcher'});
  await page.route('http://audio.test/**', (route) =>route.fulfill({contentType:'text/html',body:'<!doctype html><body style="background:#163127"></body>'}));
  await page.goto('http://audio.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.evaluate(()=>{
    const host=window as any;host.sound_sfx='1';host.sound_music='';host.audioCalls=[];
    for(const [name,flag,value] of [['sfx_on','sound_sfx','1'],['sfx_off','sound_sfx',''],['sound_on','sound_music','1'],['sound_off','sound_music','']]){
      host[name]=()=>{host[flag]=value;localStorage.setItem(flag,value);host.audioCalls.push(name);};
    }
    host.switcher=host.Switcher.createSwitcher(window,async()=>{throw Error('Audio must not request a character operation');});
    host.switcher.render({members:[],realm:'SR_USI',operation:{phase:'release'}});
  });
  const sounds=page.getByRole('button',{name:'mute game sounds',exact:true});
  const music=page.getByRole('button',{name:'mute game music',exact:true});
  await expect(sounds).toHaveAttribute('aria-pressed','false');await expect(music).toHaveAttribute('aria-pressed','true');
  await expect(sounds.locator('svg')).toBeVisible();await expect(music.locator('svg')).toBeVisible();
  await sounds.click();await expect(sounds).toHaveAttribute('aria-pressed','true');
  await music.click();await expect(music).toHaveAttribute('aria-pressed','false');
  await sounds.click();await music.click();
  expect(await page.evaluate(()=>(window as any).audioCalls)).toEqual(['sfx_off','sound_on','sfx_on','sound_off']);
  await page.evaluate(()=>{(window as any).sound_sfx='';(window as any).sound_music='1';});
  await expect(sounds).toHaveAttribute('aria-pressed','true');await expect(music).toHaveAttribute('aria-pressed','false');
  await page.getByRole('button',{name:'Minimize Steam character controls',exact:true}).click();
  await expect(sounds).toHaveCount(0);
  await page.getByRole('button',{name:'Restore Steam character controls',exact:true}).click();
  await expect(sounds).toHaveAttribute('aria-pressed','true');await expect(music).toHaveAttribute('aria-pressed','false');
  await info.attach('steam-audio-controls',{body:await page.screenshot(),contentType:'image/png'});
  await info.attach('steam-audio-ledger',{body:JSON.stringify(await page.evaluate(()=>({calls:(window as any).audioCalls,sfx:localStorage.getItem('sound_sfx'),music:localStorage.getItem('sound_music')}))),contentType:'application/json'});
  await page.evaluate(()=>(window as any).switcher.dispose());await expect(page.locator('#party-console-switcher')).toHaveCount(0);
});

// Native map_click uses this declared CODE callback boundary before socket move.
// Preserve other canvas interactions and restore the callback on disposal.
test("Steam pointer toggle blocks movement surface clicks and preserves UI controls", async ({
  page,
}, info) => {
  const bundle = await build({
    entryPoints: ["runtime/steam/switcher.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "Switcher",
  });
  await page.route("http://pointer.test/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<body><canvas id="game" width="500" height="300"></canvas><button id="native-control">Native control</button></body>',
    }),
  );
  await page.goto("http://pointer.test/");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const h = window as any;
    h.moves = 0;
    h.ui = 0;
    h.targets = 0;
    h.call_code_function = () => false;
    document.querySelector("canvas")!.addEventListener("pointerdown", () => {
      h.targets++;
      if (!h.call_code_function("on_map_click", 100, 200)) h.moves++;
    });
    document.querySelector("#native-control")!.addEventListener("click", () => h.ui++);
    h.switcher = h.Switcher.createSwitcher(window, async () => {});
    h.switcher.render({ members: [], realm: "SR_USI" });
  });
  const toggle = page.getByRole("button", { name: "Ignore movement clicks", exact: true });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.locator("canvas").click({ position: { x: 10, y: 200 } });
  expect(await page.evaluate(() => (window as any).moves)).toBe(0);
  expect(await page.evaluate(() => (window as any).targets)).toBe(1);
  await page.locator("#native-control").click();
  expect(await page.evaluate(() => (window as any).ui)).toBe(1);
  await toggle.click();
  await page.locator("canvas").click({ position: { x: 10, y: 200 } });
  expect(await page.evaluate(() => (window as any).moves)).toBe(1);
  await toggle.click();
  await page.evaluate(() => (window as any).switcher.dispose());
  await page.locator("canvas").click({ position: { x: 10, y: 200 } });
  expect(await page.evaluate(() => (window as any).moves)).toBe(2);
  await info.attach("steam-pointer-ledger", {
    body: JSON.stringify(
      await page.evaluate(() => ({ moves: (window as any).moves, ui: (window as any).ui })),
    ),
    contentType: "application/json",
  });
});

// Native score and controls are declared DOM boundaries; layout and clicks run
// in Chromium. Changing expansion must never change the toggle's screen anchor.
test('Steam character controls fit beside native score and keep a fixed minimize anchor',async({page},info)=>{
 const bundle=await build({entryPoints:['runtime/steam/switcher.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'Switcher'});
 await page.setViewportSize({width:1600,height:900});await page.route('http://layout.test/**',route=>route.fulfill({contentType:'text/html',body:'<body><div id="topmid" style="position:fixed;left:550px;top:0;width:200px;height:40px;background:#222;color:white">PVP score 15:3</div><div id="toprightcorner" style="position:fixed;right:0;top:0"><div class="game-controls" style="width:360px;height:40px;background:#444;color:white">X CODE COM Skills Guide</div></div></body>'}));
 async function mount(){await page.goto('http://layout.test/');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.evaluate(()=>{const h=window as any;h.switcher=h.Switcher.createSwitcher(window,async()=>{});h.switcher.render({members:['Warrior','Mage','Merchant','Priest'].map(name=>({name,online:true,hosting:'steam'})),realm:'SR_USI'});});}
 await mount();const minimize=()=>page.getByRole('button',{name:'Minimize Steam character controls',exact:true}),restore=()=>page.getByRole('button',{name:'Restore Steam character controls',exact:true});
 const initial=await minimize().boundingBox();expect(initial).not.toBeNull();const bounds=await page.locator('#party-console-switcher').boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(758);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(1232);
 for(let i=0;i<3;i++){await minimize().click();expect(await restore().boundingBox()).toEqual(initial);await restore().click();expect(await minimize().boundingBox()).toEqual(initial);}
 await info.attach('steam-expanded-native-gap',{body:await page.screenshot(),contentType:'image/png'});
 await minimize().click();await mount();await expect(restore()).toBeVisible();expect(await restore().boundingBox()).toEqual(initial);await info.attach('steam-minimized-native-gap',{body:await page.screenshot(),contentType:'image/png'});
 await page.setViewportSize({width:800,height:900});await expect.poll(async()=>{const b=await page.locator('#party-console-switcher').boundingBox();return b!.x>=8&&b!.x+b!.width<=792&&b!.y>=48;}).toBe(true);await restore().click();const narrow=await minimize().boundingBox();await minimize().click();expect(await restore().boundingBox()).toEqual(narrow);await page.evaluate(()=>(window as any).switcher.dispose());await expect(page.locator('#party-console-switcher')).toHaveCount(0);
});
