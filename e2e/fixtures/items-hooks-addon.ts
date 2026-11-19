// The items owner's fixture add-on: one add-on that answers the items owner's add-on hooks and hears every 10 notice, so
// e2e/live-items-hooks.spec.ts proves each `HOOKS` and `SLOTS` row of runtime/hooks/rows/10-items.ts
// whose `fixture` names that spec is asked at its decision point or told at its change. Each row sets
// the claims, actions and listings the add-on answers; with none set it answers nothing, so
// registering it changes no play. e2e/live-coordinator.cjs `/party-api/e2e-items-hooks` joins it to
// the live coordinator's registry.
import type { ItemActionAsk, ItemClaimAsk, ItemClaimView, Registration } from '../../runtime/hooks/addon-api.ts';
import { keepCapped } from './hooks-fixture-kit.ts';

export const ITEMS_HOOKS_ADDON = 'items-hooks-fixture';
export const NOTICES = ['items.fateChanged', 'items.claimShort', 'items.banked', 'items.withdrawn', 'items.bought', 'items.sold',
  'items.listed', 'items.unlisted', 'items.produced', 'items.exchanged', 'items.dismantled', 'items.mailed', 'items.storage',
  'items.bankChanged', 'items.orderPaused', 'items.claimRefused', 'items.sortLease', 'items.bankboi', 'items.saleBlocked',
  'items.intent'] as const;
export interface Heard { hook: string; at: number; payload: Record<string, unknown> }
export interface FixtureState {
  heard: Heard[];
  claims: ItemClaimAsk[];
  // The action the add-on answers for an item name.
  actions: Record<string, string>;
  listings: unknown[];
}

export function coordinatorRegistration(state: FixtureState): Registration {
  const hear = keepCapped(state.heard, 2000);
  const keep = (hook: string, payload: unknown) => hear({ hook, at: Date.now(), payload: (payload ?? {}) as Record<string, unknown> });
  return {
    name: ITEMS_HOOKS_ADDON, folder: 'addons', author: 'e2e',
    summary: "Answers the rows' item claims, actions and sources and hears every items notice.",
    hooks: {
      ...Object.fromEntries(NOTICES.map(hook => [hook, (payload: unknown) => keep(hook, payload)])),
      'items.claim'(view: ItemClaimView) {
        keep('items.claim', { character: view.character });
        return state.claims.filter(claim => claim.place === `carried:${view.character}` || claim.place === 'merchant' || claim.place === 'bank');
      },
      'items.action'(ask: ItemActionAsk) {
        const name = String((ask.item as { name?: unknown } | null)?.name), action = state.actions[name];
        keep('items.action', { character: ask.character, slot: ask.slot, item: name });
        return action ? { action } : undefined;
      },
      'items.source'() { keep('items.source', {}); return state.listings; },
    },
  };
}
