// The role loop (CF3, CF5, C-S1, "TRN-Q37 answer"): one pass on each event that can change a need,
// then, while the spend table lets them go, the Cave revival's tick and the class decisions on the target, or the
// A/B feed. There is no clock: a pass runs on the game's `player`, `entities`, `action` and `hit`
// packets, the character's report timer (`report.sent`, the backstop when every other event is lost),
// a selection change (`targeting.changed`), a hold's end (`journey.ended`, `group.released`,
// `survival.escaped`), and at the game times it computes: a condition's expiry, a spent family's
// cooldown end and the moment a step brings the target or a member into range. An event that arrives
// while a pass runs sets the pending mark, and one more pass follows. Each of those wakes waits for
// the game's next state update (the run scope's cadence, run.ts), and the loop runs at most one pass
// per game update (the executor's `update`): a wake inside an update already passed waits for the
// next one. A reply to this character's own call (`skills.settled`) wakes a pass by the same rule: a family
// sends at most once per update (the executor's `sentIn`), so a second pass inside the update could
// send only another family, and that family's send waits for the next update's pass.
import type { Role, Target } from './role-types.ts';
import type { ClassTurn, TargetAnswer } from './api.ts';
import type { Hold } from './rules.ts';
import type { TurnsScope } from './executor.ts';

type Point = { x: number; y: number };
type Mover = Point & { speed?: number; range?: number; going_x?: number; going_y?: number; moving?: boolean };
interface Socket { on?(event: string, listener: (data: unknown) => void): void; off?(event: string, listener: (data: unknown) => void): void }
export interface LoopPorts {
  // The turns owner's run scope handle, `act`: the pass's timers and the game
  // packets that wake it wait while table P holds the character, and the generation's stop ends them.
  scope: TurnsScope;
  // One executor pass and the spend table read and target answer it ran on.
  pass(): { hold: Hold; target: TargetAnswer | null } | null;
  // The game update the character is on (the executor's `update`). A loop with none runs every wake.
  update?(): number;
  // The role runner's epoch, which a target reset or a death moves.
  epoch(): number;
  // The attack family's edge at a step's in-range time.
  armAttack(at: number): void;
  // The earliest time a spent family is ready again, or null.
  nextReady(): number | null;
  role(): Role;
  turn: ClassTurn;
  // The A/B feed's turn (ab-feed.ts) while the spend table H7 holds.
  feed(): Promise<boolean>;
  // The survival owner's Cave revival tick, at today's place after the pass: true when it acted or holds.
  revival(): Promise<boolean>;
  // The loop's own notices (`skills.held`, `skills.released`, `skills.passed`).
  notify(hook: string, payload: Record<string, unknown>): void;
  report(error: unknown): void;
}

// The first time a walker going from `from` to `to` at `speed` per second comes within `range` of
// `at`, in ms from now, or null when the line never reaches it (CF4: `is_in_range` is the distance
// against the character's range, runner_functions.js:812-824, and a step moves at `speed` on a
// straight line). `slack` is the hitbox part of the game's `distance`, measured at the step's start.
export function inRangeAfter(from: Point, to: Point, speed: number, at: Point, range: number): number | null {
  const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
  const fx = from.x - at.x, fy = from.y - at.y;
  if (Math.hypot(fx, fy) <= range) return 0;
  if (!length || !(speed > 0)) return null;
  const ux = dx / length, uy = dy / length, b = fx * ux + fy * uy, c = fx * fx + fy * fy - range * range, disc = b * b - c;
  if (disc < 0) return null;
  const s = -b - Math.sqrt(disc);
  return s < 0 || s > length ? null : s / speed * 1000;
}

export function createRoleLoop(ports: LoopPorts) {
  const socket = () => (parent as unknown as { socket?: Socket }).socket;
  let active = false, working = false, pending = false, timer: number | null = null, timerAt = Infinity;
  let lastStop: { row: string; source: string } | null = null, lastTarget: TargetAnswer | null = null;
  // The in-range times `stepped` computed and no pass has reached yet. The timer runs the earliest
  // game time, and the pass it wakes arms the next one (`armGameTimes`), so a later in-range time is
  // never dropped for an earlier one.
  const inRange: number[] = [];
  const wake = () => { void tick(); };
  // The update the last pass read. A pass reads one game update, and the game's clock stands still
  // through each 250 ms window while its packets keep coming, so a wake inside an update already
  // passed waits for the next update (`waiting`). The 1 ms timer before the draw lets a host with no
  // draw, whose update is its clock, reach the next millisecond.
  let passedIn: number | null = null, waiting = false;
  const sameUpdate = () => !!ports.update && ports.update() === passedIn;
  function waitForUpdate() {
    if (waiting || !active) return;
    waiting = true;
    ports.scope.setTimeout(() => ports.scope.afterUpdate(() => { waiting = false; wake(); }), 1);
  }
  // A pass at a game time: the earliest one armed holds the timer, as the attack edge does.
  function armAt(at: number) {
    if (!active || !(at < timerAt)) return;
    if (timer !== null) ports.scope.clearTimeout(timer);
    timerAt = at;
    timer = ports.scope.setTimeout(() => { timer = null; timerAt = Infinity; ports.scope.afterUpdate(wake); }, Math.max(1, at - Date.now()));
  }
  // The next game time a need can change: a condition's end (its `ms`, game data) and a spent
  // family's cooldown end.
  function armGameTimes() {
    const conditions = Object.values((character as unknown as { s?: Record<string, { ms?: number } | undefined> }).s ?? {})
      .map(c => Number(c?.ms)).filter(ms => Number.isFinite(ms) && ms > 0);
    const now = Date.now();
    while (inRange.length && inRange[0]! <= now) inRange.shift();
    const at = Math.min(...conditions.map(ms => now + ms), ports.nextReady() ?? Infinity, inRange[0] ?? Infinity);
    if (Number.isFinite(at)) armAt(at);
  }
  // A step's in-range time: kept until a pass reaches it, and armed now when it is the earliest.
  function armInRange(at: number) {
    inRange.push(at); inRange.sort((a, b) => a - b);
    armAt(at);
  }
  // CF4 and C-S1: a step toward the target or a member below the heal line arms a pass, and the
  // attack edge, at the moment the step brings it into range.
  function stepped(payload: Record<string, unknown>) {
    if (payload.character !== character.name) return;
    const to = payload.point as Point | undefined, me = character as unknown as Mover;
    if (!to) return;
    const speed = Number(me.speed) || 0;
    const reach = (target: Target, range: number) => {
      const centre = Math.hypot(target.x - me.x, target.y - me.y);
      const slack = typeof distance === 'function' ? Math.max(0, centre - distance(character, target as never)) : 0;
      return inRangeAfter(me, to, speed, target, range + slack);
    };
    const target = lastTarget?.target;
    if (target) {
      const ms = reach(target, Number(me.range) || 0);
      if (ms !== null) { ports.armAttack(Date.now() + ms); armInRange(Date.now() + ms); }
    }
    if (character.ctype !== 'priest') return;
    const heal = G.skills.heal as unknown as { range?: number } | undefined, range = Number(heal?.range) || Number(me.range) || 0;
    for (const member of ports.turn.facts.members()) {
      const entity = member && member.name !== character.name ? get_player(member.name) as unknown as Target | null : null;
      if (!entity) continue;
      const ms = reach(entity, range);
      if (ms) armInRange(Date.now() + ms);
    }
  }
  async function tick(): Promise<void> {
    if (!active) return;
    if (working) { pending = true; return; }
    if (sameUpdate()) { waitForUpdate(); return; }
    working = true;
    try {
      do {
        pending = false;
        passedIn = ports.update?.() ?? null;
        const epoch = ports.epoch(), read = ports.pass();
        if (!read) break;
        const { hold, target } = read;
        lastTarget = target;
        // The spend table's row in force changed: a hold starts or ends. The row in force is
        // `hold.refusal`, so the narrowing rows count too; live row for these
        // notices is H4, Manual with Combat off, which never sets `hold.stop`.
        const inForce = hold.refusal;
        if (inForce?.row !== lastStop?.row) {
          if (lastStop) ports.notify('skills.released', { row: lastStop.row, source: lastStop.source, by: lastStop.source });
          if (inForce) ports.notify('skills.held', { row: inForce.row, source: inForce.source, by: inForce.source });
          lastStop = inForce;
        }
        if (hold.feed) await ports.feed();
        // The class decisions run on the pass's target only while no target reset or death came during
        // the revival's await, as b9b5c91e's supportTick re-checked `supportAllowed(epoch)`.
        else if (hold.roleLoop && hold.combat && !await ports.revival() && ports.epoch() === epoch && hold.classes && target && !target.passing && target.support)
          await ports.role().beforeAttack(target.target, ports.turn);
        ports.notify('skills.passed', { kind: 'event', by: 'core:turns' });
        armGameTimes();
      } while (pending && active && !sameUpdate());
      if (pending && active) { pending = false; waitForUpdate(); }
    } catch (error) {
      ports.report(error);
    } finally {
      working = false;
    }
  }
  const packets = ['player', 'entities', 'action', 'hit'];
  const mine = (payload: Record<string, unknown>) => !payload.character || payload.character === character.name;
  const own = (payload: Record<string, unknown>) => { if (mine(payload)) ports.scope.afterUpdate(wake); };
  const replied = (payload: Record<string, unknown>) => { if (mine(payload)) void tick(); };
  // A new selection arms the attack edge, as today's `turns.wake()` did, and a pass on the next turn
  // of the event loop, after the selection's own publish settles.
  const selected = (payload: Record<string, unknown>) => { if (mine(payload)) { ports.armAttack(0); armAt(Date.now()); } };
  return {
    tick,
    // The notices the loop hears, which the install's registration answers.
    listeners: { 'report.sent': own, 'targeting.changed': selected, 'journey.ended': own, 'group.released': own, 'survival.escaped': own, 'step.sent': stepped,
      'skills.settled': replied },
    start() {
      if (active) return;
      active = true;
      for (const event of packets) ports.scope.on(socket(), event, wake);
    },
    stop() {
      active = false;
      if (timer !== null) ports.scope.clearTimeout(timer);
      timer = null; timerAt = Infinity; inRange.length = 0;
      // The stop ends the scope's timers, so a wait for the next update ends with it.
      passedIn = null; waiting = false;
      for (const event of packets) ports.scope.off(socket(), event, wake);
    },
  };
}
