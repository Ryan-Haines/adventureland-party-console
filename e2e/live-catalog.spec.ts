import type { BrowserContext, Request, Response, Route } from '@playwright/test';
import { test, expect } from './live-fixtures';
import {nativeWallNow} from './network-clock';
import {holdTracktrix,TRACKER_REFRESH_MS,STEP_MS} from './call-budget-rows';
import {partyNames} from './game/hunt-lifecycle';
import {CATALOG_VERSIONS} from '../runtime/status/rules';

// Both tests read the full status reports the native clients send and the coordinator's reply. A
// report or reply that does not read is an error each test asserts empty, so a broken read never
// passes as a quiet client.
function observeStatus<T>(context:BrowserContext,read:(request:Request,body:any,reply:any)=>T|undefined) {
  const exchanges:T[]=[],errors:string[]=[],pending=new Set<Promise<void>>();
  const observe=(response:Response)=>{
    if(!new URL(response.url()).pathname.endsWith('/status'))return;
    const request=response.request();
    if(request.method()!=='POST')return;
    const work=(async()=>{
      const body=request.postDataJSON();
      if(!body?.name||body.combatOnly||body.combatWait)return;
      const value=read(request,body,await response.json());
      if(value!==undefined)exchanges.push(value);
    })().catch(error=>{errors.push(String(error));});
    pending.add(work);
    void work.finally(()=>pending.delete(work));
  };
  context.on('response',observe);
  return {exchanges,errors,async stop(){context.off('response',observe);await Promise.all(pending);}};
}

// Failure modes, written before the coordinator fix:
// - A stale expected version requests an already accepted catalog forever.
// - The response acknowledges acceptance but native clients keep retransmitting.
// - One character stops sending while companion runtimes continue flooding status.
// Observe actual native HTTP exchanges, retaining a compact replayable ledger.
test('accepted native catalogs stop retransmitting on every character heartbeat', async ({ live }, info) => {
  test.setTimeout(240_000);
  const context = live.clients.E2EWarrior.page.context();
  const names = partyNames;
  const catalogFields = ['travelPlaces', 'monsterChoices', 'monsterHunterLocation',
    'bestiaryCatalog', 'skillCatalog', 'appearanceChoices', 'merchantCatalog'];
  type Exchange = { name: string; started: number; finished: number; gameplayObservedAt:number;bytes: number;
    catalogFields: string[]; version?: string; needsCatalog: boolean };
  const readiness: unknown[] = [];
  try {
    await expect.poll(async () => {
      const clients = await Promise.all(names.map(async name => ({ name, catalog: await live.clients[name]!.run(
        '(({generation,known,prepared,preparing})=>({generation,known,prepared,preparing}))(globalThis.__partyCatalogDiagnostic("goo","helmet"))') })));
      if (readiness.length >= 64) readiness.shift();
      readiness.push({ at: nativeWallNow(), clients });
      return clients.every(value => value.catalog.prepared && value.catalog.known && !value.catalog.preparing);
    }, { timeout: 90_000, message: 'Every native client must finish discovery and receive acceptance before checking retransmission' }).toBe(true);
  } finally {
    await info.attach('native-client-catalog-readiness', { body: JSON.stringify(readiness), contentType: 'application/json' });
  }
  // Bootstrap may already have accepted another character's catalog. Ask each
  // real client to publish once, then observe its actual full-payload acceptance.
  // An ordinary heartbeat acknowledging shared coordinator state is not that
  // client's catalogue acknowledgement, especially during tracker discovery.
  const requested = new Set<string>();
  const requestCatalog = async (route: Route) => {
    const body = route.request().postDataJSON();
    if (!names.includes(body?.name) || body.combatOnly || body.combatWait || requested.has(body.name)) {
      await route.continue(); return;
    }
    requested.add(body.name);
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), needsCatalog: true } });
  };
  await context.route('**/party-api/status', requestCatalog);
  const status = observeStatus<Exchange>(context, (request, body, reply) => {
    if (!names.includes(body.name) || typeof reply.needsCatalog !== 'boolean') return undefined;
    return { name: body.name, started: request.timing().startTime, finished: nativeWallNow(),gameplayObservedAt:Date.now(),
      bytes: Buffer.byteLength(request.postData() || ''),
      catalogFields: catalogFields.filter(field => Object.hasOwn(body, field)),
      version: body.merchantCatalogVersion, needsCatalog: reply.needsCatalog };
  });
  const {exchanges, errors} = status;
  try {
    await expect.poll(async () => {
      const catalog = (await live.state(true)).merchantCatalog;
      return catalog?.version === CATALOG_VERSIONS.merchant && Array.isArray(catalog.allItems) && catalog.allItems.length > 0;
    }, { timeout: 120_000, message: 'Native discovery must publish a usable catalog before testing its acknowledgement' }).toBe(true);
    const acceptedCatalog = (exchange: Exchange) => !exchange.needsCatalog && exchange.catalogFields.length === catalogFields.length && exchange.version === CATALOG_VERSIONS.merchant;
    await expect.poll(() => names.every(name => exchanges.some(exchange => exchange.name === name && acceptedCatalog(exchange))),
      { timeout: 45_000, message: 'Every real character must receive catalog acceptance' }).toBe(true);
    expect([...requested].sort()).toEqual([...names].sort());
    const accepted = Object.fromEntries(names.map(name => [name, exchanges.find(exchange => exchange.name === name && acceptedCatalog(exchange))!.finished]));
    await expect.poll(() => names.every(name => exchanges.filter(exchange => exchange.name === name && exchange.started > accepted[name]!).length >= 3),
      { timeout: 45_000, message: 'Observe three subsequent status reports per native character' }).toBe(true);
    for (const name of names) {
      const settled = exchanges.filter(exchange => exchange.name === name && exchange.started > accepted[name]!);
      expect(settled.every(exchange => !exchange.needsCatalog), `${name} acknowledgement stays accepted`).toBe(true);
      expect(settled.flatMap(exchange => exchange.catalogFields), `${name} no longer resends large catalogs`).toEqual([]);
    }
    expect(errors).toEqual([]);
  } finally {
    await status.stop();
    await context.unroute('**/party-api/status', requestCatalog);
    await info.attach('native-catalog-handshake', { body: JSON.stringify({ requested: [...requested], exchanges, errors }, null, 2), contentType: 'application/json' });
  }
});


test('native tracker home rewards refresh monster and item discovery after later table changes',async({live},info)=>{
  test.setTimeout(240_000);
  await expect.poll(async()=>!!(await live.state(true)).bestiaryCatalog?.find((m:any)=>m.id==='goo'),{timeout:90_000}).toBe(true);
  const observations:any[]=[];
  const context=live.clients.E2EWarrior.page.context();
  const status=observeStatus(context,(_request,body,reply)=>{
    const monster=body.bestiaryCatalog?.find((m:any)=>m.id==='goo'),item=body.merchantCatalog?.allItems?.find((i:any)=>i.id==='helmet');
    return {at:Date.now(),name:body.name,hasCatalog:!!body.merchantCatalog,home:monster?.homeRewards,source:item?.meta?.world?.drops?.filter((d:any)=>d.monsterId==='goo'),needsCatalog:reply.needsCatalog};
  });
  const {exchanges,errors}=status;
  // CB16's reply half: the warrior holds a Tracktrix,
  // so each reply, the server's own or the two below, sets the next request 30 s on. The page logs
  // each tracker emit at the top of the socket's emit chain.
  await holdTracktrix(live,'E2EWarrior');
  await live.clients.E2EWarrior.run(`(()=>{const s=parent.socket,emit=s.emit,log=globalThis.__e2eTrackerAsks={asks:[],emit};
    s.emit=log.mine=function(method,...rest){if(method==='tracker')log.asks.push(Date.now());return emit.apply(this,[method,...rest]);};return true;})()`);
  let refresh:any=null;
  try {
  for(const rate of [0.004,0.008]){
    const receipt=await live.admin(`output=(()=>{const p=get_player('E2EWarrior'),home=Object.assign({},D.drops.monsters_home_server||{},{goo:[[${rate},'helmet',2]]});
      p.socket.emit('tracker',{monsters:p.p.stats.monsters,monsters_diff:p.p.stats.monsters_diff,exchanges:p.p.stats.exchanges,max:p.max_stats,
        drops:D.drops.monsters,maps:D.drops.maps,monsters_home_server:home,drops_home:home,tables:{}});return {name:p.name,id:p.id,socketId:p.socket.id,connected:p.socket.connected,rate:${rate},item:'helmet',quantity:2};})()`);
    await expect.poll(async()=>{const s=await live.state(true),monster=s.bestiaryCatalog?.find((m:any)=>m.id==='goo'),item=s.merchantCatalog?.allItems?.find((i:any)=>i.id==='helmet');
      const client=await live.clients.E2EWarrior.run('({name:character.name,trackerHome:parent.tracker?.drops_home?.goo,trackerAlias:parent.tracker?.monsters_home_server?.goo,diagnostic:globalThis.__partyCatalogDiagnostic?.("goo","helmet")})');
      observations.push({at:Date.now(),rate,receipt,client,home:monster?.homeRewards,source:item?.meta?.world?.drops?.filter((d:any)=>d.monsterId==='goo')});
      return {home:monster?.homeRewards?.find((d:any)=>d.id==='helmet')?.rate,source:item?.meta?.world?.drops?.find((d:any)=>d.monsterId==='goo'&&d.sourceType==='home')?.rate};},{timeout:90_000}).toEqual({home:rate,source:rate});
    const s=await live.state(true);observations.push({at:Date.now(),receipt,monster:s.bestiaryCatalog.find((m:any)=>m.id==='goo'),sources:s.merchantCatalog.allItems.find((i:any)=>i.id==='helmet').meta.world.drops.filter((d:any)=>d.monsterId==='goo')});
  }
  // The next request after the last reply comes at the 30 s refresh, not before.
  const replies=async()=>(await live.clients.E2EWarrior.events()).filter((e:any)=>e.event==='tracker-arrived').map((e:any)=>Number(e.at));
  const asks=()=>live.clients.E2EWarrior.run('globalThis.__e2eTrackerAsks.asks') as Promise<number[]>;
  const from=Math.max(...await replies());
  await expect.poll(async()=>{const next=(await asks()).filter(at=>at>from);const reply=Math.max(...(await replies()).filter(at=>next.length&&at<next[0]!));
    refresh={from,reply,next};return next.length;},{timeout:60_000,intervals:[250],message:'CB16: the next request after a reply'}).toBeGreaterThan(0).catch(()=>{});
  } finally {
  await status.stop();
  await live.clients.E2EWarrior.run(`(()=>{const log=globalThis.__e2eTrackerAsks;if(log&&parent.socket.emit===log.mine)parent.socket.emit=log.emit;delete globalThis.__e2eTrackerAsks;return true;})()`).catch(()=>null);
  await info.attach('native-home-reward-discovery',{body:JSON.stringify({observations,exchanges,errors,refresh}),contentType:'application/json'});
  }
  expect(errors).toEqual([]);
  expect(refresh?.next?.length,`CB16: a request follows the last reply: ${JSON.stringify(refresh)}`).toBeGreaterThan(0);
  expect(refresh.next[0]-refresh.reply,'CB16: a reply sets the next request at the 30 s refresh').toBeGreaterThanOrEqual(TRACKER_REFRESH_MS);
  expect(refresh.next[0]-refresh.reply,'CB16: a reply sets the next request at the 30 s refresh').toBeLessThanOrEqual(TRACKER_REFRESH_MS+2*STEP_MS);
});
