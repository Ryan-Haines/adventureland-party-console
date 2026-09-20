import {
  isRequestObject,
  requestObject,
  requestText,
  type HttpRequest,
  type HttpResponse,
} from "./contracts.ts";
import { createFocusSelection, type FocusState } from "../navigation/focus.ts";

interface FocusRoutePorts {
  owned(name: string): unknown;
  members(): string[];
  invalidate(names: string[], reason: string, shared: boolean): void;
  persist(): void;
}
function validFocus(focus: unknown): focus is string[] {
  return (
    Array.isArray(focus) &&
    focus.length <= 256 &&
    focus.every(
      (entry) => entry !== "tinyp" && typeof entry === "string" && /^[a-z0-9_]+$/i.test(entry),
    )
  );
}
function validPriority([id, value]: [string, unknown]): boolean {
  const number = Number(value);
  return /^[a-z0-9_]+$/i.test(id) && Number.isFinite(number) && number >= 0 && number <= 1000;
}
function validPriorities(value: unknown): boolean {
  return (
    value === undefined || (isRequestObject(value) && Object.entries(value).every(validPriority))
  );
}
function validRadius(value: unknown): boolean {
  return (
    value === undefined ||
    (Number.isFinite(Number(value)) && Number(value) >= 1 && Number(value) <= 10000)
  );
}

export function createFocusRoute(state: FocusState, ports: FocusRoutePorts) {
  const selection = createFocusSelection(state, {
    members: () => ports.members(),
    invalidate: (...args) => ports.invalidate(...args),
  });
  function result(
    name: string | null,
    focus: string[],
    priorities: Record<string, number>,
  ): unknown {
    return {
      ok: true,
      character: name,
      monsterFocus: focus,
      monsterPriorities: name ? state.monsterPrioritiesByCharacter[name] || {} : priorities,
      monsterSearchRadius: name ? Number(state.monsterSearchRadiusByCharacter[name]) || 400 : 400,
    };
  }
  return function focus(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      focus = body.monsterFocus,
      priorities = body.monsterPriorities,
      radius = body.monsterSearchRadius;
    if (!validFocus(focus)) return res.status(400).json({ error: "invalid monster focus" });
    if (!validPriorities(priorities))
      return res.status(400).json({ error: "invalid monster priorities" });
    if (!validRadius(radius))
      return res.status(400).json({ error: "monster search radius must be between 1 and 10000" });
    const name = body.character ? requestText(body.character) : null;
    if (name && !ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    const normalized = focus.includes("all") ? ["all"] : [...new Set(focus)];
    const normalizedPriorities = Object.fromEntries(
      Object.entries(requestObject(priorities)).map(([id, value]) => [
        id,
        Math.round(Number(value)),
      ]),
    );
    selection.select(
      name,
      normalized,
      priorities === undefined ? undefined : normalizedPriorities,
      radius,
    );
    ports.persist();
    return res.json(result(name, normalized, normalizedPriorities));
  };
}
