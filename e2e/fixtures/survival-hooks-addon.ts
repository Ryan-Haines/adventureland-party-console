// The survival owner's fixture add-on: one add-on that registers survival's one decision hook an add-on answers,
// `survival.refuses`, and every survival notice, and reads each published read at each notice, so
// e2e/live-survival-hooks.spec.ts proves each `HOOKS` row is told at its change and answers its read.
// Its refusal stays unset until a row sets one, so registering it changes no play. The character
// half registers on a character's page (`registerCharacterHalf`); the coordinator half joins the
// live coordinator's registry through e2e/live-coordinator.cjs `/party-api/e2e-survival-hooks`, as
// the movement fixture does. The payload types come from the add-on API only.
import type { DiedNotice, EscapeNotice, RecoveryNotice, Registration, SurvivalVerdict } from '../../runtime/hooks/addon-api.ts';
import { switches, type FixtureHooks } from './hooks-fixture-kit.ts';

export const SURVIVAL_HOOKS_ADDON = 'survival-hooks-fixture';
// The notices each realm tells: the party's on the coordinator, each member's own on its page.
export const COORDINATOR_NOTICES = ['survival.died', 'survival.escaped', 'survival.recoveryStarted', 'survival.recoveryPhase', 'survival.recovered',
  'survival.escapeStarted', 'survival.escapeStage', 'survival.escapeEnded', 'survival.judged'] as const;
export const CHARACTER_NOTICES = ['survival.died', 'survival.escapeMember', 'survival.respawning', 'survival.memberRecovery', 'survival.reviving'] as const;
// One notice heard, with the reads the add-on made at it.
export interface Heard { hook: string; at: number; payload: Record<string, unknown>; reads: Record<string, unknown> }
// `escapes` keeps each escape's participants from its start, since a stage notice names no member.
export interface FixtureState { heard: Heard[]; refuse?: string; escapes?: Record<string, string[]> }
export type SurvivalPayload = DiedNotice | EscapeNotice | RecoveryNotice;
export type ReadVerdict = SurvivalVerdict | undefined;

// The hooks of one realm. The function is page source too (`registerCharacterHalf`), so it uses no
// import and no closure: it reads the realm's registry as `globalThis.__partyHooks`.
export function survivalHooks(state: FixtureState, realm: 'character' | 'coordinator', notices: readonly string[]): FixtureHooks {
  const hooks = () => (globalThis as unknown as { __partyHooks: { survival: Record<string, (...args: unknown[]) => unknown> } }).__partyHooks.survival;
  const name = (payload: Record<string, unknown>) => String(payload.character ?? payload.name ?? (payload.names as string[] | undefined)?.[0] ?? (payload.participants as string[] | undefined)?.[0] ??
    payload.member ?? state.escapes?.[String(payload.id)]?.[0] ?? '');
  const reads = (payload: Record<string, unknown>) => {
    const s = hooks(), who = name(payload);
    return realm === 'character'
      ? { fighting: s.fighting!(who), verdict: s.verdict!({ character: who }), escaping: s.escaping!(who) ?? null }
      : { escaping: who ? s.escaping!(who) ?? null : null, recovery: payload.group ? s.recovery!(payload.group) ?? null : null, life: who ? s.life!(who) : 0,
        verdict: payload.group ? s.verdict!({ group: payload.group }) ?? null : null };
  };
  const keep = (hook: string, payload: Record<string, unknown>) => {
    if (hook === 'survival.escapeStarted') (state.escapes ??= {})[String(payload.id)] = [...(payload.participants as string[] ?? [])];
    state.heard.push({ hook, at: Date.now(), payload, reads: reads(payload) });
    if (state.heard.length > 2000) state.heard.shift();
  };
  const heard = Object.fromEntries(notices.map(hook => [hook, (payload: Record<string, unknown>) => keep(hook, payload)]));
  return realm === 'coordinator' ? { ...heard, 'survival.refuses': () => state.refuse } : heard;
}

// The coordinator half, which e2e/live-coordinator.cjs registers with its own state.
export function coordinatorRegistration(state: FixtureState): Registration {
  return { name: SURVIVAL_HOOKS_ADDON, folder: 'addons', author: 'e2e', summary: "Hears every survival notice and reads survival's answers at each.",
    hooks: survivalHooks(state, 'coordinator', COORDINATOR_NOTICES) };
}

// Page source: registers the character half on this character's registry once; its state is
// `globalThis.__survivalHooksFixture`.
export const registerCharacterHalf = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(SURVIVAL_HOOKS_ADDON)};
  const state=globalThis.__survivalHooksFixture||(globalThis.__survivalHooksFixture={heard:[]});
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  return hooks.register({name,folder:'addons',author:'e2e',summary:"Hears every survival notice and reads survival's answers at each.",
    hooks:(${survivalHooks.toString()})(state,'character',${JSON.stringify(CHARACTER_NOTICES)})});})()`;
// Page source: what the character half heard, from `since` on.
export const characterHeard = (since = 0) => `(globalThis.__survivalHooksFixture?.heard||[]).filter(h=>h.at>=${since})`;

// The saved add-on switches with this add-on on or off, from the character's own registry.
export const addonSwitches = (enabled: boolean) => switches(SURVIVAL_HOOKS_ADDON, enabled);
