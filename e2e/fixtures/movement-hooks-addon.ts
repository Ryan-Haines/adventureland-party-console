// The movement owner's fixture add-on: one add-on that registers every movement decision hook an
// add-on may answer and every movement notice, and keeps what it was asked and told, so
// e2e/live-movement-hooks.spec.ts proves each `HOOKS` row is asked or told at its decision point.
// Every answer stays inert until a row sets one, so registering it changes no play.
// The character half registers on a character's page (`registerCharacterHalf`); the coordinator
// half joins the live coordinator's registry through e2e/live-coordinator.cjs
// `/party-api/e2e-movement-hooks`, as the anchor fixture does.
import type { Registration } from '../../runtime/hooks/addon-api.ts';
import { switches, type FixtureHooks } from './hooks-fixture-kit.ts';

export const MOVEMENT_HOOKS_ADDON = 'movement-hooks-fixture';
export interface Seen { hook: string; at: number; payload: unknown }
// The answers a row sets; each one is unset until then.
export interface Answers {
  hold?: string; refuseSteps?: string; point?: { x: number; y: number }; refuseCrossing?: string;
  slot?: { x: number; y: number }; anchor?: string; avoid?: string[];
}
export interface FixtureState { seen: Seen[]; answers: Answers }

// The hooks of one realm: `character` holds the mover, step safety, the step point, the slot and
// the crossing; the coordinator holds the anchor and the route. Each half hears its realm's notices.
// The function is page source too (`registerCharacterHalf`), so it uses no import and no closure.
export function movementHooks(state: FixtureState, realm: 'character' | 'coordinator'): FixtureHooks {
  const keep = (hook: string, payload: unknown) => { state.seen.push({ hook, at: Date.now(), payload }); if (state.seen.length > 2000) state.seen.shift(); };
  const notices = realm === 'character'
    ? ['journey.started', 'journey.paused', 'journey.resumed', 'journey.ended', 'request.waiting', 'request.refused', 'ladder.climbed',
      'hold.started', 'hold.ended', 'click.taken', 'crossing.started', 'crossing.ended', 'step.sent', 'formation.moved']
    : ['walk.formed', 'walk.phase', 'walk.member', 'walk.ended', 'ladder.climbed', 'records.saved'];
  const heard = Object.fromEntries(notices.map(hook => [hook, (payload: unknown) => keep(hook, payload)]));
  if (realm === 'character') return { ...heard,
    'movement.request': [{ name: 'hold', tier: 'addon-task', answer() {
      keep('movement.request', { asked: true });
      return state.answers.hold ? { kind: 'hold', reason: state.answers.hold } : undefined;
    } }],
    'step.safety'(_view: unknown, to: { x: number; y: number }) { keep('step.safety', { to }); return state.answers.refuseSteps; },
    'step.point'(ask: { mover: string; to: { x: number; y: number } }) { keep('step.point', ask); return state.answers.point; },
    'crossing.allows'(ask: { crossing: string }) { keep('crossing.allows', ask); return state.answers.refuseCrossing; },
  };
  return { ...heard,
    'group.anchor'(members: readonly { name: string }[]) { keep('group.anchor', { members: members.map(m => m.name) }); return state.answers.anchor; },
    'route.avoid'(ask: { from: { map: string }; to: { map: string } }) { keep('route.avoid', ask); return state.answers.avoid; },
  };
}

// The coordinator half, which e2e/live-coordinator.cjs registers with its own state.
export function coordinatorRegistration(state: FixtureState): Registration {
  return { name: MOVEMENT_HOOKS_ADDON, folder: 'addons', author: 'e2e', summary: 'Records every movement hook and notice for the hooks table.',
    hooks: movementHooks(state, 'coordinator') };
}

// Page source: registers the character half on this character's registry once; its state is
// `globalThis.__movementHooksFixture`.
export const registerCharacterHalf = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(MOVEMENT_HOOKS_ADDON)};
  const state=globalThis.__movementHooksFixture||(globalThis.__movementHooksFixture={seen:[],answers:{}});
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  return hooks.register({name,folder:'addons',author:'e2e',summary:'Records every movement hook and notice for the hooks table.',
    hooks:(${movementHooks.toString()})(state,'character')});})()`;
// Page source: what the character half saw, from `since` on.
export const characterSeen = (since = 0) => `(globalThis.__movementHooksFixture?.seen||[]).filter(s=>s.at>=${since})`;
// Page source: sets the character half's answers (`null` clears one).
export const characterAnswers = (answers: Record<string, unknown>) => `(()=>{const a=globalThis.__movementHooksFixture.answers;
  for(const [k,v] of Object.entries(${JSON.stringify(answers)}))if(v===null)delete a[k];else a[k]=v;return a;})()`;

// The saved add-on switches with this add-on on, from the character's own registry.
export const addonSwitches = (enabled: boolean) => switches(MOVEMENT_HOOKS_ADDON, enabled);
