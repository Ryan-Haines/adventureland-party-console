import type {PartyState} from './party-state';
import type {Item} from './item';
import {automaticCommerceRuleKey} from './automatic-commerce-rule-key';
import {itemActionBanner} from './item-action-banner';
import {upgradeRuleTiers} from './upgrade-rule-tiers';

export type BankItemRules = Pick<PartyState,'merchantCharacter'|'merchantRules'|'autoItemMarks'|'autoNpcSales'|'autoStandMarks'|'autoUpgradeMarks'|'autoCompounds'|'autoDeconstruction'|'autoExchanges'>;

export function BankItemBanner({item,rules,manualNpc=false}: {item:Item;rules:BankItemRules;manualNpc?:boolean}) {
  const level=Number(item.level)||0,key=automaticCommerceRuleKey(item),upgradeKey=`${item.name}@+${level}`;
  const owners = <T,>(maps:Record<string,T>|undefined):T[] => rules.merchantRules
    ? (maps?.[String(rules.merchantCharacter)] ? [maps[String(rules.merchantCharacter)]] : []) : Object.values(maps||{});
  const bank=owners(rules.autoItemMarks).some(marks=> (marks[upgradeKey] || (level===0?marks[item.name]:undefined))==='bank');
  const upgrades=owners(rules.autoUpgradeMarks).map(marks=>marks[upgradeKey]).filter(rule=>!!rule && (typeof rule!=='object'||rule.quantity!==0));
  const tiers=Math.max(0,...upgrades.map(upgradeRuleTiers));
  const compound=owners(rules.autoCompounds).flat().filter(rule=>rule.name===item.name&&rule.quantity!==0&&rule.targetTier>level).sort((a,b)=>b.targetTier-a.targetTier)[0];
  const banner=itemActionBanner([
    manualNpc && {action:'npc',label:'NPC sale'},
    !!rules.autoNpcSales?.[key] && {action:'npc',automatic:true,label:'Auto NPC'},
    owners(rules.autoDeconstruction).some(marks=>!!marks[key]) && {action:'deconstruction',automatic:true,label:'Auto deconstruction'},
    !!rules.autoStandMarks?.[key] && {action:'stand',automatic:true,label:'Auto stand'},
    tiers>0 && {action:'upgrade',automatic:true,label:`Auto upgrade → +${level+tiers}`},
    !!compound && {action:'compound',automatic:true,label:`Auto compound → +${compound.targetTier}`},
    !!rules.autoExchanges?.[`${item.name}@${level}`] && {action:'exchange',automatic:true,label:'Auto exchange'},
    bank && {action:'bank',automatic:true,label:'Auto bank'},
  ],false);
  return banner ? <span title={banner.title || banner.label} className={`pointer-events-none absolute inset-x-0 top-0 z-20 border-b px-1 text-center font-mono text-[9px] leading-tight [overflow-wrap:anywhere] ${banner.colors} ${banner.border}`}>{banner.label}</span> : null;
}
