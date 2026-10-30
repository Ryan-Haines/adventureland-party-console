import type {BrowserContext,Frame} from '@playwright/test';

/** Application initialization, like Node's preload, follows authenticated join. */
export async function waitForBrowserClockStartup(context:BrowserContext){
  const pending=new WeakMap<Frame,Promise<void>>();
  const observe=(page:import('@playwright/test').Page)=>page.on('framenavigated',frame=>pending.delete(frame));
  context.pages().forEach(observe);context.on('page',observe);
  await context.route(/\.js(?:[?#]|$)/,async route=>{
    if(route.request().resourceType()!=='script')return route.fallback();
    const frame=route.request().frame();
    let joined=pending.get(frame);
    if(!joined){
      joined=frame.evaluate(async()=>{
        const clock=(globalThis as any).__e2eChronalClock;
        if(!clock?.ready)throw Error('Application script requested without its ChronAL startup clock');
        await clock.ready;
      });
      pending.set(frame,joined);
    }
    try{await joined;}
    catch(error){if(frame.isDetached()||route.request().failure())return;throw error;}
    await route.fallback();
  });
}
