// The events owner's fixture add-on: one add-on that registers the events owner's two decision hooks an add-on answers, `event.attend`
// and `event.kind` (on both realms), and every events notice of the coordinator, and reads
// `event.presence` and `event.schedule` at each notice, so e2e/live-events-hooks.spec.ts proves each
// `HOOKS` row is told at its change and answers its read. Its refusal stays unset until a row sets
// one, and its event kind is attended only once a row selects it, so registering it changes no play.
// It joins the live coordinator's registry through e2e/live-coordinator.cjs `/party-api/e2e-events-hooks`,
// as the survival fixture does. The types come from the add-on API only.
import type { EventPresence, Occurrence, Registration } from '../../runtime/hooks/addon-api.ts';
import { keepCapped, switches, type FixtureHooks } from './hooks-fixture-kit.ts';

export const EVENTS_HOOKS_ADDON = 'events-hooks-fixture';
// The coordinator's events notices. anniversary.phase and cipher.plan
// are the character's and have unit rows.
export const COORDINATOR_NOTICES = ['event.scheduled', 'event.due', 'event.started', 'event.ended', 'member.presence', 'event.admitted',
  'event.joined', 'event.refused', 'event.left', 'event.limit', 'event.returning', 'event.returned', 'abtesting.strategy'] as const;
// One notice heard, with the reads the add-on made at it.
export interface Heard { hook: string; at: number; payload: Record<string, unknown>; reads: { presence: EventPresence | null; schedule: Occurrence | null }; stack?: string }
// `refuse` names the member whose admission the add-on refuses.
export interface FixtureState { heard: Heard[]; refuse?: string }

// The add-on's event kind: `dreams` is a `G.events` entry with no events row and no join,
// so the row is a walk to a point on Main that the live table seeds with the admin's `events`.
export const ADDON_EVENT = 'dreams';
// It names the event as a literal, since the character half sends its source to the page.
export const addonKind = () => ({ name: 'dreams', label: 'Dreams (fixture)', kind: 'walk' as const, point: { map: 'main', x: 0, y: 0 } });

export function coordinatorRegistration(state: FixtureState): Registration {
  const hooks = () => (globalThis as unknown as { __partyHooks: { askRow(hook: string, question: readonly unknown[]): unknown } }).__partyHooks;
  const reads = (payload: Record<string, unknown>) => ({
    presence: typeof payload.member === 'string' ? hooks().askRow('event.presence', [payload.member]) as EventPresence | null : null,
    schedule: typeof payload.occurrence === 'string' ? hooks().askRow('event.schedule', [payload.occurrence]) as Occurrence | null : null,
  });
  const hear = keepCapped(state.heard, 2000);
  const answers: FixtureHooks = {
    // A refusal keeps the call path that sent it, so a refusal sent more than once names its sender.
    ...Object.fromEntries(COORDINATOR_NOTICES.map(hook => [hook, (payload: Record<string, unknown>) => hear({ hook, at: Date.now(), payload, reads: reads(payload),
      ...(hook === 'event.refused' ? { stack: String(Error().stack).split('\n').slice(2, 14).join('\n') } : {}) })])),
    'event.attend': ask => ask.member === state.refuse ? { refuse: 'fixture refuses ' + ask.member } : undefined,
    'event.kind': addonKind,
  };
  return { name: EVENTS_HOOKS_ADDON, folder: 'addons', author: 'e2e', summary: "Hears every events notice, reads presence and the schedule at each, refuses a named member's admission and adds the Dreams event kind.",
    hooks: answers };
}

// Page source: registers the character half on this character's registry once. It answers the same
// event kind, so both realms read one events row, and keeps each `event.targets()` read it is asked for.
export const registerCharacterHalf = `(()=>{const hooks=globalThis.__partyHooks,name=${JSON.stringify(EVENTS_HOOKS_ADDON)};
  if(hooks.registrations().some(r=>r.name===name))return {ok:true};
  return hooks.register({name,folder:'addons',author:'e2e',summary:"Adds the Dreams event kind.",
    hooks:{'event.kind':${addonKind.toString()}}});})()`;
// Page source: the character's `event.targets()` read, as an add-on asks it.
export const readTargets = `globalThis.__partyHooks.askRow('event.targets',[])`;
// Page source: the events owner's row for the add-on event in this realm, or null.
export const kindHere = `(globalThis.__partyHooks.events.kinds().find(r=>r.name===${JSON.stringify(ADDON_EVENT)})||null)`;
// The saved add-on switches with this add-on on or off, from the character's own registry.
export const addonSwitches = (enabled: boolean) => switches(EVENTS_HOOKS_ADDON, enabled);