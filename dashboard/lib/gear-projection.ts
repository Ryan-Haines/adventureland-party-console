// The gear comparison's projection: a character's stats with another set of equipment, moved from
// the stats it reports with its actual gear. The dialog (gear-comparison-dialog.tsx) draws it, and
// scripts/tests/gear-comparison.test.cjs checks it whole.
import type { Char } from '../features/party/char';
import type { EquippedEntry } from '../features/party/equipped-entry';
import { attributeStats, itemAttack, weaponStatAttack } from './game-formulas';

export type Equipment = [string, EquippedEntry][];

/** The summed numeric properties of every equipped entry. */
export function equipmentTotals(equipment: Equipment): Record<string, number> {
  const totals: Record<string, number> = {};
  equipment.forEach(([, value]) =>
    Object.entries(value.meta?.properties || {}).forEach(([key, amount]) => {
      const numeric = Number(amount);
      if (Number.isFinite(numeric))
        totals[key] = (totals[key] || 0) + numeric;
    }),
  );
  return totals;
}

const prop = (source: Record<string, number>, key: string) => Number(source[key] || 0);

/**
 * The projection for one character. Its reported stats already include the actual gear and active
 * sets, so each preview moves them by its change from that gear, and removing an offhand also
 * removes its set contributions.
 */
export function gearProjection(character: Char, actualEquipment: Equipment, actualSetTotals: Record<string, number>) {
  const actualTotals = equipmentTotals(actualEquipment);
  // The attribute shares and the weapons' attack follow the game's lines in
  // dashboard/lib/game-formulas.ts; a preview moves each by its change from the actual gear.
  const primary = String(character.primaryStat || '').toLowerCase();
  const statAttack = (stats: Record<string, unknown>, equipment: Equipment) =>
    weaponStatAttack(character.ctype, primary, stats, itemAttack(equipment));
  const actualStatAttack = statAttack(character as unknown as Record<string, unknown>, actualEquipment);
  return (equipment: Equipment, setTotals: Record<string, number>) => {
    const totals = equipmentTotals(equipment);
    const delta = (key: string) =>
      prop(totals, key) -
      prop(actualTotals, key) +
      Number(setTotals[key] || 0) -
      Number(actualSetTotals[key] || 0);
    const result = { ...character };
    result.str = Number(character.str || 0) + delta('str');
    result.int = Number(character.int || 0) + delta('int');
    result.dex = Number(character.dex || 0) + delta('dex');
    result.vit = Number(character.vit || 0) + delta('vit');
    result.luck = Number(character.luck || 0) + delta('luck');
    result.fortitude = Number(character.fortitude || 0) + delta('for');
    result.goldBonus = Number(character.goldBonus || 0) + delta('gold');
    result.xpBonus = Number(character.xpBonus || 0) + delta('xp');
    result.max_hp =
      Number(character.max_hp) +
      delta('hp') +
      attributeStats.maxHp(delta('str'), delta('vit'), character.level);
    result.max_mp = Number(character.max_mp) + delta('mp') + attributeStats.maxMp(delta('int'));
    result.armor =
      Number(character.armor || 0) +
      delta('armor') +
      attributeStats.armor(result.str) -
      attributeStats.armor(Number(character.str || 0));
    result.resistance =
      Number(character.resistance || 0) +
      delta('resistance') +
      attributeStats.resistance(result.int) -
      attributeStats.resistance(Number(character.int || 0));
    result.speed =
      (character.ctype === 'merchant'
        ? (character.unrestrictedSpeed ??
          (character.standOpen ? NaN : Number(character.speed || 0)))
        : Number(character.speed || 0)) +
      delta('speed') +
      attributeStats.runSpeed(result.str, result.dex) -
      attributeStats.runSpeed(Number(character.str || 0), Number(character.dex || 0));
    // Equipment and set frequency use hundredths of an attack per second.
    result.frequency =
      Number(character.frequency || 0) +
      delta('frequency') / 100 +
      attributeStats.frequency(result.int, result.dex) -
      attributeStats.frequency(Number(character.int || 0), Number(character.dex || 0));
    result.range = Number(character.range || 0) + delta('range');
    // Every item's attack adds to the stat; the weapons' attack also grows with the attributes.
    result.attack =
      Number(character.attack || 0) +
      delta('attack') +
      statAttack(result as unknown as Record<string, unknown>, equipment) -
      actualStatAttack;
    const combat = character.combatStats || {};
    const projectedRecord = result as unknown as Record<string, number>;
    projectedRecord.evasion = Number(combat.evasion || 0) + delta('evasion');
    projectedRecord.reflection =
      Number(combat.reflection || 0) + delta('reflection');
    projectedRecord.lifesteal =
      Number(combat.lifesteal || 0) + delta('lifesteal');
    projectedRecord.manasteal =
      Number(combat.manasteal || 0) + delta('manasteal');
    projectedRecord.rpiercing =
      Number(combat.resistancePiercing || 0) + delta('rpiercing');
    projectedRecord.apiercing =
      Number(combat.armorPiercing || 0) + delta('apiercing');
    projectedRecord.crit = Number(combat.crit || 0) + delta('crit');
    projectedRecord.dreturn =
      Number(combat.damageReturn || 0) + delta('dreturn');
    projectedRecord.mp_cost = Number(combat.mpCost || 0) + delta('mp_cost');
    projectedRecord.output = Number(combat.output || 0) + delta('output');
    return result;
  };
}
