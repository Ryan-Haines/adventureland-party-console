import { requestObject } from '../http/contracts.ts';
import { autoItemRuleKey, sameMarkedItem } from './item-identity.ts';

interface State {
  merchantCharacter: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  autoUpgradeMarks: Record<string, Record<string, unknown> | undefined>;
}
/** Persist the original target before production, including bank-sourced passes. */
export function rememberUpgradeContinuation(state: State, body: Record<string, unknown>): void {
  const automatic = requestObject(body.automatic), mark = requestObject(automatic.mark);
  if (body.kind !== 'upgrade' || automatic.family !== 'upgrade' || !automatic.mark) return;
  const item = requestObject(mark.item), live = requestObject(body.item), owner = String(state.merchantCharacter);
  const rule = state.autoUpgradeMarks[owner]?.[String(automatic.key)];
  const tiers = Number(typeof rule === 'object' && rule ? requestObject(rule).tiers : rule);
  validateContinuation(mark, item, live, automatic.key, tiers);
  const list = (state.upgrades ||= {})[owner] ||= [];
  const existing = list.findIndex(raw => {
    const entry = requestObject(raw);
    return entry.passId === mark.passId || entry.slot === mark.slot && entry.auto === true &&
      sameMarkedItem(requestObject(entry.item), item);
  });
  const saved = {...mark, auto:true};
  if (existing < 0) list.push(saved);
  else list[existing] = saved;
}
function validateContinuation(mark: Record<string, unknown>, item: Record<string, unknown>, live: Record<string, unknown>, key: unknown, tiers: number): void {
  if (typeof mark.passId !== 'string' || mark.passId.length > 200 || !Number.isInteger(mark.slot) ||
      mark.auto !== true || autoItemRuleKey(item) !== key || tiers !== mark.tiers)
    throw Error('Automatic upgrade continuation changed');
  validateItem(item, live, tiers);
}
function validateItem(item: Record<string, unknown>, live: Record<string, unknown>, tiers: number): void {
  const start = Number(item.level) || 0, level = Number(live.level) || 0;
  if (level < start || level >= start + tiers || !sameMarkedItem({...live,level:start}, {...item,level:start}))
    throw Error('Automatic upgrade continuation item changed');
}
