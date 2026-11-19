// The survival owner's saved fields, its
// declaration for the settings owner, which builds its table from it at load
// (`settings.declare`).
import { mapOf, wholeFrom, type Declarations } from '../../settings/api.ts';
import type { PartyEscape, PartyRecovery } from '../../coordinator/survival/api.ts';

// The saved shape of survival's records, as a save holds them (the settings owner's start reads it, initial.ts).
export interface SavedSurvivalRecords {
  escape?: PartyEscape | null;
  combatRecovery?: PartyRecovery | null;
  combatDeathSeen?: Record<string, { at: number; dead: boolean } | undefined> | null;
  combatResetByCharacter?: Record<string, number | undefined> | null;
}

export const survivalSavedFields = {
  name: 'core:survival',
  settings: {
    // C3: every fighter drinks an HP potion below this share of its HP, per character. A
    // character with no entry drinks below 50%, the merchant below 20% (lines.ts). It reaches the
    // character with each report reply and takes effect at its next turns pass.
    hpPotionBelow: { label: 'HP potion below (% HP)', kind: 'value', default: {} as Record<string, number>,
      scope: 'character', check: mapOf(wholeFrom(1, 100)), deliver: ['characters'] },
    // SRV-Q9, decided 2026-11-05: every class drinks an MP potion below this share of its MP,
    // after the HP line. A character with no entry drinks below 20%.
    mpPotionBelow: { label: 'MP potion below (% MP)', kind: 'value', default: {} as Record<string, number>,
      scope: 'character', check: mapOf(wholeFrom(1, 100)), deliver: ['characters'] },
  },
  // The escape, the death recovery and the death counter's saved state, which play writes, so each
  // is a record. They moved here from the settings owner's held block
  // (stand-in S54) with no change to a field.
  records: {
    escape: { default: null satisfies SavedSurvivalRecords['escape'] },
    combatRecovery: { default: null satisfies SavedSurvivalRecords['combatRecovery'], scope: 'scope', deliver: ['characters', 'dashboard-core'] },
    combatDeathSeen: { default: {} satisfies SavedSurvivalRecords['combatDeathSeen'] },
    combatResetByCharacter: { default: {} satisfies SavedSurvivalRecords['combatResetByCharacter'], deliver: ['characters'] },
  },
} satisfies Declarations;
