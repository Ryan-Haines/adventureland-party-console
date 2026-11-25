// The turns owner's install: the skill
// runtime, the core sources, the attack source, the executor, the role loop and the A/B feed, and
// the one `core:turns` registration with its answers in hand. The role runner keeps one install line
// and hands its selection reads (the targeting owner's) and its state; every other read is the stand-in ports'
// (shared.js `partyTurns.facts()`) or a published answer.
import type { CombatRoot, CombatState, Role, Target } from './role-types.ts';
import type { DoorOutcome, HookRegistry, Registration, SkillsAllowsAsk } from '../../hooks/registry.ts';
import { createExecutor, ATTACK_SOURCE, type Turns, type TurnsScope } from './executor.ts';
import { createAttackController, type RangeRecovery } from './attack.ts';
import { createCoreSources, decisionAsk } from './sources.ts';
import { installSkillRuntime } from './skills/runtime.ts';
import { combatContext } from './skills/context.ts';
import { createRoleLoop } from './loop.ts';
import { PULL_HP_FLOOR, PULL_SECONDS } from './skills/eligibility.ts';
import { ADDON_SPEND_CAP, SPEND_RANKS, type SpendRank } from '../../protocol/ranks.ts';
import { createAbFeed } from './ab-feed.ts';
import { actionHold, emoteRefusal, hold, occupiedRows, refuses, type Hold, type HoldFacts } from './rules.ts';
import type { TurnsFacts } from './stand-ins/holds.ts';
import { errorReason, type ClassTurn, type TurnsView } from './api.ts';
import { eventFacts } from '../../events/api.ts';
import { HEALTHY_SHARE } from '../survival/api.ts';
import { memberView } from '../../protocol/reports.ts';
import type { DamageType } from 'typed-adventureland';

export interface TurnsInstallPorts {
  hooks: HookRegistry;
  // The turns owner's run scope handle, `act`: the pass's timers and the game
  // packets that wake it wait while table P holds the character, and the generation's stop ends them.
  scope: TurnsScope;
  // The role runner's own state: its epoch (a target reset or a death), whether it runs, its class
  // role and the card's combat state.
  epoch(): number;
  active(): boolean;
  role(): Role;
  state(): CombatState;
  // The targeting owner's selection reads, which the attack source books against at the reply.
  target(): Target | null;
  selected(): string | null;
  passing(target: Target): boolean;
  preparePassing(target: Target): boolean | void;
  equipmentBusy(): boolean;
  recovery: RangeRecovery;
  // The targeting owner's reads of the skill runtime.
  damageType(): DamageType | undefined;
  report(error: unknown): void;
}
export interface TurnsInstall {
  turns: Turns;
  skills: ReturnType<typeof installSkillRuntime>;
  facts: TurnsFacts;
  // The spend table read now.
  hold(): Hold;
  // C1's action doors, which the character's action dispatcher calls
  // after the common holds.
  doors: Record<'spend' | 'emote', (args: Readonly<Record<string, unknown>>, ask: { addon: string; reason: string }) => Promise<DoorOutcome>>;
  reset(): void;
  stop(): void;
}

export function installTurns(root: CombatRoot, ports: TurnsInstallPorts): TurnsInstall {
  // The shared party code builds the stand-in ports; without them no combat timer starts
  // (b9b5c91e roles/runner.ts:324-325).
  if (!root.partyTurns) throw Error('Shared party code is not ready; refusing to start combat timers');
  const hooks = ports.hooks, facts = root.partyTurns.facts(), rows = occupiedRows(facts);
  // P13: the combat routine entry delivered for this character; an add-on entry that serves its
  // class lifts H9 and H10.
  const picked = () => root.partyTurns?.healFirstBelow?.routine?.();
  const routineServes = () => hooks.turns.routineServes(picked(), String(character.ctype));
  const holdFacts = (): HoldFacts => ({ active: ports.active(), rip: !!character.rip, hand: facts.hand(), abtesting: () => eventFacts().abtestingMode(),
    revive: hooks.survival.verdict({ character: character.name }) === 'revive', roleCombat: ports.role().combat || routineServes(),
    merchant: character.ctype === 'merchant', merchantEventFight: eventFacts().merchantFightsEvent() || routineServes(), dungeonOwned: facts.dungeonOwned(), occupied: rows });
  const read = (): Hold => hold(holdFacts());
  const notify = (hook: string, payload: Record<string, unknown>) => { hooks.notify(hook as never, { character: character.name, ...payload }); };
  let turns: Turns | null = null;
  const skills = installSkillRuntime(root, {
    ledger: { mp: () => turns?.inFlightMp() ?? 0, flying: family => !!turns?.flying(family) },
    // A class decision pushes at its category's rank; Taunt asks at `task` with its `survival`
    // category, as the engine's Absorb does (3.2).
    push: d => turns ? turns.spend({ ...decisionAsk(skills, d, d.skill === 'taunt' ? 'task' : d.category), by: 'core:turns/class' }).then(() => true, () => false) : Promise.resolve(false),
    allows: (t, id) => hooks.turns.allows(t, id),
    damageType: ports.damageType,
    // Each roster member with its last party report, so an answer weighs HP and place.
    aggroOwner: leader => {
      const reports = facts.members();
      return hooks.targeting.aggroOwner({ character: character.name, leader, members: facts.roster().map(name => {
        const report = reports.find(m => m.name === name);
        return memberView(name, report?.ctype, report);
      }) });
    },
    attacking: t => hooks.ask('targeting.attacking', t as never),
    // The ranking's doors (TRN-Q-DPS): the survival owner's potion table and healthy share, the targeting owner's pull read, and the movement owner's
    // combat step, which judges the spot's safety as any mover's.
    mpPotion: mp => hooks.survival.mpPotion(mp),
    healthy: () => hooks.survival.healthy(HEALTHY_SHARE),
    pullOnly: (t, id) => hooks.ask('targeting.pullOnly', t as never, id) === true,
    // A step movement refuses, or whose send fails, goes to the turns ring as a position refusal.
    step: (to, target) => {
      const refused = (reason: string) => turns?.refused({ family: 'position', skill: 'movement.step', reason, by: 'core:turns/offense' });
      const result = hooks.ask('movement.step', to, 'turns-position', { target });
      if (result?.status === 'refused') refused(result.reason ?? 'refused');
      void Promise.resolve(result?.sent).catch(error => refused(errorReason(error)));
    },
    // The party's reports carry each member's turns report (the status owner's status report, `turns`), and the
    // class role sets its support casts (TRN-Q-DPS DPS-3, DPS-4).
    reports: () => facts.members(), clockOffset: () => facts.clockOffset(),
    support: () => ports.role().support?.(turn) ?? {},
    context: () => combatContext(facts, () => !!refuses(read(), { rank: 'damage', occupied: true }), skills.monsters),
    notify,
  }, hooks);
  const attack = createAttackController({ recovery: ports.recovery, target: ports.target, selected: ports.selected, active: ports.active,
    passing: ports.passing, preparePassing: ports.preparePassing, equipmentBusy: ports.equipmentBusy, state: ports.state, report: ports.report,
    attackSkill: (target, world) => { const d = skills.choices.attack(world, target); return d ? decisionAsk(skills, d, 'damage') : null; },
    dropped: (reason, selected) => notify('skills.dropped', { skill: 'attack', family: 'attack', rank: 'damage', reason, by: ATTACK_SOURCE, selected }) });
  const sources = createCoreSources(skills, attack, v => hooks.turns.routine({ entry: String(picked() ?? ''), ctype: String(character.ctype), view: v,
    ready: skill => executor.ready(skill) }));
  turns = createExecutor(root, { hooks, scope: ports.scope, epoch: ports.epoch, hold: read, role: ports.role, world: () => skills.world(), state: ports.state,
    healFirstBelow: () => facts.healFirstBelow() });
  const executor = turns;
  const turn: ClassTurn = { casts: skills.casts, ready: skill => executor.ready(skill), facts };
  const feed = createAbFeed({ facts, spend: ask => executor.spend(ask), ready: skill => executor.ready(skill),
    setTargetId: (id, by) => hooks.ask('targeting.setTargetId', id, by), setState: state => { root.partyCombatState = state as unknown as CombatState; } });
  const loop = createRoleLoop({ scope: ports.scope, pass: () => executor.pass('event'), update: () => executor.update(), epoch: ports.epoch, armAttack: at => executor.armAttack(at), nextReady: () => executor.nextReady(),
    role: ports.role, turn, feed: () => feed.run(), notify, report: ports.report,
    revival: () => (character as { cave?: unknown }).cave && character.ctype === 'priest' ? hooks.skills.revival(character.name) : Promise.resolve(false) });
  // `core:turns`: the realm's first install registers it, and each later install puts its
  // own answers in it through the registry's `publish`, so one registration answers from the current
  // install.
  const registration = turnsRegistration({ sources, ready: skill => executor.ready(skill), allows: ask => refuses(executor.hold(), ask), report: () => ({ ...skills.report(), fighting: !!ports.target() && attack.lastTarget() === ports.selected() }),
    records: () => executor.records(), pullSafe: target => skills.pullSafe(skills.gateWorld(), target as never), listeners: loop.listeners });
  const published = hooks.publish(registration);
  if (!published.ok) throw Error(`The turns owner's core:turns did not load: ${published.message}`);
  executor.start();
  loop.start();
  // C1's spend action: an add-on's skill at most `ADDON_SPEND_CAP`, through the spend table with H9 and H10
  // lifted for this one spend (any stop row, the occupied rows included, still holds it), then the executor's whole refusal, the family's cooldown, the call
  // band and the reply. A target named by id is the entity the character sees.
  const refused = (reason: string): DoorOutcome => ({ outcome: 'refused', by: 'core:turns', reason });
  async function spend(args: Readonly<Record<string, unknown>>, ask: { addon: string; reason: string }): Promise<DoorOutcome> {
    const rank = (args.rank ?? ADDON_SPEND_CAP) as SpendRank, category = args.category ?? 'maintenance';
    if (typeof args.skill !== 'string') return refused('a spend names its skill');
    if (!(rank in SPEND_RANKS) || SPEND_RANKS[rank] > SPEND_RANKS[ADDON_SPEND_CAP]) return refused(`rank ${rank} above an add-on's ${ADDON_SPEND_CAP}`);
    if (category !== 'survival' && category !== 'maintenance' && category !== 'damage') return refused(`category ${String(category)} is not a spend category`);
    const h = actionHold(holdFacts()), held = h.stop ?? refuses(h, { rank });
    if (held) return refused(`T1 ${held.row}: ${held.source}`);
    const entities = (parent as { entities?: Record<string, Target> }).entities ?? {};
    const targets = (Array.isArray(args.targets) ? args.targets : []).map(t => typeof t === 'string' ? (t === character.name ? character : entities[t]) : t as Target);
    if (targets.some(t => !t)) return refused('a target this character does not see');
    try {
      const reply = await executor.spend({ skill: args.skill, targets, argument: args.argument, rank, category, reason: ask.reason, by: `addon:${ask.addon}/action` });
      return { outcome: 'sent', reply };
    } catch (error) { return refused(errorReason(error)); }
  }
  // C1's emote action (rules.ts `emoteRefusal`): the emote skill at `maintenance`, so survival's
  // spends go first, then the spend's own checks.
  function emote(args: Readonly<Record<string, unknown>>, ask: { addon: string; reason: string }): Promise<DoorOutcome> {
    const refusal = emoteRefusal(G.skills as Parameters<typeof emoteRefusal>[0], (character as { acx?: unknown }).acx, args.name);
    return refusal ? Promise.resolve(refused(refusal)) : spend({ skill: args.name, rank: 'maintenance', category: 'maintenance' }, ask);
  }
  // turns/api.ts reaches the doors through `__partyTurnsDoors`; each install's doors replace the last.
  Object.assign(globalThis, { __partyTurnsDoors: { spend, emote } });
  return { turns: executor, skills, facts, hold: read, doors: { spend, emote },
    reset() { executor.reset(); skills.reset(); attack.reset(); },
    stop() { loop.stop(); executor.stop(); skills.stop(); attack.reset(); } };
}

// The one `core:turns` registration over an install's answers: the four core sources at their ranks,
// `skills.ready`, `skills.allows`, `skills.pullSafe`, `skills.report`, the turns ring and the role loop's listeners.
export interface TurnsAnswers {
  sources: ReturnType<typeof createCoreSources>;
  ready(skill: string): unknown;
  allows(ask: SkillsAllowsAsk): ReturnType<typeof refuses>;
  pullSafe(target: unknown): boolean;
  report(): unknown;
  // The turns ring for the status owner's diagnostics lease.
  records(): readonly unknown[];
  listeners: Record<string, (payload: Record<string, unknown>) => void>;
}
export function turnsRegistration(answers: TurnsAnswers): Registration {
  const { sources } = answers;
  return { name: 'core:turns', folder: 'core', author: 'adventureland-party-console',
    summary: 'Spends each game cooldown on the most urgent request: heals before attacks, one potion at a time.',
    hooks: {
      'skills.request': [
        { name: 'absorb', rank: 'task', answer: v => sources.absorb(v as never) },
        { name: 'support', rank: 'survival', answer: v => sources.support(v as never) },
        { name: 'attack', rank: 'damage', answer: v => sources.attack(v as never) },
        { name: 'offense', rank: 'damage', answer: v => sources.offense(v as never) },
        // P13: the picked combat routine's asks, capped at an add-on's spend rank.
        { name: 'routine', rank: ADDON_SPEND_CAP, answer: (v: TurnsView) => sources.routine(v) },
      ],
      'skills.ready': skill => answers.ready(skill),
      'skills.allows': ask => answers.allows(ask),
      'skills.pullSafe': (_name, target) => answers.pullSafe(target) ||
        `the pull leaves this character below ${PULL_HP_FLOOR * 100}% HP within ${PULL_SECONDS} seconds`,
      'skills.report': () => answers.report(),
      'skills.records': () => answers.records(),
      ...answers.listeners,
    } };
}
