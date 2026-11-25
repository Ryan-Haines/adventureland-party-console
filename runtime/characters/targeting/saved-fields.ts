// The targeting owner's saved fields,
// its declaration for the settings owner, which builds its table from it at load
// (`settings.declare`).
import { mapOf, object, wholeFrom, type Declarations } from '../../settings/api.ts';
import type { EventBoundary } from '../../coordinator/targeting/snapshot.ts';
import { reflectCheck } from './reflect.ts';

// A character's priorities give each monster id a number from `min` to `max` (R07-44: the focus
// route's check moved into the declaration); a monster with none ranks at `unset`. The dashboard's
// priority boxes read the same row. `validMonsterPriorities` is one character's check, which the
// declaration applies per character and the hunting owner's focus route asks for a request that names none (api.ts).
// The saved shape of targeting's two fields the settings owner's start reads (initial.ts).
export interface SavedTargetingFields {
  monsterPrioritiesByCharacter?: Record<string, Record<string, number>> | null;
  groupedCombatResetAt?: number | null;
}
export const MONSTER_PRIORITY = { min: 0, max: 1000, unset: 50 } as const;
export const validMonsterPriorities = (value: unknown) => object(value) && Object.entries(value).every(([id, v]) =>
  /^[a-z0-9_]+$/i.test(id) && typeof v === 'number' && Number.isFinite(v) && v >= MONSTER_PRIORITY.min && v <= MONSTER_PRIORITY.max);

export const targetingSavedFields = {
  name: 'core:targeting',
  settings: {
    // Per character, the monsters it never hits with magic, and the ones it hits
    // with a physical attack only from a range of 75 or more. A character with no entry keeps
    // b9b5c91e's monsters (reflect.ts). Each list takes only the monsters game data rates for it. It
    // reaches the character with each report reply and takes effect at its next attack.
    reflectMagicByCharacter: { label: "Don't hit with magic", kind: 'value', default: {} as Record<string, string[]>,
      scope: 'character', check: reflectCheck('magic'), deliver: ['characters'] },
    reflectPhysicalByCharacter: { label: "Don't hit with physical", kind: 'value', default: {} as Record<string, string[]>,
      scope: 'character', check: reflectCheck('physical'), deliver: ['characters'] },
    monsterPrioritiesByCharacter: { label: 'Monster priorities', kind: 'value',
      default: {} satisfies SavedTargetingFields['monsterPrioritiesByCharacter'], scope: 'character', document: 'selections',
      importable: true, check: mapOf(validMonsterPriorities), refusal: 'invalid monster priorities', deliver: ['dashboard'] },
    // V3.3's hidden picks, each kept at today's value: no game fact gives the window, so each is the
    // console's own choice, named once here. A pick the
    // character reads is delivered with the reply (`pick` below).
    // W5: how long an unreachable target stays set aside, today's `now + 10000`.
    setAsideMs: { label: 'Set-aside time of an unreachable target (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 10000, hidden: true, deliver: ['characters'] },
    // The selection timer's interval, today's 1 s, so every empty pass still closes on a leader who walks away.
    targetPassMs: { label: 'Selection pass interval (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 1000, hidden: true, deliver: ['characters'] },
    // How long after its send a `too_far` reply still belongs to the crab range recovery, today's 2000.
    crabReplyMs: { label: 'Crab range reply window (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 2000, hidden: true, deliver: ['characters'] },
    // How long a fight stays live after an accepted or engaged attack (A28's margin, the neutral reset, the entity refresh's stall), today's 5000.
    attackStallMs: { label: 'Live fight window after an attack (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 5000, hidden: true, deliver: ['characters'] },
    // How long a pursuit may make no progress before it ends, today's 5000.
    pursuitStallMs: { label: 'Pursuit stall window (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 5000, hidden: true },
    // W7: how long every fresh member must miss a target before it is gone, today's 8000.
    unseenGoneMs: { label: 'Unseen target window (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 8000, hidden: true },
    // The gap between two entity snapshot requests, today's 10000; the game allows two a second.
    snapshotGapMs: { label: 'Entity snapshot gap (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 10000, hidden: true, deliver: ['characters'] },
    // How long a successor grant lives, today's 3000.
    successorGrantMs: { label: 'Successor grant life (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 3000, hidden: true, deliver: ['characters'] },
    // How long a passing encounter is remembered, today's 60000.
    passingMemoryMs: { label: 'Passing encounter memory (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 60000, hidden: true, deliver: ['characters'] },
    // How long the group's readiness and recovery must hold before they count, today's 500.
    groupReadyMs: { label: 'Group readiness hold (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 500, hidden: true },
    // The queue client's tick, today's 100; it carries state no event announces.
    queueTickMs: { label: 'Queue client tick (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: 100, hidden: true, deliver: ['characters'] },
    // The distance within which a same-type monster replaces a lost target, today's 180; no game field gives it.
    lostTargetRadius: { label: 'Lost target replacement radius', kind: 'value', check: wholeFrom(1, Infinity), default: 180, hidden: true },
  },
  // The grouped queue's reset stamp, its saved fight and the event boundary, which play writes, so
  // each is a record. They moved here from the settings owner's held block
  // (stand-in S53) with no change to a field.
  records: {
    groupedCombatResetAt: { default: 0 satisfies SavedTargetingFields['groupedCombatResetAt'], scope: 'scope' },
    groupedCombat: { default: null, scope: 'scope', profileOnly: true },
    eventBoundary: { default: null satisfies EventBoundary | null },
  },
} satisfies Declarations;
const PICKS = ['setAsideMs', 'targetPassMs', 'crabReplyMs', 'attackStallMs', 'pursuitStallMs', 'unseenGoneMs', 'snapshotGapMs',
  'successorGrantMs', 'passingMemoryMs', 'groupReadyMs', 'queueTickMs', 'lostTargetRadius'] as const;
export type PickName = typeof PICKS[number];
const declaredPick = (name: PickName): number => targetingSavedFields.settings[name].default;
// Where `pick` reads a hidden pick. The coordinator install hands it the settings owner's `hiddenValue`; a character
// reads the values its reply delivers (`deliveredPicks`). A runtime that sets no source, as a test or
// a tool, reads the declared default.
let source: (name: PickName) => number = declaredPick;
export function readPicks(read: (name: PickName) => number): void { source = read; }
export const pick = (name: PickName): number => source(name);
// A character's delivered picks: each starts at its declared default, and a reply value its
// declaration's check passes replaces it, as movement's settings reply keeps its budgets.
export function deliveredPicks() {
  const held = Object.fromEntries(PICKS.map(name => [name, declaredPick(name)])) as Record<PickName, number>;
  return {
    read: (name: PickName) => held[name],
    take(state: Record<string, unknown>): void {
      for (const name of PICKS) if (name in state && targetingSavedFields.settings[name].check(state[name])) held[name] = state[name] as number;
    },
  };
}
