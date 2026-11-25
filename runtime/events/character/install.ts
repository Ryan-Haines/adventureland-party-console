// The events owner's loops on the character:
// the poll, the anniversary tick and the clock's check run on each
// feed the game sends and each report this character sends,
// with the anniversary's game listeners (a received slice, the kiss replies, and the character's game
// updates its waits end on). The clock registers its own listeners (clock.ts `start`). The
// respawn rejoin is attend.ts `rejoin`, which survival's rejoin rung asks. Moved from shared.js's
// routine `start` and `stop` (b9b5c91e 17357-17366, 17376-17379).
import { adoptAddonKinds } from '../rules.ts';
import { eventFacts } from '../api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { scope, type ScopeHandle } from '../../lifecycle/api.ts';

type Listener = (data: any) => unknown;

export interface CharacterEventParts {
  socket(): Parameters<ScopeHandle['on']>[0];
  name(): string;
  // The events owner's run scope handle `observe`: the anniversary's reply and
  // update records see what came during a Pause. The poll and the anniversary's tick decide and call,
  // so they run on the events owner's `act` handle, which the install takes from the lifecycle owner's `scope`.
  scope: { observe: ScopeHandle };
  // The poll and this character's report (attend.ts), the anniversary (anniversary.ts) and the clock
  // (clock.ts), which registers its own listeners.
  poll(): unknown;
  reported(): unknown;
  // attend.ts `disappeared`: the search boss's warp out of this character's view.
  disappeared: Listener;
  anniversary: { tick(): unknown; received: Listener; response: Listener; updated(kind: string): void };
  clock: { start(): void; check(): void };
}

export function installCharacterEvents(parts: CharacterEventParts) {
  const { observe } = parts.scope, actScope = scope('06', 'act');
  // The poll and the anniversary act on each new state: a feed, or a report this character sent.
  const act = () => { parts.poll(); void parts.anniversary.tick(); };
  // A report heard while the character is held runs its pass once at release: the pass is one `act`
  // one-shot, and a report that comes while one waits adds nothing.
  let pass: number | null = null;
  const reported = () => {
    if (pass !== null) return;
    pass = actScope.setTimeout(() => { pass = null; parts.reported(); act(); parts.clock.check(); });
  };
  let started = false;
  // The lifecycle owner's report timer notifies `report.sent` once a report goes (S-13c's line); 06 hears its own.
  partyHooks().publish({ name: 'core:events', folder: 'core', author: 'adventureland-party-console',
    summary: "Hands the Cipher's ingredients to the merchant on each report while the character attends the Cipher, answers the event targets and reads the add-ons' event kinds.",
    hooks: { 'report.sent': (payload: Record<string, unknown>) => {
        if (started && payload.character === parts.name()) reported();
      },
      // `event.targets()` for an add-on: the types and the area of combat.ts's read, without its functions.
      'event.targets': () => { const targets = eventFacts().eventTargets(); return { types: targets.types, area: targets.area }; },
      // An add-on's event kinds join the kinds table when it is turned on and leave when it is turned off.
      'addon.on'() { adoptAddonKinds(partyHooks().events.kinds()); },
      'addon.off'() { adoptAddonKinds(partyHooks().events.kinds()); } } });
  adoptAddonKinds(partyHooks().events.kinds());

  // The generation's stop removes every listener with its scope, so the install keeps no list.
  function start() {
    started = true;
    // The clock records the feed before the poll reads it, as the listener order did.
    parts.clock.start();
    act();
    const socket = parts.socket();
    actScope.on(socket, 'server_info', act);
    observe.on(socket, 'game_response', parts.anniversary.received);
    observe.on(socket, 'game_response', parts.anniversary.response);
    observe.on(socket, 'disappear', parts.disappeared);
    for (const kind of ['entities', 'player', 'new_map', 'server_info']) observe.on(socket, kind, () => parts.anniversary.updated(kind));
  }
  function stop() {
    started = false;
  }
  return { start, stop };
}
Object.assign(globalThis, { installCharacterEvents });
