/** Offering rules are application policy, independent of an item's starting upgrade mark. */
export const upgradeOfferings = {
  offeringp: 'Primling', offering: 'Primordial Essence', offeringx: 'Primordial X',
} as const;
export type UpgradeOffering = keyof typeof upgradeOfferings;
export interface UpgradeOfferingRule {
  id: string;
  name: string;
  floor: number;
  ceiling: number;
  offering: UpgradeOffering;
  required: boolean;
}
export function isUpgradeOffering(value: unknown): value is UpgradeOffering {
  return typeof value === 'string' && Object.hasOwn(upgradeOfferings, value);
}
export function offeringRule(rules: readonly UpgradeOfferingRule[], name: string, level: number) {
  return rules.find(rule => rule.name === name && rule.floor <= level && level < rule.ceiling);
}
export function offeringOverlap(rules: readonly UpgradeOfferingRule[], next: UpgradeOfferingRule) {
  return rules.find(rule => rule.id !== next.id && rule.name === next.name && rule.floor < next.ceiling && next.floor < rule.ceiling);
}

export function validOfferingRule(value: unknown): value is UpgradeOfferingRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<UpgradeOfferingRule>;
  return typeof rule.id === 'string' && !!rule.id && typeof rule.name === 'string' && !!rule.name &&
    isUpgradeOffering(rule.offering) && typeof rule.required === 'boolean' && validOfferingRange(rule);
}
function validOfferingRange(rule: Partial<UpgradeOfferingRule>): boolean {
  return Number.isSafeInteger(rule.floor) && Number.isSafeInteger(rule.ceiling) &&
    Number(rule.floor) >= 0 && Number(rule.floor) < Number(rule.ceiling) && Number(rule.ceiling) <= 13;
}
export function validOfferingRules(value: unknown): value is UpgradeOfferingRule[] {
  if (!Array.isArray(value) || !value.every(validOfferingRule)) return false;
  return new Set(value.map(rule => rule.id)).size === value.length && !value.some(rule => offeringOverlap(value,rule));
}
