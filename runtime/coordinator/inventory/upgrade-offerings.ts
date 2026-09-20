import { randomUUID } from 'node:crypto';
import { isUpgradeOffering, offeringOverlap, type UpgradeOfferingRule } from '../../upgrade-offerings.ts';
import { requestObject } from '../http/contracts.ts';
import type { CommandOutcome } from '../navigation/manual-commands.ts';

export interface OfferingRulesState { upgradeOfferingRules?: UpgradeOfferingRule[] }
interface CatalogEntry { id: string; upgradeable?: boolean; meta?: { upgradeable?: boolean; maxLevel?: number } | null }
interface State extends OfferingRulesState { merchantCatalog?: { allItems?: CatalogEntry[] } | null }
export function offeringMaximum(state: State, name: string): number {
  const entry = state.merchantCatalog?.allItems?.find(item => item.id === name);
  return entry?.upgradeable || entry?.meta?.upgradeable ? Number(entry.meta?.maxLevel) || 13 : 0;
}
export function createOfferingCommands(state: State, persist: () => void) {
  return (body: Record<string, unknown>): CommandOutcome => {
    if (body.type !== 'upgrade-offering-rule') return undefined;
    const rules = state.upgradeOfferingRules ||= [];
    const input = requestObject(body.rule), id = ruleId(input);
    const index = rules.findIndex(rule => rule.id === id);
    if (id && index < 0) return {status:404, body:{error:'Upgrade rule no longer exists'}};
    if (body.remove === true) {
      if (index < 0) return {status:400, body:{error:'Select a rule to remove'}};
      rules.splice(index, 1); persist(); return null;
    }
    const error = validate(state, input);
    if (error) return {status:400, body:{error}};
    const next: UpgradeOfferingRule = {id:newRuleId(id), name:String(input.name), floor:Number(input.floor),
      ceiling:Number(input.ceiling), offering:input.offering as UpgradeOfferingRule['offering'], required:input.required === true};
    const overlap = offeringOverlap(rules, next);
    if (overlap) return {status:409, body:{error:`There is already a rule that covers +${overlap.floor} to +${overlap.ceiling}.`}};
    if (index < 0) rules.push(next); else rules[index] = next;
    persist(); return null;
  };
}
function validate(state: State, rule: Record<string, unknown>): string | null {
  if (!isUpgradeOffering(rule.offering) || typeof rule.required !== 'boolean') return 'Choose an offering and availability mode';
  const max = offeringMaximum(state, String(rule.name));
  if (!max || !Number.isSafeInteger(rule.floor) || !Number.isSafeInteger(rule.ceiling)) return 'Choose valid upgrade levels';
  if (Number(rule.floor) < 0 || Number(rule.floor) >= Number(rule.ceiling) || Number(rule.ceiling) > max) return 'Choose valid upgrade levels';
  return null;
}

function ruleId(input: Record<string, unknown>): string { return typeof input.id === 'string' ? input.id : ''; }
function newRuleId(id: string): string { return id || randomUUID(); }
