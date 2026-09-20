import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";

interface Supply {
  item: string;
  min: number;
  max: number;
}
interface Policy {
  hp: Supply;
  mp: Supply;
}
function nonnegative(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}
function supply(value: unknown, item: string, min: number, max: number): Supply {
  // Preserve null/false/zero coercion in existing saved-policy requests.
  const object = requestObject(value);
  return {
    item,
    min: nonnegative(Number(value && object.min), min),
    max: nonnegative(Number(value && object.max), max),
  };
}
export function createRestockRoute(
  state: { restockPolicies: Record<string, Policy> },
  ports: { owned(name: unknown): unknown; persist(): void },
) {
  return function restock(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      name = body.character;
    if (!ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const policy = { hp: supply(body.hp, "hpot1", 5, 20), mp: supply(body.mp, "mpot1", 0, 0) };
    if (policy.hp.min > policy.hp.max || policy.mp.min > policy.mp.max)
      return res.status(400).json({ error: "minimum cannot exceed maximum" });
    state.restockPolicies[requestText(name)] = policy;
    ports.persist();
    return res.json({ ok: true, policy });
  };
}
