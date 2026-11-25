import type {LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {walkProgress} from './walk-progress';
import {movementSavedFields} from '../runtime/movement/saved-fields';
import {restoreServerGlobals} from './windows';

// The event windows' end (test-windows DESIGN.md 3.2), also run between two rounds of one session.
// The runner's global undo (windows.ts windowGlobals) deletes the __e2e names a play added and puts
// back the game functions it wrapped, broadcast_e and new_monster among them. eventScrub undoes the
// state those globals point at: the Halloween announcement timers inside one global, the catalogs
// the Halloween spawners changed (halloween-rows.ts), the different-event catalog
// (event-recovery-rows.ts), the Halloween season the Slenderman warp held, and the event statuses
// in E. A session's next round needs that undo before the runner's, so eventScrub ends with the
// server's half of it and the native broadcast of the cleared statuses. It runs after the play's
// own finally blocks, so it only finds what those left, and the window attaches that list.
export async function eventScrub(live: LiveGame, info: TestInfo) {
  const left = await live.admin(`output=(()=>{const g=globalThis,left=[];
    const take=(name,undo)=>{if(Object.hasOwn(g,name)){left.push(name);try{undo(g[name]);}finally{delete g[name];}}};
    take('__e2eHalloweenAnnouncements',a=>{for(const e of Object.values(a||{}))clearInterval(e.timer);});
    take('__e2eHalloweenCatalogs',c=>{for(const [type,e] of Object.entries(c||{}))G.monsters[type]=e.original;});
    take('__e2eDifferentEventCatalog',c=>{for(const [type,e] of Object.entries(c||{}))G.monsters[type]=e.original;});
    take('__e2eSlenderWarpSeason',s=>{events.halloween=s;});
    for(const type of ['mrgreen','mrpumpkin','slenderman'])delete E[type];
    return left;})()`) as string[];
  const globals = await restoreServerGlobals(live);
  await live.admin('broadcast_e();output=true');
  await info.attach('event-window-scrub', {body: JSON.stringify({left, globals}), contentType: 'application/json'});
  return left;
}

// A walk wait with the progress rule of e2e/walk-progress.ts for its bound: it samples each
// member's client until `arrived` holds and throws `message` with the stall when the walk stops
// closing. The rule's snapshot goes into the error, so the dump names which bound fired.
export async function walkUntil(live: LiveGame, names: readonly string[], arrived: () => Promise<boolean>, message: string) {
  const rule = walkProgress(Date.now(), movementSavedFields.settings.movementPlanningMs.default);
  for (;;) {
    if (await arrived()) return rule.snapshot();
    const samples = Object.fromEntries(await Promise.all(names.map(async name => [name, await live.clients[name].run(`(()=>{
      const r=globalThis.__partyMovement?.report?.(),p=r?.progress;
      return {map:character.map,x:character.real_x,y:character.real_y,journey:r?.id??null,step:p?.step??null,
        attackAt:parent.next_skill?.attack?+new Date(parent.next_skill.attack):null,
        walking:p?.phase==='walking'&&!!character.moving,reportIntervalMs:Number(globalThis.__partyMovement?.reportInterval?.())};})()`)])));
    try { rule.observe(Date.now(), samples); }
    catch (error) { throw Error(`${message}: ${(error as Error).message} ${JSON.stringify({snapshot: rule.snapshot(), samples})}`); }
  }
}

// walkUntil for a member with no game window (a headless merchant): the same rule, sampled from the
// coordinator's report of each member (its movement report's journey, step and phase, and its own
// report interval).
export async function reportedWalkUntil(live: LiveGame, names: readonly string[], arrived: () => Promise<boolean>, message: string) {
  const rule = walkProgress(Date.now(), movementSavedFields.settings.movementPlanningMs.default);
  for (;;) {
    if (await arrived()) return rule.snapshot();
    const state = await live.state();
    const samples = Object.fromEntries(names.map(name => {
      const c = state.characters[name] ?? {}, p = c.movement?.progress;
      return [name, {map: c.map, x: c.x, y: c.y, journey: c.movement?.id ?? null, step: p?.step ?? null, attackAt: null,
        walking: p?.phase === 'walking' && !c.movement?.done && !!c.moving, reportIntervalMs: Number(c.reportIntervalMs)}];
    }));
    try { rule.observe(Date.now(), samples); }
    catch (error) { throw Error(`${message}: ${(error as Error).message} ${JSON.stringify({snapshot: rule.snapshot(), samples})}`); }
  }
}
