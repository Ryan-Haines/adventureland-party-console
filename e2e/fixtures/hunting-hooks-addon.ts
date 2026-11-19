// The hunts and farming owner's fixture add-on: one add-on that registers its three decision hooks, `hunt.quest`,
// `farm.spot` and `rare.search`, and every 07 notice, and asks `farming.focus`, `hunt.view`,
// `passive.rule` and `cave.state` at each notice, so e2e/live-hunting-hooks.spec.ts proves each
// `HOOKS` row is told at its change and answers its read. Its refusals and preferences stay unset
// until a row sets one, so registering it changes no play. It joins the live coordinator's registry
// through e2e/live-coordinator.cjs, as the events fixture does. The types come from the add-on API only.
import type { FarmingFocus, HuntView, PassiveRuleView, Registration } from '../../runtime/hooks/addon-api.ts';
import { keepCapped, switches, type FixtureHooks } from './hooks-fixture-kit.ts';

export const HUNTING_HOOKS_ADDON = 'hunting-hooks-fixture';
// The page script that reads the coordinator's add-on switches with this add-on on or off, for the
// `addons` setting e2e/live-hunting-hooks.spec.ts and e2e/live-cave.spec.ts write.
export const addonSwitches = (enabled: boolean) => switches(HUNTING_HOOKS_ADDON, enabled);
// The coordinator's 07 notices (6 part 2).
export const HUNTING_NOTICES = ['hunt.stage', 'hunt.questChanged', 'hunt.counted', 'hunt.blacklisted', 'farming.focusChanged',
  'farm.relocated', 'farming.mode', 'scatter.learned', 'rare.encounter', 'rare.patrol', 'cave.phase'] as const;
// One notice heard, with the reads the add-on made at it.
export interface Heard { hook: string; at: number; payload: Record<string, unknown>;
  reads: { focus: Omit<FarmingFocus, 'contains'> | null; hunt: HuntView | null; goo: PassiveRuleView; tinyp: PassiveRuleView; cave: unknown } }
// `refuseQuest` names a quest id the add-on refuses; `keepSpawn` the farm area id it prefers;
// `order` the Phoenix region order it answers.
export interface FixtureState { heard: Heard[]; refuseQuest?: string; keepSpawn?: string; refuseAreas?: string[]; order?: string[] }

export function coordinatorRegistration(state: FixtureState): Registration {
  const hooks = () => (globalThis as unknown as { __partyHooks: { askRow(hook: string, question: readonly unknown[]): unknown } }).__partyHooks;
  const reads = (payload: Record<string, unknown>) => {
    const group = typeof payload.group === 'string' ? payload.group : null;
    const focus = group ? hooks().askRow('farming.focus', [group]) as FarmingFocus | undefined : undefined;
    return {
      focus: focus ? { ...focus, contains: undefined } as unknown as Omit<FarmingFocus, 'contains'> : null,
      hunt: group ? hooks().askRow('hunt.view', [group]) as HuntView | undefined ?? null : null,
      goo: hooks().askRow('passive.rule', ['goo']) as PassiveRuleView,
      tinyp: hooks().askRow('passive.rule', ['tinyp']) as PassiveRuleView,
      cave: hooks().askRow('cave.state', []),
    };
  };
  const hear = keepCapped(state.heard, 2000);
  const answers: FixtureHooks = {
    ...Object.fromEntries(HUNTING_NOTICES.map(hook => [hook, (payload: Record<string, unknown>) => hear({ hook, at: Date.now(), payload, reads: reads(payload) })])),
    'hunt.quest': ask => ask.quest.id === state.refuseQuest ? false : undefined,
    'farm.spot': () => state.keepSpawn || state.refuseAreas ? { refuse: state.refuseAreas ?? [], prefer: state.keepSpawn } : undefined,
    'rare.search': () => state.order,
  };
  return { name: HUNTING_HOOKS_ADDON, folder: 'addons', author: 'e2e',
    summary: "Hears every hunting notice, reads the focus, the Hunt, two passive rules and the Cave at each, and refuses a named quest, keeps a named spawn and orders the patrol when a row sets them.",
    hooks: answers };
}
