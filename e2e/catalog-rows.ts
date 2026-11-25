import type { BrowserContext, Request, Response, Route } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import { expect, type LiveGame } from './live-fixtures';
import {nativeWallNow} from './network-clock';
import {partyNames} from './game/hunt-lifecycle';
import {CATALOG_VERSIONS} from '../runtime/status/rules';

// Both tests read the full status reports the native clients send and the coordinator's reply. A
// report or reply that does not read is an error each test asserts empty, so a broken read never
// passes as a quiet client.
export function observeStatus<T>(context:BrowserContext,read:(request:Request,body:any,reply:any)=>T|undefined) {
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
// M01 (play window W01, from live-catalog.spec.ts at 21fe30a2b): catalogStart waits for discovery, then tells
// each real client once to resend its catalog and observes the status exchanges from then on;
// its `verdict` judges the acceptance and the reports after it.
export async function catalogStart(live:LiveGame,info:TestInfo){
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
  return {async verdict(){
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
  }};
}
