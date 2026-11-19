import type { RosterActor, RosterOwnership } from "./handoff.ts";
import { MAX_LOGGED_IN, OFFLINE_ANSWERS } from '../rules.ts';
import type { RosterRoutesPorts } from "./routes.ts";
import { recordConnections } from './connection-status.ts';
import { fresh } from '../../protocol/reports.ts';
import { lifecycleSavedFields } from '../fields.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { normalizedRealm } from '../../protocol/realm.ts';

interface Status {
  server?: string;
  runtime?: string;
  seenAt?: number;
  banking?: unknown;
  stocking?: unknown;
  upgrading?: unknown;
  actualParty?: string | null;
}

interface OwnershipState {
  steamMembers: RosterOwnership["steam"];
  headlessSlots: RosterOwnership["slots"];
  nativeOwner: RosterOwnership["native"];
  steamSwitch: RosterOwnership["handoff"];
  statuses: Record<string, Status>;
  bankbois: Record<string, unknown>;
  bankboiTransaction: unknown;
  merchantCharacter: string | null;
  activeRealm?: string | null;
  leader: string | null;
  lifecycle: Record<string, string>;
}

interface Member {
  name: string;
  ctype?: string;
  online: boolean;
}
export interface OwnershipPorts<Block> {
  now: () => number;
  // The realm owner's move in flight for this character (`realm.moving`).
  realmMoving?: (name: string) => boolean;
  // The realm a live party switch takes any of these characters to (`realmOperationDestination`).
  switchRealm?: (names: string[]) => string | null;
  id: () => string;
  /** The roster's one commit (createRosterCommit), which the workers' slot writes share. */
  commit: (by: RosterActor) => void;
  notify: (hook: 'roster.changed', payload: Record<string, unknown>) => void;
  owned: (name: string) => { online?: unknown; home?: string } | undefined;
  updateAccount: () => Promise<unknown>;
  /** The account's own next update (caracAL refreshes it on its interval). */
  nextAccount: () => Promise<unknown>;
  /** The coordinator clock's sleep, which ends an offline wait at its bound with no answer. */
  sleep: (ms: number) => Promise<void>;
  stop: (block: Block, reason: string) => Promise<unknown>;
  assignSlot: (slot: number, name: string, by: RosterActor) => unknown;
  roster: () => Member[];
  configuredRealm: string;
  releaseBankboi?: () => Promise<void>;
}

/** The roster's commit: it saves the roster and sends `roster.changed`
 *  once when the Steam members or the slots differ from the last notice, naming who committed it.
 *  The coordinator builds one, so a whole-list write, an in-place write and a worker's slot write
 *  each send it once. */
export function createRosterCommit(state: Pick<OwnershipState, 'steamMembers' | 'headlessSlots'>,
  ports: { save(): void; notify(hook: 'roster.changed', payload: Record<string, unknown>): void }): (by: RosterActor) => void {
  const lists = () => JSON.stringify([state.steamMembers, state.headlessSlots]);
  let noticed = lists();
  return (by) => {
    ports.save();
    if (lists() === noticed) return;
    noticed = lists();
    ports.notify('roster.changed', { steam: state.steamMembers?.slice(), slots: state.headlessSlots.slice(), by });
  };
}

/** Accessors keep ownership changes attached to the coordinator's persisted state. */
export function coordinatorOwnership(state: OwnershipState): RosterOwnership {
  return {
    get steam() {
      return state.steamMembers;
    },
    set steam(value) {
      state.steamMembers = value;
    },
    get slots() {
      return state.headlessSlots;
    },
    set slots(value) {
      state.headlessSlots = value;
    },
    get native() {
      return state.nativeOwner;
    },
    set native(value) {
      state.nativeOwner = value;
    },
    get handoff() {
      return state.steamSwitch;
    },
    set handoff(value) {
      state.steamSwitch = value;
    },
  };
}

function groupLabel(
  group: string | null | undefined,
  primary: string | null | undefined,
  secondary: string | null | undefined,
): string {
  if (!group) return "ungrouped";
  if (group === primary) return "primary";
  return group === secondary ? "secondary" : "other";
}

function groupedRoster(
  state: OwnershipState,
  roster: () => Member[],
): ReturnType<RosterRoutesPorts["members"]> {
  const primary = state.statuses[String(state.leader)]?.actualParty;
  const groups = [
    ...new Set(
      Object.values(state.statuses)
        .map((status) => status.actualParty)
        .filter(Boolean),
    ),
  ].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  const secondary = groups.find((group) => group !== primary);
  return roster()
    .filter((member) => !state.bankbois[member.name])
    .map((member) => ({
      ...member,
      group: groupLabel(state.statuses[member.name]?.actualParty, primary, secondary),
    }));
}

/** The roster observes a character offline (K-S5 `roster.offline`): two account answers in a row
 *  show it offline. The first answer is asked at once and each later one is the account's own next
 *  update, so the wait follows the game's account list with no count. It settles false once a Steam
 *  handoff phase would expire (fields.ts `steamHandoffExpiryMs`), the bound of every phase that asks. */
export async function confirmOffline<Block>(name: string, ports: OwnershipPorts<Block>): Promise<boolean> {
  const bound = lifecycleSavedFields.settings.steamHandoffExpiryMs.default, until = ports.now() + bound;
  let offline = 0;
  for (let answer = ports.updateAccount(); ; answer = ports.nextAccount()) {
    // Each wait races the time left to the bound, so an account API that never answers settles too.
    const answered = await Promise.race([answer.then(() => true), ports.sleep(Math.max(0, until - ports.now())).then(() => false)]);
    if (answered) {
      if (!ports.owned(name)) throw new Error("Character is no longer in the account roster");
      offline = ports.owned(name)!.online ? 0 : offline + 1;
      if (offline >= OFFLINE_ANSWERS) return true;
    }
    if (!answered || ports.now() >= until) {
      boundFired({ bound: 'steamHandoffExpiryMs', owner: '13', subject: name, state: { offline, answered, ms: bound } });
      return false;
    }
  }
}

export function createCoordinatorOwnershipPorts<Block extends { enabled?: boolean }>(
  state: OwnershipState,
  workers: Record<string, Block>,
  ports: OwnershipPorts<Block>,
): RosterRoutesPorts {
  const ready = (name: string, runtime: string) =>
    state.statuses[name]?.runtime === runtime &&
    fresh(state.statuses[name]?.seenAt, ports.now(), 'recent', 0, true);
  const observedRealm = (name: string, since = 0) => {
    const status = state.statuses[name];
    return status?.server && (status.seenAt || 0) > since && fresh(status.seenAt, ports.now(), 'recent', 0, true)
      ? normalizedRealm(status.server) : null;
  };
  // The operation that holds the character's bag for a roster action, as v1.5.0 refused one: a bank
  // trip, a restock or an upgrade. Any other job lets a Steam restore or action go through; the
  // drain keeps its own wider rule (lifecycle.ready).
  const operation = (name: string): string | null => {
    const status = state.statuses[name];
    if (!status || !fresh(status.seenAt, ports.now(), 'recent', 0, true)) return null;
    return status.banking === true ? 'a bank trip' : status.stocking === true ? 'a restock'
      : status.upgrading === true ? 'an upgrade' : null;
  };
  const busy = (name: string) =>
    !!(
      state.bankboiTransaction ||
      operation(name) ||
      // A Steam or roster action waits while the realm owner's move for the merchant is in flight;
      // the move's own window bounds it.
      ports.realmMoving?.(name) === true
    );
  // The roster's one refusal: a BankBoi transaction, or the first of `names` the busy
  // rule holds, named with its operation; a realm move names none.
  const refusal = (names: string[]): string | null => {
    if (state.bankboiTransaction) return "Wait for the bankboi transaction to finish";
    const held = names.find(name => busy(name));
    return held ? `Wait for ${held}: ${operation(held) ?? "the character's active inventory operation"} to finish` : null;
  };
  return {
    now: ports.now,
    id: ports.id,
    save: ports.commit,
    owned: (name) => !!ports.owned(name) && !state.bankbois[name],
    bridgeReady: () => false,
    headlessReady: (name) => ready(name, "headless"),
    codeRunning: (name) => ready(name, "native"),
    busy: refusal,
    prepareSteam: async (name) => {
      if (name === state.merchantCharacter && state.bankboiTransaction && ports.releaseBankboi)
        await ports.releaseBankboi();
    },
    realm: () => state.activeRealm || ports.configuredRealm,
    observedRealm,
    realmContext: () => {
      const primary = String(state.nativeOwner);
      const home = ports.owned(primary)?.home;
      return { current: observedRealm(primary), home: normalizedRealm(home) };
    },
    switchRealm: names => ports.switchRealm?.(names) ?? null,
    bridgeChanged: () => {},
    observationsChanged: entries => recordConnections(state, entries, ports.now()),
    validateParticipants: (names) => {
      if (new Set(names).size !== names.length || names.length > MAX_LOGGED_IN)
        throw new Error("maximum characters logged in");
      const refused = refusal(names);
      if (refused) throw new Error(refused);
    },
    stopHeadless: async (name) => {
      const block = workers[name];
      if (!block) return;
      block.enabled = false;
      state.lifecycle[name] = "stopping";
      await ports.stop(block, "dashboard ownership transfer");
      state.lifecycle[name] = "offline";
    },
    startHeadless: (name, index) => ports.assignSlot(index + 1, name, 'user'),
    confirmOffline: (name) => confirmOffline(name, ports),
    members: () => groupedRoster(state, ports.roster),
  };
}
