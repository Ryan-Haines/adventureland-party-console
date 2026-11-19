// The member's group task on the character:
// the heartbeat
// carries the task of the member's group, and every mover on the character reads its kind,
// phase and tier from here. The module keeps the record the heartbeat writes (table A's `task`
// row) and shared.js installs it with `installTaskAssignment` before the movement
// requesters (runtime/movement/character/owner.ts), whose identities take their tier from
// `assignedTier`.

import type { HookRegistry } from '../../hooks/registry.ts';
import { farmWalkHeld, type ReunionMovement } from '../../movement/api/character.ts';

interface Point { map: string; x: number; y: number }
interface AssignedTask { kind: string; owner?: string; tier?: string; phase?: string; apart?: string; apartAt?: Point; reunion?: string }
interface Character { map: string; x: number; y: number; rip?: boolean }
export interface AssignmentPorts {
  character(): Character;
  partyLocation(): Point | null;
  // shared.js's `smart_move`, bound to the movement owner.
  smartMove(destination: unknown, callback: undefined, options: unknown): unknown;
  // The realm's hook registry, which carries movement's `journey.ended` to the apart walk.
  hooks: Pick<HookRegistry, 'publish'>;
}
export function installTaskAssignment(ports: AssignmentPorts) {
  // The member takes its group's live task from every reply, whoever drives its movement (rule
  // 2.3.2): the console's Main load, a maintenance hold and the Cave runtime end the apply after this
  // row. `at` is the reply's arrival, which death recovery compares with the moment it asked.
  let record: { task: AssignedTask | null; at: number } | null = null;
  function receiveTask(state: { task?: AssignedTask | null }) { record = { task: state.task || null, at: Date.now() }; }
  const task = () => record?.task || null;
  function taskKind() { return task()?.kind ?? null; }
  function taskPhase() { return task()?.phase ?? null; }
  // A heartbeat that is lost names no task, so each identity falls back to its own row's tier.
  function assignedTier(fallback: string) { return task()?.tier || fallback; }
  // The party's death recovery holds this member until its farm return walks (combat gating
  // reads it); the event return holds it from its Town leg until the return ends.
  function combatRecoveryHolds() { return taskKind() === "death-recovery" && taskPhase() !== "returning-to-farm"; }
  function eventReturnHolds() { return taskKind() === "event-return"; }
  // `reunion`: the reunion follows the member's group task's `reunion` column, which
  // the heartbeat carries: on its own under an `alone` task, from a command also under a `command`
  // task, and when a left-out member farms alone. A heartbeat that is lost names no
  // task, and movement's 10 s fallback to the saved farm point covers it.
  function reunionAssigned(command?: unknown) {
    const t = task();
    return !t || t.reunion === "alone" || !!command && t.reunion === "command" || t.apart === "farm";
  }
  // The Hunt hand-in holds this character while its group task is the hand-in (1.3 `assignment`):
  // the reader reads the task the last heartbeat stored, so the coordinator sends no flag beside it.
  function huntTurnInPriority() { return taskKind() === "hunt-turn-in"; }
  function apartFromEvent() { return !!task()?.apart; }
  // A member left out of its party's event farms alone, so the party's event does not hold
  // its walk back to the saved spot.
  function apartFarming() { return task()?.apart === "farm"; }
  // A member left out of its group's event never follows the party there. On
  // "wait" it walks to Main, where the party lands after the event, and stands; on "farm" it
  // walks to the saved farm point and farms alone there. Each heartbeat asks again until the
  // walk runs, because a higher request, such as the player's own trip, may hold the member
  // first; the walk's one identity keeps a running walk, and its arrival (`journey.ended`) marks it
  // done. The next task ends it.
  let apartStarted: string | null = null;
  // The apart walk's end: the registry's `publish` registers core:apart-walk at the
  // first install and puts each later install's closure in it.
  const ended = ports.hooks.publish({ name: 'core:apart-walk', folder: 'core', author: 'adventureland-party-console',
    summary: "Marks a left-out member's walk done when movement says it arrived.",
    hooks: { 'journey.ended'(payload) { if (payload.code === "arrived" && current && payload.owner === "apart:" + current.owner) apartStarted = current.owner + "|" + current.apart; } } });
  if (!ended.ok) throw Error(`The groups and tasks owner's core:apart-walk did not load: ${ended.message}`);
  let current: AssignedTask | null = null;
  function followApart(assigned: AssignedTask | null) {
    const key = assigned && assigned.apart ? assigned.owner + "|" + assigned.apart : null, c = ports.character();
    current = assigned && assigned.apart ? assigned : null;
    if (!key) { apartStarted = null; return; }
    if (key === apartStarted || c.rip) return;
    // The walk is the member's own, at its group task's tier, so the party's event walk it was
    // part of gives way to it, as the walk to Main does.
    // An add-on's walk names where its left-out member waits (`member.apart`); else it waits in Main.
    const goal = assigned!.apart === "farm" ? ports.partyLocation() : assigned!.apartAt ?? null;
    if (assigned!.apart === "farm" && !goal) return;
    if (!goal && c.map === "main") { apartStarted = key; return; }
    Promise.resolve(ports.smartMove(goal ? { map: goal.map, x: goal.x, y: goal.y } : "main", undefined,
      { request: { kind: "task-walk", owner: "apart:" + assigned!.owner, tier: "event-attendance" } })).catch(() => {});
  }
  return { receiveTask, memberTask: () => record, task, taskKind, taskPhase, assignedTier, combatRecoveryHolds, eventReturnHolds, reunionAssigned,
    huntTurnInPriority, apartFromEvent, apartFarming, followApart,
    /** The `apart` row: the walk for this reply's task. */
    apartReply: () => followApart(task()) };
}

// The farm reunion: whether a reunion
// runs for this member, toward whom, and when it ends. Movement's crossings walk it (crossings.ts
// `reunionTravel`, under the `task-walk` request owner.ts `reunionRequest` names), and the loop runs
// on the movement owner's scheduler. characters/shared.js installs it with `installFarmReunion`
// before movement's character install, which reads its answers.
// The game objects, the movement service and the reunion token are shared.js's untyped values.
type Value = any;
export interface ReunionPorts {
  now(): number;
  // The runtime root (the token's `__partyReunion` copy and the recovered death) and the game's
  // parent window (its entities and its own copy of the recovered death).
  root: Value;
  parent: Value;
  // The movement owner (`live`, `fresh`, `stop`), its walk state (the intent and the clock offset),
  // and the reunion's movement it publishes (ReunionMovement), installed after this module.
  movement: Value;
  walkState: Value;
  walks(): ReunionMovement;
  character(): Value;
  // True while this runtime is the current one (shared.js `runtimeCurrent`).
  current(): boolean;
  dungeonOwned(): boolean;
  lastDeath(): { at: number } | null;
  deathRecoveryRequest(): { owner: string };
  farmTravel(): Value;
  setCombatTarget(id: string | null): void;
  eventRecovery(): Value;
  partyLocation(): Value;
  partyPositions(): Value[];
  desiredPartyMembers(): string[];
  leader(): string | null;
  attacking(entity: Value): boolean;
  // The items owner's bag facts: the character banks, has a bank run queued, stocks or upgrades.
  bagBusy(): boolean;
  request(path: string, options: Value): Promise<unknown>;
  farmingTravelTarget(command: Value): Value;
  farmingEntryPoint(location: Value): Value;
  inFarmArea(character: Value, location: Value, margin: number): boolean;
  // The farm's search radius (hunting's `farm.radius`).
  farmRadius(): number;
  canMoveTo(x: number, y: number): boolean;
  log(message: string, color: string): void;
}
type Assignment = Pick<ReturnType<typeof installTaskAssignment>, 'taskKind' | 'reunionAssigned' | 'eventReturnHolds'>;

export function installFarmReunion(ports: ReunionPorts, assignment: Assignment) {
  let reunion: Value = ports.root.__partyReunion || null;
  const set = (token: Value) => { reunion = ports.root.__partyReunion = token; };
  // A failed stop stays on the token, which the status report carries (`reunionReport`).
  const stop = (token: Value): Promise<void> => Promise.resolve(ports.movement.stop("smart", undefined, ports.walks().reunionRequest(token)))
    .then(() => undefined, (error: Value) => { token.lastError = "stop failed: " + String(error?.message || error); });
  const recovered = (at: number) => { ports.root.__partyRecoveredDeathAt = ports.parent.__partyRecoveredDeathAt = at; };
  // A reunion does not start over another walk. A live request other than this reunion's own
  // and the death recovery's holds the character at a rank the farm walk does not take over
  // (movement's `farmWalkHeld` over `movement.live()`), in place of b9b5c91e's nine walk flags.
  function walkHeld(): boolean {
    const live = ports.movement.live();
    if (!live || live.owner === ports.deathRecoveryRequest().owner) return false;
    // The event return holds its member in Town under the return's identity (owner.ts
    // `holdForTask`). That standing hold gives way to the walk of the return's own resume command.
    const cycle = reunion?.command?.type === "event-resume-travel" && reunion.command.cycleId;
    if (cycle && !live.journey && live.owner === "event-return:" + cycle) return false;
    return farmWalkHeld(live, reunion ? "reunion:" + reunion.id : "");
  }
  // `reunion` (the group task allows it), the attackers, death, the merchant, the bag's own
  // work (b9b5c91e shared.js:13471), a navigation the player cancelled and another live walk each
  // hold the reunion. The return pauses, not defensive
  // combat, when the party is attacked, so the role loop still heals and fights.
  function reunionBlocked(): boolean {
    if (!assignment.reunionAssigned(!!reunion?.command)) return true;
    if (Object.values(ports.parent.entities || {}).some((enemy: Value) =>
      enemy && enemy.type === "monster" && enemy.visible && !enemy.dead && ports.attacking(enemy))) return true;
    const c = ports.character();
    return !!c.rip || c.ctype === "merchant" || ports.bagBusy() || !!ports.walkState.intent.cancelled || walkHeld();
  }
  // The members to rejoin: fresh, alive, on this realm and inside the saved spot's farm area (the
  // same area test the command path uses), the leader first, then the nearest. A combat handoff
  // (walk.ts `engageWalk`) released the walk when the leader engaged a target inside the area from
  // within the farm's search radius, so the leader may fight from outside the area; the handoff
  // reunion counts a member within that radius of the area.
  function reunionMembers(): Value[] {
    const location = ports.partyLocation();
    if (!location) return [];
    const c = ports.character(), desired = ports.desiredPartyMembers(), leader = ports.leader(), realm = ports.walks().reunionRealm();
    const margin = reunion?.command?.convoyHandoff ? ports.farmRadius() : 0;
    return ports.partyPositions().filter(member => member.name !== c.name && desired.indexOf(member.name) >= 0 &&
      member.ctype !== "merchant" && !member.rip && member.hp > 0 && !member.activeEvent &&
      ports.movement.fresh(Number(member.seenAt), ports.now() + ports.walkState.clockOffset, 'presence', 0, true) &&
      member.server === realm && ports.inFarmArea(member, location, margin))
      .sort((a, b) => Number(b.name === leader) - Number(a.name === leader) ||
        Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
  }
  function beginFarmReunion(command?: Value): void {
    if (ports.dungeonOwned()) return;
    // The event return admits a reunion only from its own `event-resume-travel` (rules.ts
    // `event-return` row, reunion `command`), which returns.ts `dispatch` sends a member whose saved
    // spot is not the leader's. The exit's Town leg still holds that walk through its live request
    // (`walkHeld`).
    if (assignment.taskKind() === "event-return" && !command) return;
    const c = ports.character();
    if (c.ctype === "merchant") return;
    const death = ports.lastDeath();
    if (death) recovered(death.at);
    if (!assignment.reunionAssigned(!!command)) return;
    // A delayed respawn fallback leaves a journey admitted meanwhile alone: the owner's report
    // names its holder. An explicit reunion command keeps its ownership handoff.
    if (!command && farmWalkHeld(ports.movement.live(), ports.deathRecoveryRequest().owner)) return;
    const travel = ports.farmTravel();
    if (travel) travel.cancelled = true;
    set({ id: c.name + "-" + ports.now(), revision: ports.walkState.intent.revision, phase: "waiting", retryAt: 0,
      command: command || null, portAttempted: false });
    ports.setCombatTarget(null);
    ports.walks().reunionStarts();
    void stop(reunion);
  }
  // Steps 7 and 8a: the respawned member's farm or Hunt return. True when the return runs, or
  // another owner already holds the member's movement at a rank the farm walk does not take over
  // (rules.ts `farmWalkHeld`); false when nothing can move it yet, so death recovery asks again.
  function deathRecoveryFarmReturn(): boolean {
    if (!reunion) beginFarmReunion();
    return !!reunion || farmWalkHeld(ports.movement.live(), ports.deathRecoveryRequest().owner);
  }
  function reunionCurrent(token: Value): boolean {
    return ports.current() && reunion === token && !token.cancelled &&
      token.revision === ports.walkState.intent.revision && !ports.walkState.intent.cancelled;
  }
  async function cancelFarmReunion(reason: string): Promise<void> {
    const token = reunion;
    if (!token) return;
    token.cancelled = true; token.phase = "cancelled"; token.lastError = reason;
    if (token.moving) await stop(token);
    ports.walks().reunionEnded(token);
    if (reunion === token) set(null);
  }
  async function farmReunionTick(): Promise<void> {
    const c = ports.character(), walks = ports.walks();
    if (ports.dungeonOwned()) { retire(null); return; }
    // Retire the obsolete routine without stopping the event's newer route. The return's own resume
    // command is that route.
    // A living member under the event return goes back with the return's walks, so its last death
    // starts no reunion once the return ends. A member still dead when the return ends keeps it.
    const death = ports.lastDeath();
    if (assignment.eventReturnHolds() && !reunion?.command) {
      if (death && !c.rip) recovered(death.at);
      retire("Event exit owns movement"); return;
    }
    // Respawn can finish after its promise times out, or before a reloaded runner observes rip.
    // Recover authorized displacement independently.
    const location = ports.partyLocation();
    if (ports.current() && !reunion && location && !reunionBlocked() && (c.map !== location.map || death &&
        death.at > Math.max(ports.root.__partyRecoveredDeathAt || 0, ports.parent.__partyRecoveredDeathAt || 0))) {
      beginFarmReunion();
      if (death) recovered(death.at);
    }
    if (!ports.current() || !reunion) return;
    const token = reunion;
    if (!reunionCurrent(token) || c.rip) return cancelFarmReunion("navigation changed or died");
    if (ports.walks().sharedWalkActivity() === "farm-recovery") return;
    if (reunionBlocked()) {
      token.portAsked = null;
      if (token.moving) { token.moving = false; await stop(token); }
      token.phase = "waiting-for-movement-owner"; return;
    }
    if (token.moving && !reunionMembers().length && !ports.partyLocation()) {
      token.moving = false; token.phase = "waiting-for-party-near-farm";
      await stop(token);
      walks.reunionWait(token); return;
    }
    if (token.handoffPending || walks.reunionCrossing.working && !token.moving) return;
    const handoffTarget = token.command && token.command.convoyHandoff && ports.farmingTravelTarget(token.command);
    if (handoffTarget) {
      token.handoffPending = true;
      try {
        await ports.request("/event-resume-complete", { method: "POST", body: {
          character: c.name, commandId: token.command.id, navigationRevision: token.revision,
          engagedTarget: { id: handoffTarget.id, map: c.map, x: handoffTarget.x, y: handoffTarget.y } } });
        if (!reunionCurrent(token) || reunionBlocked()) return;
        void stop(token);
        ports.setCombatTarget(handoffTarget.id);
        walks.reunionEnded(token); set(null);
        ports.eventRecovery().phase = "complete";
      } catch (error) { walks.reunionWait(token); }
      finally { token.handoffPending = false; }
      return;
    }
    // A full wipe has no survivor to rendezvous with, so the authorized waypoint itself stands in
    // and everyone returns without waiting on each other. Individually dispatched returns own
    // their destination: a leader returning elsewhere cannot rendezvous with them or authorize a
    // shared walk there.
    const independentReturn = token.command && !token.command.convoyHandoff, saved = ports.partyLocation();
    const member = independentReturn
      ? Object.assign({ name: "the saved farming waypoint" }, ports.farmingEntryPoint(token.command.location))
      : reunionMembers()[0] || (saved && Object.assign({ name: "the saved farming waypoint" }, saved));
    if (!member) { token.phase = "waiting-for-party-near-farm"; walks.reunionWait(token); return; }
    const distance = c.map === member.map ? Math.hypot(c.x - member.x, c.y - member.y) : Infinity;
    const commandArrived = !token.command || !!token.command.convoyHandoff || (token.command.location.shapes || token.command.location.allOf
      ? ports.inFarmArea(c, token.command.location, 0) : walks.reunionAt(c, token.command.location));
    if (walks.reunionArrived({ member, distance, arrived: commandArrived, independent: independentReturn }) &&
        (c.in == null || member.in == null || c.in === member.in) && ports.canMoveTo(member.x, member.y)) {
      if (token.moving) { token.moving = false; await stop(token); }
      if (!reunionCurrent(token)) return;
      if (token.command) {
        walks.reunionCrossing.working = true;
        try { await ports.request("/event-resume-complete", { method: "POST", body: {
          character: c.name, commandId: token.command.id, navigationRevision: token.revision } }); }
        catch (error: Value) { token.lastError = String(error.message || error); walks.reunionWait(token); return; }
        finally { walks.reunionCrossing.working = false; }
      }
      token.phase = "complete"; ports.eventRecovery().phase = "complete";
      ports.log("Rejoined farming party near " + member.name, "#51D2E1");
      walks.reunionEnded(token); set(null); return;
    }
    return walks.reunionTravel(token, { member, distance, arrived: commandArrived, independent: independentReturn });
  }
  // The token ends without a stop: a Cave command or an event exit owns movement now.
  function retire(reason: string | null): void {
    if (reunion) { reunion.cancelled = true; reunion.moving = false; if (reason) reunion.lastError = reason; }
    set(null);
  }
  // The loop's run on the movement owner's scheduler: a failed tick records its error and waits for
  // this character's next report (crossings.ts `reunionWait`).
  const reunionLoop = () => farmReunionTick().catch((error: Value) => {
    if (reunion) { reunion.lastError = String(error.reason || error.message || error); ports.walks().reunionWait(reunion); }
  });
  let endLoop: (() => void) | null = null;
  // The lifecycle owner's intake asks this for each command it takes (table I `reunion`): a new command ends the farm
  // reunion, unless it is the reunion's own convoy (a `shared-walk` monster walk while the shared walk
  // runs the farm recovery).
  async function endReunionFor(command: { type?: string; purpose?: string }): Promise<void> {
    const own = ports.root.__partySharedWalking?.activity === 'farm-recovery' && command.type === 'party-monster-travel' &&
      /^shared-walk/.test(command.purpose || '');
    if (reunion && !own) await cancelFarmReunion('new coordinator command');
  }
  return {
    reunionBlocked, reunionMembers, reunionCurrent, beginFarmReunion, deathRecoveryFarmReturn, cancelFarmReunion, farmReunionTick, retireReunion: retire,
    endReunionFor,
    // The running reunion's token, or null, and its line in the status report.
    currentReunion: () => reunion,
    reunionReport: () => reunion && { id: reunion.id, phase: reunion.phase, destination: reunion.destination,
      mage: reunion.mage, retryAt: reunion.retryAt, lastError: reunion.lastError },
    // The escape drops the reunion: its walk home owns the member.
    dropReunion() { if (reunion) reunion.cancelled = true; set(null); },
    // A runtime reload takes over the previous runtime's reunion with a fresh token and stops its walk.
    resumeReunion() {
      if (!reunion) return;
      reunion.cancelled = true;
      set(Object.assign({}, reunion, { cancelled: false, moving: false }));
      void stop(reunion);
    },
    reunionLoop,
    // The lifecycle owner's run part for the loop: the farm reunion is a movement requester, so movement's
    // scheduler drives its loop one run at a time; the generation's stop ends it.
    reunionPart: {
      start(): void { endLoop = ports.movement.every('farm-reunion', reunionLoop); },
      stop(): void { if (endLoop) { endLoop(); endLoop = null; } },
    },
  };
}

// The walk this character runs and the command it last took, for a test's evidence.
export interface CommandEvidencePorts {
  walk(): Value;
  lastCommand(): unknown;
  command(): Value;
  intent(): { revision: number; cancelled?: boolean };
}
export function installCommandEvidence(ports: CommandEvidencePorts) {
  return function convoyState() {
    const w = ports.walk(), c = ports.command(), intent = ports.intent();
    return { convoy: w && { id: w.id, commandId: w.commandId, phase: w.phase, cancelled: !!w.cancelled }, lastCommand: ports.lastCommand(),
    command: c && { id: c.id, type: c.type, phase: c.phase }, revision: intent.revision, cancelled: intent.cancelled };
  };
}

Object.assign(globalThis, { installTaskAssignment, installFarmReunion, installCommandEvidence });
// The assignment door targeting's ports read.
export type TaskAssignment = ReturnType<typeof installTaskAssignment>;
