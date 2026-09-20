import { requestObject } from "../http/contracts.ts";
import type { OrderChoice, OrderLine } from "./order-types.ts";

function validLevel(choice: OrderChoice, level: number): boolean {
  const max = choice.compoundable ? 7 : choice.upgradeable ? 13 : 0;
  return (
    Number.isSafeInteger(level) && level >= 0 && level <= max && !(level > 0 && !choice.upgradeable)
  );
}
function validQuantity(quantity: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 9999;
}

function normalizeLine(
  raw: unknown,
  choices: OrderChoice[],
  allowLevel: boolean,
): OrderLine | null {
  const line = requestObject(raw),
    quantity = Number(line.quantity);
  const choice = choices.find((entry) => entry.id === line.id);
  if (typeof line.id !== "string" || !choice || !validQuantity(quantity)) return null;
  const level = Number(line.level) || 0;
  if (allowLevel && !validLevel(choice, level)) return null;
  return { id: line.id, quantity, ...(allowLevel && level ? { level } : {}) };
}

export function normalizeOrderLines(
  lines: unknown,
  choices: OrderChoice[],
  allowLevel: boolean,
): OrderLine[] | null {
  if (!Array.isArray(lines) || lines.length > 100) return null;
  const result: OrderLine[] = [];
  for (const raw of lines) {
    const line = normalizeLine(raw, choices, allowLevel);
    if (!line) return null;
    result.push(line);
  }
  return result;
}
