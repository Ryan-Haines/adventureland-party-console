import {rememberCharacterAppearance, type AppearanceState} from "./character-appearance.ts";
import { requestObject, type HttpRequest, type HttpResponse } from "../http/contracts.ts";
import { createCombatIngestion, preserveNewerCombat } from "./combat-ingestion.ts";

export interface StatusReport {
  name: string;
  runtime?: string;
  steamPrimary?: boolean;
  seenAt?: number;
}

interface IngestionState<Report extends StatusReport> extends AppearanceState {
  statuses: Record<string, Report | undefined>;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  steamSwitch: { phase?: string } | null;
  nativeOwner: string | null;
  merchantCharacter: string | null;
}

interface IngestionPorts<Report extends StatusReport> {
  now(): number;
  known(name: string): boolean;
  persistRoster(): void;
  catalogs(body: Report): void;
  ponty(body: Report): void;
  bankVaults(body: Report): void;
  bank(body: Report): void;
  oneShots(body: Report): string[];
  merchant(body: Report, previous: Report | undefined): void;
  groupedCombat(): void;
  rareReport(name: string, report: Report): void;
  rareTick(): void;
  bankboi(body: Report): void;
  anniversary(name: string, report: Report): void;
  huntSnapshot(): string;
  huntTick(previous: Report | undefined, name: string): void;
  farmAreaTick(): void;
  persist(): void;
  abtesting(): void;
  scatter(body: Report, learned: string[]): void;
  events(body: Report): void;
  publishMarket(name: string): void;
  convoyStep(): boolean;
  merchantScheduling(body: Report, hadPrevious: boolean): void;
  response(name: string, mode?: "combat"): unknown;
}

/** Orders status consumers explicitly: combat reconciliation precedes passive rare pulls. */
export function createStatusIngestion<Report extends StatusReport>(
  state: IngestionState<Report>,
  ports: IngestionPorts<Report>,
) {
  const channel = createCombatIngestion(state.statuses, ports);
  function nativeOwnership(body: Report): void {
    if (
      body.runtime !== "native" ||
      (state.steamSwitch && state.steamSwitch.phase !== "complete") ||
      state.headlessSlots.includes(body.name)
    )
      return;
    if (!state.steamMembers.includes(body.name)) state.steamMembers.push(body.name);
    if (body.steamPrimary !== false) state.nativeOwner = body.name;
    ports.persistRoster();
  }

  function consume(body: Report): string[] {
    nativeOwnership(body);
    ports.catalogs(body);
    ports.ponty(body);
    ports.bankVaults(body);
    ports.bank(body);
    return ports.oneShots(body);
  }

  function combat(body: Report, previous: Report | undefined, learned: string[]): void {
    ports.groupedCombat();
    ports.rareReport(body.name, state.statuses[body.name]!);
    ports.rareTick();
    ports.bankboi(body);
    ports.anniversary(body.name, state.statuses[body.name]!);
    const before = ports.huntSnapshot();
    ports.huntTick(previous, body.name);
    ports.farmAreaTick();
    if (before !== ports.huntSnapshot()) ports.persist();
    ports.abtesting();
    ports.scatter(body, learned);
    ports.events(body);
  }

  function handle(req: HttpRequest, res: HttpResponse): unknown {
    const raw = requestObject(req.body);
    if (typeof raw.name !== "string" || !ports.known(raw.name))
      return res.status(400).json({ error: "unknown character" });
    if (raw.combatWait === true || raw.combatOnly === true)
      return channel.handle(raw.name, raw, res);
    // Report fields are decoded by their domain consumer; unrecognized fields remain available to the dashboard.
    const body = raw as unknown as Report;
    if (rememberCharacterAppearance(state, body, ports.now())) ports.persistRoster();
    const learned = consume(body);
    const previous = state.statuses[body.name];
    if (body.name === state.merchantCharacter) ports.merchant(body, previous);
    state.statuses[body.name] = { ...preserveNewerCombat(body, previous), seenAt: ports.now() };
    combat(body, previous, learned);
    channel.flush();
    ports.publishMarket(body.name);
    if (ports.convoyStep()) ports.persist();
    ports.merchantScheduling(body, !!previous);
    return res.json(ports.response(body.name));
  }
  return { handle };
}
