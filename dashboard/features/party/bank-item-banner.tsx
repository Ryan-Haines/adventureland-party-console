import { activeRules, ruleMode, type ActiveRule } from '../../../runtime/items/api.ts';
import type {PartyState} from './party-state';
import type {Item} from './item';
import {itemActionBanner} from './item-action-banner';

export type BankItemRules = Pick<PartyState,'merchantCharacter'|'merchantRules'|'autoItemMarks'|'autoNpcSales'|'autoStandMarks'|'autoUpgradeMarks'|'autoCompounds'|'autoDeconstruction'|'autoExchanges'>;

// The bank banner's label for each active item rule.
const BANK_LABELS: Record<ActiveRule['action'], (level: number, rule: ActiveRule) => string> = {
  exchange: () => 'Auto exchange',
  npc: () => 'Auto NPC',
  stand: () => 'Auto stand',
  upgrade: (level, rule) => `Auto upgrade → +${level + (rule.tiers || 0)}`,
  compound: (_, rule) => `Auto compound → +${rule.targetTier}`,
  deconstruction: () => 'Auto deconstruction',
};

// With shared rules the merchant's rules apply; without them every character's rules reach the
// account bank, so the banner reads the items owner's active rules across every character that holds a rule.
export function BankItemBanner({item,rules,manualNpc=false}: {item:Item;rules:BankItemRules;manualNpc?:boolean}) {
  const level=Number(item.level)||0,merchant=String(rules.merchantCharacter);
  const owners=rules.merchantRules ? [merchant] : [...new Set([merchant,...[rules.autoItemMarks,rules.autoUpgradeMarks,rules.autoCompounds,rules.autoDeconstruction]
    .flatMap(maps=>Object.keys(maps||{}))])];
  const bank=owners.some(owner=>ruleMode(rules.autoItemMarks?.[owner]||{},item)==='bank');
  const banner=itemActionBanner([
    manualNpc && {action:'npc',label:'NPC sale'},
    ...activeRules(rules,item,owners).map(rule=>({action:rule.action,automatic:true,label:BANK_LABELS[rule.action](level,rule)})),
    bank && {action:'bank',automatic:true,label:'Auto bank'},
  ],false);
  return banner ? <span title={banner.title || banner.label} className={`pointer-events-none absolute inset-x-0 top-0 z-20 whitespace-normal break-words px-1 text-center text-[9px] leading-tight ${banner.colors}`}>{banner.label}</span> : null;
}
