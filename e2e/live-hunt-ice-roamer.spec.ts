import { iceRoamer } from './gameplay-scenarios';
import { test, expect } from './live-fixtures';
import { warrior as W, priest as P, fighters, party, quests, start, world, tokens, artifact } from './game/hunt-lifecycle';

test('a missing native sprite frame preserves actual convoy walking and draw scheduling', async ({live}, info) => {
  test.setTimeout(240_000);
  await party(live);
  // The faulted frame belongs to a monster type no other monster in view shares, so the game's own
  // error for the missing frame (adopt_soft_properties reads the frame of every entity it syncs)
  // hits only that one entity; a shared skin like goo's also broke every other goo in view.
  const seed = await live.admin(`output=(()=>{const p=get_player(${JSON.stringify(W)});
    const native=new Set((G.maps[p.map].monsters||[]).map(m=>G.monsters[m.type]?.skin||m.type));
    const type=['arcticbee','bbpompom','pppompom','cgoo'].find(t=>G.monsters[t]&&!native.has(G.monsters[t].skin||t));
    if(!type)throw Error('No monster type foreign to '+p.map);
    for(const [dx,dy] of [[35,0],[-35,0],[0,35],[0,-35]]){const x=p.x+dx,y=p.y+dy;
      if(!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
      const m=new_monster(p.in,{type,__e2eAmbientExempt:true,position:[x,y],radius:0,count:1},{temp:1});
      Object.assign(m,{aggro:0,rage:0,target:null});m.e2eHunt=true;
      return {id:m.id,type,skin:G.monsters[type].skin||type,map:m.map,x:m.x,y:m.y};}
    throw Error('No reachable seed position')})()`);
  const monsterId = seed.id;
  await expect.poll(() => live.clients[W].frame.evaluate(id => Boolean((window as any).entities[id]), monsterId)).toBe(true);
  const fault = await live.clients[W].frame.evaluate(id => {
    const game = window as any, c = game.character;
    const sprite = game.entities[id], frames = game.textures[sprite.skin];
    if (!Array.isArray(frames) || !frames[1]) throw Error('Native sprite fixture requires an idle frame');
    const sharing = Object.values(game.entities).filter((e: any) => e !== sprite && e.skin === sprite.skin).length;
    if (sharing) throw Error('The faulted skin must be unique in view');
    const saved = frames[1], started = Date.now(), draws = game.draws;
    // Cosmetic cache fault only. Native movement, sockets and physics are untouched.
    delete frames[1];
    sprite.cskin = null;
    const samples: unknown[] = [];
    const timer = setInterval(() => samples.push({at:Date.now(),draws:game.draws,lastDraw:+game.last_draw,x:c.real_x,y:c.real_y}), 100);
    game.__e2eRenderFault = {skin:sprite.skin, started, draws, samples, reschedules:0, restored:false};
    const requestFrame = game.requestAnimationFrame;
    // Observe scheduling without changing its callbacks or timing. Host FPS is
    // not a correctness requirement; a throwing draw never reaches this call.
    game.requestAnimationFrame = function(callback: FrameRequestCallback) {
      if (callback === game.draw) game.__e2eRenderFault.reschedules++;
      return requestFrame.call(game, callback);
    };
    setTimeout(() => {frames[1] = saved; clearInterval(timer); game.requestAnimationFrame = requestFrame; game.__e2eRenderFault.restored = true;}, 7000);
    return {skin:sprite.skin, started, draws, origin:{map:c.map,x:c.real_x,y:c.real_y}};
  }, monsterId);
  const destination = await live.clients[W].run(`(()=>{for(let i=0;i<16;i++){const a=i*Math.PI/8,x=character.real_x+400*Math.cos(a),y=character.real_y+400*Math.sin(a);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No reachable native walk')})()`);
  await info.attach('declared-native-render-fault', {body:JSON.stringify({fault,destination}),contentType:'application/json'});
  await live.post('/travel', destination);
  await expect.poll(async () => live.clients[W].frame.evaluate(() => (window as any).__e2eRenderFault.restored), {timeout:15_000}).toBe(true);
  const observations = await live.clients[W].frame.evaluate(() => (window as any).__e2eRenderFault);
  await info.attach('native-render-scheduling', {body:JSON.stringify(observations),contentType:'application/json'});
  expect(observations.reschedules, 'Native draw must continue scheduling its own frames during the texture fault').toBeGreaterThan(2);
  expect(live.clients[W].errors.filter(error => /texture|reading/.test(error))).toEqual([]);
  await expect.poll(async () => {
    const current = await world(live);
    return fighters.every(name => current[name].map === destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
  }, {timeout:90_000}).toBe(true);
  await artifact(live,info,'native-render-fault-walking',{seed,fault,destination,observations});
  await live.admin(`output=(()=>{for(const i of Object.values(instances)){const m=i.monsters?.[${JSON.stringify(seed.id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
});

test('native Ice Roamer Hunt engages successive enemies and returns both real rewards', async ({ live }, info) => {
  test.setTimeout(480000);
    await iceRoamer(live, info);
});
