// The character's Hunt (character/hunt.ts): the quest report the status carries, the Daisy location,
// the Hunt walk's travel facts that targeting's passing column reads, and the acquisition
// diagnostics of the Hunt monster on the way. Targeting's passing.ts `huntTravelTarget` picks the
// monster; this client says why a candidate is refused and logs it. The Hunt walk's planner request
// (`returnPlan`) says whether the walk may cast Town; movement's walk client builds its route
// preparation from it.

import { partyHooks } from '../../hooks/index.ts';
import { scope } from '../../lifecycle/api.ts';

// The game's NPC interaction, which typed-adventureland does not declare.
declare const interact: (name: string) => Promise<unknown>;

// A Hunt walk command as its planner request reads it.
interface HuntWalk { purpose?: string; continuousReturn?: unknown; disableTown?: boolean }
/**
 * A Hunt walk's planner request: the walk back to Daisy (`continuousReturn` 1) may cast Town, and
 * the planner compares the Town route with the walk, unless the command turned Town off; the
 * outbound mission walk walks. A walk that is no Hunt walk has no Hunt request.
 */
export function huntReturnPlan(command: HuntWalk): { town: boolean; compareTown: boolean } | null {
  if (command.continuousReturn === 1) return { town: !command.disableTown, compareTown: !command.disableTown };
  return command.purpose === 'monster-hunt' ? { town: false, compareTown: false } : null;
}

interface Monster { id?: string; mtype?: string; x: number; y: number; map?: string; in?: string; visible?: boolean; dead?: unknown; hp?: number }
// The game's `character.s.monsterhunt`: the quest id, the count left, the time left and the server.
interface GameQuest { id?: unknown; c?: unknown; ms?: unknown; sn?: unknown }
// movement's walk travel record, as far as the Hunt reads it.
interface Travel { id?: unknown; epoch?: unknown; purpose?: string; huntTarget?: string; continuousReturn?: unknown; defensePaused?: unknown }
// The Hunt walk's control (root.__partyHuntTravel), bound to one walk by its id and epoch.
interface Control { id?: unknown; epoch?: unknown; reason?: string; primary?: Monster | null; committed?: Monster[]; defending?: unknown }
// A Hunt walk command as the acquisition log reads it.
export interface HuntCommand { huntTarget?: string; convoyId?: unknown; epoch?: unknown; id?: unknown; navigationRevision?: unknown;
  location?: { map: string; x: number; y: number } | null; huntAcquisitionLogs?: Record<string, { signature: string; repeats: number }> }
export interface HuntClientPorts {
  character(): { name: string; map: string; in?: string; x: number; y: number; rip?: unknown; s?: { monsterhunt?: GameQuest } };
  // The game's NPC lookup, absent on a runner without it.
  findNpc(name: string): { map: string; x: unknown; y: unknown } | null | undefined;
  // movement's walk: its travel record, the Hunt walk's control and whether navigation was
  // cancelled.
  travel(): Travel | null | undefined;
  control(): Control | null | undefined;
  cancelled(): boolean;
  // survival's escape and recovery holds.
  escaping(): boolean;
  escapeOwns(): boolean;
  recoveryHolds(): boolean;
  // targeting's passing column: the walk's attackers, whether a monster is a passing encounter, its
  // key, a passive stop, the deaths it saw, and its target check with the refusal reason.
  attackers(): Monster[];
  keepMoving(target: Monster): boolean;
  passingKey(target: Monster): string;
  passiveStop(target: Monster): boolean;
  deaths(): Monster[];
  allowed(target: Monster, command: HuntCommand, diagnostic: { reason?: string }): boolean;
  // The game's reach checks (in range, a walkable approach point).
  inRange(target: Monster): boolean;
  reachable(target: Monster): boolean;
  // The events owner's event facts and the farm client's search radius.
  eventActive(): boolean;
  eventJoined(): boolean;
  radius(): number;
  // The character's combat event log (shared.js `queueCombatEvent`).
  log(kind: string, message: string, details: Record<string, unknown>, key: string): void;
  // movement's walk to Daisy under the Hunt NPC requester, the coordinator's completion route and the
  // game log.
  npcWalk(location: unknown): Promise<unknown>;
  post(path: string, options: { method: string; body: Record<string, unknown> }): Promise<unknown>;
  gameLog(message: string, color: string): void;
}
// The coordinator's `monster-hunt-interact` command: accept or claim at Daisy.
interface InteractCommand { id?: unknown; cycleId?: unknown; action?: string }

export function installHuntClient(ports: HuntClientPorts) {
  const me = () => ports.character();
  // The character's Monster Hunt quest as the game holds it.
  function status() {
    const hunt = me().s?.monsterhunt;
    if (!hunt) return null;
    return { id: typeof hunt.id === 'string' ? hunt.id : null, count: Number(hunt.c) || 0,
      remainingMs: typeof hunt.ms === 'number' ? hunt.ms : null, server: typeof hunt.sn === 'string' ? hunt.sn : null };
  }
  // Daisy's location from the game, which the coordinator keeps for the map main.
  function hunterLocation() {
    const location = ports.findNpc('monsterhunter');
    return location ? { map: location.map, x: Number(location.x), y: Number(location.y) } : null;
  }
  // The walk is the outbound Hunt walk to the mission's monster.
  function outbound(): boolean {
    const c = ports.travel();
    return !!(c && c.purpose === 'monster-hunt' && c.huntTarget && !c.continuousReturn);
  }
  // The Hunt walk is paused for a defense, on the way out or for a passive setting.
  function defense(): boolean {
    const c = ports.travel(), control = ports.control();
    return !!(c && c.defensePaused && (outbound() || control && control.reason === 'passive-setting'));
  }
  // The Hunt walk's control, while it belongs to the current walk.
  function control(): Control | null {
    const travel = ports.travel(), c = ports.control();
    return travel && c && c.id === travel.id && c.epoch === travel.epoch ? c : null;
  }
  // The outbound Hunt walk meets more than one attacker it may not walk past, or a passive stop.
  function extraAggro(): boolean {
    if (!outbound() || defense()) return false;
    if (ports.cancelled() || ports.escaping() || ports.recoveryHolds()) return false;
    const current = control(), targets = ports.attackers().filter(t => !ports.keepMoving(t)), keys: Record<string, true> = {};
    if (targets.some(t => ports.passiveStop(t))) return true;
    for (const t of targets) keys[ports.passingKey(t)] = true;
    if (current && current.primary && !ports.deaths().some(d => ports.passingKey(d) === ports.passingKey(current.primary!)))
      keys[ports.passingKey(current.primary)] = true;
    return Object.keys(keys).length > 1;
  }
  // One acquisition line per channel each time its candidate or reason changes. A repeat only
  // counts, and the next line carries how often the line before it repeated.
  function log(command: HuntCommand | null | undefined, target: Monster | null | undefined, reason: string,
      details?: Record<string, unknown>, channel?: string): void {
    if (!command || !command.huntTarget) return;
    const key = channel || 'scan', logs = command.huntAcquisitionLogs || (command.huntAcquisitionLogs = {});
    const signature = JSON.stringify([target && target.id, reason]), previous = logs[key], c = me();
    if (previous?.signature === signature) { previous.repeats++; return; }
    logs[key] = { signature, repeats: 0 };
    ports.log('navigation', 'Hunt acquisition: ' + reason, Object.assign({
      previousRepeats: previous?.repeats ?? 0,
      convoyId: command.convoyId, epoch: command.epoch, commandId: command.id, huntTarget: command.huntTarget,
      navigationRevision: command.navigationRevision,
      destination: command.location && { map: command.location.map, x: command.location.x, y: command.location.y },
      position: { map: c.map, in: c.in, x: c.x, y: c.y }, searchRadius: ports.radius(),
      candidate: target && { id: target.id, mtype: target.mtype, x: target.x, y: target.y },
      distance: target ? Math.hypot(target.x - c.x, target.y - c.y) : null,
    }, details || {}), 'hunt-acquisition:' + command.convoyId + ':' + key);
  }
  // Why the character takes no Hunt monster on the way now.
  function pause(): string | null {
    if (me().rip) return 'character dead';
    if (ports.cancelled()) return 'navigation cancelled';
    if (ports.escapeOwns()) return 'escape owns movement';
    if (ports.eventActive() || ports.eventJoined()) return 'event owns movement';
    return null;
  }
  // Why a Hunt monster is refused, or null when the character can take it.
  function rejection(target: Monster, command: HuntCommand): string | null {
    const c = me();
    if (!target.visible) return 'not visible';
    if (target.dead || target.hp !== undefined && !(target.hp > 0)) return 'monster dead';
    if (target.map && target.map !== c.map || target.in !== undefined && target.in !== c.in) return 'different map or instance';
    if (!(Math.hypot(target.x - c.x, target.y - c.y) <= ports.radius())) return 'outside search radius';
    const diagnostic: { reason?: string } = {};
    if (!ports.allowed(target, command, diagnostic)) return diagnostic.reason || 'target ineligible';
    if (ports.inRange(target)) return null;
    return ports.reachable(target) ? null : 'attack position unreachable';
  }
  // The Monster Hunt NPC's accept or claim, reported to the coordinator either way. The interaction
  // asks the call budget's `job` band and waits for the call window while it answers "not now".
  async function interactNpc(command: InteractCommand): Promise<unknown> {
    let result: unknown = null, error: string | null = null;
    try {
      await ports.npcWalk(ports.findNpc("monsterhunter"));
      await partyHooks().calls.wait({ band: 'job', method: 'interact' }, scope('07', 'act'));
      result = await interact("monsterhunt");
    } catch (huntError) {
      const e = huntError as { reason?: unknown; message?: unknown } | null;
      error = String(e && (e.reason || e.message) || huntError);
    }
    await ports.post("/monster-hunt-interact-complete", { method: "POST", body: {
      character: me().name, commandId: command.id, cycleId: command.cycleId,
      action: command.action, success: !error, error: error,
    } });
    if (error) throw new Error(error);
    ports.gameLog(command.action === "claim" ? "Monster Hunt reward claimed" : "Monster Hunt accepted", "#c084fc");
    return result;
  }
  return { status, hunterLocation, outbound, defense, control, extraAggro, log, pause, rejection, interactNpc, returnPlan: huntReturnPlan };
}
