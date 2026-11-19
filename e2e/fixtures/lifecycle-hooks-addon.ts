// Lifecycle's fixture add-on: one add-on that answers `lifecycle.ready` and hears every 13 notice, so
// e2e/live-lifecycle-hooks.spec.ts proves each `HOOKS` row is asked at its decision point or told at its
// change. Its coordinator half hears the Pause, Play, drain, shutdown, reload, start and worker notices
// and keeps them in a file under the E2E data directory, since the table restarts the coordinator; the
// harness (e2e/live-coordinator.cjs) registers it again at each start while the marker file exists.
// Its character half answers `lifecycle.ready` with a hold while the table sets one, hears the
// readiness, hold and report notices, reads `lifecycle.held` and `lifecycle.drain` at each, and keeps
// what it heard in local storage, which outlives the CODE reload. With no hold set it answers ready,
// so registering it changes no play.
import type { ReadyAnswer, Registration } from '../../runtime/hooks/addon-api.ts';
import { switches } from './hooks-fixture-kit.ts';

export const LIFECYCLE_HOOKS_ADDON = 'lifecycle-hooks-fixture';
const LIFECYCLE_HOOKS_KEY = 'e2e-lifecycle-hooks';
export const LIFECYCLE_HOOKS_MARKER = 'e2e-lifecycle-hooks.on';
export const LIFECYCLE_HOOKS_FILE = 'e2e-lifecycle-hooks.jsonl';
export const HOLD_REASON = 'the fixture add-on is finishing its own work';
export const COORDINATOR_NOTICES = ['lifecycle.started', 'lifecycle.paused', 'lifecycle.played', 'lifecycle.drainStarted',
  'lifecycle.drainEnded', 'lifecycle.shutdown', 'lifecycle.reloaded', 'worker.started', 'worker.exited'] as const;
export const CHARACTER_NOTICES = ['lifecycle.readiness', 'lifecycle.holdChanged', 'report.sent'] as const;
export interface Heard { hook: string; at: number; payload: Record<string, unknown>; held?: boolean; drain?: unknown; state?: { paused?: boolean } | null }

// The coordinator half: each notice is one line of the heard file.
export function coordinatorRegistration(keep: (entry: Heard) => void): Registration {
  return {
    name: LIFECYCLE_HOOKS_ADDON, folder: 'addons', author: 'e2e',
    summary: 'Hears every lifecycle notice on the coordinator.',
    hooks: Object.fromEntries(COORDINATOR_NOTICES.map(hook => [hook, (payload: unknown) =>
      keep({ hook, at: Date.now(), payload: (payload ?? {}) as Record<string, unknown> })])),
  };
}

// The character half, page source: it uses no import and no closure. `hold` is the reason the table
// sets on `globalThis.__lifecycleHooksHold`; a ready answer is the default.
function characterHooks(key: string, notices: readonly string[]) {
  const hooks = (globalThis as any).__partyHooks;
  const keep = (entry: Heard) => {
    try { const kept = JSON.parse(localStorage.getItem(key) || '[]'); kept.push(entry); localStorage.setItem(key, JSON.stringify(kept.slice(-500))); } catch {}
  };
  return {
    ...Object.fromEntries(notices.map(hook => [hook, (payload: Record<string, unknown>) =>
      keep({ hook, at: Date.now(), payload, held: hooks.askRow('lifecycle.held', []), drain: hooks.askRow('lifecycle.drain', []) })])),
    'lifecycle.ready'(ask: { character: string; lease: unknown }): ReadyAnswer {
      const hold = (globalThis as any).__lifecycleHooksHold as string | undefined;
      keep({ hook: 'lifecycle.ready', at: Date.now(), payload: { character: ask.character, holding: !!hold } });
      return hold ? { ready: false, reason: hold } : { ready: true };
    },
  };
}
// Page source: registers the character half once per generation.
export const registerCharacterHalf = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(LIFECYCLE_HOOKS_ADDON)};
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  return hooks.register({name,folder:'addons',author:'e2e',summary:'Answers lifecycle.ready and hears the readiness, hold and report notices.',
    hooks:(${characterHooks.toString()})(${JSON.stringify(LIFECYCLE_HOOKS_KEY)},${JSON.stringify(CHARACTER_NOTICES)})});})()`;
// Page source: sets or clears the add-on's hold.
export const holdSource = (reason: string | null) => `(globalThis.__lifecycleHooksHold=${JSON.stringify(reason ?? undefined)},true)`;
// Page source: what the character half heard from `since` on.
export const characterHeard = (since: number) => `(()=>{try{return JSON.parse(localStorage.getItem(${JSON.stringify(LIFECYCLE_HOOKS_KEY)})||'[]').filter(e=>e.at>=${since});}catch{return [];}})()`;
// Page source: a boundary the add-on cannot open (`addonMayAsk` false), asked as core does, and when it settles.
export const boundarySource = `(()=>{const at=Date.now();globalThis.__lifecycleHooksBoundary={at};
  __partyHooks.askRow('lifecycle.boundary',[]).then(()=>{globalThis.__lifecycleHooksBoundary.settled=Date.now();});return at;})()`;
// The saved add-on switches with this add-on on or off, from the character's own registry.
export const lifecycleHooksSwitches = (enabled: boolean) => switches(LIFECYCLE_HOOKS_ADDON, enabled);
