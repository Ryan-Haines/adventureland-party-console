import type { Item } from './item';
import type { PartyState } from './party-state';
import { automaticCommerceRuleKey } from './automatic-commerce-rule-key';

export function AutoStandBanner({item,rules}: {item:Item;rules:PartyState['autoStandMarks']}) {
  const rule = rules?.[automaticCommerceRuleKey(item)];
  return rule ? <span title={`Auto stand · ${rule.price.toLocaleString()}g`} className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-amber-700 bg-amber-950 px-1 text-center text-[9px] leading-tight text-amber-200">Auto<br />stand</span> : null;
}
