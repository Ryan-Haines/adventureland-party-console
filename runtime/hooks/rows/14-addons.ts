// Owner 14's rows of the hook table: the add-on system. Only 14's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import { doorOnly } from './row.ts';
import type { ActionRow, HookRow, SlotRow } from '../registry.ts';

export const HOOKS = {
  // An add-on's switch turning off (0.1: the switch is an 11 setting, and the enabled set it changes
  // is 14's). An add-on that keeps state between ticks, such as tank and hold's fight, ends it here:
  // while off it sees no tick, so nothing else tells it. The add-on hears its own switch; a core
  // registration hears every add-on's, so the movement owner ends the requests the add-on still
  // holds and the task owner its tasks.
  'addon.off': { kind: 'notice', part: 'the add-on system (14), the add-on switch', answers: 'many', side: 'both',
    fixture: 'scripts/tests/hook-registry.test.cjs#item 5: a switched-off add-on answers nothing, its walk ends, and switching it on needs no restart',
    receives: "the switched-off add-on's name", returns: 'nothing' },
  // An add-on's switch turning on, once per switch-on, to the add-on and every core listener.
  'addon.on': { kind: 'notice', part: 'the add-on system (14), the add-on switch', answers: 'many', side: 'both',
    fixture: 'scripts/tests/hook-registry.test.cjs#AS35: addon.on fires once per switch-on, after the switch, and never for an add-on left on',
    receives: "the switched-on add-on's name", returns: 'nothing' },
  // An add-on's own tick: once per status report on the character, as it
  // builds the report, and once per received report on the coordinator, for that character. It may
  // write its stores and `ctx.act`, which only queues.
  'addon.tick': { kind: 'request', part: 'the add-on system (14), the add-on tick', answers: 'many', addonMayAsk: false, side: 'both',
    bound: "the add-on's own stores and one queued action per character; an answer that throws counts as none and is recorded",
    fixture: 'scripts/tests/addon-context.test.cjs#addon.tick: each enabled add-on ticks once per report with its context, on both sides',
    receives: '{character, now}, the settings for the scope, the add-on context', returns: 'nothing' },
  // The outcome of an action the add-on asked, on the side that asked it, to that add-on only.
  'addon.acted': { kind: 'notice', part: 'the add-on system (14), actions', answers: 'many', side: 'both',
    fixture: 'scripts/tests/addon-context.test.cjs#addon.acted: a refused, a replaced and a sent action reach the asking add-on',
    receives: '{id, action, character, addon, outcome: sent with its reply, refused with by and reason, or failed with the error}', returns: 'nothing' },
  // The character's reply to a command the coordinator's `addon.command` forwarded.
  'addon.commanded': { kind: 'notice', part: 'the add-on system (14), commands', answers: 'many', side: 'coordinator',
    fixture: "scripts/tests/addon-context.test.cjs#addon.commanded: a forwarded command reaches the character's addon.command and its reply comes back",
    receives: '{id, character, addon, reply}', returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

// The three dashboard slots the add-on system draws: the two mode rows, an add-on's settings section
// and its status line. The section and the status line draw only for an installed add-on, so their
// fixture is the console table every installed add-on's journey joins.
export const SLOTS = {
  'mode-row': { owner: '14', data: "each enabled entry of 01's target-mode and combat-mode slots with its declared button {label, description, color}", section: false,
    fixture: 'e2e/addon-console.case.ts#the mode rows: the combat modes in row 1 and the target modes in row 2, each sending its own field, one pressed per row' },
  // Every enabled add-on with a section gets it; `save` reaches a target mode add-on's `target.settings`
  // and any other add-on's `addon.command`.
  'settings-section': { owner: '14', data: "an add-on's dashboard.tsx section with {store, settings, save, inherited, monsters} (addon-kit.ts AddonSectionProps)", section: true,
    fixture: 'scripts/tests/dashboard-addon-slots.test.cjs#settings-section: an enabled add-on with a section and no target mode gets its Farming settings section' },
  'status-line': { owner: '14', data: "a target mode entry's declared status {title, field, idle}, drawn in its button's colour", section: false,
    fixture: 'e2e/addon-console.case.ts#add-on console journeys' },
} as const satisfies Record<string, SlotRow>;

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = [] as const;
export const DECISIONS = {
  // What an add-on does on its own each report, beside the hooks that answer another owner's
  // decision.
  "an add-on's own tick": { site: 'runtime/hooks/registry.ts:1221', hook: 'addon.tick' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {} satisfies Record<string, PlainKind>;

// The game calls no owner's keyword names: the add-on owner's
// door in runtime/hooks/actions/ sends each under the common holds and the `background` band, and the
// server applies its own checks. The player chose the add-on, so the gold games, the duel and the
// friend list are its choice too (the user's answer to Q1). 09 only prices these events
// (call-budget.ts:250, :300, :316-318); its realm and hands never send them.
const gameEvent = <E extends string>(event: E, args = "the event's own data", bound = "the game's own checks") =>
  ({ events: [event], functions: [], door: 'gameEvent', args, bound }) as const;
export const ACTIONS = {
  set_home: gameEvent('set_home'), ureward: gameEvent('ureward'), throw: gameEvent('throw'), property: gameEvent('property'),
  list_pvp: gameEvent('list_pvp'), bless_server: gameEvent('bless_server'), blocker: gameEvent('blocker'), click: gameEvent('click'),
  poke: gameEvent('poke'), mreport: gameEvent('mreport'),
  bet: gameEvent('bet', "{type: 'dice', dir: 'up' | 'down', num, gold}", "the game's dice checks; gold the character holds"),
  poker: gameEvent('poker', "the poker table's body", "the game's tavern checks"),
  tavern: gameEvent('tavern', "the tavern's body", "the game's tavern checks"),
  duel: gameEvent('duel', '{event, name}', "the game's duel checks; survival's escape and death still come first"),
  friend: gameEvent('friend', "{event: 'accept' | 'request' | 'unfriend', name}", "the game's friend checks"),
  // The shell purchase sends the add-on's body as the event; 10 makes no shell call of its own.
  buy_shells: gameEvent('buy_shells'), buy_with_cash: gameEvent('buy_with_cash'),
  // The console's own channel between its characters: the runner replaces the game's send_cm
  // (lifecycle/character/host.ts `runner.send_cm`), so it is no game function; add-ons talk through the store.
  cm: { events: ['cm'], functions: [], closed: 'AS', cite: "runtime/lifecycle/character/host.ts runner.send_cm; addon-capabilities.md C4, one store on all three sides" },
  // Game-master commands run only for a game master's account.
  gm: { events: ['gm'], functions: [], closed: 'FW', cite: 'runtime/characters/call-budget.ts:301, a game master command' },
} as const satisfies Record<string, ActionRow>;
// C3's door table: the dispatcher and the action queue are the registry's own parts, which only
// core calls.
export const DOOR_ONLY = {
  ...doorOnly('runtime/hooks/actions/dispatch.ts', 'port', ['runAction']),
  ...doorOnly('runtime/hooks/actions/queue.ts', 'port', ['createActionQueue']),
};
