// The movement owner's movers on the character. The follow mover is shared.js's followLeaderIfFar, moved
// here: a member with no target walks to its leader, or under Follows me to the character on Manual, when it
// stands farther than rules.ts FOLLOW_DISTANCE. It answers the core request `movement.followIfFar`, which
// The targeting owner's selection asks on every publish with no target. The mover view is the role runner's
// `moverView`, moved here with the shared.js reads it took from `root.sharedRoutine` (appendix A2 VIEW). The
// movement tick is the role runner's, moved here with `idleMovement`, `frankyMovement`'s call and
// `takeAddon`: one loop the module registers, which runs the movers in the mover table's order.
import type { DoorOutcome, HookRegistry, MoverAnswer } from '../../hooks/registry.ts';
import { coreRegistrations } from '../../hooks/core.ts';
import { ARRIVAL_TOLERANCE, FOLLOW_DISTANCE, followLeavesCurrentEvent, MOVERS, MOVEMENT_TICK_MS, townGoal } from '../rules.ts';
import { ADDON_TIERS, TIERS, type Tier } from '../../protocol/ranks.ts';
import { eventFacts } from '../../events/api.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';

const roleRunner = coreRegistrations.find(r => r.name === 'core:role-runner')!;

interface Spot { map: string; x: number; y: number }
// What shared.js hands the follow: today's reads of its own state, one each.
export interface FollowPorts {
  character(): Spot & { name?: string; moving?: boolean; rip?: boolean };
  // The heartbeat's follow facts: Follows me's character on Manual, and the leader's last reported
  // location (01 design 13.5).
  followMe(): { name?: string; location: Spot | null } | null;
  // The targeting owner's engaged monster, and shared.js's routine once its install ends.
  engagedMonster(): unknown;
  routine(): unknown;
  leaderLocation(): Spot | null;
  // The farm approach's own route, which holds the character.
  approachRouted(): boolean;
  scatter(): boolean;
  // The facts that hold the follow (`walkHeld`): the party Town, a convoy, the group walk, a
  // departure fight and the bank errand's queue flag.
  townActive(): boolean;
  convoyActive(): boolean;
  groupWalking(): boolean;
  departurePending(): boolean;
  bankQueued(): boolean;
  shouldFollowLeader(): boolean;
  // The events owner's active combat event (shared.js `activeCombatEvent`, stand-in S-06) and the game's event
  // name for a map, which the follow's event rule reads (rules.ts `followLeavesCurrentEvent`).
  activeEvent(): { name: string } | null;
  mapEvent(map: string): string | undefined;
  // Movement that belongs to an active kite.
  kiting(): boolean;
  intent(): { cancelled?: boolean; revision: number };
  leader(): string | null;
  following(on: boolean): void;
  // Joining awaits native teleportation (joinEventDestination).
  joinEvent(destination: Spot): Promise<unknown>;
  current(): boolean;
  escaping(): boolean;
  reunionAssigned(): boolean;
  // The walk under the follow request's identity.
  walk(destination: Spot): Promise<unknown>;
  gameLog(message: string, color: string): void;
}

export function createFollow(ports: FollowPorts) {
  // The follow takes the follow-me character's location on Manual, else the leader's.
  const followAt = () => { const me = ports.followMe(); return me ? me.location : ports.leaderLocation(); };
  // A party Town, a party walk, a convoy, a departure fight or a bank errand holds the follow.
  const walkHeld = () => ports.townActive() || ports.convoyActive() || ports.groupWalking() || ports.departurePending() || ports.bankQueued();
  const follow = {
    async followLeaderIfFar(): Promise<boolean> {
      if (ports.approachRouted() || ports.scatter()) return false;
      if (walkHeld() || !ports.shouldFollowLeader() || !followAt()) return false;
      const map = ports.character().map;
      if (followLeavesCurrentEvent(ports.activeEvent(), followAt(), map, ports.mapEvent(map))) return false;
      if (ports.kiting()) return false;
      const character = ports.character();
      if (character.moving) return true;
      const at = followAt()!;
      if (character.map === at.map && Math.hypot(at.x - character.x, at.y - character.y) <= FOLLOW_DISTANCE) return false;
      const revision = Number(ports.intent().revision) || 0, followedName = ports.leader(), destination = { ...at };
      ports.following(true);
      try {
        await ports.joinEvent(destination);
        // The join awaits native teleportation, so the follow reads ownership and the latest
        // leader report again before the walk takes movement.
        const now = followAt();
        if (!ports.current() || ports.character().rip || ports.intent().cancelled && !ports.followMe() || ports.escaping() ||
            (Number(ports.intent().revision) || 0) !== revision || ports.leader() !== followedName ||
            !ports.shouldFollowLeader() || !now || now.map !== destination.map ||
            followLeavesCurrentEvent(ports.activeEvent(), now, ports.character().map, ports.mapEvent(ports.character().map)) ||
            walkHeld() || !ports.reunionAssigned()) return false;
        await ports.walk(now);
        return true;
      } catch (error) {
        const e = error as { reason?: unknown; message?: unknown } | undefined, reason = e && (e.reason || e.message || e);
        // A refused follow (a higher request holds movement) asks again on its next tick.
        if (reason !== 'interrupted' && reason !== 'refused') ports.gameLog('Follow path failed: ' + String(reason), 'red');
        return true;
      } finally {
        ports.following(false);
      }
    },
    // Table A's `follow-step` row: Follows me is the party's walk, so each report steps it, whatever
    // the role loop's combat path does; a member in its own fight finishes it first.
    followMeStep(): void {
      const me = ports.followMe(), character = ports.character();
      if (me && me.name !== character.name && !ports.engagedMonster() && ports.routine())
        follow.followLeaderIfFar()
          .catch(error => ports.gameLog('Follows me step failed: ' + String(error), 'red'));
    },
  };
  return follow;
}
export type Follow = ReturnType<typeof createFollow>;

// The follow's answer joins the role runner's registration, the movers' own; each CODE
// reload publishes its own closure's follow there.
export function publishFollow(follow: Follow, hooks: Pick<HookRegistry, 'publish'>): void {
  const result = hooks.publish({ ...roleRunner, hooks: { 'movement.followIfFar': follow.followLeaderIfFar } });
  if (!result.ok) throw Error(`The movement owner's follow did not load: ${result.message}`);
}

// Movement's own service (owner.ts installPartyMovement): the step and hold an add-on answer
// takes, the step safety the view hands an add-on, and the invariant audit of each tick.
export interface MoverService {
  stepAllows(to: { x: number; y: number }, target?: string): boolean;
  audit(): void;
  holdStep(): void;
  step(to: { x: number; y: number }, mode: string, options: { target?: string; closes?: 'terrain' | 'attackers' }): { sent: Promise<unknown> };
}
// What the mover view reads besides the follow's `character` and `leader`, one read each.
export interface MoverPorts extends FollowPorts {
  service(): MoverService;
  // The game party's names (shared.js `currentPartyList`).
  partyList(): string[];
  // The farm's monster focus.
  focus(): string[];
  // The events owner's joined event, Franky's fight and its adds, and the hunting owner's rare control, saved farm spot and
  // farm area: stand-ins S-06 and S-07, today's reads.
  joinedEvent(): string | null;
  franky(): boolean;
  fightsAdds(event: string): boolean;
  rareControl(): { kind?: string; id?: string; destination?: Spot | null } | null;
  farmSpot(): Spot | null;
  inFarmArea(point: { x: number; y: number }): boolean;
  // The game's globals, which the view hands an add-on so it reads the game only through the view.
  root(): GameGlobals;
  // The movers the tick calls (`MoverRoutine`), which install.ts answers, and its clock.
  movers(): MoverRoutine;
  now(): number;
  // Movement's run scope handle, `act`: the scope holds the
  // tick with the character, and runs a tick due while held once at release.
  scope: ScopeHandle;
}

interface GameGlobals {
  parent: { entities: Record<string, unknown>; socket?: { on?(event: string, listener: (data: Record<string, unknown>) => void): unknown } };
  G: unknown;
  can_move_to(x: number, y: number): boolean;
  can_move(m: unknown): boolean;
  damage_multiplier?(defense: number): number;
  get_combat_dimensions?(e: unknown): number[];
  __partyHooks?: Pick<HookRegistry, 'moving' | 'moverAnswer' | 'before' | 'turns' | 'skills' | 'enabled'>;
  partyCombatPosition?: unknown;
}

// The add-on movers' view of one movement tick (runtime/hooks/view.ts `MoverView`). The role runner
// hands it the tick's target and whether combat is allowed.
export function createMoverView(ports: MoverPorts) {
  return function moverView({ target, combat }: { target?: unknown; combat: boolean }) {
    const game = ports.root(), character = ports.character() as Spot & { base?: unknown };
    return { character, target, entities: game.parent.entities, G: game.G, now: ports.now(), combat,
      party: ports.partyList(), franky: ports.franky(), fightsAdds: ports.fightsAdds('franky'), leader: ports.leader(),
      joinedEvent: ports.joinedEvent(), rareControl: ports.rareControl(), focus: ports.focus(), farmSpot: ports.farmSpot(),
      // The game's terrain checks: a straight walk (can_move_to) and a point a body can stand on (can_move).
      canMoveTo: (to: { x: number; y: number }) => game.can_move_to(to.x, to.y),
      canStand: (to: { x: number; y: number }) => game.can_move({ map: character.map, x: to.x, y: to.y, going_x: to.x, going_y: to.y, base: character.base }),
      stepSafe: (to: { x: number; y: number }, target?: string) => ports.service().stepAllows(to, target),
      inFarmArea: ports.inFarmArea,
      damageMultiplier: game.damage_multiplier, dimensions: game.get_combat_dimensions, socket: game.parent.socket };
  };
}

type Target = { id: string };
// The movers the tick calls: movement's own combat steps, formation, approach, add-on walk and
// convoy triggers (steps.ts, formation.ts, approach.ts, owner.ts, walk-client.ts, built by
// install.ts), and the stand-ins' movers shared.js hands in (S-the hunting owner's rare and farm polls and Cave
// ownership, the survival owner's Cave recovery). A test's movers leave out the ones its row does not reach.
export interface MoverRoutine {
  dungeonOwned?(): boolean;
  resetCombatMovement?(): void;
  defensiveFormationMove?(): boolean;
  pollRareHunting?(): boolean;
  pollFarmingCombatHandoff?(): void;
  groupedMovement?(positions: () => boolean): boolean;
  recoverFarmApproach?(target: Target | null): boolean;
  caveRecoveryMove?(): boolean;
  formationMove?(target: Target): boolean;
  kiteIfNeeded(target: Target): unknown;
  approachCombatTarget(target: Target): unknown;
  addonWalk?(name: string, tier: string, to: unknown, reason?: string): void;
  endAddonWalk?(): void;
  // E02-a: the convoy defence triggers `isOccupied` fired on each read.
  convoyDefenseTriggers?(): void;
}
// What the role runner hands the tick when it starts its timers: its own holds, equipment pass and
// target selection, and its error report. The combat gate is the request table's `skills.allows`, and the
// turns owner arms its own attack edge on `step.sent`.
export interface RunnerTick {
  // The console Pause or Manual holds the character.
  held(): boolean;
  equipment(): void;
  // A selected target that is gone asks the selection again.
  reselect(): void;
  target(): Target | null;
  // The entity refresh for the selected target.
  refresh(): void;
  report(error: unknown): void;
}

export { MOVEMENT_TICK_MS };

// C1's movement actions: an add-on's `walk` or `step` becomes its
// `movement.request` answer at the tier the action names, one of `ADDON_TIERS`, and the movement
// tick weighs it with every mover by that tier, so the planner picks the doors and crossings. Each
// add-on holds one action: a new one settles the last as refused. A step settles on its send. A
// walk settles `sent` when a tick takes it and answers each tick until the character stands within
// ARRIVAL_TOLERANCE of its point. `town` is Main's Town landing, the place a party Town asks for.
interface MoveAction { addon: string; tier: Tier; answer: MoverAnswer; settle(outcome: DoorOutcome): void }
type ActionAsk = { addon: string; reason: string };
export function createMovementActions(game: () => { G: unknown }) {
  const pending = new Map<string, MoveAction>();
  const refused = (reason: string): DoorOutcome => ({ outcome: 'refused', by: 'core:movement', reason });
  const at = (value: unknown) => {
    const p = value as { map?: unknown; x?: unknown; y?: unknown } | null | undefined;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { map: typeof p.map === 'string' ? p.map : undefined, x: Number(p.x), y: Number(p.y) } : undefined;
  };
  function queue(args: Readonly<Record<string, unknown>>, ask: ActionAsk, answer: MoverAnswer | string): Promise<DoorOutcome> {
    const tier = args.tier as Tier;
    if (!ADDON_TIERS.includes(tier)) return Promise.resolve(refused(`tier ${String(args.tier)} is not an add-on tier`));
    if (typeof answer === 'string') return Promise.resolve(refused(answer));
    pending.get(ask.addon)?.settle(refused('replaced'));
    return new Promise(settle => { pending.set(ask.addon, { addon: ask.addon, tier, answer, settle }); });
  }
  return {
    walk(args: Readonly<Record<string, unknown>>, ask: ActionAsk): Promise<DoorOutcome> {
      const maps = (game().G as { maps?: Parameters<typeof townGoal>[0] } | undefined)?.maps ?? {};
      const to = args.to === 'town' ? townGoal(maps, 'main') : at(args.to);
      return queue(args, ask, to?.map ? { kind: 'walk', to: { map: to.map, x: to.x, y: to.y }, reason: ask.reason } : 'a walk names a point on a map, or town');
    },
    step(args: Readonly<Record<string, unknown>>, ask: ActionAsk): Promise<DoorOutcome> {
      const to = at(args.to);
      return queue(args, ask, to ? { kind: 'step', to: { x: to.x, y: to.y }, reason: ask.reason } : 'a step names a point');
    },
    // The highest tier action of an enabled add-on. A walk the character reached ends, settling
    // `sent` if no tick took it yet, and a switched-off add-on's action settles refused. A settled
    // promise ignores a second settle.
    best(character: { map: string; x: number; y: number }, enabled: (name: string) => boolean) {
      let best: MoveAction | undefined;
      for (const action of [...pending.values()]) {
        const to = action.answer.kind === 'walk' ? action.answer.to : undefined;
        if (!enabled(action.addon)) action.settle(refused(`${action.addon} was switched off`));
        else if (!to || to.map !== character.map || Math.hypot(to.x - character.x, to.y - character.y) > ARRIVAL_TOLERANCE) {
          if (!best || TIERS[action.tier].rank > TIERS[best.tier].rank) best = action;
          continue;
        } else action.settle({ outcome: 'sent' });
        pending.delete(action.addon);
      }
      return best ? { registration: best.addon, mover: { name: 'action', tier: best.tier }, answer: best.answer, action: best } : null;
    },
    // The tick took the action: a walk keeps answering, and a step ends with its send.
    taken(action: MoveAction, sent: Promise<unknown> | undefined): void {
      if (!sent) { action.settle({ outcome: 'sent' }); return; }
      pending.delete(action.addon);
      sent.then(reply => action.settle({ outcome: 'sent', reply }), error => action.settle({ outcome: 'failed', error: String((error as { reason?: unknown })?.reason ?? error) }));
    },
    pending: (): boolean => pending.size > 0,
  };
}
export type MovementActions = ReturnType<typeof createMovementActions>;

// One core mover of the mover table: whether it answers on this tick, and its answer, true when it takes the
// tick. `early` marks the and S-07 movers, which run before the runner's target pass, as
// today. A `positions` mover asks the add-on answer itself, through `first`.
interface Tick { dungeon: boolean; target: Target | null }
interface CoreMover { early?: true; applies(tick: Tick): boolean; run(tick: Tick, first: () => boolean): boolean }

export function createMovementTick(ports: Pick<MoverPorts, 'root' | 'service' | 'movers' | 'now' | 'scope'>, view: ReturnType<typeof createMoverView>,
  actions: MovementActions = createMovementActions(ports.root)) {
  const routine = () => ports.movers(), game = () => ports.root();
  return function startMovementTick(runner: RunnerTick): () => void {
    const reset = () => routine().resetCombatMovement?.();
    const outside = (tick: Tick) => !tick.dungeon;
    // With no target, farm-approach-recovery waits only while targeting says a
    // selection is due, so it does not walk in the gap before targeting picks the next target.
    const combat = () => !game().__partyHooks!.skills.allows({ rank: 'damage' });
    const selectionDue = () => !!(game().__partyHooks?.turns?.target(null) as { due?: boolean } | undefined)?.due;
    const approachDue = (tick: Tick) => !tick.dungeon && (!!tick.target || !selectionDue());
    const core: Record<string, CoreMover> = {
      // The mover table's two event rows are the events owner's movers: character/combat.ts answers them.
      ...Object.fromEntries((['event-return-combat', 'franky-approach'] as const).map(name => [name, { early: true, applies: outside,
        run: (_tick: Tick, first: () => boolean) => eventFacts().movers[name]({ reselect: runner.reselect, target: runner.target, combat: combat(), first }) }])),
      // The hunting owner's two farm polls run after the rare check on every tick it does not take.
      'rare-hunting': { early: true, applies: outside, run() {
        if (routine().pollRareHunting?.()) return true;
        routine().pollFarmingCombatHandoff?.(); return false;
      } },
      'grouped-regroup': { applies: outside, run: () => false },
      // The grouped mover's coordinated approach places the character around the party's target, a
      // target formation step, so a formation add-on answers before it.
      'grouped-target-formation': { applies: outside, run: (_tick, first) => !!routine().groupedMovement?.(first) },
      'farm-approach-recovery': { applies: approachDue, run: tick => !!routine().recoverFarmApproach?.(tick.target) },
      'cave-recovery': { applies: tick => tick.dungeon, run: () => !!routine().caveRecoveryMove?.() },
      'idle-formation': { applies: tick => !tick.target, run(tick) {
        if (tick.dungeon || !(combat() && routine().defensiveFormationMove?.())) reset();
        return true;
      } },
      'target-formation': { applies: tick => !!tick.target, run: tick => !!routine().formationMove?.(tick.target!) },
      // The kite and the approach emit collision-checked moves without awaiting arrival, so attacks
      // and support continue while the destination changes.
      'kite-and-approach': { applies: tick => !!tick.target, run(tick) {
        const target = tick.target!;
        Promise.resolve(routine().kiteIfNeeded(target)).then(function (kiting) {
          if (!kiting && runner.target() === target) return routine().approachCombatTarget(target);
        }).catch(runner.report);
        return true;
      } },
    };
    // An add-on answer takes the tick through the movement owner, which judges the step like every
    // combat step (design 2.4, 3.1); the character's combat position names the add-on.
    // An action the tick takes settles through `actions.taken`.
    function takeAddon(best: { registration: string; mover: { tier: string }; answer: MoverAnswer; action?: Parameters<MovementActions['taken']>[0] }): void {
      const name = "addon:" + best.registration, answer = best.answer, movement = ports.service();
      game().partyCombatPosition = { at: ports.now(), mode: name, movementOwner: name, phase: answer.phase, reason: answer.reason,
        ...(answer.kind !== "hold" ? { destination: answer.to } : {}) };
      // A walk ends when the add-on answers anything else.
      if (answer.kind !== "walk") routine().endAddonWalk?.();
      let sent: Promise<unknown> | undefined;
      if (answer.kind === "hold") movement.holdStep();
      else if (answer.kind === "walk") routine().addonWalk?.(name, best.mover.tier, answer.to, answer.reason);
      else (sent = movement.step(answer.to, name, { target: answer.target, closes: answer.closes }).sent).catch(runner.report);
      if (best.action) actions.taken(best.action, sent);
    }
    function movementTick(): void {
      // Design 3.2: the movement owner checks its invariants on every movement tick.
      ports.service().audit();
      if (runner.held()) { reset(); return; }
      routine().convoyDefenseTriggers?.();
      const dungeon = !!routine().dungeonOwned?.();
      if (dungeon && !combat()) { reset(); return; }
      try {
        runner.equipment();
        // An add-on answer runs before the first core mover whose tier ranks below its own (Step 9
        // design "The movers in one list"); the add-on reads the tick through the mover view.
        const hooks = game().__partyHooks!;
        const asked = hooks.moving() ? hooks.moverAnswer(view({ target: runner.target() || undefined, combat: combat() })) : null;
        // A pending action answers beside the add-on movers, the higher tier first.
        const action = actions.pending() ? actions.best(view({ combat: combat() }).character, name => hooks.enabled(name)) : null;
        const addon = action && (!asked || TIERS[action.mover.tier].rank > TIERS[asked.mover.tier].rank) ? action : asked;
        const first = (mover: string) => hooks.before(addon, mover) ? (takeAddon(addon!), true) : false;
        const state: Tick = { dungeon, target: null };
        let selected = false;
        for (const mover of MOVERS) {
          const entry = core[mover.name];
          if (!entry.early && !selected) {
            selected = true;
            runner.reselect();
            state.target = runner.target();
            runner.refresh();
          }
          if (!entry.applies(state)) continue;
          if (mover.positions ? entry.run(state, () => first(mover.name)) : first(mover.name) || entry.run(state, () => false)) return;
        }
      } catch (error) {
        runner.report(error);
      }
    }
    const timer = ports.scope.setInterval(movementTick, MOVEMENT_TICK_MS);
    return () => ports.scope.clearInterval(timer);
  };
}

export function installMovementMovers(ports: MoverPorts, hooks: Pick<HookRegistry, 'publish'>) {
  const follow = createFollow(ports), moverView = createMoverView(ports), actions = createMovementActions(ports.root);
  publishFollow(follow, hooks);
  // C1's action doors, which the character's action dispatcher calls after the common holds;
  // movement/api/character.ts reaches them through `__partyMovementDoors`.
  const doors = { walk: actions.walk, step: actions.step };
  Object.assign(globalThis, { __partyMovementDoors: doors });
  return { ...follow, startMovementTick: createMovementTick(ports, moverView, actions), doors };
}
