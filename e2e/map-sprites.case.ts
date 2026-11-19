import { test, expect } from "./fixtures";
import { build } from "esbuild";
import path from "node:path";
// The run scope and ports the status owner's telemetry (runtime/status/character/telemetry.ts) reads, in the page:
// each socket listener and timer is kept, and each map frame request is kept in `packets`.
const HARNESS = `window.listeners={};window.timers=[];window.packets=[];window.emit=(event,data)=>(listeners[event]||[]).forEach(f=>f(data));window.__partyRunScope={scope:()=>({on:(target,event,f)=>{(listeners[event]=listeners[event]||[]).push(f);},setInterval:f=>{timers.push(f);return timers.length;},setTimeout:()=>0,clearInterval(){},clearTimeout(){},sleep:()=>Promise.resolve()})};window.frame=async()=>{timers[0]();await new Promise(r=>setTimeout(r,0));};window.telemetryOn=(module,character,G)=>module.createTelemetry({me:()=>character,G:()=>G,parent:()=>window,root:()=>window,now:Date.now,runtime:()=>'r',current:()=>true,request:(path,o)=>{if(path==='/map-frame')packets.push(o.body);return Promise.resolve({});},entity:()=>null,player:()=>null,party:()=>[],report:{sprite:()=>null,mapDollHtml:()=>null,activeConditions:()=>[]},items:{fingerprint:x=>x,itemDefinition:()=>null,inventoryOperationEntry:()=>null,inventoryTotals:()=>({}),safeItemDefinition:x=>x},map:{definition:()=>undefined,definitionNeeded(){},selected:()=>null,queue:()=>null,markers:()=>[],grouped:()=>false,eventCombat:()=>false},death:{huntTrip:()=>null,joinedEvent:()=>null}});`;
// The bundle that mounts MapCanvas on an empty main map and rerenders it every `tick` ms. Each test
// plants its own setup and the frame's fields; `body` runs in App before the render, and `boot`
// defers the mount until the page calls window.boot().
function mapCanvasBundle(setup:string,fields:string,{tick,body='',boot=false}:{tick:number;body?:string;boot?:boolean}){
  const contents="import React from'react';import{createRoot}from'react-dom/client';import{MapCanvas}from'./features/party/map-canvas';"+setup+(boot?'window.boot=()=>{':'')+"const definition={name:'main',min_x:-200,min_y:-200,max_x:200,max_y:200,tiles:[],placements:[],groups:[],tilesets:{}};"+
    `function App(){const[t,s]=React.useState(0);React.useEffect(()=>{const timer=setInterval(()=>s(v=>v+1),${tick});return()=>clearInterval(timer)},[]);`+body+
    "return <div style={{width:400,height:300}}><MapCanvas definition={definition} frame={{name:'Actor',map:'main',at:Date.now(),x:0,y:0,"+fields+"}} previous={null} receivedAt={performance.now()} scale={1} detailed={false}/></div>}createRoot(document.getElementById('root')).render(<App/>);"+(boot?'};':'');
  return build({bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.resolve('dashboard/tsconfig.json'),
    stdin:{resolveDir:path.resolve('dashboard'),loader:'tsx',contents}});
}
// Failure inventory: docs/testing-map-sprites-steam-layout.md. Native renderer
// textures are the declared boundary; maintained collection + Canvas render run.
test("live maps draw native weapon cosmetic and projectile pixels without clipping or ghosts", async ({
  page,
  app,
}, info) => {
  const bundle = await mapCanvasBundle(`import{captureNativeLayers}from'../runtime/status/character/telemetry';
 const atlas=document.createElement('canvas');atlas.width=64;atlas.height=32;const ctx=atlas.getContext('2d');for(const[x,y,w,h,color]of[[0,0,16,16,'#ff0000'],[16,0,4,16,'#ffff00'],[20,0,16,16,'#00ffff'],[36,0,8,8,'#ff00ff'],[44,0,4,4,'#00ff00']]){ctx.fillStyle=color;ctx.fillRect(x,y,w,h);}const url=atlas.toDataURL();
 const node=(sx,sy,width,height,x=0,y=0,ax=0,ay=0)=>({visible:true,renderable:true,alpha:1,position:{x,y},scale:{x:1,y:1},rotation:0,pivot:{x:0,y:0},anchor:{x:ax,y:ay},texture:{frame:{x:sx,y:sy,width,height},orig:{width,height},baseTexture:{resource:{url}}},children:[]});
 const actor=node(0,0,16,16,0,0,.5,1);actor.texture.orig={width:20,height:20};actor.texture.trim={x:2,y:4};actor.children=[node(20,0,16,16,-26,-16),node(36,0,8,8,-4,-30),node(16,0,4,16,14,-16)];actor.children[2].scale={x:-1,y:1};const layers=captureNativeLayers(actor);window.nativeLayers=layers;const projectile={id:'arrow',x:40,y:-10,layers:captureNativeLayers(node(44,0,4,4,40,-10,.5,.5))};let running=true;window.removeProjectile=()=>{running=false;};`,`entities:[{id:'Actor',name:'Actor',type:'character',x:0,y:0,hp:100,max_hp:100,mp:10,max_mp:10,layers}],visuals:running?[projectile]:[]`,{tick:50});
  await page.goto(app.url);
  await page.route("**/map-sprites-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<head><style>canvas{display:block;width:100%;height:100%}</style></head><body style="margin:0"><div id="root"></div></body>',
    }),
  );
  await page.goto(app.url + "/map-sprites-harness");
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const canvas = page.locator("canvas");
  const pixels = () =>
    canvas.evaluate((element) => {
      const c = element as HTMLCanvasElement,
        ctx = c.getContext("2d")!;
      return [
        [200, 140],
        [180, 140],
        [200, 123],
        [211, 140],
        [240, 140],
      ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    });
  await expect.poll(pixels).toEqual([
    [255, 0, 0, 255],
    [0, 255, 255, 255],
    [255, 0, 255, 255],
    [255, 255, 0, 255],
    [0, 255, 0, 255],
  ]);
  await info.attach("native-map-layer-pixels", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });
  await page.evaluate(() => (window as any).removeProjectile());
  await expect.poll(async () => (await pixels())[4]).toEqual([7, 17, 15, 255]);
  await info.attach("native-map-layer-ledger", {
    body: JSON.stringify({
      layers: await page.evaluate(() => (window as any).nativeLayers),
      pixels: await pixels(),
    }),
    contentType: "application/json",
  });
});

test("map sprite publication remains subscriber-only and bounds native renderer payloads", async ({
  page,
}, info) => {
  // The status owner's telemetry over the planted ports of HARNESS.
  const bundle = await build({
    entryPoints: ["runtime/status/character/telemetry.ts"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "MapSprites",
  });
  await page.route("http://map-publication.test/**", (r) =>
    r.fulfill({ contentType: "text/html", body: "<body></body>" }),
  );
  await page.goto("http://map-publication.test/");
  await page.addScriptTag({ content: HARNESS });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.addScriptTag({
    content: `var G={items:{sword:{skin:'sword'},shield:{skin:'shield'}}};var url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';function node(){return{visible:true,renderable:true,texture:{frame:{x:0,y:0,width:1,height:1},orig:{width:1,height:1},baseTexture:{resource:{url:url}}},children:[]};}var character=Object.assign(node(),{name:'Actor',id:'Actor',type:'character',map:'main',x:1,y:2,hp:100,max_hp:100,items:[],slots:{mainhand:{name:'sword'},offhand:{name:'shield'}}});window.entities={};window.map_animations={arrow:Object.assign(node(),{atype:'map',x:12,y:13}),deleted:Object.assign(node(),{atype:'map',to_delete:true,x:1,y:1})};window.captureCalls=0;for(const sprite of [character,map_animations.arrow]){const kids=sprite.children;Object.defineProperty(sprite,'children',{get(){captureCalls++;return kids;},set(value){Object.defineProperty(sprite,'children',{value,writable:true,configurable:true});},configurable:true});}window.telemetry=telemetryOn(MapSprites,character,G);telemetry.start();`,
  });
  // While no dashboard subscribes, a frame captures no sprite and sends no packet
  // (publishMapFrame returns before capture when mapOn is false), as b9b5c91e checked.
  await page.evaluate(() => (window as any).frame());
  expect(await page.evaluate(() => ({ calls: (window as any).captureCalls, packets: (window as any).packets.length }))).toEqual({ calls: 0, packets: 0 });
  await page.evaluate(() => {
    (window as any).telemetry.map(true);
    return (window as any).frame();
  });
  const payload = await page.evaluate(() => (window as any).packets[0]);
  expect(await page.evaluate(() => (window as any).captureCalls), "a subscribed frame captures the sprites").toBeGreaterThan(0);
  expect(payload.entities[0].weapons.map((weapon: any) => weapon.hand)).toEqual([
    "mainhand",
    "offhand",
  ]);
  expect(payload.entities[0].layers).toHaveLength(1);
  expect(payload.visuals.map((visual: any) => visual.id)).toEqual(["arrow"]);
  const limits = await page.evaluate(() => {
    const h = window as any,
      actor = h.node();
    actor.children = Array.from({ length: 1000 }, () => h.node());
    const animations = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [
        String(i),
        Object.assign(h.node(), { atype: "map", x: i, y: i }),
      ]),
    );
    return {
      entity: h.MapSprites.captureNativeLayers(actor).length,
      visuals: h.MapSprites.captureMapVisuals(animations).reduce(
        (sum: number, entry: any) => sum + entry.layers.length,
        0,
      ),
    };
  });
  // The capture takes the game's whole sprite tree and every live map animation.
  expect(limits).toEqual({ entity: 1001, visuals: 1000 });
  await info.attach("subscribed-native-map-wire", {
    body: JSON.stringify({ payload, limits, bytes: Buffer.byteLength(JSON.stringify(payload)) }),
    contentType: "application/json",
  });
});

test("headless native HTML dolls preserve large cosmetics and atlas clipping", async ({ page, app }, info) => {
  const bundle = await mapCanvasBundle(`
const url=location.origin+'/headless-atlas.svg';const cell=(left,bottom,w,h,mx,my)=>'<div style="position:absolute;left:'+left+'px;bottom:'+bottom+'px;width:'+w+'px;height:'+h+'px;overflow:hidden"><img src="'+url+'" style="width:80px;height:48px;margin-left:'+mx+'px;margin-top:'+my+'px"></div>';const dollHtml='<div style="position:relative;width:40px;height:50px;overflow:visible">'+cell(-12,8,16,16,0,0)+cell(16,42,8,8,-16,0)+cell(12,0,16,24,-24,0)+'</div>';`,`entities:[{id:'Actor',name:'Actor',type:'character',x:0,y:0,hp:100,max_hp:100,mp:10,max_mp:10,dollHtml}]`,{tick:50});
  await page.goto(app.url);
  await page.route('**/headless-atlas.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="48"><rect width="80" height="48" fill="#ffff00"/><rect width="16" height="16" fill="#00ffff"/><rect x="16" width="8" height="8" fill="#ff00ff"/><rect x="24" width="16" height="24" fill="#ff0000"/></svg>'}));
  await page.route('**/headless-doll-harness',route=>route.fulfill({contentType:'text/html',body:'<style>canvas{display:block;width:100%;height:100%}</style><body style="margin:0"><div id="root"></div>'}));
  await page.goto(app.url+'/headless-doll-harness');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const canvas=page.locator('canvas');
  await expect.poll(()=>canvas.evaluate(el=>{const ctx=(el as HTMLCanvasElement).getContext('2d')!;return [[174,134],[200,101],[200,140],[167,134]].map(([x,y])=>Array.from(ctx.getImageData(x,y,1,1).data))})).toEqual([[0,255,255,255],[255,0,255,255],[255,0,0,255],[7,17,15,255]]);
  await info.attach('headless-native-html-cosmetics',{body:await canvas.screenshot(),contentType:'image/png'});
});

test("headless server action projectiles render native atlas frames and retire on hit", async ({page,app},info)=>{
  const telemetryBundle=await build({entryPoints:['runtime/status/character/telemetry.ts'],bundle:true,write:false,platform:'browser',format:'iife',globalName:'MapSprites'});
  const bundle=await mapCanvasBundle(``,`entities:[],projectiles,projectilesAt:window.projectileClock`,{tick:25,body:`const projectiles=window.liveProjectiles;`,boot:true});
  await page.goto(app.url);await page.route('**/headless-flight.svg',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="4" height="4" fill="#00ff00"/><rect x="4" width="4" height="4" fill="#ff00ff"/></svg>'}));
  await page.route('**/headless-flight-harness',r=>r.fulfill({contentType:'text/html',body:'<style>canvas{display:block;width:100%;height:100%}</style><body style="margin:0"><div id="root"></div>'}));await page.goto(app.url+'/headless-flight-harness');
  await page.addScriptTag({content:HARNESS});await page.addScriptTag({content:telemetryBundle.outputFiles[0].text});await page.addScriptTag({content:bundle.outputFiles[0].text});
  // The projectiles reach the map as the published frame carries them.
  await page.addScriptTag({content:`window.no_graphics=true;window.get_entity=id=>id==='Actor'?{map:'main',x:-40,y:0}:null;window.projectile_origin=()=>({x:-40,y:-15});var G={items:{},projectiles:{arrow:{animation:'arrow'}},animations:{arrow:{file:location.origin+'/headless-flight.svg',frames:2,framefps:100000}}};var character={name:'Actor',id:'Actor',map:'main',x:0,y:0,items:[],slots:{}};window.entities={};window.telemetry=telemetryOn(MapSprites,character,G);telemetry.start();window.published=async()=>{packets.length=0;await frame();window.liveProjectiles=packets[0].projectiles;return packets[0].projectiles;};window.packet={pid:'native-flight',attacker:'Actor',target:'Monster',x:40,y:-15,projectile:'arrow',eta:10000};emit('action',packet);`});
  expect(await page.evaluate(()=>(window as any).packets.length)).toBe(0);
  await page.evaluate(async()=>{const w=window as any;w.telemetry.map(true);w.emit('action',w.packet);const flight=(await w.published())[0];w.projectileClock=flight.startedAt+5000;w.boot();});
  const canvas=page.locator('canvas'),pixel=()=>canvas.evaluate(el=>Array.from((el as HTMLCanvasElement).getContext('2d')!.getImageData(200,133,1,1).data));await expect.poll(pixel).toEqual([0,255,0,255]);
  await info.attach('headless-action-projectile',{body:await canvas.screenshot(),contentType:'image/png'});
  const flight=await page.evaluate(()=>(window as any).liveProjectiles[0]);expect(flight).toMatchObject({id:'native-flight',x:-40,y:-15,targetX:40,targetY:-15,frames:2});
  await page.evaluate(async()=>{const w=window as any;w.emit('hit',{pid:'other-flight'});await w.published();});await expect.poll(pixel).toEqual([0,255,0,255]);
  await page.evaluate(async()=>{const w=window as any;w.emit('hit',{pid:'native-flight'});await w.published();});await expect.poll(pixel).toEqual([7,17,15,255]);
  // The frame carries every live projectile until its hit or eta, with no count limit.
  const published=await page.evaluate(async()=>{const w=window as any;for(let i=0;i<1000;i++)w.emit('action',{...w.packet,pid:'flight-'+i});return (await w.published()).length});expect(published).toBe(1000);
  await info.attach('headless-action-wire',{body:JSON.stringify({flight,published}),contentType:'application/json'});
});
