import {expect, type LiveGame} from '../live-fixtures';
import type {Page, Request} from '@playwright/test';
import {liveWindow, type LiveWorld} from '../windows';
import {waitForGameplay} from '../network-clock';
import {settleNavigation} from '../movement-owner-helpers';
import {fighters, merchant, party, world, observed, point, arrived, travel} from '../game/hunt-lifecycle';
import {departureSignalFaultSource, DEPARTURE_HOLD_MS} from '../departure-signal-fault';
import {MOVEMENT_HOOKS_ADDON, addonSwitches, characterAnswers, characterSeen, registerCharacterHalf, type Seen} from '../fixtures/movement-hooks-addon';
import {FIXTURE_RING, REPORT_FIELD, STATUS_LINE, STATUS_NOTICES, STATUS_TASK_LABEL, registerCharacterHalf as registerStatusHalf, statusHooksSwitches, type Heard} from '../fixtures/status-hooks-addon';
import {FOLLOW_DISTANCE} from '../../runtime/movement/rules.ts';
import {ARRIVAL_TOLERANCE} from '../../runtime/protocol/ladder.ts';

// W09 Party walk across Main and Town home, with dashboard actions (test-windows DESIGN.md 2.2).
// One play with no fight, from the town square: the merchant's first heartbeat makes it the
// merchant, and the player checks its card, scrolls the Hunt blacklist picker and equips the
// priest's Loaded Die from the dashboard; the merchant walks into the bank and back to its stand,
// then stands at the square; the party walks past a Targetron that attacks the merchant and then
// one that attacks the warrior; the party walks 450 with the warrior's first travel reply held and
// a sprite frame gone; the priest is placed far and follows; the movement hooks add-on holds,
// refuses, steps, walks and ends walks; the warrior's click pauses and hands back a walk and
// breaks a party Town, which casts again and lands; combat steps pause a travel and let it go; an
// add-on refuses the next Town; the status hooks add-on answers the dashboard's actions; a
// coordinator restart ends the play.
// Failure modes: C6 and C2, a merchant order or door route does not walk or arrive; H41 and H42, a
// Targetron's splash stops an outsider pass or the party ignores its own attacker; H6 and H15, a
// late departure or a missing sprite frame costs a recovery, an epoch or the arrival; C36, a far
// member does not follow; C29-C57 and C40, a movement hook or notice is not asked, heard or
// obeyed; T8, a click does not hand back, a broken Town does not cast again and land, or letting
// go sends a stop; C5, a heal cancels the Town channel; M12, M39 and M52, the dashboard's equip,
// merchant controls or blacklist picker fail or a restart loses them; M62, a status hook the
// dashboard's actions answer is not heard.
// Each check's steps are the play's own; a failed step records its message under its check and
// the play goes on, so every check still reports.
// Every old spec this window cites is at 21fe30a2b.
const [W, P] = [fighters[0]!, fighters[1]!], M = merchant;
const failed: Record<string, string> = {}, reads: Record<string, any> = {};
const step = async (id: string, run: () => Promise<unknown>) => {
  try { await run(); } catch (error) { failed[id] ??= String((error as Error)?.message ?? error).slice(0, 2000); }
};

// The movement hooks fixture (live-movement-hooks.spec.ts), with its answering hooks.
const coordinator = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-movement-hooks', body);
const seenC = async (live: LiveGame) => await coordinator(live, {op: 'seen'}) as Seen[];
const seenW = async (live: LiveGame, since = 0) => await live.clients[W]!.run(characterSeen(since)) as Seen[];
const askC = async (live: LiveGame, hook: string, ...args: unknown[]) => (await coordinator(live, {op: 'ask', hook, args})).answer;
const askW = async (live: LiveGame, hook: string, ...args: unknown[]) => await live.clients[W]!.run(`globalThis.__partyHooks.ask(${JSON.stringify(hook)},...${JSON.stringify(args)})`);
const heard = (seen: Seen[], hook: string) => seen.filter(s => s.hook === hook).map(s => s.payload as Record<string, unknown>);
const at = async (live: LiveGame, name: string) => await live.clients[name]!.run('({map:character.map,in:character.in,x:character.real_x,y:character.real_y})') as {map: string; in: string; x: number; y: number};

// The status hooks fixture (live-status-hooks.spec.ts), both halves: W01 hears its notices on the
// farm, and here its character half answers the dashboard's actions (QUESTIONS.md L5).
const fixture = async (live: LiveGame, body: Record<string, unknown>) => await live.post('/e2e-status-hooks', body);
const statusHeard = async (live: LiveGame, since: number) => await fixture(live, {op: 'heard', since}) as Heard[];
const of = (list: Heard[], hook: string) => list.filter(h => h.hook === hook);
const api = (live: LiveGame, route: string, init: RequestInit = {}) => fetch(`${live.deploymentPaths.apiUrl}/party-api${route}`, init);

// M39 and M52: the dashboard on the merchant's first heartbeat, then the warrior's blacklist picker.
async function merchantCard(live: LiveGame, page: Page) {
  const name = M;
  await step('M39', async () => {
    // No merchant/config request: the first real merchant heartbeat must assign it.
    await expect.poll(async () => (await live.state()).merchantCharacter).toBe(name);
    await page.goto(live.url);
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.getByText(/Merchant logistics/)).toBeVisible();
    await expect(card.getByRole('button', {name: 'Donate gold', exact: true})).toBeVisible();
    await expect(card.getByText(/Monster focus/)).toHaveCount(0);
    await card.getByRole('button', {name: 'Donate gold', exact: true}).click();
    const donation = page.getByRole('dialog', {name: 'Donate gold for merchant XP'});
    await expect(donation).toContainText(name + ' will withdraw');
    await donation.getByRole('button', {name: 'Cancel', exact: true}).click();
  });
  await step('M52', async () => {
    let catalog: Array<{id:string}> = [];
    await expect.poll(async () => {
      catalog = (await live.state(true)).monsterChoices || [];
      return catalog.length;
    }, { timeout: 90_000 }).toBeGreaterThan(30);
    const warrior=page.locator('article').filter({has:page.getByRole('heading',{name:'E2EWarrior',exact:true})});
    await warrior.getByRole('button',{name:'Farming settings',exact:true}).click();
    await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button',{name:'Add',exact:true}).click();
    const picker=page.getByRole('dialog',{name:'Add to Hunt blacklist',exact:true});
    const list=picker.getByRole('region',{name:'Hunt blacklist monsters'});
    const rows=list.getByRole('button',{name:/^Inspect /});
    await expect.poll(() => rows.count()).toBeGreaterThan(30);
    const firstName=(await rows.first().getAttribute('aria-label'))!.replace('Inspect ','');
    await rows.first().click({position:{x:70,y:20}});
    await expect(page.getByRole('heading',{name:firstName,exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await list.hover();
    await page.mouse.wheel(0,100000);
    await expect(rows.last()).toBeInViewport();
    await expect(rows.first()).not.toBeInViewport();
    const lastName=(await rows.last().getAttribute('aria-label'))!.replace('Inspect ','');
    await rows.last().click({position:{x:20,y:20}});
    await expect(page.getByRole('heading',{name:lastName,exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    await picker.getByRole('textbox',{name:'Search blacklist monsters'}).fill('goo');
    const goo=picker.getByRole('button',{name:'Inspect Goo',exact:true});
    await goo.click({position:{x:20,y:20}});
    await expect(page.getByRole('heading',{name:'Goo',exact:true})).toBeVisible();
    await page.keyboard.press('Escape');
    const matches=(request: Request)=>{
      if(request.method()!=='POST'||!request.url().endsWith('/party-api/hunt-blacklist'))return false;
      const body=request.postDataJSON();return body?.action==='add'&&body.monsterId==='goo'&&body.character==='E2EWarrior';
    };
    const response=page.waitForResponse(response=>matches(response.request()),{timeout:15_000});
    await picker.getByRole('button',{name:'Add Goo to blacklist',exact:true}).click();
    const receipt=await response,body=await receipt.json();
    expect(receipt.ok()).toBe(true);
    expect(body.blacklist.goo.reason).toBe('Manually blacklisted');
    await expect.poll(async()=>(await live.state()).farmingProfiles.E2EWarrior.huntBlacklist.goo?.reason).toBe('Manually blacklisted');
    reads.M52 = {firstName, lastName, monsters: catalog.length};
    // The picker and the Settings dialog under it each close on Escape; M12 reads the cards.
    await page.keyboard.press('Escape');
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    if (await settings.isVisible()) await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
  });
}

// M12: the priest's Loaded Die equips from its inventory menu; the restart at the play's end reads it again.
const cargo = (live: LiveGame) => live.admin(`output=(()=>{const p=get_player('${P}');return {items:p.items,slots:p.slots}})()`);
async function loadedDie(live: LiveGame, page: Page) {
  const name = P;
  await step('M12', async () => {
    const seed=await live.admin(`output=(()=>{const p=get_player('${name}');
      if(!p||p.items[10])throw Error('Loaded Die fixture requires empty inventory cell 10');
      if(G.items.cave_loaded_die.type!=='orb')throw Error('Native Loaded Die must be orb equipment');
      p.items[10]={name:'cave_loaded_die',level:0};
      p.slots.orb={name:'orbofint',level:0};
      cache_player_items(p);p.cslots.orb=cache_item(p.slots.orb);resend(p,'reopen+cid');
      return {definition:G.items.cave_loaded_die,items:p.items,orb:p.slots.orb};})()`);
    reads.M12 = {seed: seed.orb};
    await expect.poll(async()=> (await live.state()).characters[name]?.items?.some((entry:any)=>entry?.item?.name==='cave_loaded_die'),{timeout:30_000}).toBe(true);
    // A fresh dashboard, as the old test opened it: no dialog or picker from M52 covers the card.
    await page.goto(live.url);
    const priest=page.locator('article').filter({has:page.getByRole('heading',{name,exact:true})});
    const inventory=priest.getByRole('button',{name:/^Inventory/});
    await expect(inventory).toBeVisible();
    if(await inventory.getAttribute('aria-expanded')!=='true')await inventory.click();
    const die=priest.getByLabel('Loaded Die',{exact:true});
    await expect(die).toBeVisible();await die.click({button:'right'});
    await expect(page.getByRole('menuitem',{name:'Equip',exact:true})).toBeVisible();
    await page.getByRole('menuitem',{name:'Equip',exact:true}).click();
    await expect.poll(()=>live.admin(`output=get_player('${name}').slots.orb`),{timeout:30_000}).toMatchObject({name:'cave_loaded_die',level:0});
    const after=await cargo(live);
    expect(after.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
    expect([...after.items,...Object.values(after.slots)].filter((item:any)=>item?.name==='cave_loaded_die')).toHaveLength(1);
  });
}

// C6 with C2's reads (DESIGN.md 4.2 C2): the merchant's order into the bank walks and arrives,
// then its route home crosses the door back.
async function merchantRoute(live: LiveGame, page: Page) {
  await step('C6', async () => {
    await expect(page.getByRole('heading', { name: M, exact: true })).toBeVisible();
    const before = await observed(live);
    const bank = await live.admin(`output={map:'bank',x:G.maps.bank.spawns[0][0],y:G.maps.bank.spawns[0][1]}`), destination = bank;
    await travel(live, M, bank);
    await step('C2', async () => {
      // The merchant walks main's square to the bank door first, so the 50 it moves reads on main.
      await expect.poll(async () => Math.hypot((await observed(live))[M].x-before[M].x, (await observed(live))[M].y-before[M].y), { timeout: 30_000 }).toBeGreaterThan(50);
      reads.C2 = {before: before[M], destination};
    });
    await arrived(live, [M], bank);
    await step('C2', async () => {
      const client = await live.clients[M].snapshot();
      expect(Math.hypot(client.x-destination.x, client.y-destination.y)).toBeLessThan(35);
    });
    // Idle merchant policy returns to this stand. Main's Town spawn is only a
    // transient arrival on that route and can be left between observations.
    const home = { map: 'main', x: -63, y: 100 };
    await travel(live, M, home);
    await arrived(live, [M], home);
  });
}

// H41 and H42: a Targetron by the party's route attacks the merchant at its stand in the square,
// then a second one the warrior, each while the party walks 100 from the square.
async function targetronPasses(live: LiveGame) {
  await live.post('/merchant/stand-location',{map:'main',x:0,y:0});
  await expect.poll(()=>live.clients[M].run('Math.hypot(character.real_x,character.real_y)'),{timeout:45_000}).toBeLessThan(4);
  await expect.poll(()=>live.clients[W].run(`!parent.party_list.includes('${M}')`),{timeout:15_000}).toBe(true);
  for (const partyTarget of [false, true]) await step(partyTarget ? 'H42' : 'H41', async () => {
    // Each pass starts from a standing party. In w03-w05-w09-run4 the H41 walk's arrival left a
    // second walk of both fighters in travel when H42 posted its own; the warrior kept the old
    // walk's id, the coordinator dropped it from the new one, and H42's start poll never saw it.
    for (const name of fighters) await settleNavigation(live.clients[name]!, name);
    // arrived()'s walk bound (game/hunt-lifecycle.ts) holds the walk's end.
    await expect.poll(async()=>(await live.state()).activeConvoy?.id??null,{timeout:120_000,message:'The party walk before the pass ends'}).toBeNull();
    // Lose the readiness transport while the real client has installed its
    // owner. This gives the native explosion a stationary initial window;
    // readiness and actual movement are restored immediately after its receipt.
    let holdReady=true;
    const context=live.clients[W]!.page.context();
    await context.route('**/party-api/status',async route=>{
      const body=route.request().postDataJSON();
      if(holdReady&&body?.name===W&&body.convoyNavigation?.routeReady)return route.abort('failed');
      return route.continue();
    });
    const samples:any[]=[];let monster:any;
    // The second pass walks to another point 100 from the square than the first one ended on.
    const destination=await live.clients[W]!.run(`(()=>{for(let i=0;i<16;i++){const x=100*Math.cos(i*Math.PI/8),y=100*Math.sin(i*Math.PI/8);if(can_move_to(x,y)&&Math.hypot(x-character.real_x,y-character.real_y)>60)return {map:character.map,x,y};}throw Error('No native clear convoy endpoint');})()`);
    expect(await live.clients[P]!.run(`can_move_to(${destination.x},${destination.y})`),'The same native endpoint must be clear for the Priest footprint').toBe(true);
    // A sampler records the convoy and the warrior's own walk id every second through the start
    // polls below (w03-w05-w09-run3's H42 failed in one of them with no reading).
    const starts:any[]=[];
    reads[partyTarget ? 'H42' : 'H41'] = {destination, starts};
    let sampling=true;
    const sampler=(async()=>{while(sampling){try{const s=await live.state(),own=await live.clients[W].run('partyMovement.convoyNavigationReport()?.id??null');
      starts.push({at:Date.now(),own,convoy:s.activeConvoy&&{id:s.activeConvoy.id,phase:s.activeConvoy.phase,participants:s.activeConvoy.participants}});if(starts.length>45)starts.splice(0,1);}catch(e){starts.push(String(e));}
      await waitForGameplay(1_000);}})();
    try{
      await live.post('/travel',destination);
      await expect.poll(async()=>{const s=await live.state();return s.activeConvoy?.participants?.includes(W)&&['shared-prepare','shared-travel','travel'].includes(s.activeConvoy.phase);},{timeout:30_000}).toBe(true);
      // The route above drops each report of the warrior's that carries routeReady, and the
      // warrior's first report of the walk can already carry it, so the coordinator may never hear
      // its convoy. The warrior's own client names the walk it runs.
      await expect.poll(async()=>{const s=await live.state(),own=await live.clients[W].run('partyMovement.convoyNavigationReport()?.id??null');return !!s.activeConvoy&&own===s.activeConvoy.id;},{timeout:15_000}).toBe(true);
      sampling=false;await sampler;
      monster=await live.admin(`output=(()=>{const p=get_player('${W}'),original=G.monsters.targetron;try{
        G.monsters.targetron={...original,hp:1000000,attack:1000,speed:0,charge:0,aggro:0,range:200};
        const m=new_monster(p.in,{type:'targetron',count:1,boundary:[p.x+40,p.y,p.x+41,p.y+1]},{temp:1});
        // Every later recalculation (target_player, a condition: node/server.js
        // calculate_monster_stats) reads zone_stats before the catalog, so the seed keeps its
        // declared attack, frequency and speed for the whole case.
        m.zone_stats={...G.monsters.targetron};
        target_player(m,get_player('${partyTarget?W:M}'));return {id:m.id,type:m.type,instance:p.in,target:m.target??null,map:m.map,x:m.x,y:m.y,explosion:m.explosion,
          peaceful:!!m.peaceful,dead:!!m.dead,conditions:Object.keys(m.s||{}),zoneActor:!!m.zone_actor};
      }finally{G.monsters.targetron=original;}})()`);
      // The seed's own precondition: the declared Targetron attacks its declared target.
      expect(monster.target,'The seeded Targetron must target '+(partyTarget?W:M)+': '+JSON.stringify(monster)).toBe(partyTarget?W:M);
      // Each poll also records the seed's own state and where W and M stand, so a case that
      // sees no hit names whom the Targetron attacked and from where.
      const seedTrace:any[]=[];
      try{
        await expect.poll(async()=>{
          seedTrace.push(await live.admin(`output=(()=>{const m=instances[${JSON.stringify(monster.instance)}]?.monsters?.[${JSON.stringify(monster.id)}],w=get_player('${W}'),mm=get_player('${M}');
            return {at:Date.now(),seed:m?{target:m.target||null,x:m.x,y:m.y,speed:m.speed,attack:m.attack,frequency:m.frequency,moving:!!m.moving}:null,W:w&&{x:w.x,y:w.y,moving:!!w.moving},M:mm&&{x:mm.x,y:mm.y}};})()`));
          const hits=(await live.clients[W].events()).filter((e:any)=>e.event==='hit'&&String(e.data?.hid)===String(monster.id)&&e.data?.id===W&&e.data?.damage>0);
          return partyTarget?hits.length:hits.filter((e:any)=>e.data.splash===true).length;},{timeout:30_000}).toBeGreaterThan(0);
      }finally{reads[partyTarget ? 'H42' : 'H41'].seedTrace = seedTrace.slice(-6);}
      holdReady=false;
      await expect.poll(async()=>{const state=await live.state(),native=await world(live);samples.push({at:Date.now(),convoy:state.activeConvoy&&{id:state.activeConvoy.id,phase:state.activeConvoy.phase,epoch:state.activeConvoy.epoch}});
        return partyTarget?[W,P].some(n=>state.characters[n]?.convoyNavigation?.defenseTargets?.some((t:any)=>String(t.id)===String(monster.id))):[W,P].every(n=>native[n].map===destination.map&&Math.hypot(native[n].x-destination.x,native[n].y-destination.y)<=25);
      },{timeout:60_000}).toBe(true);
      Object.assign(reads[partyTarget ? 'H42' : 'H41'], {destination, monster, samples: samples.slice(-6)});
    }finally{
      sampling=false;await sampler;
      holdReady=false;
      await context.unrouteAll({behavior:'ignoreErrors'});
      if(monster)await live.admin(`output=(()=>{const seed=${JSON.stringify(monster)},m=instances[seed.instance]?.monsters?.[seed.id];if(m&&m.type===seed.type&&m.map===seed.map)remove_monster(m,{method:'disappear',nospawn:true});return true;})()`);
    }
  });
  // The H42 pass ends in the party's defense; the walk the next step reads starts from a standing party.
  for (const name of fighters) await settleNavigation(live.clients[name]!, name);
}

// H6 with H15's reads (DESIGN.md 4.2 H15): one party walk of 450 with the warrior's first travel
// reply held and a foreign monster's sprite frame missing on the warrior's client for 7 s.
async function lateDeparture(live: LiveGame) {
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
  try {
    await expect.poll(() => live.clients[W].frame.evaluate(id => Boolean((window as any).entities[id]), monsterId)).toBe(true);
    const fault = await live.clients[W]!.frame.evaluate(id => {
      const game = window as any, c = game.character;
      const sprite = game.entities[id], frames = game.textures[sprite.skin];
      if (!Array.isArray(frames) || !frames[1]) throw Error('Native sprite fixture requires an idle frame');
      const sharing = Object.values(game.entities).filter((e: any) => e !== sprite && e.skin === sprite.skin).length;
      if (sharing) throw Error('The faulted skin must be unique in view');
      const saved = frames[1], started = Date.now(), draws = game.draws;
      // Cosmetic cache fault only. Native movement, sockets and physics are untouched.
      delete frames[1];
      sprite.cskin = null;
      game.__e2eRenderFault = {skin:sprite.skin, started, draws, reschedules:0, restored:false};
      const requestFrame = game.requestAnimationFrame;
      // Observe scheduling without changing its callbacks or timing. Host FPS is
      // not a correctness requirement; a throwing draw never reaches this call.
      game.requestAnimationFrame = function(callback: FrameRequestCallback) {
        if (callback === game.draw) game.__e2eRenderFault.reschedules++;
        return requestFrame.call(game, callback);
      };
      setTimeout(() => {frames[1] = saved; game.requestAnimationFrame = requestFrame; game.__e2eRenderFault.restored = true;}, 7000);
      return {skin:sprite.skin, started, draws, origin:{map:c.map,x:c.real_x,y:c.real_y}};
    }, monsterId);
    const destination = await live.clients[W]!.run(`(()=>{for(let i=0;i<16;i++){const a=i*Math.PI/8,x=character.real_x+450*Math.cos(a),y=character.real_y+450*Math.sin(a);if(can_move_to(x,y))return {map:character.map,x,y};}throw Error('No reachable native walk')})()`);
    const installed=await live.clients[W]!.run(departureSignalFaultSource(W));
    let maxRecoveryAttempts = 0;
    const epochs = new Set<string>();
    const observe = async () => {
      const convoy = (await live.state()).activeConvoy;
      maxRecoveryAttempts = Math.max(maxRecoveryAttempts, convoy?.recoveryAttempts || 0);
      if (convoy && convoy.phase === 'travel') epochs.add(convoy.id + ':' + convoy.epoch);
    };
    try {
      await live.post('/travel',destination);
      await step('H15', async () => {
        await expect.poll(async () => live.clients[W].frame.evaluate(() => (window as any).__e2eRenderFault.restored), {timeout:15_000}).toBe(true);
        const observations = await live.clients[W]!.frame.evaluate(() => (window as any).__e2eRenderFault);
        reads.H15 = {seed, fault, observations};
        expect(observations.reschedules, 'Native draw must continue scheduling its own frames during the texture fault').toBeGreaterThan(2);
        expect(live.clients[W].errors.filter(error => /texture|reading/.test(error))).toEqual([]);
      });
      await step('H6', async () => {
        await expect.poll(async () => {
          await observe();
          const blocked=await live.clients[W]!.run('globalThis.__e2eDepartureFaults || []');
          return blocked.filter((fault:{startedAt:number;endedAt:number})=>fault.endedAt-fault.startedAt>=DEPARTURE_HOLD_MS-50).length;
        }, {timeout:120_000,message:"The warrior's first travel reply must be held"}).toBe(1);
        await expect.poll(async () => {
          await observe();
          const current = await world(live);
          return fighters.every(name => current[name].map===destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
        }, {timeout:90_000}).toBe(true);
        expect(maxRecoveryAttempts,'A late departure is no route failure').toBe(0);
        expect([...epochs],'The walk departs once, under one epoch').toHaveLength(1);
        const hook=await live.clients[W]!.run('globalThis.__e2eDepartureHook');
        expect(hook?.generation).toBe(installed.generation);
        expect(hook?.signals.length).toBe(1);
        reads.H6 = {destination, signals: hook?.signals, maxRecoveryAttempts, epochs: [...epochs]};
      });
      // H15's arrival is H6's, read with its own 35.
      await step('H15', async () => {
        await expect.poll(async () => {
          const current = await world(live);
          return fighters.every(name => current[name].map === destination.map && Math.hypot(current[name].x-destination.x,current[name].y-destination.y)<35);
        }, {timeout:90_000}).toBe(true);
      });
    } finally {
      await live.clients[W]!.run(`(()=>{const hook=globalThis.__e2eDepartureHook;if(hook){hook.enabled=false;hook.restore?.();}delete globalThis.__e2eDepartureHook;delete globalThis.__e2eDepartureFaults;return true;})()`);
    }
  } finally {
    await live.clients[W]!.frame.evaluate(() => { delete (window as any).__e2eRenderFault; });
    await live.admin(`output=(()=>{for(const i of Object.values(instances)){const m=i.monsters?.[${JSON.stringify(seed.id)}];if(m)remove_monster(m,{method:'disappear',nospawn:true});}return true;})()`);
  }
}

// C36's far half: the priest placed beyond FOLLOW_DISTANCE of the warrior asks the follow, which
// walks it back. The near half is W01's.
async function farFollow(live: LiveGame) {
  await step('C36', async () => {
    // The follow mover answers false while a walk holds the member (movers.ts followLeaderIfFar
    // `walkHeld`), so the play's walks end before the priest is placed far.
    for (const name of fighters) await settleNavigation(live.clients[name]!, name);
    await expect.poll(async () => (await live.state()).activeConvoy ?? null, {timeout: 60_000, message: "the play's walks end"}).toBeNull();
    const w = await at(live, W);
    const to = await live.admin(`output=(()=>{const w=get_player('${W}');for(let i=0;i<16;i++){const t=i*Math.PI/8,x=w.x+${FOLLOW_DISTANCE + 150}*Math.cos(t),y=w.y+${FOLLOW_DISTANCE + 150}*Math.sin(t);
      if(can_move({map:w.map,x:w.x,y:w.y,going_x:x,going_y:y,base:w.base})){transport_player_to(get_player('${P}'),w.map,[x,y]);return {map:w.map,x,y};}}throw Error('No clear point beyond the follow distance');})()`) as {map: string; x: number; y: number};
    await expect.poll(async () => { const p = await at(live, P); return p.map === to.map && Math.hypot(p.x - to.x, p.y - to.y) < 5; }, {timeout: 15_000, message: 'the priest stands beyond the follow distance'}).toBe(true);
    const answer = await live.clients[P]!.run(`globalThis.__partyHooks.ask('movement.followIfFar',{character:${JSON.stringify(P)}})`);
    reads.C36 = {placed: to, warrior: w, answer};
    expect(answer, 'a member beyond the distance walks').toBe(true);
    await expect.poll(async () => { const p = await at(live, P), now = await at(live, W); return Math.hypot(p.x - now.x, p.y - now.y); },
      {timeout: 60_000, message: 'the priest walks back inside the follow distance'}).toBeLessThanOrEqual(FOLLOW_DISTANCE);
    for (const name of fighters) await settleNavigation(live.clients[name]!, name);
  });
}

// The movement hooks fixture's answering rows, at the party's spot after the walks.
async function movementHooks(live: LiveGame) {
  const group = String(heard(await seenC(live), 'walk.formed')[0]?.group);
  await step('C29', async () => {
    await live.clients[W]!.run(characterAnswers({hold:'hooks table hold'}));
    // An add-on's hold is a combat hold: the movement tick stops the character's own step and names
    // the add-on in its combat position. `movement.live` names only journeys and request holds, so
    // it never shows this hold. The registry weighs the answer at its registration's tier.
    const position=`(()=>{const p=globalThis.partyCombatPosition;return [p?.movementOwner??null,p?.reason??null];})()`;
    try{
      await expect.poll(()=>live.clients[W]!.run(position),{timeout:30_000}).toEqual([`addon:${MOVEMENT_HOOKS_ADDON}`,'hooks table hold']);
      expect(await live.clients[W]!.run(`(()=>{const a=globalThis.__partyHooks.moverAnswer({});return a&&[a.registration,a.mover.tier,a.answer.kind];})()`)).toEqual([MOVEMENT_HOOKS_ADDON,'addon-task','hold']);
    }finally{await live.clients[W]!.run(characterAnswers({hold:null}));}
    await expect.poll(async()=>(await live.clients[W]!.run(position) as unknown[])[0],{timeout:30_000}).not.toBe(`addon:${MOVEMENT_HOOKS_ADDON}`);
  });
  await step('C31', async () => {
    const here=await at(live,W),to={x:here.x+12,y:here.y};
    await live.clients[W]!.run(characterAnswers({refuseSteps:'inside the hooks table zone'}));
    try{
      const result=await askW(live,'movement.step',to,'hooks-table') as {status:string;reason?:string};
      expect(result.status).toBe('refused');expect(String(result.reason)).toContain('inside the hooks table zone');
    }finally{await live.clients[W]!.run(characterAnswers({refuseSteps:null}));}
    expect(heard(await seenW(live),'step.safety').some(a=>JSON.stringify(a.to)===JSON.stringify(to))).toBe(true);
  });
  await step('C43', async () => {
    const here=await at(live,W),to={x:here.x+10,y:here.y};
    const result=await askW(live,'movement.step',to,'hooks-table') as {status:string};
    expect(['sent','kept']).toContain(result.status);
    expect(heard(await seenW(live),'step.safety').some(a=>JSON.stringify(a.to)===JSON.stringify(to)),'step safety judged it').toBe(true);
  });
  await step('C42', async () => {
    const here=await at(live,W),ask=(tier:string,dx:number)=>({kind:'hooks-table',destination:{map:here.map,x:here.x+dx,y:here.y},members:[W,P],tier,label:'hooks table'});
    try{
      expect(await askC(live,'walks.request',group,ask('hunt-mission',220))).toBe(true);
      await expect.poll(async()=>heard(await seenC(live),'walk.formed').some(f=>f.group===group&&f.tier==='hunt-mission'),{timeout:30_000}).toBe(true);
      // The walk gives way to a second ask of its own task at any tier, so the lower ask comes from
      // another task, at farming, the task tier below hunt-mission.
      expect(await askC(live,'walks.request',group,{...ask('farming',-220),kind:'hooks-table-lower'}),'a lower ask while the walk holds').toBe(false);
    }finally{await coordinator(live,{op:'walks',hook:'walks.end',args:[group,'cancelled']});}
  });
  await step('C37', async () => {
    const here=await at(live,W);
    expect(await askC(live,'walks.request',group,{kind:'hooks-table',destination:{map:here.map,x:here.x+200,y:here.y},members:[W,P],tier:'farming',label:'hooks table'})).toBe(true);
    // A named member leaves the walk alone and the walk goes on for its leader: walks.end answers
    // false and tells walk.member 'left' (Follow off for a follower, d5dccc495).
    expect((await coordinator(live,{op:'walks',hook:'walks.end',args:[group,'realm-switch',P]})).answer,'the walk goes on without the leaver').toBe(false);
    await expect.poll(async()=>heard(await seenC(live),'walk.member').some(m=>m.member===P&&m.change==='left'),{timeout:30_000}).toBe(true);
    expect((await coordinator(live,{op:'walks',hook:'walks.end',args:[group,'realm-switch']})).answer).toBe(true);
    await expect.poll(async()=>heard(await seenC(live),'walk.ended').some(e=>e.group===group&&e.code==='realm-switch'),{timeout:30_000}).toBe(true);
  });
  // The leave turned the priest's Follow off; the play's later walks are the party's.
  await live.post('/formation', {character: P, follow: true});
  for (const name of fighters) await settleNavigation(live.clients[name]!, name);
  await step('C55', async () => {
    // A request hold refuses every step before step safety reads it.
    await expect.poll(()=>askW(live,'movement.live'),{timeout:180_000}).toBeNull();
    const here=await at(live,W),offered={x:Math.round(here.x)+8,y:Math.round(here.y)};
    await live.clients[W]!.run(characterAnswers({point:offered}));
    try{
      await askW(live,'movement.step',{x:here.x-8,y:here.y},'hooks-table');
      const w=await seenW(live);
      expect(heard(w,'step.point').some(a=>a.mover==='hooks-table')).toBe(true);
      expect(heard(w,'step.safety').some(a=>JSON.stringify(a.to)===JSON.stringify(offered)),'step safety judged the offered point').toBe(true);
    }finally{await live.clients[W]!.run(characterAnswers({point:null}));}
  });
}

// T8's live half (DESIGN.md 4.3 T8): the warrior's click pauses a follow and hands it back, a click
// breaks the party's Town, which casts again and lands (C5's heal watch and C56, C57 read that
// Town), and combat steps pause a travel and let it go with no stop packet.
const stopPackets=`(()=>{if(!globalThis.__e2eStops){const s=globalThis.__e2eStops={count:0},original=globalThis.move;
  globalThis.move=function(x,y){if(Math.hypot(x-character.real_x,y-character.real_y)<1)s.count++;return original(x,y);};}return globalThis.__e2eStops.count;})()`;
// Records every native move with its target and whether it is a stop packet.
const moveLog=`(()=>{if(!globalThis.__e2eMoveLog){const log=globalThis.__e2eMoveLog=[],original=globalThis.move;
  globalThis.move=function(x,y){log.push({at:Date.now(),x,y,stop:Math.hypot(x-character.real_x,y-character.real_y)<1});return original(x,y);};}return globalThis.__e2eMoveLog.length;})()`;
async function playerHands(live: LiveGame) {
  const client = live.clients[W]!;
  // The stop and move logs wrap the page's `move` and add __e2e globals; the runner's global undo
  // puts back the `move` the window started with and removes the globals (window-runner.ts
  // restoreGlobals).
  await client.run(stopPackets);
  const stops=async()=>await client.run('globalThis.__e2eStops.count') as number;
  const {o,a}=await client.run(`(()=>{const c=character,clear=(p,q)=>can_move({map:c.map,x:p.x,y:p.y,going_x:q.x,going_y:q.y,base:c.base});
    const o={map:c.map,x:c.real_x,y:c.real_y},found=[];
    for(let i=0;i<16&&found.length<1;i++){const t=i*Math.PI/8,p={map:c.map,x:o.x+250*Math.cos(t),y:o.y+250*Math.sin(t)};
      if(clear(o,p)&&clear(p,o))found.push(p);}
    if(!found.length)throw Error('No clear point');return {o,a:found[0]};})()`) as Record<'o'|'a',{map:string;x:number;y:number}>;
  const journey=async()=>await client.run('__partyMovement.report()?.id ?? null') as string|null;
  const walking=async()=>await client.run('!!character.moving');
  const records=async()=>await client.run('__partyMovement.records()') as any[];
  const ended=async(id:string)=>(await records()).find(entry=>entry.decision==='ended'&&entry.journeyId===id);
  const code=async(id:string)=>(await ended(id))?.code;
  const ask=async(destination:unknown,request?:Record<string,unknown>)=>await client.run(`(()=>{const id='ask'+Math.random(),asks=globalThis.__e2eAsk||={};asks[id]='pending';
    smart_move(${JSON.stringify(destination)},undefined,${request?`{request:${JSON.stringify(request)}}`:'undefined'}).then(()=>asks[id]='arrived',e=>asks[id]=e&&e.code||String(e&&e.message||e));
    return {id,journey:__partyMovement.report()?.id??null};})()`) as {id:string;journey:string|null};
  const outcome=async(id:string)=>await client.run(`globalThis.__e2eAsk[${JSON.stringify(id)}]`);
  const travelW=async(location:unknown)=>{
    const prior=await journey();
    await live.post('/command',{character:W,type:'character-travel',location,label:'Movement owner on'});
    await expect.poll(async()=>{const id=await journey();return id&&id!==prior?id:null;},{timeout:15_000}).toBeTruthy();
    return (await journey())!;
  };
  const near=async(p:{x:number;y:number})=>await client.run(`Math.hypot(character.real_x-(${p.x}),character.real_y-(${p.y}))`) as number;
  const reached=async(p:{x:number;y:number})=>{await expect.poll(async()=>!(await walking())&&await near(p)<=ARRIVAL_TOLERANCE,{timeout:60_000}).toBe(true);};
  const click=async(p:{x:number;y:number})=>await client.run(`(()=>{const g=parent,c=g.character,x=${p.x},y=${p.y};
    if(typeof on_map_click==='function'&&on_map_click(x,y))return false;
    const m=typeof g.calculate_move==='function'?g.calculate_move(c,x,y):{x,y};
    c.from_x=c.real_x;c.from_y=c.real_y;c.going_x=m.x;c.going_y=m.y;c.moving=true;if(typeof g.calculate_vxy==='function')g.calculate_vxy(c);
    g.socket.emit('move',{x:c.real_x,y:c.real_y,going_x:c.going_x,going_y:c.going_y,m:c.m});return true;})()`);
  const clicking=async()=>await client.run('__partyMovement.clicking()') as {walking:boolean;remainingMs:number|null}|null;
  const often={timeout:15_000,intervals:[50]};
  await step('T8', async () => {
    // Item 9: the click pauses the lower walk, and its own walk is not fought.
    const follow=await ask(a,{kind:'follow',owner:'follow'});
    await expect.poll(async()=>await near(o),{timeout:15_000}).toBeGreaterThan(60);
    await click(o);
    // Lower requests wait for the click to finish.
    const lower=await ask(a,{kind:'approach',owner:'approach:click'});
    await expect.poll(async()=>await outcome(lower.id)).toBe('refused');
    await expect.poll(async()=>(await records()).some((e:any)=>e.decision==='paused'&&e.journeyId===follow.journey&&e.cause==='click')).toBe(true);
    // Item 11: after the walk the card counts down, then the paused walk resumes by itself. The
    // countdown runs on the game's clock, so the polls look often.
    await expect.poll(async()=>(await clicking())?.walking,often).toBe(false);
    expect(await near(o),'the click walk reached its point').toBeLessThanOrEqual(ARRIVAL_TOLERANCE);
    await expect.poll(async()=>(await live.state()).characters.E2EWarrior?.activity?.text ?? '',often).toMatch(/^Your click - taking over in \d+ s$/);
    await expect.poll(async()=>(await records()).some((e:any)=>e.decision==='resumed'&&e.journeyId===follow.journey&&e.cause==='click'),{timeout:30_000}).toBe(true);
    expect(await clicking()).toBe(null);
    const endedClick=(await records()).find((e:any)=>e.decision==='ended'&&e.owner==='click');
    expect(endedClick?.code,'the countdown ends the click, never an open-ended pause').toBe('elapsed');
    await expect.poll(async()=>await code(follow.journey!),{timeout:60_000}).toBe('arrived');
    await reached(a);
    expect(await walking()).toBe(false);
  });
  await townCast(live, async () => {
    await step('T8', async () => {
      // Item 17 (user, 2026-10-29): a click breaks the console's Town channel. The cast's hold ends
      // `interrupted:click`, the card says Town comes again, and after the countdown the same Town
      // request casts again by itself and lands.
      await expect.poll(async()=>await client.run('!!(character.c&&character.c.town)'),often).toBe(true);
      await click(o);
      await expect.poll(async()=>(await records()).some((e:any)=>e.decision==='ended'&&e.code==='interrupted:click'&&/^town:/.test(String(e.owner))),often).toBe(true);
      await expect.poll(async()=>(await live.state()).characters.E2EWarrior?.activity?.text ?? '',often).toMatch(/^Your click - casting Town again in \d+ s$/);
      // Landed is the server's word: its player has no Town channel and stands in the spawn's
      // scatter, and the client shows it there with the cast's hold released. The client drops its
      // own c.town when the channel's time runs out, before the server's teleport arrives, so the
      // client alone reads landed while it still stands where the click left it.
      await expect.poll(async()=>{const r=await records(),cut=r.findLastIndex((e:any)=>e.decision==='ended'&&e.code==='interrupted:click');
        return cut>=0&&r.slice(cut+1).some((e:any)=>e.decision==='crossing'&&e.code==='town'&&e.owner===r[cut].owner);},{timeout:30_000}).toBe(true);
      const server=async()=>await live.admin(`output=(()=>{const p=get_player('${W}'),s=G.maps.main.spawns[0];return {map:p.map,x:p.x,y:p.y,town:!!(p.c&&p.c.town),radius:Math.hypot(s[3]/2,s[3]/2),sx:s[0],sy:s[1]};})()`) as any;
      await expect.poll(async()=>{const p=await server();if(p.map!=='main'||p.town||Math.hypot(p.x-p.sx,p.y-p.sy)>Math.max(ARRIVAL_TOLERANCE,p.radius))return false;
        // A cast that keeps Town held after it lands is the requester casting again (endCode read
        // the click's end after the recast released, step the status owner's first build).
        return await client.run(`!character.moving&&__partyMovement.live()?.kind!=='town'&&Math.hypot(character.real_x-(${p.x}),character.real_y-(${p.y}))<=${ARRIVAL_TOLERANCE}`);},{timeout:60_000}).toBe(true);
      // The ring keeps its last 128 records, so a count of casts falls when an old one leaves it; the
      // check reads the casts after the landing's last one by sequence number.
      const townCasts=async()=>(await records()).filter((e:any)=>e.decision==='crossing'&&e.code==='town');
      const landedSeq=Math.max(0,...(await townCasts()).map((e:any)=>e.seq));
      // The state carries no Town cycle; a member's Town command of the cycle leaves the fast state's pending
      // commands when that member's membership ends, so the cycle is over once none is left.
      await expect.poll(async()=>{const pending=(await live.state('fast')).pendingCommands;expect(pending,'the fast state publishes pendingCommands').toBeDefined();
        return Object.values(pending).filter((c:any)=>c?.type==='town-party').length;},{timeout:30_000}).toBe(0);
      expect((await townCasts()).filter((e:any)=>e.seq>landedSeq),'no Town cast after the landing').toEqual([]);
    });
  });
  // Items 1 to 5 of the combat steps: steps pause a dashboard travel, repeats send nothing, and
  // letting go resumes it with no stop packet and no new plan.
  await step('T8', async () => {
    await client.run(moveLog);
    const moves=async(since:number)=>(await client.run('globalThis.__e2eMoveLog') as any[]).slice(since);
    const service=async(expression:string)=>await client.run(`__partyMovement.${expression}`);
    const entries=async(id:string,decision:string)=>(await records()).filter((entry:any)=>entry.journeyId===id&&entry.decision===decision);
    const side=async(length=40,offset=0,toward?:{x:number;y:number})=>await client.run(`(()=>{const c=character;for(let i=0;i<16;i++){const t=i*Math.PI/8,p={x:c.real_x+${length}*Math.cos(t)+${offset},y:c.real_y+${length}*Math.sin(t)};
      const q=${JSON.stringify(toward??null)};
      if(can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:p.x,going_y:p.y,base:c.base})&&(!q||can_move({map:c.map,x:p.x,y:p.y,going_x:q.x,going_y:q.y,base:c.base})))return p;}throw Error('No clear step');})()`) as {x:number;y:number};
    // The Town landed the party at Main's spawn; the travel goes back to the click's first point.
    const target = await near(a) > 150 ? a : o;
    const first=await travelW(target);
    await expect.poll(walking,{timeout:15_000}).toBe(true);
    await expect.poll(async()=>(await service('report()'))?.remaining>0,{timeout:15_000}).toBe(true);
    const searches=(await service('report()')).searches;
    const p=await side(150,0,target);
    // One CODE frame call, as combat sends them within one tick: a round trip under virtual
    // time can outlast the walk of the step (the first run). The let go goes out in the
    // same call. The idle role runner lets go on every movement tick (resetCombatMovement).
    const burst=await client.run(`(()=>{const p=${JSON.stringify(p)},m=__partyMovement,first=m.step(p,'e2e-step').status,paused=m.live().paused;
      const walking=!!character.moving&&Math.hypot(character.going_x-p.x,character.going_y-p.y)<2,from=__e2eMoveLog.length;
      const repeats=[0,0.5,-0.5,1,-1].map(d=>m.step({x:p.x+d,y:p.y-d},'e2e-step').status),moves=__e2eMoveLog.slice(from);
      const held=m.live().paused,letGoFrom=__e2eMoveLog.length,letGoStops=__e2eStops.count;m.letGo();
      return {first,paused,walking,repeats,moves,held,letGoFrom,letGoStops,resumed:!m.live().paused};})()`);
    expect(burst.first).toBe('sent');
    expect(burst.paused,'the first step pauses the travel').toBe(true);
    expect(burst.walking,'precondition: the character walks the step').toBe(true);
    expect(burst.repeats,'steps to the point being walked are kept').toEqual(['kept','kept','kept','kept','kept']);
    expect(burst.moves,'native moves for repeated steps').toEqual([]);
    expect(burst.held,'precondition: the travel is still paused when combat lets go').toBe(true);
    expect(burst.resumed,'letting go resumes the travel').toBe(true);
    const {letGoFrom,letGoStops}=burst as {letGoFrom:number;letGoStops:number};
    expect((await service('live()')).paused).toBe(false);
    expect((await entries(first,'resumed')).map((entry:any)=>entry.cause)).toEqual(['let-go']);
    await expect.poll(async()=>(await moves(letGoFrom)).length,{timeout:5_000}).toBeGreaterThan(0);
    expect((await moves(letGoFrom))[0].stop,'the first move after letting go is travel, not a stop').toBe(false);
    expect(await stops(),'stop packets from letting go of a paused journey').toBe(letGoStops);
    await expect.poll(async()=>await code(first),{timeout:60_000}).toBe('arrived');
    expect((await service('last()')).searches,'planner searches across the pause').toBe(searches);
    expect((await records()).filter((entry:any)=>entry.journeyId===first).map((entry:any)=>entry.decision)).toEqual(['started','paused','resumed','ended']);
    await reached(target);
  });
}

// The party's Town after its walks (C5 merged into C29 by DESIGN.md 4.2; C56 and C57 read it):
// the priest's first channel gets a 15 HP injury and 40% MP, which no heal may cancel, and both
// land inside Main's spawn scatter. `during` runs while the cast is out (T8's click).
async function townCast(live: LiveGame, during: () => Promise<void>) {
  const spawn = await live.admin(`output={map:'main',x:G.maps.main.spawns[0][0],y:G.maps.main.spawns[0][1],scatter:G.maps.main.spawns[0][3]||0}`);
  const beforeTown = await observed(live), since = await live.clients[W]!.run('Date.now()') as number;
  // Failure inventory: a 15-HP deficit triggers passive healing during Town;
  // native healing clears the caster's channel and splits the returning party.
  // Declare the initial healing condition once, at the first real channel.
  // No cast, heal, transport, arrival or successful response is fabricated.
  await live.admin(`output=(()=>{
    const fixture=globalThis.__e2eTownHealing={armedAt:Date.now()};
    fixture.timer=setInterval(()=>{const p=get_player(${JSON.stringify(P)});
      if(fixture.seed||!p?.c?.town)return;
      fixture.seed={at:Date.now(),map:p.map,x:p.x,y:p.y,hp:p.hp,max_hp:p.max_hp,mp:p.mp,max_mp:p.max_mp,channel:{...p.c.town}};
      // As in the CI incident, MP recovery takes priority over topping off HP.
      // Otherwise regen_hp can erase the injury before the party status sees it.
      p.hp=p.max_hp-15;p.mp=Math.floor(p.max_mp*.4);
      fixture.seed.declaredHp=p.hp;fixture.seed.declaredMp=p.mp;resend(p,'u+cid');clearInterval(fixture.timer);
    },10);return {armedAt:fixture.armedAt,missingHp:15,mpRatio:.4};})()`);
  try {
    await live.post('/town-party', {});
    await during();
    await step('C29', async () => {
      await expect.poll(async () => {
        const current = await observed(live);
        // Upstream transport scatters each axis within half the configured spawn width.
        return [W, P].every(name => current[name].townAt > beforeTown[name].townAt &&
          current[name].map === spawn.map && !current[name].moving &&
          Math.abs(current[name].x-spawn.x) <= spawn.scatter/2+1 &&
          Math.abs(current[name].y-spawn.y) <= spawn.scatter/2+1);
      }, { timeout: 90_000, message: 'Both native Town casts must complete inside the actual server spawn bounds' }).toBe(true);
      await expect.poll(async () => (await live.state()).townCycle?.pending?.length || 0).toBe(0);
      const seed=await live.admin('output=globalThis.__e2eTownHealing.seed');
      expect(seed,'The native Town channel must receive the declared minor injury').toBeTruthy();
      const events=await live.clients[P]!.events();
      const receipt=events.find((event:any)=>event.event==='new_map'&&event.at>=seed.at&&event.data?.name===spawn.map&&event.data?.effect===1);
      expect(receipt,'The first real cast must produce a Town transport').toBeTruthy();
      // Native transport and a later heal can share one ChronAL window timestamp.
      // End the channel at its transport receipt's sequence, not an inclusive time.
      const channelHeals=events.filter((event:any)=>event.at>=seed.at&&event.sequence<receipt.sequence&&event.event==='hit'&&event.data?.hid===P&&event.data?.source==='heal');
      const starts=events.filter((event:any)=>event.at>=seed.at&&event.sequence<receipt.sequence&&event.event==='game_response'&&event.data?.place==='town'&&event.data?.in_progress);
      reads.C5 = {seed, receipt, channelHeals, starts};
      expect(channelHeals,'Routine heals must not cancel Town channeling').toEqual([]);
      expect(starts.length,'No second Town request may be needed after the declared injury').toBeLessThanOrEqual(1);
      expect(receipt.at-seed.at,'The original three-second native cast must finish without a walking fallback').toBeLessThan(8000);
    });
  } finally {
    await live.admin('output=(()=>{const fixture=globalThis.__e2eTownHealing;if(fixture)clearInterval(fixture.timer);delete globalThis.__e2eTownHealing;return true;})()');
  }
  await step('C56', async () => {
    expect(heard(await seenW(live,since),'crossing.started').length).toBeGreaterThan(0);
  });
  await step('C57', async () => {
    const ended=heard(await seenW(live,since),'crossing.ended');
    expect(ended.length).toBeGreaterThan(0);
    for(const e of ended)expect(['landed','refused','interrupted','timed-out']).toContain(e.code);
  });
}

// C54: an add-on refuses the next party Town, and the crossing ends refused.
async function refusedCrossing(live: LiveGame, since: number) {
  await step('C54', async () => {
    expect(heard(await seenW(live,since),'crossing.allows').length,'asked before the Town').toBeGreaterThan(0);
    const from=await live.clients[W]!.run('Date.now()') as number;
    await live.clients[W]!.run(characterAnswers({refuseCrossing:'the hooks table refuses this crossing'}));
    try{
      await live.post('/town-party',{});
      await expect.poll(async()=>heard(await seenW(live,from),'crossing.ended').some(e=>e.code==='refused'),{timeout:30_000}).toBe(true);
    }finally{await live.clients[W]!.run(characterAnswers({refuseCrossing:null}));}
  });
  // The refused crossings retry once the refusal clears; the play goes on when the Town is over.
  await expect.poll(()=>askW(live,'movement.live'),{timeout:180_000}).toBeNull();
}

// M62's answering half (QUESTIONS.md L5): the dashboard's actions, each answered by the status
// hooks add-on, with the add-on's own line and task. It plays with no walk, so its add-on task on
// the party group holds nothing the walk checks read.
async function statusAnswers(live: LiveGame, dashboard: Page) {
  const page = live.clients[W]!, heard = statusHeard;
  await step('M62', async () => {
    expect(await fixture(live, { op: 'register' }), 'the coordinator half registers').toEqual({ ok: true });
    expect(await page.run(registerStatusHalf), 'the character half registers').toEqual({ ok: true });
    await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(statusHooksSwitches(true)) }] });
  });
  const since = Date.now(), rows: Record<string, unknown> = {};
  reads.M62 = rows;
  const stream = new AbortController();
  try {
    await step('M62', async () => {
      const opened = await api(live, '/dashboard-stream', { signal: stream.signal });
      expect(opened.ok).toBe(true);
      await expect.poll(async () => of(await heard(live, since), 'dashboard.opened').length, { timeout: 10_000 }).toBeGreaterThan(0);
    });
    await step('M62', async () => {
      await expect.poll(async () => (await live.state()).characters[W]?.addonReports?.['status-hooks-fixture']?.[REPORT_FIELD] ?? null,
        { timeout: 30_000 }).not.toBeNull();
    });
    await step('M62', async () => {
      await fixture(live, { op: 'line', line: STATUS_LINE });
      await expect.poll(async () => (await live.state()).characters[W]?.activity?.addons ?? [], { timeout: 30_000 })
        .toContainEqual({ addon: 'status-hooks-fixture', label: `${STATUS_LINE} (${W})` });
    });
    // The add-on's task line names its own task, never "Idle". The fixture asks one
    // add-on task for the group, so table L's own line changes to its label.
    await step('M62', async () => {
      const at = Date.now();
      await fixture(live, { op: 'task', task: true });
      try {
        // The line is derived on each state read (status/coordinator/line.ts), so the poll reads the
        // state as the dashboard does, and keeps the group's task for the evidence.
        await expect.poll(async () => {
          rows.taskLine = { activity: (await live.state()).characters[W]?.activity ?? null,
            group: ((await live.tasks()).groups as { id: string; live?: unknown; waiting?: unknown; ring?: unknown[] }[]).find(g => g.id === `party:${W}`) ?? null };
          return of(await heard(live, at), 'status.lineChanged').filter(h => h.payload.character === W).map(h => h.payload.line);
        }, { timeout: 60_000, intervals: [500] }).toContainEqual(expect.stringContaining(STATUS_TASK_LABEL));
        const changed = of(await heard(live, at), 'status.lineChanged').filter(h => h.payload.character === W && String(h.payload.line).includes(STATUS_TASK_LABEL));
        expect(String(changed.at(-1)!.payload.by)).toMatch(/^L[1-9]$/);
      } finally { await fixture(live, { op: 'task', task: false }); }
    });
    await step('M62', async () => {
      await live.post(`/combat-log/${W}/clear`, {});
      const command = of(await heard(live, since), 'dashboard.command').find(h => h.payload.route === `/party-api/combat-log/${W}/clear`);
      expect(command?.payload.by).toBe('user');
    });
    await step('M62', async () => {
      const at = Date.now();
      expect((await api(live, `/diagnostics/records?character=${W}&rings=movement`)).ok).toBe(true);
      expect(of(await heard(live, at), 'diagnostics.leased').map(h => h.payload.rings)).toContainEqual(['movement']);
      // The lease lasts two report periods (table G); the next read after it lapsed sees the release.
      await expect.poll(async () => { await api(live, `/diagnostics/records?character=${W}&rings=turns`);
        return of(await heard(live, at), 'diagnostics.released').length; }, { timeout: 60_000 }).toBeGreaterThan(0);
    });
    await step('M62', async () => {
      // The turns owner's `skills.records` and the targeting owner's `targeting.records` answer the turns and targeting rings, which
      // the character posts after its report while a view leases them.
      await expect.poll(async () => {
        const read = await (await api(live, `/diagnostics/records?character=${W}&rings=turns,targeting`)).json();
        return ['turns', 'targeting'].filter(ring => read.live?.[ring]?.at > since);
      }, { timeout: 30_000 }).toEqual(['turns', 'targeting']);
    });
    await step('M62', async () => {
      // The `diagnostics-ring` slot: the add-on list names the ring with its label, a view's read
      // leases it like a table G ring, and the character half's read posts after the report.
      const listed = await (await api(live, '/addons')).json();
      expect(listed.rings, 'the add-on list names the ring').toContainEqual({ ring: FIXTURE_RING.ring, addon: 'status-hooks-fixture', label: FIXTURE_RING.label });
      await expect.poll(async () => {
        const read = await (await api(live, `/diagnostics/records?character=${W}&rings=${FIXTURE_RING.ring}`)).json();
        return read.live?.[FIXTURE_RING.ring]?.records?.[0]?.readAt > since;
      }, { timeout: 30_000 }).toBe(true);
      // A ring no enabled add-on declares is refused, as an unknown table G ring is.
      expect((await api(live, `/diagnostics/records?character=${W}&rings=status-hooks-fixture.none`)).status).toBe(400);
      rows.addonRing = FIXTURE_RING.ring;
    });
    await step('M62', async () => {
      // The Diagnostics button reads its alerts again on the last ring save, which the movement
      // owner's `records.saved` sets.
      await fixture(live, { op: 'notify', hook: 'records.saved', args: [{ ring: 'movement', character: W, record: 'df11-planted' }] });
      // The dashboard reads the icon from its core section (status/coordinator/state.ts `core`).
      await expect.poll(async () => (await (await api(live, '/state?section=core&dashboard=1')).json()).recordSaved?.record ?? null, { timeout: 10_000 }).toBe('df11-planted');
    });
    await step('M62', async () => {
      const at = Date.now();
      const issued = await live.post('/apps', { name: 'e2eStatusApp', scopes: ['read', 'command'], ownCommands: false });
      expect(issued.key, 'the key shows once at issue').toMatch(/^[0-9a-f]{64}$/);
      const bearer = { authorization: `Bearer ${issued.key}` };
      const state = await api(live, '/state?section=core&dashboard=1', { headers: bearer });
      expect(state.status, 'the read scope reads state').toBe(200);
      expect(JSON.stringify(await state.json()), 'K9: no answer reveals the key').not.toContain(issued.key);
      // The refused scope row: a key without `settings` writes no setting.
      const refused = await api(live, '/settings', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ changes: [{ field: 'anniversaryAutoChat', value: true }] }) });
      expect(refused.status).toBe(403);
      // An app's command names the app and ranks at `app`.
      await api(live, `/combat-log/${W}/clear`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: '{}' });
      const command = of(await heard(live, at), 'dashboard.command').find(h => h.payload.by === 'app:e2eStatusApp');
      expect(command, 'the command is named by the app').toBeTruthy();
      expect((await live.post('/apps/e2eStatusApp/revoke', {})).app.revokedAt).toBeGreaterThan(0);
      expect((await api(live, '/state?section=core', { headers: bearer })).status, 'a revoked key is refused').toBe(401);
      const events = await heard(live, at);
      expect(of(events, 'app.keyIssued')[0]?.payload).toMatchObject({ name: 'e2eStatusApp', tier: 'app', by: 'user' });
      expect(of(events, 'app.used').length, 'each use sends app.used').toBeGreaterThanOrEqual(1);
      expect(of(events, 'app.keyRevoked')[0]?.payload.name).toBe('e2eStatusApp');
    });
    // The screen half: the Interface settings "Apps" screen (app-keys-settings.tsx)
    // issues a key, shows it once, saves a lock through the settings writer and revokes the key.
    await step('M62', async () => {
      const at = Date.now(), name = 'e2eScreenApp';
      const settings = dashboard.getByRole('dialog', { name: 'Settings', exact: true });
      // The page renders its buttons before React hydrates them, so the open click repeats until
      // the dialog shows.
      const open = async () => {
        await dashboard.goto(live.url);
        await dashboard.bringToFront();
        await expect(async () => {
          if (!await settings.isVisible()) await dashboard.getByRole('button', { name: 'Interface settings', exact: true }).click();
          await expect(settings).toBeVisible();
        }).toPass();
        await settings.getByRole('tab', { name: 'Apps', exact: true }).click();
        return settings.getByRole('region', { name: 'Apps' });
      };
      let apps = await open();
      await apps.getByLabel('App name').fill(name);
      await apps.getByRole('checkbox', { name: 'Change settings' }).check();
      await apps.getByRole('button', { name: 'Issue key' }).click();
      const shown = apps.getByTestId('issued-app-key');
      await expect(shown).toContainText(`Key for ${name}, shown only now`);
      const key = (await shown.locator('code').textContent()) ?? '';
      expect(key, 'the screen shows the issued key').toMatch(/^[0-9a-f]{64}$/);
      const bearer = { authorization: `Bearer ${key}` };
      expect((await api(live, '/state?section=core', { headers: bearer })).status, 'the screen key reads state').toBe(200);
      expect(JSON.stringify(await (await api(live, '/apps')).json()), 'K9: the app list never holds the key').not.toContain(key);
      const write = async () => {
        const answer = await api(live, '/settings', { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' },
          body: JSON.stringify({ changes: [{ field: 'anniversaryAutoChat', value: false }] }) });
        return answer.ok ? 'written' : JSON.stringify(await answer.json());
      };
      expect(await write(), 'the settings scope writes an unlocked setting').toBe('written');
      // The lock ticked on the screen saves through the settings owner's writer, which refuses the app's write.
      await apps.getByText('Settings locked against apps', { exact: true }).click();
      // The box shows the saved lock list (app-keys-settings.tsx `locks`), so it ticks once the write
      // comes back; the row clicks it and reads the write the lock refuses.
      const lockBox = apps.getByRole('checkbox', { name: 'Anniversary auto chat', exact: true });
      await lockBox.click();
      await expect(lockBox).toBeChecked();
      await expect.poll(write).toContain('Anniversary auto chat is locked against apps');
      // K9: a reload shows the app's row and never the key again.
      apps = await open();
      await expect(apps.getByTestId('issued-app-key')).toHaveCount(0);
      const row = apps.getByTestId('app-key').filter({ hasText: name });
      await expect(row).toHaveCount(1);
      await expect(row).not.toContainText(key);
      await apps.getByText('Settings locked against apps', { exact: true }).click();
      const unlockBox = apps.getByRole('checkbox', { name: 'Anniversary auto chat', exact: true });
      await unlockBox.click();
      await expect(unlockBox).not.toBeChecked();
      await row.getByRole('button', { name: 'Revoke', exact: true }).click();
      await expect(row).toHaveCount(0);
      expect((await api(live, '/state?section=core', { headers: bearer })).status, 'a key revoked on the screen is refused').toBe(401);
      const events = await heard(live, at);
      expect(of(events, 'app.keyIssued').find(h => h.payload.name === name)?.payload).toMatchObject({ tier: 'app', by: 'user' });
      expect(of(events, 'app.keyRevoked').map(h => h.payload.name)).toContain(name);
      await dashboard.keyboard.press('Escape');
    });
    stream.abort();
    await step('M62', async () => {
      await expect.poll(async () => of(await heard(live, since), 'dashboard.closed').length, { timeout: 10_000 }).toBeGreaterThan(0);
      const all = await heard(live, since);
      rows.heard = all.slice(-200);
      // Every status event fired at its change.
      expect(STATUS_NOTICES.filter(hook => of(all, hook).length === 0), 'every notice was heard').toEqual([]);
    });
  } finally {
    stream.abort();
    await fixture(live, { op: 'off' }).catch(() => null);
    await live.post('/settings', { changes: [{ field: 'addons', value: await page.run(statusHooksSwitches(false)).catch(() => ({})) }] }).catch(() => {});
  }
}

// The play's end: one coordinator restart, which M12 and M39 read across.
async function restart(live: LiveGame, page: Page) {
  await live.restartCoordinator();
  await step('M12', async () => {
    const restarted=await cargo(live);expect(restarted.slots.orb).toMatchObject({name:'cave_loaded_die',level:0});
    expect(restarted.items.filter((item:any)=>item?.name==='orbofint')).toHaveLength(1);
  });
  await step('M39', async () => {
    const name = M;
    await expect.poll(async () => (await live.state()).merchantCharacter).toBe(name);
    await page.reload();
    const card = page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await expect(card.getByText(/Merchant logistics/)).toBeVisible();
    // Confirm that the assigned merchant can execute actual bank work, not only render controls.
    await live.post('/command', {character:name,type:'bank'});
    await expect.poll(async () => (await live.state()).bank?.character, {timeout:90_000}).toBe(name);
  });
}

async function partyWalkPlay(live: LiveGame, page: Page) {
  await merchantCard(live, page);
  await loadedDie(live, page);
  // The movement hooks fixture on both fighters and the coordinator. The shipped tank-hold add-on
  // answers group.anchor, a one-answer hook; switched off in the add-on manager it leaves the hook
  // to the fixture.
  await live.post('/addons',{name:'tank-hold',enabled:false});
  for(const name of fighters){await settleNavigation(live.clients[name]!,name);expect(await live.clients[name]!.run(registerCharacterHalf)).toEqual({ok:true});}
  expect(await coordinator(live,{op:'register'})).toEqual({ok:true});
  await live.post('/settings',{changes:[{field:'addons',value:await live.clients[W]!.run(addonSwitches(true))}]});
  for(const name of fighters)await expect.poll(async()=>live.clients[name]!.run(`globalThis.__partyHooks.enabled(${JSON.stringify(MOVEMENT_HOOKS_ADDON)})`),{timeout:15_000}).toBe(true);
  const since=await live.clients[W]!.run('Date.now()') as number;
  reads.since = since;
  await merchantRoute(live, page);
  await party(live);
  await targetronPasses(live);
  await lateDeparture(live);
  await farFollow(live);
  await movementHooks(live);
  await playerHands(live);
  await refusedCrossing(live, since);
  await statusAnswers(live, page);
  // The coordinator half's notices live in the coordinator process (live-coordinator.cjs
  // `hookFixtureStates`), which the restart replaces, so C40 reads its walk.member notices first.
  reads.C40 = {members: heard(await seenC(live),'walk.member')};
  await restart(live, page);
}

const own = (id: string, extra?: () => void) => ({
  owner: id.startsWith('M') ? 'merchant' : 'movement', behaviours: [], start() {}, reads: () => ({failed: failed[id] ?? null, reads: reads[id] ?? null}),
  verdict() { expect(failed[id], `${id}: every step of the play passes`).toBeUndefined(); extra?.(); },
});

liveWindow({
  id: 'W09', name: 'Party walk across Main and Town home, with dashboard actions',
  // The merchant's first heartbeat makes it the merchant (M39, live-merchant-config.spec.ts).
  use: {merchantDefault: null},
  // The old tests took 3.2 min of play together (DESIGN.md 2.2 W09); the waits each check carries
  // reach 180 s for the add-on walk's end and 90 s for each arrival.
  timeoutMs: 1_200_000,
  // The dashboard page belongs to Playwright's base context, not the native fixture's, so its
  // live connections close before that fixture closes its gateway (live-merchant-config.spec.ts).
  async play({live, page}: LiveWorld) { try { await partyWalkPlay(live, page); } finally { await page.close(); } },
  observers: [
    {id: 'C2', ...own('C2')}, {id: 'C6', ...own('C6')}, {id: 'H41', ...own('H41')}, {id: 'H42', ...own('H42')}, {id: 'H6', ...own('H6')}, {id: 'H15', ...own('H15')}, {id: 'C36', ...own('C36')},
    {id: 'C29', ...own('C29')}, {id: 'C31', ...own('C31')}, {id: 'C43', ...own('C43')}, {id: 'C42', ...own('C42')}, {id: 'C37', ...own('C37')}, {id: 'C55', ...own('C55')}, {id: 'C54', ...own('C54')}, {id: 'C56', ...own('C56')}, {id: 'C57', ...own('C57')},
    // C40: each member change of the play's walks, completed on the arrivals and left on C37's leave.
    {id: 'C40', owner: 'movement', behaviours: [], start() {}, reads: () => ({failed: failed.C40 ?? null, reads: reads.C40 ?? null}), async verdict() {
      const members: Record<string, unknown>[]=reads.C40?.members ?? [];
      expect(members.length).toBeGreaterThan(0);
      // A member that left a walk for silence rejoins it on its next report (fa3a9134d).
      for(const m of members)expect(['completed','left','rejoined']).toContain(m.change);
      expect(members.some(m=>m.change==='completed'),'a member completes on an arrival').toBe(true);
      expect(members.some(m=>m.member===P&&m.change==='left'),"the priest's leave").toBe(true);
    }},
    {id: 'T8', ...own('T8')}, {id: 'M12', ...own('M12')}, {id: 'M39', ...own('M39')}, {id: 'M52', ...own('M52')}, {id: 'M62', ...own('M62')},
  ],
});
