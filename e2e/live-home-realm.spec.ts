import { test, expect, type LiveGame, headlessMerchant, logoutNative } from './live-fixtures';

test.use({ liveHeadless:true });

async function freshParticipants(live: LiveGame, names: string[]) {
  await expect.poll(async () => {
    const state = await live.state();
    return names.every(name => state.characters[name]?.seenAt >= Date.now() - 5000);
  }, {timeout:90_000,message:'Every realm participant must report fresh native status after restart'}).toBe(true);
}

// See home-realm-failures.md. Native server/client assertions preserve the
// endpoint contract; no fabricated home-success receipt or realm response.
test('home realm change confirms every active character including merchant', async ({ page, live }, info) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(20_000);
  const pageErrors: string[] = [];
  const reads:Array<{at:number;url:string;status?:number;failure?:string}>=[];
  page.on('response',response=>{if(response.url().includes('/party-api/state')&&reads.length<128)reads.push({at:Date.now(),url:response.url(),status:response.status()});});
  page.on('requestfailed',request=>{if(request.url().includes('/party-api/')&&reads.length<128)reads.push({at:Date.now(),url:request.url(),failure:request.failure()?.errorText});});
  page.on('pageerror', error => pageErrors.push(error.message));
  const names = ['E2EWarrior', 'E2EPriest', 'E2EMerchant'];
  const accountNames = [...names, 'E2EBankBoi'];
  const homePlanning: unknown[] = [];
  let guardedPage: typeof page | undefined;
  try {
    // Native admission permits only one merchant. A managed merchant can be
    // paused and restored while the offline storage merchant changes its home.
    await headlessMerchant(live);
    await expect.poll(async () => (await live.state()).characters.E2EMerchant?.runtime, {timeout:90_000}).toBe('headless');
    const seeded = await live.admin(`output=(async()=>{let matched=0;for(const name of ${JSON.stringify(accountNames)}) {
      const p=get_player(name); if(p){p.p.home='USII'; delete p.p.dt.last_homeset;}
      const result=await db.collection('character').updateOne({'info.name':name},{$set:{'info.p.home':'USII'},$unset:{'info.p.dt.last_homeset':''}});
      matched+=result.matchedCount;
    } return matched;})()`);
    expect(seeded).toBe(accountNames.length);
    // The server seed changes native player/DB state, but existing clients retain
    // their previous home until a real login sends a fresh character snapshot.
    // That login reports home US II while the party stands on US I, so the Steam
    // restore asks Switch or Stay; the row stays, and the home change below moves it.
    await live.reconnectClient('E2EWarrior', { realmChoice: 'stay' });
    await live.restartCoordinator();
    await expect.poll(async () => (await live.state()).realmControl?.homeRealm, {timeout:30_000}).toBe('SR_USII');
    await freshParticipants(live, names);
    // Failure inventory: native set_home has no location prerequisite. A route
    // outage must not fail account home changes or replay the cooldown mutation.
    // Reject only this participant's planning during the current home operation;
    // keep native home receipts, status and persistence completely unmodified.
    guardedPage = live.clients.E2EPriest.page;
    await guardedPage.route('**/party-api/movement-plan', async route => {
      const body = route.request().postDataJSON();
      const operation = (await live.state()).realmControl?.operation;
      if (body.character === 'E2EPriest' && operation?.phase === 'setting-home' &&
          operation.homeExecutors?.includes('E2EPriest')) {
        homePlanning.push({at:Date.now(),operation:operation.id,request:body});
        await route.abort('timedout');
      } else await route.continue();
    });
    await page.goto(live.url);
    // The real dashboard deliberately pauses queries while hidden. Interact
    // with its foreground page, as a user does after the native clients open.
    await page.bringToFront();
    // SSR buttons can appear before the React event handlers hydrate. Repeating
    // this idempotent open action verifies the dialog rather than losing a click.
    await expect(async () => {
      const settings = page.getByRole('dialog', {name:'Interface settings',exact:true});
      if (!await settings.isVisible()) await page.getByRole('button', {name:'Interface settings',exact:true}).click();
      await expect(settings).toBeVisible({timeout:1000});
    }).toPass({timeout:20_000});
    const destination=page.getByRole('option', {name:/US I \(/});
    const picker=page.getByLabel('Change realm', {exact:true});
    await expect(async()=>{
      // A late client/data update can close the popup between observation and
      // click. Retry only this idempotent UI selection, before any realm action.
      if(!/\bSR_USI\b/.test(await picker.textContent()||'')){
        await page.bringToFront();
        if(!await destination.isVisible())await picker.click();
        await destination.click({timeout:1000});
      }
      await expect(picker).toContainText(/\bSR_USI\b/,{timeout:1000});
    }).toPass({timeout:20_000});
    await page.getByRole('button', {name:'Change realm',exact:true}).click();
    await page.getByText('Set as home realm', {exact:true}).click();
    const modal = page.getByRole('dialog', {name:'Change home realm?',exact:true});
    await expect(modal).toContainText('This will change for all characters in the account including characters not currently logged in.');
    await expect(modal.getByRole('button', {name:'Cancel',exact:true})).toBeVisible();
    await info.attach('account-home-confirmation', {body:await page.screenshot(),contentType:'image/png'});
    // Set home goes from where the character stands, so the
    // merchant makes no walk before `set_home`. The headless merchant stands on its home realm, US II,
    // while the party is on US I, so the change can move it between realms by a fresh login, which is
    // no walk. Its walk record is its own reports up to its confirmed home: two reports in a row on
    // one realm and map stand on one spot.
    const walk: {at:number;server?:string;map?:string;x:number;y:number;confirmed:boolean}[] = [];
    const sample = async () => {
      const state = await live.state(), merchant = state.characters.E2EMerchant;
      const entry = state.realmControl?.operation?.characters?.find((character:any)=>character.name==='E2EMerchant');
      walk.push({at:Date.now(),server:merchant?.server,map:merchant?.map,x:Math.round(Number(merchant?.x)),y:Math.round(Number(merchant?.y)),confirmed:!!entry?.homeConfirmed});
      return state.realmControl?.operation?.phase;
    };
    await sample();
    await modal.getByRole('button', {name:'Change home realm',exact:true}).click();
    await expect.poll(sample, {timeout:120_000, intervals:[250]}).toBe('complete');
    await info.attach('merchant-walk-before-set-home', {body:JSON.stringify(walk),contentType:'application/json'});
    const beforeHome = walk.slice(0, Math.max(1, walk.findIndex(entry=>entry.confirmed)));
    const steps = beforeHome.slice(1).filter((entry, index) => entry.server && entry.server === beforeHome[index]!.server &&
      entry.map === beforeHome[index]!.map && Math.hypot(entry.x - beforeHome[index]!.x, entry.y - beforeHome[index]!.y) > 10);
    expect(steps, 'The merchant walks nowhere before its set_home').toEqual([]);
    const state = await live.state();
    expect(state.realmControl.operation.characters.filter((entry:any)=>entry.homeConfirmed).map((entry:any)=>entry.name).sort()).toEqual([...accountNames].sort());
    const native = await live.admin(`output=Object.fromEntries(${JSON.stringify(names)}.map(name=>[name,get_player(name).p.home]))`);
    expect(native).toEqual(Object.fromEntries(names.map(name=>[name,'USI'])));
    expect(state.realmControl.homeCharacters.every((entry:any)=>entry.home==='SR_USI')).toBe(true);
    const database = await live.admin(`output=(async()=>{const homes={};for(const name of ['E2EBankBoi']){
      const record=await db.collection('character').findOne({'info.name':name});homes[name]=record.info.p.home;
    }return homes;})()`);
    expect(database).toEqual({E2EBankBoi:'USI'});
    expect(homePlanning, 'Native home setting must not depend on a walking route').toEqual([]);
    const homeReceipts = async () => Promise.all(['E2EWarrior','E2EPriest'].map(async name => ({
      name, receipts:(await live.clients[name].events()).filter((event:any) =>
        event.at >= state.realmControl.operation.startedAt && event.event === 'game_response' && event.data?.place === 'set_home'),
    })));
    await expect.poll(async () => (await homeReceipts()).map(entry => entry.receipts.map((event:any) => event.data)),
      {timeout:15_000,message:'Each native participant must receive exactly one successful home mutation receipt'})
      .toEqual(['E2EWarrior','E2EPriest'].map(() => [{home:'USI',success:true,response:'home_set',place:'set_home'}]));
    await info.attach('native-home-mutation-receipts', {body:JSON.stringify(await homeReceipts()),contentType:'application/json'});
    await info.attach('native-account-home-realms', {body:JSON.stringify({native,database,state:state.realmControl}),contentType:'application/json'});
    // A set home the game refuses sets the party's realm
    // back. The game refuses `set_home` for 36 h after the last one (server.js `sh_time`), so the
    // merchant's refusal is the game's, not planted in the console.
    await live.admin(`output=(async()=>{const p=get_player('E2EMerchant');p.p.dt.last_homeset=new Date();
      await db.collection('character').updateOne({'info.name':'E2EMerchant'},{$set:{'info.p.dt.last_homeset':new Date()}});return true})()`);
    const refused = await live.post('/realm/switch', {realm:'SR_USII',setHome:true});
    await expect.poll(async () => {
      const operation = (await live.state()).realmControl?.operation;
      return operation?.id === refused.operation.id && ['failed', 'complete'].includes(operation.phase) ? operation.phase : null;
    }, {timeout:180_000}).toBe('failed');
    const failed = await live.state();
    expect(failed.realmControl.activeRealm).toBe('SR_USI');
    expect(await live.admin(`output=get_player('E2EMerchant').p.home`)).toBe('USI');
    await info.attach('failed-set-home-rolls-back', {body:JSON.stringify(failed.realmControl),contentType:'application/json'});
  } catch (error) {
    await info.attach('home-realm-dashboard-readiness',{body:JSON.stringify({reads,browser:await page.evaluate(()=>{
      const clock=(window as any).__e2eChronalClock;
      return {hidden:document.hidden,visibility:document.visibilityState,at:Date.now(),clock:clock&&{now:clock.now(),state:clock.state,join:clock.join,errors:clock.errors}};
    }).catch(String)}),contentType:'application/json'});
    const screenshot = await page.screenshot({timeout:10_000}).catch(()=>null);
    if (screenshot) await info.attach('home-realm-dashboard-failure', {body:screenshot,contentType:'image/png'}).catch(()=>{});
    throw error;
  } finally {
    try {
      await guardedPage?.unrouteAll({behavior:'wait'});
      await info.attach('home-realm-planner-dependency', {body:JSON.stringify(homePlanning),contentType:'application/json'});
      await info.attach('home-realm-dashboard-errors', {body:JSON.stringify(pageErrors),contentType:'application/json'});
    }
    finally { await page.close(); }
  }
});

test.describe('temporary native headless home change', () => {
  test.use({ liveHeadless:true });
  test('offline merchant logs in to set home and returns offline without changing slots', async ({ page, live }, info) => {
    test.setTimeout(240_000);
    try {
      await logoutNative(live,'E2EMerchant');
      const seeded = await live.admin("output=db.collection('character').updateOne({'info.name':'E2EMerchant'},{$set:{'info.p.home':'USII'},$unset:{'info.p.dt.last_homeset':''}})");
      expect(seeded.matchedCount).toBe(1);
      await live.restartCoordinator();
      await expect.poll(async () => (await live.state()).realmControl?.homeCharacters?.find((entry:any)=>entry.name==='E2EMerchant')?.home).toBe('SR_USII');
      await freshParticipants(live, ['E2EWarrior','E2EPriest']);
      const before = await live.state();
      const result = await live.post('/realm/switch', {realm:'SR_USI',setHome:true});
      expect(result.operation.homeTargets).toContain('E2EMerchant');
      await expect.poll(async () => (await live.state()).realmControl?.operation?.phase, {timeout:150_000}).toBe('complete');
      await expect.poll(async () => await live.admin("output=!!get_player('E2EMerchant')"), {timeout:30_000}).toBe(false);
      const after = await live.state();
      expect(after.realmControl.homeCharacters.every((entry:any)=>entry.home==='SR_USI')).toBe(true);
      expect(after.activeSlots.map((entry:any)=>({index:entry.index,kind:entry.kind,character:entry.character}))).toEqual(before.activeSlots.map((entry:any)=>({index:entry.index,kind:entry.kind,character:entry.character})));
      const storedHome = await live.admin("output=db.collection('character').findOne({'info.name':'E2EMerchant'}).then(c=>c.info.p.home)");
      expect(storedHome).toBe('USI');
      await info.attach('offline-character-native-home-and-slot-restoration', {body:JSON.stringify({before,after,storedHome}),contentType:'application/json'});
    } finally { await page.close(); }
  });
});
