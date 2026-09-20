import { requestObject } from "../http/contracts.ts";

const listCatalogs = ["travelPlaces", "bestiaryCatalog", "skillCatalog"] as const;
const consumedFields = [
  "travelPlaces",
  "monsterChoices",
  "monsterLocationsVersion",
  "monsterHunterLocation",
  "bestiaryCatalog",
  "skillCatalog",
  "appearanceChoices",
  "merchantCatalog",
  "merchantCatalogVersion",
] as const;

export interface CatalogState {
  validateCatalog?: ReturnType<typeof import('./catalog-validation.ts').createCatalogValidation>;
  travelPlaces: unknown;
  bestiaryCatalog: unknown;
  skillCatalog: unknown;
  monsterChoices: unknown;
  monsterLocationsVersion?: number;
  monsterHunterLocation: { map: string; x: number; y: number } | null;
  appearanceChoices: unknown;
  merchantCatalog: unknown;
  merchantCatalogVersion: unknown;
  bankVaults: unknown;
}

function acceptHunterLocation(body: Record<string, unknown>, state: CatalogState): void {
  const location = requestObject(body.monsterHunterLocation);
  if (
    location.map !== "main" ||
    !Number.isFinite(Number(location.x)) ||
    !Number.isFinite(Number(location.y))
  )
    return;
  state.monsterHunterLocation = { map: "main", x: Number(location.x), y: Number(location.y) };
}

function acceptObjectCatalogs(body: Record<string, unknown>, state: CatalogState): void {
  if (body.appearanceChoices && typeof body.appearanceChoices === "object")
    state.appearanceChoices = body.appearanceChoices;
  if (body.merchantCatalog && typeof body.merchantCatalog === "object") {
    state.merchantCatalog = body.merchantCatalog;
    state.merchantCatalogVersion =
      body.merchantCatalogVersion || requestObject(body.merchantCatalog).version || null;
  }
}

function rejectInvalidCatalogs(body: Record<string, unknown>, state: CatalogState): void {
  for (const key of ['bestiaryCatalog', 'skillCatalog', 'merchantCatalog'] as const) {
    if (body[key] !== undefined && state.validateCatalog?.(key, body[key], body.clientVersion) === false)
      delete body[key];
  }
}

/** Large discovery catalogs are consumed once rather than retained in each heartbeat. */
export function consumeStatusCatalogs(body: Record<string, unknown>, state: CatalogState): void {
  rejectInvalidCatalogs(body, state);
  for (const key of listCatalogs) {
    const value = body[key];
    if (Array.isArray(value) && value.length) state[key] = value;
  }
  if (Array.isArray(body.monsterChoices) && body.monsterChoices.length) {
    state.monsterChoices = body.monsterChoices;
    state.monsterLocationsVersion = Number(body.monsterLocationsVersion) || 0;
  }
  acceptHunterLocation(body, state);
  acceptObjectCatalogs(body, state);
  for (const key of consumedFields) delete body[key];
}

export function consumeBankVaults(
  body: Record<string, unknown>,
  state: Pick<CatalogState, "bankVaults">,
): void {
  if (Array.isArray(body.bankVaults)) state.bankVaults = body.bankVaults;
  delete body.bankVaults;
}

/** Retains report order and the existing epoch fence when learning scatter candidates. */
export function consumeOneShotReports(
  body: Record<string, unknown>,
  state: { types: string[]; epoch: number },
): string[] {
  const reported =
    Array.isArray(body.oneShotMonsterTypes) && Number(body.oneShotEpoch) === state.epoch
      ? body.oneShotMonsterTypes.filter(
          (value: unknown): value is string =>
            typeof value === "string" && /^[a-z0-9_]+$/i.test(value),
        )
      : [];
  const learned = reported.filter((value) => !state.types.includes(value));
  if (learned.length) state.types.push(...learned);
  delete body.oneShotMonsterTypes;
  delete body.oneShotEpoch;
  return learned;
}
