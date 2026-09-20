import { requestObject, requestText } from "../http/contracts.ts";
import type { CharacterBlock } from "../characters/types.ts";

interface Location {
  map: string;
  x: number;
  y: number;
  [field: string]: unknown;
}
interface Command {
  id: number;
  type: string;
  location?: unknown;
  label?: unknown;
  navigationExempt?: boolean;
}
interface Status {
  seenAt: number;
  map?: string;
  x?: number;
  y?: number;
  joinedEvent?: unknown;
  mapEvent?: unknown;
}
export interface ManualNavigationState {
  merchantCharacter: string | null;
  leader: string | null;
  activeRealm: string;
  statuses: Record<string, Status | undefined>;
  characterLocations: Record<string, unknown>;
  commands: Record<string, Command | undefined>;
}
export interface ManualNavigationPorts {
  now(): number;
  nextCommand(): number;
  queue(names: string[], reason: string): void;
  releaseEscape(): void;
  authorize(names: string[], location: { map?: string; x: number; y: number }): void;
  authorizeRoute(names: string[], location: unknown, shared: boolean): void;
  members(): string[];
  convoy(location: unknown, label: unknown): void;
  invalidate(names: string[], reason: string, shared: boolean): void;
  block(name: string): CharacterBlock;
  realmExists(realm: string): boolean;
  realmLabel(realm: string): string;
  restart(block: CharacterBlock, delay: number): void;
  log(message: string, level: string): void;
  persist(): void;
}
export interface CommandReply {
  status: number;
  body: Record<string, unknown>;
}
/** undefined means another command family owns the request; null means normal acknowledgement. */
export type CommandOutcome = CommandReply | null | undefined;
function error(status: number, message: string): CommandReply {
  return { status, body: { error: message } };
}
function location(value: unknown): Location | null {
  const input = requestObject(value);
  return typeof input.map === "string" &&
    Number.isFinite(Number(input.x)) &&
    Number.isFinite(Number(input.y))
    ? { ...input, map: input.map, x: Number(input.x), y: Number(input.y) }
    : null;
}
export function createManualNavigationCommands(
  state: ManualNavigationState,
  ports: ManualNavigationPorts,
) {
  function travel(body: Record<string, unknown>, name: string): CommandOutcome {
    const destination = location(body.location);
    if (!destination) return undefined;
    if (name !== state.merchantCharacter) ports.releaseEscape();
    ports.authorize([name], destination);
    state.commands[name] = {
      id: ports.nextCommand(),
      type: "character-travel",
      location: state.characterLocations[name],
      label: body.label || "destination",
    };
    ports.persist();
    return null;
  }
  function partyTravel(body: Record<string, unknown>, name: string): CommandOutcome {
    if (name !== state.leader || !location(body.location)) return undefined;
    const status = state.statuses[String(state.leader)];
    if (!status || status.seenAt < ports.now() - 10000)
      return error(409, "an online party leader is required");
    ports.authorizeRoute(ports.members(), body.location, true);
    if (body.resumeAfterEvent === true && ports.members().some(attending))
      return { status: 200, body: { ok: true, deferredUntilEventEnd: true } };
    ports.convoy(body.location, body.label || "selected monster");
    return null;
  }
  function attending(name: string): boolean {
    const status = state.statuses[name];
    return !!status && !!(status.joinedEvent || status.mapEvent);
  }
  function town(name: string): null {
    const shared = name === state.leader;
    ports.invalidate(shared ? ports.members() : [name], "manual Town", shared);
    state.commands[name] = {
      id: ports.nextCommand(),
      type: "character-travel",
      location: { map: "main", x: -174, y: 121 },
      label: "town",
      navigationExempt: true,
    };
    return null;
  }
  function home(name: string): CommandOutcome {
    if (!state.merchantCharacter || name !== state.merchantCharacter)
      return error(409, "go home is only available for the configured merchant");
    const realm = state.activeRealm,
      block = ports.block(name);
    if (!ports.realmExists(realm)) return error(500, "merchant home realm is unavailable");
    const switching = block.realm !== realm;
    block.realm = realm;
    state.commands[name] = {
      id: ports.nextCommand(),
      type: "character-travel",
      location: { map: "main", x: 0, y: 0 },
      label: "home in Main",
    };
    ports.log("Returning " + name + " home to " + ports.realmLabel(realm) + " Main", "info");
    ports.persist();
    if (switching || !block.connected) ports.restart(block, 150);
    return null;
  }
  function leader(name: string): CommandOutcome {
    const status = state.statuses[String(state.leader)];
    if (!state.leader || state.leader === name || !status || status.seenAt < ports.now() - 10000)
      return error(409, "an online different party leader is required");
    ports.authorize([name], { map: status.map, x: Number(status.x), y: Number(status.y) });
    state.commands[name] = { id: ports.nextCommand(), type: "return-leader" };
    return null;
  }
  function handle(body: Record<string, unknown>): CommandOutcome {
    const name = requestText(body.character);
    switch (body.type) {
      case "bank":
        ports.queue(
          [name],
          name === state.merchantCharacter ? "manual bank exchange" : "manual visit",
        );
        return null;
      case "character-travel":
        return travel(body, name);
      case "party-monster-travel":
        return partyTravel(body, name);
      case "town":
        return town(name);
      case "go-home":
        return home(name);
      case "return-leader":
        return leader(name);
      default:
        return undefined;
    }
  }
  return { handle };
}
