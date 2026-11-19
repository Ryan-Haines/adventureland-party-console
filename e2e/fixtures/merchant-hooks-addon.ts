// The merchant jobs owner's fixture add-on: one add-on that answers the merchant jobs owner's two add-on hooks and hears every 08 notice, so
// e2e/live-merchant-hooks.spec.ts proves each `HOOKS` and `SLOTS` row of runtime/hooks/rows/08-merchant.ts
// is asked at its decision point or told at its change. Its coordinator half declares a kind at
// priority 90 (the job owner runs it at 74) and proposes one job of it per pass from a list each row
// sets: a PVP listing, a blacklisted listing, then a listing on the home realm. Its character half
// hears the runner's, the stand's and gathering's notices on the merchant's page. With no list set it
// proposes nothing, so registering it changes no play. e2e/live-coordinator.cjs
// `/party-api/e2e-merchant-hooks` joins the coordinator half to the live coordinator's registry.
import type { MerchantJobAsk, MerchantKindAsk, Registration } from '../../runtime/hooks/addon-api.ts';
import { keepCapped, switches } from './hooks-fixture-kit.ts';

export const MERCHANT_HOOKS_ADDON = 'merchant-hooks-fixture';
export const FIXTURE_KIND = 'restock-check';
export const FIXTURE_REASON = `addon:${MERCHANT_HOOKS_ADDON}:${FIXTURE_KIND}`;
export const COORDINATOR_NOTICES = ['merchant.job.queued', 'merchant.job.started', 'merchant.job.paused', 'merchant.job.resumed',
  'merchant.job.ended'] as const;
export const CHARACTER_NOTICES = ['merchant.holder.changed', 'merchant.stand.opened', 'merchant.stand.closed', 'merchant.gathering.phase',
  'merchant.gathering.cast'] as const;
// The kind the fixture declares: the restock command at the listing's realm, asking 90.
export const FIXTURE_KINDS: readonly MerchantKindAsk[] = [{ kind: FIXTURE_KIND, command: 'merchant-self-restock', realm: 'listing', priority: 90,
  label: 'Fixture restock' }];
export interface Heard { hook: string; at: number; payload: Record<string, unknown> }
export interface FixtureState { heard: Heard[]; jobs: MerchantJobAsk[] }

export function coordinatorRegistration(state: FixtureState): Registration {
  const hear = keepCapped(state.heard, 2000);
  const keep = (hook: string, payload: unknown) => hear({ hook, at: Date.now(), payload: (payload ?? {}) as Record<string, unknown> });
  return {
    name: MERCHANT_HOOKS_ADDON, folder: 'addons', author: 'e2e',
    summary: "Declares one merchant job kind, proposes the rows' jobs and hears every job notice.",
    hooks: {
      ...Object.fromEntries(COORDINATOR_NOTICES.map(hook => [hook, (payload: unknown) => keep(hook, payload)])),
      'merchant.jobKind'() { keep('merchant.jobKind', {}); return FIXTURE_KINDS; },
      'merchant.job'(view) { keep('merchant.job', { current: view.current?.reason ?? null }); return state.jobs.shift(); },
    },
  };
}

// The character half's notices, page source: it uses no import and no closure.
export function merchantNotices(state: { heard: Heard[] }, notices: readonly string[]) {
  return Object.fromEntries(notices.map(hook => [hook, (payload: Record<string, unknown>) => {
    state.heard.push({ hook, at: Date.now(), payload });
    if (state.heard.length > 2000) state.heard.shift();
  }]));
}
// Page source: registers the character half on the merchant's registry once; its state is
// `globalThis.__merchantHooksFixture`.
export const registerCharacterHalf = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(MERCHANT_HOOKS_ADDON)};
  const state=globalThis.__merchantHooksFixture||(globalThis.__merchantHooksFixture={heard:[]});
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  return hooks.register({name,folder:'addons',author:'e2e',summary:'Hears the merchant runner, stand and gathering notices.',
    hooks:(${merchantNotices.toString()})(state,${JSON.stringify(CHARACTER_NOTICES)})});})()`;
// Page source: what the character half heard, from `since` on.
export const characterHeard = (since = 0) => `(globalThis.__merchantHooksFixture?.heard||[]).filter(h=>h.at>=${since})`;
// Page source: the saved add-on switches with this add-on on or off, from the merchant's registry.
export const merchantHooksSwitches = (enabled: boolean) => switches(MERCHANT_HOOKS_ADDON, enabled);
