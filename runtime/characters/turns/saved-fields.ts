// The turns owner's saved field, its
// declaration for the settings owner, which builds its table from it at load
// (`settings.declare`).
import { mapOf, wholeFrom, type Declarations } from '../../settings/api.ts';

export const turnsSavedFields = {
  name: 'core:turns',
  settings: {
    // A7: the priest heals first when anyone is below this share of HP, per character. A
    // character with no entry heals first below `HEAL_FIRST_BELOW`. It reaches the character with
    // each report reply and takes effect at the next pass after it.
    healFirstBelow: { label: 'Heal first below (% HP)', kind: 'value', default: {} as Record<string, number>,
      scope: 'character', check: mapOf(wholeFrom(1, 100)), deliver: ['characters'] },
  },
} satisfies Declarations;

// "Heal first below" for a character with no entry: the one copy of the default, which the
// executor's view and survival's escape read through `healFirstBelowOf`. The settings owner
// refuses a value outside 1 to 100 at the write, so a delivered number is the line.
export const HEAL_FIRST_BELOW = 80;
export function healFirstBelowOf(delivered: unknown): number {
  return typeof delivered === 'number' ? delivered : HEAL_FIRST_BELOW;
}
