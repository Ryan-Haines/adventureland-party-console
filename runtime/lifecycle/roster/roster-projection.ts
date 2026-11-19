import { fresh, REALM_VIEW_REPORT_MS } from '../../protocol/reports.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import { MAX_LOGGED_IN } from '../rules.ts';
import { normalizedRealm, realmLabel } from '../../protocol/realm.ts';
export interface AccountCharacter {
  name: string;
  type?: string;
  level?: number;
  id?: string | number;
  online?: unknown;
  home?: string;
  server?: string;
}
interface Account {
  characters: AccountCharacter[];
  servers?: { key: string; players?: unknown }[];
}
interface RosterStatus {
  name: string;
  seenAt: number;
  server?: string;
  ctype?: string;
  home?: string;
}
interface RosterState {
  bankbois: Record<string, unknown>;
  statuses: Record<string, RosterStatus | undefined>;
  headlessSlots: (string | null)[];
  steamMembers: string[];
  nativeOwner: string | null;
  lifecycle: Record<string, string | undefined>;
  activeRealm: string;
  realmSwitch: unknown;
}
function observedServer(
  status: RosterStatus | undefined,
  character: AccountCharacter | undefined,
  present: boolean,
): string | null {
  return status && present && status.server
    ? normalizedRealm(status.server)
    : (character && character.server) || null;
}

/** Project live account and session ownership without retaining an outdated account response. */
export function createRosterProjection(
  state: RosterState,
  account: () => Account,
  now: () => number,
) {
  function owned(name: unknown): AccountCharacter | undefined {
    return account().characters.find((entry) => entry.name === name);
  }
  function roster() {
    return account()
      .characters.filter((entry) => !state.bankbois[entry.name])
      .map((entry) => ({
        name: entry.name,
        ctype: entry.type,
        level: entry.level,
        id: entry.id,
        online: !!entry.online,
        home: characterHome(entry.name),
        server: entry.server || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  function characterHome(name: string): string | null {
    const character = owned(name);
    if (!character) return null;
    const status = state.statuses[name];
    // The game updates connected homes immediately; account DB snapshots lag.
    return status?.name === name && fresh(status.seenAt, now(), 'recent') && status.server && status.home
      ? status.home : character.home || null;
  }
  function homeRealm(): string | null {
    const homes = (account().characters || []).map((entry) =>
      normalizedRealm(characterHome(entry.name)),
    );
    return homes.length && homes[0] && homes.every((home) => home === homes[0]) ? homes[0] : null;
  }
  function headlessSlots() {
    return state.headlessSlots.map((name, index) => ({
      index: index + 1,
      kind: "headless",
      character: name,
      state: name ? state.lifecycle[name] || "offline" : "empty",
    }));
  }
  function slots() {
    const headless = headlessSlots(),
      occupied = headless.filter((slot) => slot.character);
    const steam = state.steamMembers.map((name, index) => ({
      index: name === state.nativeOwner ? 0 : 100 + index,
      kind: "native",
      character: name,
      primary: name === state.nativeOwner,
      state: fresh(state.statuses[name]?.seenAt, now(), "presence", 0, true) ? "online" : "offline",
    }));
    const empty = headless
      .filter((slot) => !slot.character)
      .slice(0, Math.max(0, MAX_LOGGED_IN - steam.length - occupied.length));
    return [...steam, ...occupied.concat(empty).sort((a, b) => a.index - b.index)];
  }
  // The lifecycle owner's presence answer for a member: a slot holds it and reads online.
  function online(name: string): boolean {
    return slots().some((slot) => slot.character === name && slot.state === "online");
  }
  // The lifecycle owner's offline answer for a member (user answer A of 2026-11-16): the slot that holds it reads
  // offline, so a worker that is starting or repairing keeps its member. A member with no slot, such
  // as a browser client, is offline once its reports age past `presence`.
  function offline(name: string): boolean {
    const slot = slots().find((entry) => entry.character === name);
    return slot ? slot.state === "offline" : !fresh(state.statuses[name]?.seenAt, now(), "presence", 0, true);
  }
  function participants(): string[] {
    return Array.from(
      new Set(
        slots()
          .map((slot) => slot.character)
          .filter((name): name is string => !!name && !state.bankbois[name]),
      ),
    );
  }
  // A member counts online in the realm view while its slot reads online: a headless worker from its
  // socket's connect to its disconnect (workers.ts `connected`), a Steam member while its reports
  // keep coming. Its report's server is then its realm. A slot that reads online while the member's
  // reports stopped past the `realm-view` reading (protocol/reports.ts) means a connection that
  // went silent without a disconnect, so the member reads offline and REALM_VIEW_REPORT_MS fires
  // once until its reports come back.
  const silent = new Set<string>();
  function observation(name: string) {
    const status = state.statuses[name],
      character = owned(name);
    const connected = slots().some((slot) => slot.character === name && slot.state === "online");
    const reporting = !!status && fresh(status.seenAt, now(), "realm-view");
    if (connected && !reporting && !silent.has(name)) {
      silent.add(name);
      boundFired({ bound: "REALM_VIEW_REPORT_MS", owner: "13", subject: name, state: { seenAt: status?.seenAt ?? null, ms: REALM_VIEW_REPORT_MS } });
    }
    if (reporting || !connected) silent.delete(name);
    const present = connected && reporting;
    return {
      name,
      ctype: status?.ctype || character?.type || null,
      realm: observedServer(status, character, present),
      online: present,
    };
  }
  function realms() {
    return (account().servers || []).map((realm) => ({
      key: realm.key,
      label: realmLabel(realm.key),
      players: Number(realm.players) || 0,
      // Preserve the legacy regex semantics for account-supplied keys.
      // oxlint-disable-next-line unicorn/prefer-string-starts-ends-with
      pvp: /PVP$/.test(String(realm.key || "")),
    }));
  }
  function control() {
    const observations = participants().map((name) => observation(name));
    const combatRealms = Array.from(
      new Set(
        observations
          .filter((entry) => entry.ctype !== "merchant")
          .map((entry) => entry.realm)
          .filter(Boolean),
      ),
    );
    const merchant = observations.find((entry) => entry.ctype === "merchant") || null;
    return {
      activeRealm: state.activeRealm,
      currentRealm: combatRealms.length === 1 ? combatRealms[0] : null,
      homeRealm: homeRealm(),
      homeCharacters: account().characters.map((character) => ({
        name: character.name,
        home: normalizedRealm(characterHome(character.name)),
      })),
      split: combatRealms.length > 1,
      characters: observations,
      merchantRealm: (merchant && merchant.realm) || null,
      operation: state.realmSwitch,
      realms: realms(),
    };
  }
  /** The account's realms, for the dashboard's giveaway list; none before the account answers. */
  function servers() {
    return account()?.servers || [];
  }
  return { owned, roster, homeRealm, characterHome, slots, online, offline, participants, control, servers };
}
