// Owner 02's rows of the hook table: movement. Only 02's build writes this file;
// runtime/hooks/registry.ts composes every owner's file into one `HOOKS` and one `SLOTS`.
import type { DecisionRow, PlainKind } from './row.ts';
import type { ActionRow, ReadRow } from '../registry.ts';
import type { AddonWalkAnswer, AddonWalkView, CrossingAsk, DispatchContext, HookRow, MemberHold, MemberHoldAsk, DispatchRegistration, RouteAvoidAsk, FormationAsk, WalkFlagsAnswer, WalkFlagsView, FormationAnswer, SlotRow, StepPointAsk, WalkAsk, WalkEndCode } from '../registry.ts';
import type { Rung } from '../../protocol/ladder.ts';
import type { confirmIndependentApproach, independentApproach, independentReadiness } from '../../movement/api/character.ts';
import type { formationRecovery, GameMonster } from '../../movement/api/coordinator.ts';

export const HOOKS = {
  'movement.request': { kind: 'request', side: 'character', part: 'movement (02)', answers: 'many', addonMayAsk: false, bound: "tier: its registration's tier, at most manual",
    fixture: 'e2e/live-movement-hooks.spec.ts#movement.request: holds, steps or walks the character at its add-on tier',
    receives: "the character's view on each role runner movement tick", returns: 'hold, a step to a point, a walk to a point on any map, or nothing' },
  'group.anchor': { kind: 'request', side: 'coordinator', part: 'grouped combat, a movement sub-owner (runtime/coordinator/targeting/queue.ts)', answers: 'one', addonMayAsk: false, bound: 'a member of the group only',
    fixture: 'e2e/live-movement-hooks.spec.ts#group.anchor: the group record asks it with its members in a fight',
    receives: "the group's members and their reports", returns: 'the member the formation centres on, or nothing' },
  // Step 9b. Step safety's monster entries (13.2 item 8): an add-on refuses a combat step that
  // ends inside a zone it keeps, such as a boss's aggro reach.
  'step.safety': { kind: 'request', side: 'character', part: 'movement (02), step safety (3.1)', answers: 'many', addonMayAsk: false, bound: 'refusal only',
    fixture: 'e2e/live-movement-hooks.spec.ts#step.safety: refuses a step that ends inside its zone',
    receives: "the character's view and the step's end point", returns: 'a refusal in plain words, or nothing' },
  'journey.started': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#journey.started: fires when a request is granted, kept, retargeted or resumed',
    receives: 'character, requestId, kind, owner, destination, status', returns: 'nothing' },
  'journey.paused': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#journey.paused: fires when a pause source, a click or a combat step pauses the journey',
    receives: 'character, requestId, by, reason, state', returns: 'nothing' },
  'journey.ended': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#journey.ended: fires once with its end code',
    receives: 'character, requestId, kind, owner, code, by', returns: 'nothing' },
  // Movement's follow: a member with no target walks to its leader, or
  // under Follows me to the character on Manual, when it stands farther than FOLLOW_DISTANCE. 04's
  // selection asks it on every publish with no target and awaits the answer's promise.
  'movement.followIfFar': { kind: 'request', side: 'character', part: 'movement (02)', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'e2e/live-movement-hooks.spec.ts#movement.followIfFar: a member inside the distance does not walk',
    receives: 'character', returns: 'a promise of whether the follow took the tick' },
  // Movement's end of a group walk: the realm switch asks it for each
  // group whose walk carries a member leaving the realm. Its answer is on the coordinator.
  'walks.end': { kind: 'request', side: 'coordinator', part: 'movement (02)', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-movement-hooks.spec.ts#walks.end: ends the group's walk with the asker's code",
    receives: 'a group, an end code and optionally the one member that leaves', returns: 'whether a walk ended' },
  // The walk estimate: a read that starts no walk. The events owner's K2 times a
  // staged event's `due` and the Cipher merchant's walk to the Witch by it.
  'walks.estimate': { kind: 'request', side: 'coordinator', part: 'movement (02)', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-events-hooks.spec.ts#L: Mr. Green becomes due at the walk estimate",
    receives: 'a group, a destination and the reporting member', returns: "the planned time of the group's walk there, else of the member's own walk, or nothing with no route" },
  // Who holds a walk member that is not walking. The walk asks
  // it for each member while it rallies (movement/coordinator/walk.ts `letGo`), and each holder
  // answers for its own holds only: movement the player's manual control, and 01, 05, 06, 08 and 13
  // their own members (E02-01h for the tasks owner's wind-down).
  'member.holder': { kind: 'request', side: 'coordinator', part: 'movement (02), asked by the group walk', answers: 'many', core: true, addonMayAsk: false,
    fixture: 'scripts/tests/convoy-coordinator.test.cjs#a dead member leaves the walk and the party goes on; its revival changes nothing in the walk',
    receives: 'group, member', returns: 'the holds the answerer has on the member: owner, reason, coming, endsOn' },
  // The group walk's four notices. The walk machine
  // fires each at the transition that makes the change (movement/coordinator/walk.ts `formWalk`,
  // `walkPhase`, `completeMembers`, `walkEnds`), and `walks.end` fires `walk.ended` with its own code.
  'walk.formed': { kind: 'notice', side: 'coordinator', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#walk.formed: fires once when a group walk is created',
    receives: 'group, walk, members, tier, purpose, destination', returns: 'nothing' },
  'walk.phase': { kind: 'notice', side: 'coordinator', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#walk.phase: fires on each phase change of the walk',
    receives: 'group, walk, phase, from', returns: 'nothing' },
  'walk.member': { kind: 'notice', side: 'coordinator', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#walk.member: fires when a member completes or leaves the walk',
    receives: "group, walk, member, change ('completed', 'left' or 'rejoined'), code ('died' when the member died on the walk, 'silent' when the console knows it is gone)", returns: 'nothing' },
  'walk.ended': { kind: 'notice', side: 'coordinator', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#walk.ended: fires once with the end code',
    receives: "group, walk, code (`arrived`, `released`, `replaced`, `cancelled`, a `walks.end` code or the T5 code of a failed walk), reason", returns: 'nothing' },
  // Movement's core requests and reads. Each answer is the module's own
  // function: the character's movement owner (movement/character/owner.ts) publishes its `step`,
  // `acceptMagiport`, `live`, `climbing` and its ring's records and incidents into the role
  // runner's registration on each CODE load; `core:movement` answers the walk request, the
  // heartbeat's movement section and the game's monster table on the coordinator
  // (movement/coordinator/runtime.ts); the freshness rule answers in every realm (hooks/core.ts).
  // `walks.estimate` is built by the events owner's V1 and `movement.park` by the lifecycle owner's L-S2.
  'walks.request': { kind: 'request', side: 'coordinator', part: 'movement (02), the group walk', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-movement-hooks.spec.ts#walks.request: starts the group's walk at the asker's tier, and a lower ask is refused",
    receives: 'a group and the walk it asks for: its purpose, destination, members, tier and label', returns: 'whether the walk started, was kept or was retargeted; false when T1 refuses it' },
  'movement.step': { kind: 'request', side: 'character', part: 'movement (02), the combat step (2.4)', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'e2e/live-movement-hooks.spec.ts#movement.step: one step through step safety at the asker\'s turn',
    receives: "the step's point, the mover that asks and its options (target, closes)", returns: 'sent, kept or refused with the reason, and the send' },
  'movement.acceptMagiport': { kind: 'request', side: 'character', part: 'movement (02), the crossings', answers: 'one', core: true, addonMayAsk: false,
    fixture: "scripts/tests/hook-registry.test.cjs#X3: the character's requests and reads are the movement owner's own functions",
    receives: 'the request it ranks as and the mage that offers', returns: "the game's answer, or a refusal" },
  'movement.live': { kind: 'request', side: 'character', part: 'movement (02)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-movement-hooks.spec.ts#movement.live: names who holds movement',
    receives: 'nothing', returns: 'kind, owner, tier, whether a journey runs and whether it is paused, or null' },
  // The lifecycle owner's park: the held reply and the drain ask movement to hold the
  // character where it stands, at the `lifecycle` row, until its drain or hold ends.
  'movement.park': { kind: 'request', side: 'character', part: 'movement (02)', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'e2e/live-lifecycle-hooks.spec.ts#movement.park: the drain parks the warrior where it stands',
    receives: 'the character', returns: 'nothing: a journey pauses and a character moving with no journey stands still' },
  'reports.fresh': { kind: 'request', side: 'both', part: 'movement (02), the report freshness rule (R4, MOV-222)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-movement-hooks.spec.ts#reports.fresh: answers the one freshness rule for a reading',
    receives: 'a stamp, the time and the reading', returns: 'whether the stamp is fresh' },
  'movement.climbing': { kind: 'request', side: 'character', part: 'movement (02), the one climber', answers: 'one', core: true, addonMayAsk: true,
    fixture: "e2e/live-movement-hooks.spec.ts#movement.climbing: names the live climb's rung and try",
    receives: 'nothing', returns: 'the climber, its activity, rung and try, or null' },
  'movement.reply': { kind: 'request', side: 'coordinator', part: 'movement (02), the heartbeat reply (12 table R)', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'scripts/tests/hook-registry.test.cjs#X3 and the R5 correction: core:movement answers the walk request, the reply and the game data on the coordinator',
    receives: "the scope's state and the reply's ports", returns: "movement's fields of the status reply" },
  'movement.records': { kind: 'request', side: 'character', part: 'movement (02), the decision ring (7)', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-movement-hooks.spec.ts#movement.records: answers the character's ring",
    receives: 'nothing', returns: "the ring's records, oldest first" },
  'movement.incidents': { kind: 'request', side: 'character', part: 'movement (02), the decision ring (7)', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-movement-hooks.spec.ts#movement.incidents: answers the character's stuck and caught-error records",
    receives: 'nothing', returns: 'the incidents, oldest first' },
  // The game's monster table on the coordinator:
  // targeting's reflect lists read it here (reflect.ts). Null until the game data
  // loads.
  'movement.gameMonsters': { kind: 'request', side: 'coordinator', part: 'movement (02), the planner\'s game data', answers: 'one', core: true, addonMayAsk: false,
    fixture: "scripts/tests/monster-attack-policy.test.cjs#movement.gameMonsters: the reflect choices read the coordinator's game data",
    receives: 'nothing', returns: "the game's monster table, or null before it loads" },
  // Movement's decisions on the coordinator that targeting's group record reads: the terrain recovery
  // round and the independent approach's capability, readiness and confirmation, which grouped combat
  // asks. core:movement answers the recovery round on the coordinator
  // (movement/coordinator/runtime.ts). The independent approach rules answer in every realm
  // (hooks/core.ts), as the freshness rule does.
  'movement.formationRecovery': { kind: 'request', side: 'coordinator', part: 'movement (02), the terrain recovery round', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-movement-hooks.spec.ts#movement.formationRecovery: answers the group's terrain recovery round",
    receives: "the group's last record, its members, the target, the group key, the time, whether pulls pause, the healer's range and the target's identity", returns: 'the recovery round, or nothing when none runs' },
  'movement.independentApproach': { kind: 'request', side: 'both', part: 'movement (02), the independent approach', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'e2e/live-movement-hooks.spec.ts#movement.independentApproach: answers whether every member approaches on its own',
    receives: 'the members and the time', returns: 'whether every member is available, in one place and reports the capability' },
  'movement.independentReadiness': { kind: 'request', side: 'both', part: 'movement (02), the independent approach', answers: 'one', core: true, addonMayAsk: false,
    fixture: "e2e/live-movement-hooks.spec.ts#movement.independentReadiness: answers each member's readiness report",
    receives: 'the members', returns: "each member's last readiness report by name" },
  'movement.confirmIndependentApproach': { kind: 'request', side: 'both', part: 'movement (02), the independent approach', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'e2e/live-movement-hooks.spec.ts#movement.confirmIndependentApproach: issues and settles the confirmation round',
    receives: "the group's last record, the members, the selection, the target id and the time", returns: 'the confirmation revision, round and whether every member confirmed' },
  // The decision hooks of CF11 and R5 that an add-on answers. `crossing.allows` refuses only; a
  // refused crossing climbs the request's round as any refused crossing does. `step.point` offers a
  // step point that step safety still judges. `ladder.rung` adds rungs to the add-on's own requests only.
  // `route.avoid` (R5, corrected by "Movement check and close" CC3) names whole maps, the only avoid rule
  // the planner has; each answer can only take maps out of a route.
  'route.avoid': { kind: 'request', side: 'coordinator', part: 'movement (02), the planner', answers: 'many', addonMayAsk: false, bound: 'refusal only: it takes maps out of a route',
    fixture: 'e2e/live-movement-hooks.spec.ts#route.avoid: the planner asks it for every route it plans',
    receives: "the route's start and end points", returns: 'the maps the route must not cross, or nothing' },
  'crossing.allows': { kind: 'request', side: 'character', part: 'movement (02), the crossings', answers: 'many', addonMayAsk: false, bound: 'refusal only',
    fixture: 'e2e/live-movement-hooks.spec.ts#crossing.allows: refuses a crossing in plain words, and the crossing ends refused',
    receives: "the character, the crossing and the request it ranks as", returns: 'a refusal in plain words, or nothing; it cannot allow' },
  'step.point': { kind: 'request', side: 'character', part: 'movement (02), the combat step (2.4)', answers: 'one', addonMayAsk: false, bound: 'a point step safety still judges',
    fixture: "e2e/live-movement-hooks.spec.ts#step.point: offers this character's step point, which step safety judges",
    receives: "the character, the mover, its point and target", returns: 'a point for the step, or nothing' },
  // The formation routine (hook-coverage-2 R4): the solver asks the entry a character picked in the
  // `formation` slot for its point. The solver's collision check, step safety, the formation tier
  // and the call budget still run on the answer, so an add-on only picks among safe points.
  'formation.routine': { kind: 'request', side: 'character', part: 'movement (02), the formation solver', answers: 'slot', addonMayAsk: false,
    bound: "only for a character whose formation pick is the add-on's entry and whose class the entry lists; a point the solver's collision check refuses runs the solver's best; a hold ends with the formation's own hold rules",
    fixture: "scripts/tests/hook-registry.test.cjs#R4: formation.routine answers only for the characters that picked its entry and whose class it lists",
    receives: "the character and its class, the formation's target, healer and desired range, the members' positions, the solver's candidate points with their danger, coverage and range scores, and the combat mode",
    returns: "a point, a hold, or nothing for the solver's best" },
  // R5's walk hooks: each add-on answers for its own task's group walk only (purpose `addon:<name>`).
  // `walk.request` names the walk on each walk step, `walk.departs` holds its departure (the
  // walk's progress tests still end a hold that makes no progress), and `safe.goal` names the point
  // its walk restarts from.
  'walk.request': { kind: 'request', side: 'coordinator', part: 'movement (02), the group walk', answers: 'many', addonMayAsk: false,
    bound: "its own task's walk, at the task's tier; handsCombat lets that walk hand combat over to farming on the way, the defence pause stays core, and it sets no other walk flag",
    fixture: "scripts/tests/hook-registry.test.cjs#R5: an add-on names its own task's group walk, holds its departure and names its safe point",
    receives: "the group, its live add-on task and the task's walk", returns: "a destination (with a label, members and handsCombat), 'end', or nothing" },
  'walk.departs': { kind: 'request', side: 'coordinator', part: 'movement (02), the group walk (T4)', answers: 'many', addonMayAsk: false, bound: "its own task's walk; T4's progress tests end a hold",
    fixture: "scripts/tests/hook-registry.test.cjs#R5: an add-on names its own task's group walk, holds its departure and names its safe point",
    receives: 'the group, its walk, phase and members', returns: 'true to hold the departure, or nothing' },
  // P3: every add-on may answer for every group walk's departure, defence pause and combat handoff,
  // core walks included. The walk asks once when it forms; the escape's walk is not asked.
  'walk.flags': { kind: 'request', side: 'coordinator', part: 'movement (02), the group walk (T4)', answers: 'many', addonMayAsk: false,
    bound: "hold ends under T4's progress tests; go still waits for the member's fight; walk-on still ends at an escape or a death recovery; it sets no rank-table flag; several answers merge the safer way: hold beats go, pause beats walk-on, no handoff beats a handoff",
    fixture: "scripts/tests/hook-registry.test.cjs#P3: an add-on lets the Hunt walk leave its chests and walk on through a defence",
    receives: "the group and its walk: purpose, phase and the departure, defence pause and combat handoff core gave it",
    returns: "depart 'hold' or 'go', defence 'pause' or 'walk-on', handsCombat, or nothing" },
  // P8: a core walk asks every add-on for its safe point too; an add-on's own walk asks only its add-on.
  'safe.goal': { kind: 'request', side: 'coordinator', part: 'movement (02), the one climber (T2)', answers: 'many', addonMayAsk: false,
    bound: "an add-on's own walk asks its add-on only; a core walk takes the first point in load order; a point names a map and finite x and y, and the ladder moves on when the planner cannot reach it; the escape's walk is not asked",
    fixture: "scripts/tests/hook-registry.test.cjs#P8: a core walk's safe point moves to the add-on's point",
    receives: "the group, its walk and the walk's purpose", returns: "a point, or nothing for the walk's own" },
  // P9: a core climb asks every add-on too, and its rungs go ahead of the core round, whose own
  // rungs stay last, so the core floor (an event map's exit, the wait) still ends the round.
  'ladder.rung': { kind: 'request', side: 'both', part: 'movement (02), the one climber (T2)', answers: 'many', addonMayAsk: false,
    bound: "its own request's rungs go before the round's last fallback; a core climb's rungs go ahead of the core round, whose rungs stay last",
    fixture: "scripts/tests/hook-registry.test.cjs#P9: an add-on's rung comes first on a core climb, and the core rungs stay last",
    receives: "the holder of the climb and its activity", returns: 'rungs to try, or nothing' },
  // The notices of R5 and CF11, each fired at the change it tells (movement/character/owner.ts,
  // movement/coordinator/routes.ts for the saved ring).
  'journey.resumed': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#journey.resumed: fires when the pause ends',
    receives: 'character, requestId, by, reason', returns: 'nothing' },
  'request.waiting': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'scripts/tests/hook-registry.test.cjs#R5: the owner tells a hold, a refused and a waiting request, a paused and resumed journey, and the click',
    receives: 'character, kind, owner, tier, cause, by', returns: 'nothing' },
  'request.refused': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'scripts/tests/hook-registry.test.cjs#R5: the owner tells a hold, a refused and a waiting request, a paused and resumed journey, and the click',
    receives: 'character, kind, owner, stop, rule, by', returns: 'nothing' },
  'ladder.climbed': { kind: 'notice', side: 'both', part: 'movement (02)', answers: 'many', 
    fixture: "scripts/tests/hook-registry.test.cjs#R5: ladder.rung adds rungs to its add-on's own requests only, and ladder.climbed tells each rung",
    receives: 'the character, or the group and walk; owner, rung, trying, step', returns: 'nothing' },
  'hold.started': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'scripts/tests/hook-registry.test.cjs#R5: the owner tells a hold, a refused and a waiting request, a paused and resumed journey, and the click',
    receives: 'character, kind, owner, tier, deadline, by', returns: 'nothing' },
  'hold.ended': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'scripts/tests/hook-registry.test.cjs#R5: the owner tells a hold, a refused and a waiting request, a paused and resumed journey, and the click',
    receives: 'character, kind, owner, code, by', returns: 'nothing' },
  'click.taken': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'scripts/tests/hook-registry.test.cjs#R5: the owner tells a hold, a refused and a waiting request, a paused and resumed journey, and the click',
    receives: "character, state ('taken' or 'returned'), destination or code", returns: 'nothing' },
  'records.saved': { kind: 'notice', side: 'coordinator', part: 'movement (02)', answers: 'many', 
    fixture: 'scripts/tests/hook-registry.test.cjs#X7: records.saved tells each movement ring snapshot, and no task or call ring snapshot',
    receives: "ring ('movement'), character, record, trigger, by", returns: 'nothing' },
  'crossing.started': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#crossing.started: fires when a crossing is sent',
    receives: 'character, crossing, kind, owner', returns: 'nothing' },
  'crossing.ended': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#crossing.ended: fires once when a crossing lands, is refused, interrupted or times out',
    receives: "character, crossing, kind, owner, code ('landed', 'refused', 'interrupted' or 'timed-out'), reason", returns: 'nothing' },
  'step.sent': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#step.sent: fires when a combat step is sent, with its mover and point',
    receives: 'character, mover, point, target', returns: 'nothing' },
  'formation.moved': { kind: 'notice', side: 'character', part: 'movement (02)', answers: 'many', 
    fixture: 'e2e/live-movement-hooks.spec.ts#formation.moved: fires when a formation step is sent',
    receives: 'character, mover, point, target', returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

export const SLOTS = {
  // The routine slot R4: each character's formation pick, saved per character in `routines`.
  formation: { owner: '02', data: "{entry, label, classes} on the formation.routine registration's slot entry, picked per character", section: false,
    fixture: "scripts/tests/hook-registry.test.cjs#R4: formation.routine answers only for the characters that picked its entry and whose class it lists" },
} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the movement owner's rows: the group walk requests and the movement owner's
// questions, each with its rule for a missing answer.
export function dispatch(ctx: DispatchContext) {
  // The enabled add-on named `name` when it answers `hook`: R5's walk hooks ask only the add-on whose
  // task the walk serves.
  const own = (name: string, hook: 'walk.request' | 'walk.departs'): DispatchRegistration | undefined => ctx.answering(hook).find(r => r.name === name);
  const point = (value: unknown): { x: number; y: number } | undefined => {
    const p = value as { x?: unknown; y?: unknown } | null | undefined;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: Number(p.x), y: Number(p.y) } : undefined;
  };
  return {
    // Movement's group walk requests. A missing answer would leave a walk
    // running that its asker ended, or a walk asked for that never starts, so each ask fails without one.
    walks: {
      request(group: string, ask: WalkAsk): boolean {
        return ctx.one('walks.request').hooks['walks.request']!(group, ask) === true;
      },
      end(group: string, code: WalkEndCode, member?: string): boolean {
        return ctx.one('walks.end').hooks['walks.end']!(group, code, member) === true;
      },
      // The planned time of the group's walk to `destination`, else of `member`'s own walk,
      // undefined with no route.
      estimate(group: string, destination: WalkAsk['destination'], member?: string): Promise<number | undefined> {
        return ctx.one('walks.estimate').hooks['walks.estimate']!(group, destination, member);
      },
      // Every holder's holds on the member, in load order. Only core answers the row, so a holder's
      // throw reaches the walk's own error path.
      holders(ask: MemberHoldAsk): MemberHold[] {
        return ctx.answering('member.holder').flatMap(r => [...r.hooks['member.holder']!(ask)]);
      },
      // Whether a registration that answers `member.holder` names `owner` as its `holder`.
      answersFor(owner: string): boolean {
        return ctx.answering('member.holder').some(r => r.holder === owner);
      },
    },
    // The movement owner's questions with a default when nothing answers (R5, "R5 correction"). An
    // add-on answer that throws counts as no answer, and the registry keeps its error.
    movement: {
      // The coordinator's game data; null where `core:movement` does not answer, as before it loads.
      gameMonsters: (): Readonly<Record<string, GameMonster | undefined>> | null => ctx.answering('movement.gameMonsters')[0]?.hooks['movement.gameMonsters']!() ?? null,
      // The terrain recovery round. The movement rule answers in every realm, so a missing answer is a
      // missing owner and the ask fails.
      formationRecovery(...ask: Parameters<typeof formationRecovery>): ReturnType<typeof formationRecovery> {
        return ctx.one('movement.formationRecovery').hooks['movement.formationRecovery']!(...ask);
      },
      // The independent approach's capability, readiness and confirmation, answered in every realm as above.
      independentApproach(...ask: Parameters<typeof independentApproach>): boolean {
        return ctx.one('movement.independentApproach').hooks['movement.independentApproach']!(...ask);
      },
      independentReadiness(...ask: Parameters<typeof independentReadiness>): ReturnType<typeof independentReadiness> {
        return ctx.one('movement.independentReadiness').hooks['movement.independentReadiness']!(...ask);
      },
      confirmIndependentApproach(...ask: Parameters<typeof confirmIndependentApproach>): ReturnType<typeof confirmIndependentApproach> {
        return ctx.one('movement.confirmIndependentApproach').hooks['movement.confirmIndependentApproach']!(...ask);
      },
      // Every map an add-on's `route.avoid` names, once each, in load order. An answer that throws or
      // names no list counts as none.
      avoidedMaps(ask: RouteAvoidAsk): string[] {
        const maps = new Set<string>();
        for (const { answer } of ctx.answers('route.avoid', r => r.hooks['route.avoid']!(ask, ctx.settings(r.name))))
          if (Array.isArray(answer)) for (const map of answer) if (typeof map === 'string' && map) maps.add(map);
        return [...maps];
      },
      // The first refusal of a crossing, named by its add-on.
      crossingRefusal(ask: CrossingAsk): string | undefined {
        return ctx.refusal('crossing.allows', r => r.hooks['crossing.allows']!(ask, ctx.settings(r.name)));
      },
      stepPoint(ask: StepPointAsk): { x: number; y: number } | undefined {
        const r = ctx.answering('step.point')[0];
        return r && point(ctx.call(r, 'step.point', () => r.hooks['step.point']!(ask, ctx.settings(r.name))));
      },
      // R4: the answer of the formation entry `pick` names, when an enabled add-on fills it and lists
      // the character's class. The built-in entry, a missing pick and a broken answer all read as
      // nothing, so the solver runs its own best.
      formationRoutine(pick: string | undefined, ask: FormationAsk): FormationAnswer {
        const holder = pick ? ctx.slotHolder('formation:' + pick) : undefined, r = holder && ctx.answering('formation.routine').find(o => o.name === holder.name);
        if (!r || holder.classes && !holder.classes.includes(ask.ctype)) return undefined;
        const answer = ctx.call(r, 'formation.routine', () => r.hooks['formation.routine']!(ask, ctx.settings(r.name)));
        if (answer && 'hold' in answer) return answer.hold === true ? { hold: true } : undefined;
        return point(answer);
      },
      // P3: the add-ons' answers merged the safer way. An answer outside the shape counts as none.
      walkFlags(view: WalkFlagsView): WalkFlagsAnswer {
        const merged: WalkFlagsAnswer = {};
        for (const { answer: a } of ctx.answers('walk.flags', r => r.hooks['walk.flags']!(view, ctx.settings(r.name)))) {
          if (a.depart === 'hold' || a.depart === 'go' && merged.depart !== 'hold') merged.depart = a.depart;
          if (a.defence === 'pause' || a.defence === 'walk-on' && merged.defence !== 'pause') merged.defence = a.defence;
          if (typeof a.handsCombat === 'boolean') merged.handsCombat = merged.handsCombat === false ? false : a.handsCombat;
        }
        return merged;
      },
      // R5's walk hooks, asked of the add-on whose task the walk serves.
      walkRequest(name: string, view: AddonWalkView): AddonWalkAnswer {
        const r = own(name, 'walk.request');
        return r && ctx.call(r, 'walk.request', () => r.hooks['walk.request']!(view, ctx.settings(r.name)));
      },
      holdsDeparture(name: string, view: { group: string | null; walk: string; phase: string; members: string[] }): boolean {
        const r = own(name, 'walk.departs');
        return !!r && ctx.call(r, 'walk.departs', () => r.hooks['walk.departs']!(view, ctx.settings(r.name))) === true;
      },
      // P8: an add-on walk (`addon:<name>`) asks its add-on; a core walk asks every add-on and takes
      // the first point in load order. The escape's walk keeps 05's goal.
      safeGoal(purpose: string | null, view: { group: string | null; walk: string }): { map: string; x: number; y: number } | undefined {
        if (purpose === 'escape-recovery') return undefined;
        const name = purpose?.startsWith('addon:') ? purpose.slice('addon:'.length) : undefined;
        for (const r of ctx.answering('safe.goal').filter(o => name === undefined || o.name === name)) {
          const answer = ctx.call(r, 'safe.goal', () => r.hooks['safe.goal']!({ ...view, purpose }, ctx.settings(r.name)));
          if (answer && typeof answer.map === 'string' && point(answer)) return { map: answer.map, ...point(answer)! };
        }
        return undefined;
      },
      // The rungs each add-on adds to its own request's round: a holder named `addon:<name>` or
      // `addon:<name>:<walk>` (owner.ts `endAddon`).
      // P9: a core holder (one not named `addon:`) asks every add-on, whose rungs go ahead of its round
      // (`ahead`). A rung without a name, a direction and an attempt counts as none.
      rungs(holder: string, activity?: string): { own: Rung[]; ahead: Rung[] } {
        const core = !holder.startsWith('addon:');
        const rungs = ctx.answering('ladder.rung').filter(r => core || holder === `addon:${r.name}` || holder.startsWith(`addon:${r.name}:`))
          .flatMap(r => { const a = ctx.call(r, 'ladder.rung', () => r.hooks['ladder.rung']!({ holder, activity }, ctx.settings(r.name))); return Array.isArray(a) ? a : []; })
          .filter((g: Rung) => !!g && typeof g.name === 'string' && typeof g.toward === 'boolean' && typeof g.attempt === 'function');
        return core ? { own: [], ahead: rungs } : { own: rungs, ahead: [] };
      },
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/movement/rules.ts'] as const;
export const DECISIONS = {
  'which movement request wins': { at: 'runtime/movement/rules.ts#decide', hook: 'movement.request' },
  'who may stop a journey': { at: 'runtime/movement/rules.ts#judgeStop', core: 'safety', cite: 'runtime/movement/rules.ts:215, escape and death recovery always stop' },
  'a combat step during a journey, its point': { at: 'runtime/movement/rules.ts#stepAllowed', hook: 'step.point' },
  'a combat step during a journey, its safety': { at: 'runtime/movement/rules.ts#stepAllowed', hook: 'step.safety' },
  'maps a route may cross': { site: 'runtime/movement/coordinator/planner-service.ts:109', hook: 'route.avoid' },
  'a crossing may go': { site: 'runtime/movement/character/owner.ts:1293', hook: 'crossing.allows' },
  'formation slot': { site: 'runtime/movement/character/formation.ts:840', hook: 'formation.routine' },
  'the formation anchor': { site: 'runtime/coordinator/targeting/queue.ts:173', hook: 'group.anchor' },
  'an add-on task\'s group walk destination': { site: 'runtime/movement/coordinator/walk.ts:354', hook: 'walk.request' },
  'an add-on walk holds its departure': { site: 'runtime/movement/coordinator/walk.ts:1473', hook: 'walk.departs' },
  'the wait rung before the walk ladder starts its next round': { site: 'runtime/movement/coordinator/walk.ts:1410', hook: 'retry.policy' },
  'a failed walk exhausts its retries (T5 exhausts)': { site: 'runtime/movement/coordinator/walk.ts:1353', hook: 'retry.policy' },
  'a core walk\'s departure waits for the fight and chests': { at: 'runtime/movement/rules.ts#walkDeparture', hook: 'walk.flags' },
  'death safe goal of a core walk': { at: 'runtime/movement/rules.ts#deathGoal', core: 'game', cite: 'runtime/movement/rules.ts:252, the on_death respawn map' },
  'safe goal of a core walk': { site: 'runtime/movement/coordinator/walk.ts:1835', hook: 'safe.goal' },
  'safe goal of an add-on walk': { site: 'runtime/movement/coordinator/walk.ts:1835', hook: 'safe.goal' },
  'climber rungs for an add-on request': { site: 'runtime/movement/character/owner.ts:1499', hook: 'ladder.rung' },
  'climber rungs ahead of a core round': { site: 'runtime/movement/character/owner.ts:1499', hook: 'ladder.rung' },
  'a failed core walk is taken up again by 07\'s farm recovery': { at: 'runtime/movement/rules.ts#farmRecovers', hook: 'ladder.rung' },
  'whether an add-on walk hands combat over to farming on the way': { at: 'runtime/movement/rules.ts#handsCombatOver', hook: 'walk.request' },
  'farm approach re-routes one missed attack turn after the last attack': { site: 'runtime/movement/character/approach.ts:202', core: 'game', cite: 'runtime/movement/character/approach.ts:206, the game attack period and the client skill_timeout' },
  'follow distance and the follower\'s event rule': { at: 'runtime/movement/rules.ts#followLeavesCurrentEvent', hook: 'settings.overlay' },
  'what a player\'s click does': { at: 'runtime/movement/rules.ts#clickRule', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12, the manual row' },
  'a walk the player started ranks at the manual tier': { at: 'runtime/movement/rules.ts#playerWalk', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:18, the manual row' },
  'the farm walk after a death stays off a ranked request': { at: 'runtime/movement/rules.ts#farmWalkHeld', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'a walk holds the combat turn': { at: 'runtime/movement/rules.ts#combatHold', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'the Hunt\'s hand-in holds event travel': { at: 'runtime/movement/rules.ts#eventTravelHeld', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'the player\'s cancel ends a walk': { at: 'runtime/movement/rules.ts#cancelEnds', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12, the manual row' },
  'a walk gives way to a higher request': { at: 'runtime/movement/rules.ts#preemptible', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'an event walk takes over a shared walk': { at: 'runtime/movement/rules.ts#eventMayTake', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'an exempt walk keeps walking through a defence': { at: 'runtime/movement/rules.ts#exemptWalk', hook: 'walk.flags' },
  'a walk pauses for a defence': { at: 'runtime/movement/rules.ts#defensePauses', hook: 'walk.flags' },
  'a send\'s call band': { at: 'runtime/movement/rules.ts#sendBand', core: 'call-budget', cite: 'runtime/characters/call-budget-limits.ts:5' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  departureWindow: 'read', departureStep: 'read', isSafeAt: 'read', cruisePaced: 'read', reportSlowed: 'read',
  ownerOfTier: 'read', tierOf: 'read', walkRequester: 'read', returnWorkflowSuperseded: 'read', attackersHp: 'read',
  groupWalkActive: 'read', townGoal: 'read', departureWaitsFight: 'read', departureWaitsLoot: 'read',
  goesToFarm: 'label', clickLabel: 'label', climbLabel: 'label', partyTravelLabel: 'label', heldLabel: 'label',
  walkLabel: 'label', farmWalk: 'label',
} satisfies Record<string, PlainKind>;

// C1's game actions (addon-capabilities.md "The table by owner"): the walk and the step become a
// `movement.request` answer at the add-on's tier (runtime/movement/character/movers.ts
// `createMovementActions`), so the planner picks the doors and crossings and the rank table still
// decides. The player's cancel, the Magiport accept and the cruise pace stay movement's own.
export const ACTIONS = {
  // The walk's crossings: Town, Blink and Magiport are movement's per-thing uses of use and use_skill.
  walk: { events: ['move', 'transport', 'leave', 'town'], functions: ['smart_move', 'xmove', 'move', 'transport', 'leave', 'town', 'use:town', 'use_skill:blink', 'use_skill:magiport'], door: 'walk',
    args: '{to: {map, x, y} or town, tier: one of ADDON_TIERS}', bound: "a movement.request walk at the add-on's tier; it answers until the character arrives" },
  step: { events: [], functions: [], door: 'step', args: '{to: {x, y}, tier: one of ADDON_TIERS}', bound: "a movement.request step at the add-on's tier, which step safety judges" },
  stop: { events: ['stop'], functions: ['stop'], closed: 'FW', cite: "runtime/movement/rules.ts#cancelEnds: the player's cancel and the rank table end walks; an add-on ends its own walk by not answering" },
  magiport: { events: ['magiport'], functions: ['accept_magiport'], closed: 'FW', cite: "movement.acceptMagiport: 02 accepts a party mage's Magiport inside its walk rules" },
  cruise: { events: ['cruise'], functions: [], closed: 'FW', cite: "runtime/movement/rules.ts#cruisePaced: the cruise pace is the server's floor and cap" },
} as const satisfies Record<string, ActionRow>;

// C3's reads (addon-capabilities.md "The completeness rule"): each export of movement's two doors
// and each PLAIN read, with the side that holds it. An export both doors carry is one row on both
// sides, named at the character door.
const CHARACTER_DOOR = 'runtime/movement/api/character.ts', COORDINATOR_DOOR = 'runtime/movement/api/coordinator.ts', RULES = 'runtime/movement/rules.ts';
export const READS = {
  'movement.isSafeAt': { side: 'both', type: 'boolean', door: `${CHARACTER_DOOR}#isSafeAt` },
  'movement.handsCombatOver': { side: 'both', type: 'boolean', door: `${CHARACTER_DOOR}#handsCombatOver` },
  'movement.gameItems': { side: 'both', type: "the game's item table, or null before it loads", door: `${CHARACTER_DOOR}#gameItems` },
  'movement.npcPlace': { side: 'both', type: '{map, x, y} of the NPC id, or null', door: `${CHARACTER_DOOR}#npcPlace` },
  'movement.combatHold': { side: 'character', type: "'group' | 'walk' | null", door: `${CHARACTER_DOOR}#combatHold` },
  'movement.approachFan': { side: 'character', type: '{x, y}[]', door: `${CHARACTER_DOOR}#approachFan` },
  'movement.stepLength': { side: 'character', type: 'number', door: `${CHARACTER_DOOR}#stepLength` },
  'movement.arrivalTolerance': { side: 'both', type: 'number', door: `${CHARACTER_DOOR}#ARRIVAL_TOLERANCE` },
  'movement.reportStallDistance': { side: 'both', type: 'number', door: `${CHARACTER_DOOR}#REPORT_STALL_DISTANCE` },
  'movement.farmWalkHeld': { side: 'both', type: 'boolean', door: `${CHARACTER_DOOR}#farmWalkHeld` },
  'movement.movers': { side: 'character', type: "T6's movers in order: {name, tier, positions?}[]", door: `${CHARACTER_DOOR}#MOVERS` },
  'movement.tierOf': { side: 'both', type: '{tier: Tier}', door: `${CHARACTER_DOOR}#tierOf` },
  'movement.convoyRestored': { side: 'coordinator', type: 'PartyConvoy | null', door: `${COORDINATOR_DOOR}#restoredConvoy` },
  'movement.travelDefense': { side: 'coordinator', type: "the walk's defence: its attackers and whether it pauses", door: `${COORDINATOR_DOOR}#classifyTravelDefense` },
  'movement.communicationReason': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#communicationReason` },
  'movement.targetIdentity': { side: 'coordinator', type: 'string', door: `${COORDINATOR_DOOR}#identity` },
  'movement.travelCombat': { side: 'coordinator', type: "the member's walk fight, or null", door: `${COORDINATOR_DOOR}#travelCombatFor` },
  'movement.convoyFighting': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#convoyFighting` },
  'movement.gameEvents': { side: 'coordinator', type: "the game's event table, or null before it loads", door: `${COORDINATOR_DOOR}#gameEvents` },
  'movement.samePlace': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#samePlace` },
  'movement.sequencedTravelReport': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#sequencedTravelReport` },
  'movement.travelReportFields': { side: 'coordinator', type: 'string[]', door: `${COORDINATOR_DOOR}#travelReportFields` },
  'movement.canStand': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#canStand` },
  'movement.homeGoal': { side: 'coordinator', type: 'SafeGoal | null', door: `${COORDINATOR_DOOR}#homeGoal` },
  'movement.fingerprint': { side: 'coordinator', type: 'string', door: `${COORDINATOR_DOOR}#movementFingerprint` },
  'movement.townLanding': { side: 'coordinator', type: 'SafeGoal | null', door: `${COORDINATOR_DOOR}#townLanding` },
  'movement.sharedCommand': { side: 'coordinator', type: 'SharedCommand', door: `${COORDINATOR_DOOR}#sharedCommand` },
  'movement.returnArrivalRadius': { side: 'coordinator', type: 'number', door: `${COORDINATOR_DOOR}#RETURN_ARRIVAL_RADIUS` },
  'movement.climbLabel': { side: 'coordinator', type: 'string', door: `${COORDINATOR_DOOR}#climbLabel` },
  'movement.farmRecovers': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#farmRecovers` },
  'movement.farmWalk': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#farmWalk` },
  'movement.partyTravelLabel': { side: 'coordinator', type: 'string | null', door: `${COORDINATOR_DOOR}#partyTravelLabel` },
  'movement.playerWalk': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#playerWalk` },
  'movement.walkLabel': { side: 'coordinator', type: 'string', door: `${COORDINATOR_DOOR}#walkLabel` },
  'movement.huntDefense': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#huntDefense` },
  'movement.outboundHunt': { side: 'coordinator', type: 'boolean', door: `${COORDINATOR_DOOR}#outboundHunt` },
  'movement.departureWindow': { side: 'both', type: 'number', door: `${RULES}#departureWindow` },
  'movement.departureStep': { side: 'both', type: "the departure's progress sample", door: `${RULES}#departureStep` },
  'movement.cruisePaced': { side: 'both', type: 'boolean', door: `${RULES}#cruisePaced` },
  'movement.reportSlowed': { side: 'both', type: 'boolean', door: `${RULES}#reportSlowed` },
  'movement.ownerOfTier': { side: 'both', type: 'string', door: `${RULES}#ownerOfTier` },
  'movement.walkRequester': { side: 'both', type: 'Requester', door: `${RULES}#walkRequester` },
  'movement.returnWorkflowSuperseded': { side: 'both', type: 'boolean', door: `${RULES}#returnWorkflowSuperseded` },
  'movement.attackersHp': { side: 'both', type: 'number', door: `${RULES}#attackersHp` },
  'movement.groupWalkActive': { side: 'both', type: 'boolean', door: `${RULES}#groupWalkActive` },
  'movement.townGoal': { side: 'both', type: 'SafeGoal | null', door: `${RULES}#townGoal` },
  'movement.departureWaitsFight': { side: 'both', type: 'boolean', door: `${RULES}#departureWaitsFight` },
  'movement.departureWaitsLoot': { side: 'both', type: 'boolean', door: `${RULES}#departureWaitsLoot` },
} as const satisfies Record<string, ReadRow>;
// The door exports that are no read: a write to movement's state, a port that the composition root
// or a core hook answer wires, or a command.
export const DOOR_ONLY = {
  'runtime/movement/api/character.ts#confirmIndependentApproach': { kind: 'port', cite: 'the movement.confirmIndependentApproach hook answer, which issues a confirmation round' },
  'runtime/movement/api/character.ts#independentApproach': { kind: 'port', cite: 'the movement.independentApproach hook answer' },
  'runtime/movement/api/character.ts#independentReadiness': { kind: 'port', cite: 'the movement.independentReadiness hook answer' },
  'runtime/movement/api/coordinator.ts#formationRecovery': { kind: 'port', cite: 'the movement.formationRecovery hook answer' },
  'runtime/movement/api/coordinator.ts#gameMonsters': { kind: 'port', cite: 'the movement.gameMonsters hook answer' },
  'runtime/movement/api/coordinator.ts#admitMerchantInterruption': { kind: 'write', cite: "admits the merchant's interruption into a walk" },
  'runtime/movement/api/coordinator.ts#attachMerchantInterruption': { kind: 'write', cite: "attaches the merchant's command to its interruption" },
  'runtime/movement/api/coordinator.ts#finishMerchantInterruption': { kind: 'write', cite: "ends the merchant's interruption" },
  'runtime/movement/api/coordinator.ts#releaseMerchantInterruption': { kind: 'write', cite: "releases the merchant's interruption" },
  'runtime/movement/api/coordinator.ts#convoyDefenseStep': { kind: 'command', cite: "steps the convoy's defence" },
  'runtime/movement/api/coordinator.ts#preparationChanged': { kind: 'write', cite: "marks the planner's preparation changed" },
  'runtime/movement/api/coordinator.ts#acceptTravelReport': { kind: 'write', cite: "merges a member's travel report" },
  'runtime/movement/api/coordinator.ts#endTownMembership': { kind: 'write', cite: "ends a member's place in the party Town" },
  'runtime/movement/api/coordinator.ts#restoreTownCommand': { kind: 'write', cite: "restores a member's Town command" },
  'runtime/movement/api/coordinator.ts#retireTownCommand': { kind: 'write', cite: "retires a member's Town command" },
  'runtime/movement/api/coordinator.ts#authorizeCoordinatorFarmingRoute': { kind: 'command', cite: 'the farming route the coordinator authorizes' },
  'runtime/movement/api/coordinator.ts#stepWalks': { kind: 'command', cite: "steps every group's walk" },
  'runtime/movement/api/coordinator.ts#walkEnds': { kind: 'command', cite: "ends a group's walk with its code" },
  'runtime/movement/api/coordinator.ts#prepareMovement': { kind: 'port', cite: "loads the planner's geometry for a game version" },
  'runtime/movement/api/coordinator.ts#heartbeatMovement': { kind: 'port', cite: "the heartbeat reply's movement section" },
  'runtime/movement/api/coordinator.ts#createPlannerService': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#createRareRouteDistance': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#createRouteTime': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#createCommandOwnership': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#createMovementRecords': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#createConvoyAcknowledgementRoutes': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#createConvoyEngagementRoutes': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#createCoordinatorNavigationActions': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#createPartyTravelRoutes': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#installMovementRecordRoutes': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#installMovementRoutes': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#installSharedConvoyRoute': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#createCoordinatorTravelClock': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#installCoordinatorMovement': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#createSharedConvoyNavigation': { kind: 'port', cite: "13's composition root" }, 'runtime/movement/api/coordinator.ts#createCoordinatorManualNavigation': { kind: 'port', cite: "13's composition root" },
  'runtime/movement/api/coordinator.ts#createCoordinatorPartyConvoys': { kind: 'port', cite: "13's composition root" },
} as const satisfies Record<string, { kind: 'write' | 'port' | 'command'; cite: string }>;
