// The movement owner's coordinator commands on the character, moved from characters/shared.js (big check part 9): the
// doors the lifecycle owner's intake (runtime/lifecycle/character/intake.ts, table I) runs for movement's commands, the
// farming walk's travel token, the walk ends other owners ask for (the hunting owner's rare and Cave hand-offs) and
// the walk a retiring runtime releases. Each reads movement's own parts and walk state here; the
// ports are other owners' reads and requests, which shared.js hands in.
import { defendConvoy, nextTownGeneration, showNavigation, type WalkState, type installMovementRequesters } from './owner.ts';
import type { WalkClient } from './walk-client.ts';
import type { WalkFlags } from '../rules.ts';
import type { SharedCommand } from '../../protocol/walk.ts';
import { PATROL_WALK } from '../../hunting/api.ts';

// A coordinator command carries the walk flags its walk keeps (rules.ts cancelEnds reads them).
type Command = Record<string, any> & WalkFlags & { id: number; type: string };
type Walk = NonNullable<WalkClient['groupWalk']['travel']>;
type Request = ReturnType<WalkCommandParts['townRequest']>;
interface Point { map: string; x: number; y: number; in?: unknown }
// The game window's realm fields the commands write, where the walk's records outlive a CODE reload.
interface CommandsHost {
  __partyEventWalkFailure?: { at: number; reason: unknown; convoyId: unknown };
  __partyTravelCombat?: { id: unknown; revision: number } | null;
  __partyLastCommand?: number;
  partyRoleRunner?: { wake(): void; resetTargeting(): void };
}
// Movement's own parts the commands use. install.ts hands them in, and each takes its type from
// the walk client or the requesters that build it.
export type WalkCommandParts = Pick<WalkClient, 'groupWalk' | 'releaseConvoyCruise' | 'endConvoyWalk' | 'cancelEnds' | 'sharedPartyWalk' | 'coordinatedMonsterTravel'>
  & Pick<ReturnType<typeof installMovementRequesters>, 'convoyRequest' | 'claim' | 'walkRequest' | 'townLanded' | 'prepareReturnExit'
    | 'returnWorkflowSuperseded' | 'townCast' | 'townReady' | 'townRequest' | 'manualRequest' | 'followRequest' | 'nextPass' | 'reportOrSilence'> & {
  host: CommandsHost;
  state: WalkState;
  movement: { cancel(reason: string, detail: Record<string, unknown>): Promise<unknown>; stop(kind?: string, ignored?: undefined, request?: unknown): Promise<unknown> };
  cancelFarmApproach(reason: string): void;
  cancelGroupRoute(): void;
  restoreReunionHandlers(): void;
  farmApproach: { route?: unknown };
};
// Other owners' reads and requests.
export interface WalkCommandPorts {
  character(): { name: string; map: string; rip?: boolean };
  current(): boolean;
  escaping(): boolean;
  now(): number;
  smartMove(destination: unknown, callback: undefined, options: { request: Request }): Promise<unknown>;
  gameLog(message: string, color: string): void;
  request(path: string, options: { method: string; body: Record<string, unknown> }): Promise<unknown>;
  // The targeting owner's selection.
  setCombatTarget(id: string | null): void;
  publishSelection(selection: null, clear: boolean): void;
  // The survival owner's respawn while the character is dead.
  respawn(by: string): Promise<unknown>;
  // the merchant jobs owner's runner: a walk after the merchant's fight ends.
  afterCombat<T>(action: () => Promise<T>, label: string): Promise<T>;
  // The events owner's events: the leader's event join, the manual walk's event leave, the event return's phase and
  // convoy, the anniversary's walk command.
  joinEvent(destination: unknown): Promise<unknown>;
  leaveEventForWalk(command: Command, request: Request): Promise<unknown>;
  saveTownPhase(command: Command, phase: string): Promise<unknown>;
  eventConvoyReturn(command: Command): void;
  anniversaryCommand(command: Command): void;
  // The tasks owner's party targets and farm reunion.
  leaderLocation(): Point | null;
  setPartyLocation(location: unknown): void;
  cancelReunion(reason: string): Promise<unknown>;
  retireReunion(token: null): void;
  // The lifecycle owner's intake: the last command and its rollback for the next generation.
  rollback(id: number): void;
  command(): number;
}

export function installWalkCommands(parts: WalkCommandParts, ports: WalkCommandPorts) {
  const { state, groupWalk } = parts;
  // The farming walk's travel token, which a newer walk cancels.
  let farmingTravelToken: { id: number; revision: number; cancelled: boolean; defensiveTravel: boolean } | null = null;
  // Ends the group walk this runtime runs: its route, cruise and leg end and it leaves the walk state.
  function endGroupWalk(walk: Walk): void {
    walk.detachRoute?.();
    parts.endConvoyWalk(walk);
    if (groupWalk.travel === walk) groupWalk.travel = null;
  }
  const stopFor = (request: Request) => Promise.resolve(parts.movement.stop('smart', undefined, request)).catch(() => {});

  // A convoy release whose navigation revision or epoch is stale runs nothing.
  async function releaseEventWalk(command: Command, accept: () => void): Promise<void> {
    if (Number(command.navigationRevision) !== Number(state.intent.revision) || state.intent.cancelled) return;
    const held = groupWalk.travel;
    if (held && (held.id !== command.convoyId || Number(held.epoch) > Number(command.epoch))) return;
    accept();
    if (held) { endGroupWalk(held); await stopFor(parts.convoyRequest(held)); }
    const host = parts.host;
    host.__partyEventWalkFailure = { at: ports.now(), reason: command.reason, convoyId: command.convoyId };
    const travelControl = host.__partyTravelCombat;
    if (travelControl && travelControl.id === command.convoyId && travelControl.revision === Number(command.navigationRevision))
      host.__partyTravelCombat = null;
    host.partyRoleRunner?.wake();
  }
  // A farming walk runs under its travel token, which a newer walk cancels; a stale navigation
  // revision runs nothing.
  async function farmWalk<T>(command: Command, defensive: boolean, runWalk: () => Promise<T>): Promise<T | undefined> {
    if (Number(command.navigationRevision || 0) !== Number(state.intent.revision) || parts.cancelEnds(command, state.intent)) return;
    // The status tick hands the same command in again while the tasks owner's reunion stop is awaited. The
    // repeat runs nothing, so its end leaves the running walk's token in place.
    if (farmingTravelToken?.id === command.id) return;
    const token = { id: command.id, revision: state.intent.revision, cancelled: false, defensiveTravel: defensive };
    farmingTravelToken = token;
    try { return await runWalk(); }
    finally { if (farmingTravelToken === token) farmingTravelToken = null; }
  }
  // An accepted command ends the convoy defence, counts a Town generation and takes over the group walk.
  async function takeOverWalk(command: Command): Promise<void> {
    const host = parts.host, walk = groupWalk.travel;
    if (command.type === 'party-monster-travel') defendConvoy(state, null);
    if (command.type !== 'town-party' && command.purpose !== 'shared-walk-return') nextTownGeneration(state);
    if (!walk || command.type === 'party-monster-travel' && command.convoyId === walk.id && command.id === walk.commandId) return;
    // Assembly to preparation keeps the same convoy's cap. Every other takeover restores normal speed
    // before awaiting the movement stop.
    if (command.type !== 'party-monster-travel' || command.convoyId !== walk.id) parts.releaseConvoyCruise(walk);
    else walk.cruiseHandoff = true;
    walk.freezeRoute?.();
    walk.cancelled = true;
    walk.release?.();
    // A newer coordinator command supersedes the local walk, so the walk releases its own journey
    // (design section 1.4): the coordinator already ranked the replacement walk (section 5.1), and any
    // other command's own request ranks by the rule table.
    try {
      await parts.movement.cancel('Command takeover: ' + command.type + ' / ' + (command.phase || 'start'), {
        code: command.convoyId === walk.id ? 'convoy-phase-change' : 'command-takeover',
        convoyId: walk.id, epoch: walk.epoch, commandId: walk.commandId,
        replacementCommandId: command.id, replacementConvoyId: command.convoyId, by: parts.convoyRequest(walk) });
    } catch { /* Already stopped. */ }
  }
  // The manual walks to a place.
  async function arrive(location: unknown, message: string): Promise<void> {
    await ports.smartMove(location, undefined, { request: parts.manualRequest });
    ports.gameLog(message, '#51D2E1');
  }
  function partyTravel(command: Command): Promise<void> {
    ports.setPartyLocation(command.location);
    return ports.afterCombat(() => arrive(command.location, 'Arrived at party location'), 'party travel');
  }
  async function forceTravel(command: Command): Promise<void> {
    ports.setPartyLocation(command.location);
    state.forceTraveling = true;
    ports.setCombatTarget(null);
    try { await arrive(command.location, 'Force travel arrived at party location'); }
    finally { state.forceTraveling = false; }
  }
  const characterTravel = (command: Command) => arrive(command.location, 'Arrived at ' + (command.label || 'destination'));
  async function returnToLeader(): Promise<void> {
    const leader = ports.leaderLocation();
    if (!leader) throw Error('party leader location is unavailable');
    await ports.joinEvent(leader);
    await arrive(leader, 'Returned to party leader');
  }
  // Town clears the persisted rally point and any walk in flight. The configured monster focus stays,
  // so Find monster must be pressed again to set a new destination.
  async function townParty(command: Command): Promise<void> {
    const host = parts.host, character = ports.character, townPoint = { map: 'main', x: 0, y: 0 };
    ports.setPartyLocation(null);
    state.following = false;
    state.forceTraveling = false;
    ports.setCombatTarget(null);
    state.departing = true;
    state.townTraveling = true;
    const townGeneration = nextTownGeneration(state);
    const owns = () => ports.current() && !ports.escaping() && state.townGeneration === townGeneration;
    const holder = parts.townRequest(command).owner;
    const respawned = async () => {
      if (!character().rip) return;
      await ports.respawn('command-town');
      while (character().rip) await parts.nextPass(holder + ':respawn');
    };
    try {
      // Town is a hard override: its rank 85 claim ends any lower journey before the channel.
      parts.claim(parts.townRequest(command));
      await respawned();
      ports.setCombatTarget(null);
      // Incoming damage can cancel the Town channel, so combat stays suppressed and the channel
      // repeats until the teleport has landed. The cast follows the override's rule (townReady),
      // and a failed Town route tries again on the next report, where the party's positions are new,
      // or once the reports fall silent (requesters' `reportOrSilence`).
      while (owns() && !parts.townLanded(townPoint)) {
        await respawned();
        if (character().map !== 'main') {
          await parts.prepareReturnExit(command, 'town', owns);
          try { await parts.sharedPartyWalk(townPoint, 'town-return', command.cycleId, command, () => state.townGeneration === townGeneration); }
          catch (townRouteError) {
            if (parts.returnWorkflowSuperseded(townRouteError)) throw townRouteError;
            showNavigation(state, String((townRouteError as Error).message || townRouteError));
            await parts.reportOrSilence(holder);
          }
        } else if (parts.townReady()) {
          await ports.saveTownPhase(command, 'main-town');
          try { await parts.townCast(parts.townRequest(command)); } catch { /* The loop casts again. */ }
        }
        await parts.nextPass(holder);
      }
      if (!owns()) return;
      await ports.saveTownPhase(command, 'complete');
      ports.gameLog('Used Town; all navigation waypoints cleared', '#51D2E1');
      await ports.request('/town-complete', { method: 'POST', body: { character: character().name, commandId: command.id, cycleId: command.cycleId } });
    } catch (townError) {
      if (parts.returnWorkflowSuperseded(townError)) return;
      throw townError;
    } finally {
      state.townTraveling = false;
      state.departing = false;
    }
  }
  // A monster walk: a walk the player picked by hand leaves the event first (the events owner's leave), an event
  // return reports its convoy to the events owner, and Franky's protected exit supersedes the boss fight.
  async function monsterTravel(command: SharedCommand): Promise<unknown> {
    await ports.leaveEventForWalk(command, parts.walkRequest(command));
    if (command.purpose === 'event-return') ports.eventConvoyReturn(command);
    ports.anniversaryCommand(command);
    if (command.purpose === 'franky-exit' && command.phase === 'assemble') {
      ports.setPartyLocation(null);
      // The authorized protected exit supersedes voluntary boss combat; waiting for Franky's death
      // here would keep the exit owner from installing.
      ports.setCombatTarget(null);
      ports.publishSelection(null, true);
      parts.host.partyRoleRunner?.resetTargeting();
      return parts.coordinatedMonsterTravel(command);
    }
    if (command.purpose === 'party-travel' && command.phase === 'assemble')
      return ports.afterCombat(() => parts.coordinatedMonsterTravel(command), 'party travel');
    return parts.coordinatedMonsterTravel(command);
  }

  // The hunting owner's rare encounter retires the Phoenix patrol's group walk.
  function endPatrolWalk(): void {
    const prior = groupWalk.travel;
    if (!prior || prior.purpose !== PATROL_WALK) return;
    endGroupWalk(prior);
    state.convoyActive = false;
    void stopFor(parts.convoyRequest(prior));
  }
  // The hunting owner's new rare control takes the farm's movement over (the farm walk and the tasks owner's farm reunion).
  async function takeFarmMovement(): Promise<void> {
    const prior = state.following || farmingTravelToken || parts.farmApproach.route;
    if (farmingTravelToken) farmingTravelToken.cancelled = true;
    state.following = false;
    parts.cancelFarmApproach('rare hunting owns movement');
    await ports.cancelReunion('rare hunting owns movement');
    if (prior && !groupWalk.travel) try { await parts.movement.stop('smart', undefined, parts.followRequest); } catch { /* Already stopped. */ }
  }
  // The hunting owner's Cave command retires the prior walk owner before it rejects that walk's promise, so the
  // walk's asynchronous failure handler cannot stop the new dungeon journey.
  function stopForCave(): Promise<unknown> {
    if (groupWalk.travel) endGroupWalk(groupWalk.travel);
    if (farmingTravelToken) farmingTravelToken.cancelled = true;
    ports.retireReunion(null);
    state.following = false;
    state.convoyActive = false;
    return parts.movement.cancel('Dungeon command changed', { code: 'dungeon-command-changed', by: { kind: 'cave', owner: 'cave:runtime' } });
  }
  // A walk this runtime ran ends with it, and the coordinator may hand its command to the next
  // generation (the lifecycle owner's run part asks this at the stop).
  function releaseWalkAtStop(): void {
    if (state.townTraveling) ports.rollback(ports.command());
    const walk = groupWalk.travel;
    if (!walk) return;
    parts.endConvoyWalk(walk);
    // The coordinator retains convoy commands until arrival, so a newly evaluated shared script may
    // accept this command again after a hot reload.
    const host = parts.host;
    host.__partyLastCommand = Math.min(Number(host.__partyLastCommand) || 0, (Number(walk.commandId) || 1) - 1);
    try {
      parts.movement.cancel('Runtime retired; releasing convoy movement', { code: 'runtime-retired', convoyId: walk.id, commandId: walk.commandId,
        by: parts.convoyRequest(walk) }).catch(() => {});
    } catch { /* Already stopped. */ }
  }

  // The lifecycle owner's run part: the generation's stop ends the group route, restores the reunion's
  // game handlers and releases the walk.
  function stop(): void {
    parts.cancelGroupRoute();
    parts.restoreReunionHandlers();
    releaseWalkAtStop();
  }
  return {
    stop, releaseEventWalk, farmWalk, takeOverWalk, partyTravel, forceTravel, characterTravel, returnToLeader, townParty, monsterTravel,
    endPatrolWalk, takeFarmMovement, stopForCave, releaseWalkAtStop,
    // The farming walk's travel token, which the escape, the reunion and the merchant runner read.
    farmTravel: () => farmingTravelToken,
  };
}
