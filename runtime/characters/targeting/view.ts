// One selection pass's facts: the character, the entities in view, the party, and each fact tables A,
// M and S read, each read once per pass, when a row first asks it. The pass holds its view while it
// runs (`withView`); an ask outside a pass reads a view of its own, so it reads each fact at the ask,
// as b9b5c91e did.
import type { TargetingMap, TargetingPorts, TargetingState } from './install.ts';
import { eventFacts, type EventFacts } from '../../events/api.ts';

// The other owners' facts, each read from its owner's door.
export const PORT_FACTS = {
  reunionRealm: (p: TargetingPorts) => p.walks.reunionRealm(),
  groupedFarming: (p: TargetingPorts) => p.hunting.farm.grouped(),
  monsterFocusNow: (p: TargetingPorts) => p.hunting.facts.focus.focus,
  currentPartyList: (p: TargetingPorts) => p.tasks.partyList(),
  dungeonOwned: (p: TargetingPorts) => p.hunting.cave.owned(),
  huntCombatTargetNow: (p: TargetingPorts) => p.hunting.facts.focus.huntTarget,
  travelCombatActive: (p: TargetingPorts) => p.walks.travelCombatActive(),
  targetScope: (p: TargetingPorts) => p.tasks.holds.targetScope(),
  rareControlNow: (p: TargetingPorts) => p.hunting.facts.focus.rare.control,
  huntPending: (p: TargetingPorts) => p.hunting.facts.focus.lootPending,
  // The lifecycle owner's drain answer (`lifecycle.drain`): the targets the drain lets finish, or null.
  drain: (p: TargetingPorts) => p.root.__partyHooks.ask('lifecycle.drain'),
  rareActive: (p: TargetingPorts) => p.hunting.facts.focus.rare.active,
  partyFarmingMonsterTypeNow: (p: TargetingPorts) => p.hunting.facts.focus.partyType,
  farmingModeNow: (p: TargetingPorts) => p.hunting.facts.focus.mode,
  dungeonOwns: (p: TargetingPorts) => p.hunting.facts.cave.owned,
  // A11's read: the tasks owner's assignment tier.
  assignedTierNow: (p: TargetingPorts) => p.tasks.assignment.assignedTier(''),
  handControl: (p: TargetingPorts) => p.tasks.holds.handControl(),
  getFarmingMode: (p: TargetingPorts) => p.hunting.farm.mode(),
} as const;
// The events owner's facts the rows read (api.ts `eventFacts()`, E04-06a): K7's marker and active event, Franky's
// fight, and `event.targets()`'s current types and area event.
export const EVENT_FACTS = {
  joinedEventNow: (f: EventFacts) => f.joinedEventName(), activeCombatEvent: (f: EventFacts) => f.active(),
  frankyCombatActive: (f: EventFacts) => f.frankyActive(), eventTargetTypesNow: (f: EventFacts) => f.eventTargets().types,
  eventArea: (f: EventFacts) => f.eventTargets().area,
} as const;
// The targeting owner's own facts of the pass, each one of its functions with no argument.
export const OWN_FACTS = ['returnCombatActive', 'rareTarget', 'unfinishedFight'] as const;
// The events owner's facts take their type from EventFacts and the port facts from their owners' doors; the targeting owner's own
// facts read the untyped module map.
type EventFactValues = { readonly [K in keyof typeof EVENT_FACTS]: ReturnType<typeof EVENT_FACTS[K]> };
type PortFactValues = { readonly [K in keyof typeof PORT_FACTS]: ReturnType<typeof PORT_FACTS[K]> };
type UntypedFact = typeof OWN_FACTS[number];

export type TargetingView = { readonly [K in UntypedFact]: any } & PortFactValues & EventFactValues & {
  readonly character: typeof character;
  readonly entities: Record<string, any>;
  readonly party: string[];
  // The event target types here: the area event's types on its map (Goo Brawl's goos), else the
  // current event's own (M's row, `isExternallyClaimedMonster`).
  readonly eventTypesHere: string[];
};

export function createViews(t: TargetingMap, p: TargetingPorts, s: TargetingState) {
  // One view's facts, read on first ask. The getters sit on one prototype per module, so a view of
  // its own costs one object per ask.
  class View { readonly cache = new Map<string, unknown>(); }
  const once = (view: View, name: string, read: () => unknown) => {
    if (!view.cache.has(name)) view.cache.set(name, read());
    return view.cache.get(name);
  };
  for (const [name, read] of Object.entries(PORT_FACTS)) Object.defineProperty(View.prototype, name, { get(this: View) { return once(this, name, () => read(p)); } });
  for (const [name, read] of Object.entries(EVENT_FACTS)) Object.defineProperty(View.prototype, name, { get(this: View) { return once(this, name, () => read(eventFacts())); } });
  for (const name of OWN_FACTS) Object.defineProperty(View.prototype, name, { get(this: View) { return once(this, name, () => t[name]()); } });
  Object.defineProperties(View.prototype, {
    character: { get: () => character },
    entities: { get: () => (parent as unknown as { entities?: Record<string, any> }).entities ?? {} },
    party: { get(this: TargetingView) { return this.currentPartyList; } },
    eventTypesHere: { get(this: View & TargetingView) { return once(this, 'eventTypesHere', () => this.eventArea ? eventFacts().targets(this.eventArea) : this.eventTargetTypesNow); } },
  });
  const createView = () => new View() as unknown as TargetingView;
  // The open pass's view, or one of the ask's own.
  function view(): TargetingView { return s.view ?? createView(); }
  // Runs one pass under one view; a pass inside a pass reads the outer one.
  function withView<T>(run: () => T): T {
    const prior = s.view;
    s.view = prior ?? createView();
    try { return run(); } finally { s.view = prior; }
  }
  return { view, withView };
}
