import {ruleOwner, type SharedScope} from "./shared-rules.ts";
import type { Item, ItemMark } from "../contracts/item.ts";
import { autoItemRuleKey, autoItemRuleMode } from "./item-identity.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

interface State extends SharedScope {
  autoItemMarks?: Record<string, Record<string, unknown> | undefined>;
  marked?: Record<string, ItemMark[] | undefined>;
}

function removeRules(rules: Record<string, unknown>, item: Item): void {
  const key = autoItemRuleKey(item);
  if (rules[key] === "bank") delete rules[key];
  if ((Number(item.level) || 0) === 0 && rules[String(item.name)] === "bank") delete rules[String(item.name)];
}

/** Remove the recipient's rule before making withdrawn stock available to collection. */
export function guardBankWithdrawal(state: State, name: string, item: Item, confirmed: boolean, persist: () => void): CommandOutcome {
  const rules = state.autoItemMarks?.[ruleOwner(state,name)];
  if (!rules || autoItemRuleMode(rules, item) !== "bank") return null;
  if (!confirmed) return { status: 409, body: {
    code: "auto_bank_confirmation_required",
    error: "This item is automatically marked for bank. Allow withdrawal and remove mark?",
  } };
  const key = autoItemRuleKey(item);
  removeRules(rules, item);
  if (state.marked?.[name]) state.marked[name] = state.marked[name].filter(mark =>
    !mark.auto || autoItemRuleKey(mark.item) !== key);
  persist();
  return null;
}
