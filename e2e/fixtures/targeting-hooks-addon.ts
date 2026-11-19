// The targeting owner's fixture add-on: one add-on that answers the targeting owner's four decision hooks and hears every 04 notice, and
// reads the published reads at each notice, so e2e/live-targeting-hooks.spec.ts proves each `HOOKS`
// row is told at its change and answers its read. Each answer stays unset until the spec sets it in
// the page (`__e2eTargeting`), so registering it changes no play. The character half registers on a
// character's page (`registerCharacterHalf`); the coordinator half joins the live coordinator's
// registry through e2e/live-coordinator.cjs `/party-api/e2e-targeting-hooks`, as the survival fixture
// does. The payload types come from the add-on API only.
import type { CandidatesView, ChangedNotice, FightStateNotice, GrantNotice, NominatedNotice, PassedNotice, Registration, RingNotice } from '../../runtime/hooks/addon-api.ts';
import { switches, type FixtureHooks } from './hooks-fixture-kit.ts';

export const TARGETING_HOOKS_ADDON = 'targeting-hooks-fixture';
// The notices each realm tells: the queue's on the coordinator, each character's own on its page.
export const COORDINATOR_NOTICES = ['targeting.nominated', 'targeting.fightState', 'targeting.granted', 'targeting.revoked'] as const;
export const CHARACTER_NOTICES = ['targeting.changed', 'targeting.passed', 'targeting.refused', 'targeting.skipped', 'targeting.retired',
  'targeting.cleared', 'targeting.unreachable'] as const;
export type TargetingPayload = ChangedNotice | PassedNotice | RingNotice | NominatedNotice | FightStateNotice | GrantNotice;
// One notice heard, with the reads the add-on made at it.
export interface Heard { hook: string; at: number; payload: Record<string, unknown>; reads: Record<string, unknown> }
// The answers: the candidates it keeps, the goo it prefers (the nearer or the farther), the aggro
// owner it names and the target id it refuses.
export interface Answers { keep?: string[]; prefer?: 'near' | 'far'; aggroOwner?: string; refuse?: string }
export interface FixtureState { heard: Heard[]; asked: Record<string, number>; answers: Answers }

// The hooks of one realm. The function is page source too (`registerCharacterHalf`), so it uses no
// import and no closure: it reads the realm's registry as `globalThis.__partyHooks`.
export function targetingHooks(state: FixtureState, realm: 'character' | 'coordinator', notices: readonly string[]): FixtureHooks {
  const hooks = () => (globalThis as unknown as { __partyHooks: { turns: Record<string, (...args: unknown[]) => unknown>;
    targeting: Record<string, (...args: unknown[]) => unknown>; askRow(hook: string, question: readonly unknown[]): unknown } }).__partyHooks;
  const asked = (hook: string) => { state.asked[hook] = (state.asked[hook] || 0) + 1; };
  const reads = (payload: Record<string, unknown>) => {
    const h = hooks();
    // The coordinator answers the passing column: whether a passing goo may interrupt a farm walk.
    if (realm === 'coordinator') return { fight: payload.group ? h.targeting.fight!(payload.group) ?? null : null,
      passing: h.targeting.passing!({ requester: { tier: 'farming' }, purpose: 'farm' }, 'passive') };
    const answer = h.turns.target!({}) as { target?: { id?: string }; due?: boolean } | undefined;
    const target = answer?.target;
    // `targeting.threat` is a published read with no method on the registry's `targeting` facade,
    // so the fixture asks it through `askRow`. A listener that throws here pushes nothing to `heard`.
    return { target: target?.id ?? null, due: !!answer?.due, threat: h.askRow('targeting.threat', [{}]),
      allows: target ? h.turns.allows!(target, 'attack') ?? null : null };
  };
  // Each notice keeps its newest 1000 entries. Every pass tells changed and passed, several a second
  // on the leader, so one bound over the whole list let them push out a notice told once, such as
  // targeting.retired, before the step that reads it.
  const keep = (hook: string, payload: Record<string, unknown>) => {
    state.heard.push({ hook, at: Date.now(), payload, reads: reads(payload) });
    if (state.heard.filter(h => h.hook === hook).length > 1000) state.heard.splice(state.heard.findIndex(h => h.hook === hook), 1);
  };
  const heard = Object.fromEntries(notices.map(hook => [hook, (payload: Record<string, unknown>) => keep(hook, payload)]));
  // `targeting.prefers` runs on both realms: the character's own selection and the grouped queue,
  // whose view names the leader's report as the character.
  const prefers = (view: CandidatesView<{ id: string; x: number; y: number }>) => {
    asked('targeting.prefers');
    if (!state.answers.prefer) return undefined;
    const me = view.character as { x: number; y: number }, sign = state.answers.prefer === 'far' ? -1 : 1;
    const far = (c: { x: number; y: number }) => Math.hypot(c.x - me.x, c.y - me.y);
    return [...view.candidates].sort((a, b) => sign * (far(a) - far(b)));
  };
  if (realm === 'coordinator') return { ...heard, 'targeting.prefers': prefers };
  return { ...heard,
    // The view carries the party; the answer keeps the named goos while a party is in view.
    'targeting.candidates': (view: { candidates: { id: string }[]; party: string[] }) => {
      asked('targeting.candidates');
      if (!state.answers.keep) return undefined;
      return view.party.length ? view.candidates.filter(c => state.answers.keep!.includes(c.id)) : undefined;
    },
    'targeting.prefers': prefers,
    'targeting.aggroOwner': () => { asked('targeting.aggroOwner'); return state.answers.aggroOwner; },
    'targeting.refuses': (monster: { id?: string }) => {
      asked('targeting.refuses');
      return state.answers.refuse && monster?.id === state.answers.refuse ? 'the planted goo is refused' : undefined;
    },
  };
}

// The coordinator half, which e2e/live-coordinator.cjs registers with its own state.
export function coordinatorRegistration(state: FixtureState): Registration {
  return { name: TARGETING_HOOKS_ADDON, folder: 'addons', author: 'e2e', summary: "Hears every targeting notice and reads targeting's answers at each.",
    hooks: targetingHooks(state, 'coordinator', COORDINATOR_NOTICES) };
}

// Page source: registers the character half on this character's registry once; its state is
// `globalThis.__e2eTargeting`.
export const registerCharacterHalf = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(TARGETING_HOOKS_ADDON)};
  const state=globalThis.__e2eTargeting||(globalThis.__e2eTargeting={heard:[],asked:{},answers:{}});
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  return hooks.register({name,folder:'addons',author:'e2e',summary:"Answers targeting's decision hooks and hears every targeting notice.",
    hooks:(${targetingHooks.toString()})(state,'character',${JSON.stringify(CHARACTER_NOTICES)})});})()`;
// Page source: sets the page's answers.
export const answer = (answers: Answers) => `(()=>{const s=globalThis.__e2eTargeting;s.answers=${JSON.stringify(answers)};return s.answers;})()`;
// Page source: what the character half heard from `since` on, and how often each decision hook was asked.
export const characterHeard = (since = 0) => `(globalThis.__e2eTargeting?.heard||[]).filter(h=>h.at>=${since})`;
export const characterAsked = `(globalThis.__e2eTargeting?.asked||{})`;

// The saved add-on switches with this add-on on or off, from the character's own registry.
export const addonSwitches = (enabled: boolean) => switches(TARGETING_HOOKS_ADDON, enabled);
