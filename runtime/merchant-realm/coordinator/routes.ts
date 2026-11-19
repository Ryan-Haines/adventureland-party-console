// The realm owner's routes: the merchant's listing hop and stand return doors, the manual go-home
// command, and the party switch's start and home-complete routes. Each asks the realm owner or the
// switch service; none decides a move. A decision reads the player's setting through `played`,
// so an add-on's overlay plays.
import { played } from '../../settings/api.ts';
import { playerMoved } from '../../events/coordinator/api.ts';
import type { CharacterBlock } from '../../lifecycle/api.ts';
import { requestObject, requestText, type HttpRequest, type HttpResponse } from '../../lifecycle/api.ts';
import { fresh as freshReport } from '../../protocol/reports.ts';
import { merchantKind, type MerchantWork } from '../../merchant-jobs/api.ts';
import { merchantSlotCommand } from '../../merchant-jobs/coordinator/api.ts';
import { normalizedRealm, REALM_HOME_REPLY_MS, realmRefusal, type RealmAnswer } from '../rules.ts';
import type { MerchantRealmOwner } from './owner.ts';
import { recordRealm } from './records.ts';
import { wakeReportWaits } from './report-wait.ts';
import { createCoordinatorRealmSwitch, LIVE_PHASES, observedHome, recordPhase, switchBound, type RealmOperation } from './party-switch.ts';
import { bareRealm } from '../../protocol/realm.ts';

// From runtime/coordinator/http/merchant-realms.ts: the character's doors for a listing hop and
// for the home return before the stand opens. Each asks the realm owner's want.
interface MerchantRealmState {
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  activeRealm: string;
}
interface MerchantRealmPorts {
  now(): number;
  resolve(realm: string): unknown;
  log(message: string, level: string): void;
  realm: Pick<MerchantRealmOwner, 'want' | 'label'>;
}
// A job hops for its listing when its kind says its realm is the listing's (`merchant.kind`).
function matchingRealmJob(current: MerchantWork | null, jobId: unknown): current is MerchantWork {
  return !!current && current.id === jobId && merchantKind(current.reason).realm === 'listing';
}
// A want's refusal as the route answers it: PVP keeps v1.5.0's message, the blacklist
// names the realm, and an order you give for a blacklisted realm asks for your confirmation.
function refusedAnswer(answer: RealmAnswer, realm: string): { status: number; body: Record<string, unknown> } | null {
  if (answer === 'refused:pvp') return { status: 409, body: { error: "automatic PVP realm travel is disabled" } };
  if (answer === 'confirm:blacklisted')
    return { status: 409, body: { error: realm + " is on your realm blacklist", needsConfirmation: true } };
  if (answer.startsWith('refused:')) return { status: 409, body: { error: realm + " is on your realm blacklist" } };
  return null;
}
export function createMerchantRealmRoutes(state: MerchantRealmState, ports: MerchantRealmPorts) {
  function switchRealm(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent,
      merchant = state.merchantCharacter;
    if (!merchant || !matchingRealmJob(current, body.jobId) || body.character !== merchant)
      return res.status(409).json({ error: "ALData marketplace job is no longer current" });
    const realm = typeof body.realm === "string" ? body.realm : "";
    if (!ports.resolve(realm))
      return res.status(400).json({ error: "unknown Adventure Land realm" });
    // The confirmation binds the order you placed: the job carries it, and the hop sends none.
    const answer = ports.realm.want('job:' + current.id, realm, { manual: current.manual === true, confirm: current.realmConfirmed === true,
      acknowledged: stop => res.once('finish', stop) });
    const refused = refusedAnswer(answer, realm);
    if (refused) return res.status(refused.status).json(refused.body);
    if (answer === 'here') return res.json({ ok: true, alreadyThere: true });
    current.phase = "switching realm";
    current.heartbeatAt = ports.now();
    ports.log(
      "Switching " + merchant + " to " + bareRealm(realm) +
        (current.reason === "join giveaway" ? " for giveaway entry" : " for marketplace transaction"),
      "info",
    );
    return res.json({ ok: true, realm });
  }
  function ensureHome(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      merchant = state.merchantCharacter;
    if (!merchant || body.character !== merchant)
      return res.status(409).json({ error: "merchant is no longer configured" });
    const realm = typeof body.realm === "string" ? body.realm : "";
    if (realm !== state.activeRealm || !ports.resolve(realm))
      return res.status(400).json({ error: "invalid merchant home realm" });
    if (ports.realm.want('home', realm, { acknowledged: stop => res.once('finish', stop) }) === 'here')
      return res.json({ ok: true, alreadyThere: true });
    ports.log("Returning " + merchant + " to active realm " + ports.realm.label(realm) + " before opening stand", "info");
    return res.json({ ok: true, realm });
  }
  return { switchRealm, ensureHome };
}

// The manual go-home command: the realm owner writes the merchant's home realm and its travel
// command, and restarts the worker when the realm changes or the worker is offline. Movement's
// manual commands ask it for "go-home".
type HomeCommandState = Parameters<typeof playerMoved>[0] & {
  merchantCharacter: string | null;
  activeRealm: string;
  commands: Record<string, unknown>;
};
interface HomeCommandPorts {
  now(): number;
  nextCommand(): number;
  block(name: string): CharacterBlock;
  realmExists(realm: string): boolean;
  realmLabel(realm: string): string;
  // The worker's stop; it rejects when the worker manager cannot stop the worker.
  restart(block: CharacterBlock): Promise<unknown>;
  log(message: string, level: string): void;
  persist(): void;
}
export function createMerchantHomeCommand(state: HomeCommandState, ports: HomeCommandPorts) {
  return function home(name: string): { status: number; body: Record<string, unknown> } | null {
    if (!state.merchantCharacter || name !== state.merchantCharacter)
      return { status: 409, body: { error: "go home is only available for the configured merchant" } };
    const realm = state.activeRealm,
      block = ports.block(name);
    if (!ports.realmExists(realm)) return { status: 500, body: { error: "merchant home realm is unavailable" } };
    // The realm switch leaves every event map.
    playerMoved(state, [name], null, ports.now());
    const switching = block.realm !== realm;
    block.realm = realm;
    merchantSlotCommand(state, 'realm', {
      id: ports.nextCommand(),
      type: "character-travel",
      location: { map: "main", x: 0, y: 0 },
      label: "home in Main",
    }, name);
    ports.log("Returning " + name + " home to " + ports.realmLabel(realm) + " Main", "info");
    ports.persist();
    // Go home has no arrival window, so a stop that fails is the command's own failure: it logs and
    // reaches the realm record (`realm.move.failed`).
    if (switching || !block.connected) ports.restart(block).catch((error: unknown) => {
      ports.log("Could not restart " + name + " to return home: " + String(error), "error");
      recordRealm({ subject: name, decision: 'failed', owner: 'home', code: 'worker-stop' });
    });
    return null;
  };
}

// From runtime/coordinator/http/realms.ts.
interface RealmRouteState {
  merchantRealmBlacklist?: readonly string[];
  // The job owner's slot writer reads them (merchantSlotCommand).
  merchantCharacter?: string | null;
  merchantCurrent?: { id: string; reason?: string } | null;
  steamMembers: string[];
  realmSwitch: RealmOperation | null;
  bankboiTransaction: unknown;
  statuses: Record<string, { seenAt: number; server?: string; home?: string } | undefined>;
  commands: Record<string, unknown>;
}
interface RealmRoutePorts {
  now(): number;
  resolve(realm: string): unknown;
  bankBusy(): boolean;
  participants(): string[];
  native(): string | null;
  current(): string | null;
  home(): string | null;
  characterHome(name: string): string | null;
  accountCharacters(): string[];
  // The next member report or home confirmation, or `bound` ms (report-wait.ts `nextReport`).
  nextReport(bound: number): Promise<void>;
  persist(): void;
  run(operation: RealmOperation): unknown;
  refresh(): Promise<unknown>;
  label(realm: string): string;
  dispatch(): void;
}

function isCurrentHome(
  operation: RealmOperation | null,
  body: Record<string, unknown>,
): operation is RealmOperation {
  return (
    !!operation &&
    operation.id === body.operationId &&
    operation.phase === "setting-home" &&
    typeof body.character === "string" &&
    !!operation.homeExecutors?.includes(body.character)
  );
}

export function createRealmRoutes(state: RealmRouteState, ports: RealmRoutePorts) {
  function start(
    realm: string,
    setHome: boolean,
    participants: string[],
    res: HttpResponse,
    confirmed: boolean,
  ): unknown {
    const operation: RealmOperation = {
      id: "realm-" + ports.now(),
      phase: "switching",
      realm,
      setHome,
      fromRealm: ports.current(),
      homeRealm: ports.home(),
      participants,
      homeTargets: setHome ? ports.accountCharacters() : undefined,
      characters: participants.map((name) => ({
        name,
        realm: normalizedRealm(state.statuses[name]!.server),
        arrived: normalizedRealm(state.statuses[name]!.server) === realm,
      })),
      startedAt: ports.now(),
      completedAt: null,
      error: null,
      confirmed,
    };
    state.realmSwitch = operation;
    recordPhase(operation);
    ports.persist();
    ports.run(operation);
    return res.status(202).json({ ok: true, operation });
  }
  function checkParticipants(realm: string, setHome: boolean, res: HttpResponse, confirmed: boolean): unknown {
    const participants = ports.participants();
    if (!participants.length)
      return res.status(409).json({ error: "no active characters are assigned" });
    const stale = participants.filter(
      (name) => !state.statuses[name] || !freshReport(state.statuses[name]!.seenAt, ports.now(), 'presence'),
    );
    if (stale.length)
      return res
        .status(409)
        .json({
          error: "every active character must be connected before switching",
          characters: stale,
        });
    if (participants.some((name) => state.steamMembers.includes(name)) && !ports.native())
      return res
        .status(409)
        .json({ error: "the Steam character must be connected before switching" });
    return start(realm, setHome, participants, res, confirmed);
  }
  function switchConflict(): string | null {
    if (state.realmSwitch && LIVE_PHASES.includes(state.realmSwitch.phase))
      return "a realm switch is already in progress";
    if (state.bankboiTransaction || ports.bankBusy())
      return "wait for the current bankboi transaction to finish";
    return null;
  }
  async function switchRealm(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body),
      realm = typeof body.realm === "string" ? body.realm : "";
    if (!ports.resolve(realm))
      return res.status(400).json({ error: "unknown Adventure Land realm" });
    // PVP is refused for every switch; a blacklisted destination asks your confirmation,
    // which binds this one order.
    const refusal = realmRefusal('party-switch', realm, played(state, 'merchantRealmBlacklist') || [], { manual: true, confirm: body.confirm === true });
    if (refusal === 'refused:pvp')
      return res
        .status(409)
        .json({ error: "PVP realm switching is displayed but intentionally disabled" });
    if (refusal) return res.status(409).json({ error: realm + " is on your realm blacklist", needsConfirmation: true });
    const conflict = switchConflict();
    if (conflict) return res.status(409).json({ error: conflict });
    if (body.setHome) {
      try { await ports.refresh(); }
      catch (error) {
        return res.status(502).json({ error: "Could not refresh account home realms: " + requestText(requestObject(error).message || error) });
      }
      // Account I/O yields: another transition may have reserved ownership.
      const refreshedConflict = switchConflict();
      if (refreshedConflict) return res.status(409).json({ error: refreshedConflict });
    }
    return checkParticipants(realm, !!body.setHome, res, body.confirm === true);
  }
  // The first home refusal ends the set home and names the operation's error. The switch's run
  // takes the party back and then fails the operation, so the refusal wakes its wait.
  function fail(operation: RealmOperation, error: string): void {
    operation.error ||= error;
    ports.persist();
    wakeReportWaits();
  }
  async function confirmHome(operation: RealmOperation, name: string, res: HttpResponse): Promise<unknown> {
    try {
      const deadline = ports.now() + REALM_HOME_REPLY_MS;
      let confirmed = false;
      do {
        await ports.refresh();
        confirmed = normalizedRealm(observedHome(state.statuses[name], ports.characterHome(name), operation, ports.now())) === operation.realm;
        if (confirmed) break;
        await ports.nextReport(deadline - ports.now());
      } while (ports.now() < deadline && operation.phase === "setting-home");
      if (!confirmed && operation.phase === "setting-home") switchBound('realmHomeReplyMs', REALM_HOME_REPLY_MS, operation, { name });
      if (!confirmed) throw new Error("Adventure Land did not confirm the new home realm for " + name);
      const entry = operation.characters.find((character) => character.name === name);
      if (!entry) throw new Error("Character is not part of this home change");
      entry.homeConfirmed = true;
      wakeReportWaits();
      ports.persist();
      return res.json({ ok: true, character: name, homeRealm: operation.realm });
    } catch (error) {
      fail(operation, requestText(requestObject(error).message || error));
      return res.status(502).json({ error: operation.error });
    }
  }
  async function homeComplete(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body),
      operation = state.realmSwitch;
    if (!isCurrentHome(operation, body))
      return res.status(409).json({ error: "home realm operation is no longer current" });
    if (operation.characters.some((entry) => entry.name === body.character && entry.homeConfirmed))
      return res.json({ ok: true, character: body.character, homeRealm: operation.realm });
    merchantSlotCommand(state, 'realm', null, requestText(body.character));
    if (!body.success) {
      fail(operation, requestText(body.character) + ": " + requestText(body.error || "Adventure Land rejected the home realm change"));
      return res.json({ ok: false });
    }
    return confirmHome(operation, requestText(body.character), res);
  }
  return { switchRealm, homeComplete };
}

// From runtime/coordinator/http/realm-actions.ts.
type RealmActionState = Parameters<typeof createCoordinatorRealmSwitch>[0] &
  Parameters<typeof createRealmRoutes>[0];
type RealmActionPorts = Omit<Parameters<typeof createCoordinatorRealmSwitch>[1], "dispatchMerchant"> &
  Omit<Parameters<typeof createRealmRoutes>[1], "run" | "home" | "characterHome" | "accountCharacters" | "refresh">;

/** Realm HTTP controls dispatch through the same operation service and merchant resumption callback. */
export function createCoordinatorRealmActions(state: RealmActionState, ports: RealmActionPorts) {
  const switching = createCoordinatorRealmSwitch(state, {
    ...ports,
    dispatchMerchant: () => ports.dispatch(),
  });
  return createRealmRoutes(state, { ...ports, run: async (operation) => switching.run(operation),
    home: () => ports.roster.homeRealm(),
    characterHome: (name) => ports.roster.owned(name)?.home || null,
    accountCharacters: () => ports.account.response.characters.map((entry) => entry.name),
    refresh: () => ports.account.updateInfo() });
}
