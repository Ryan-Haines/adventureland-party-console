import type { CoreAsk, TargetAnswer, TurnsView } from './api.ts';
import type { SkillDecision, SkillWorld } from './skills/types.ts';
import type { Target } from './role-types.ts';
import type { SpendRank } from '../../protocol/ranks.ts';
import type { SpendAsk } from '../../hooks/registry.ts';
import { priestAttacks } from './rules.ts';

// The turns owner's core sources: the skill
// engine's choices and the attack family's request, each a `skills.request` answer of `core:turns`.
// Each reads the spend table through its view and the pass's one target answer.
interface Engine {
  choices: {
    support(w: SkillWorld): SkillDecision[];
    absorb(w: SkillWorld): SkillDecision | null;
    offense(w: SkillWorld, target: Target): SkillDecision[];
  };
  book(d: SkillDecision): NonNullable<CoreAsk['book']>;
}
// A decision's ask. Its rank is the request's place in its family; its category stays the
// decision's, so it meets the MP rule it meets today (3.2).
export function decisionAsk(engine: Pick<Engine, 'book'>, d: SkillDecision, rank: SpendRank): CoreAsk {
  return { skill: d.skill, targets: d.targets, argument: d.argument, rank, category: d.category, reason: d.reason, book: engine.book(d),
    ...(d.belowReserve ? { belowReserve: true } : {}) };
}
// P13: the picked combat routine's asks for a pass, or undefined while the built-in routine runs.
type Routine = (v: TurnsView) => readonly SpendAsk[] | undefined;
export function createCoreSources(engine: Engine, attack: { request(answer: TargetAnswer, world: SkillWorld): CoreAsk | null }, routine: Routine = () => undefined) {
  // One answer per pass: the support, attack, offense and routine sources read the same one.
  const answers = new WeakMap<TurnsView, readonly SpendAsk[] | undefined>();
  const picked = (v: TurnsView) => { if (!answers.has(v)) answers.set(v, v.roleLoop && v.combat ? routine(v) : undefined); return answers.get(v); };
  return {
    // Priest Absorb, before the heal, at `task` with its `survival` category.
    absorb(v: TurnsView): CoreAsk | undefined {
      if (!v.roleLoop || !v.combat) return undefined;
      const d = engine.choices.absorb(v.world());
      return d ? decisionAsk(engine, d, 'task') : undefined;
    },
    // Support casts: survival decisions at `survival`, buffs at
    // `maintenance`.
    support(v: TurnsView): CoreAsk[] | undefined {
      if (!v.roleLoop || !v.combat) return undefined;
      // A picked routine replaces the buffs; the survival casts stay core.
      const replaced = !!picked(v);
      return engine.choices.support(v.world()).filter(d => !replaced || d.category === 'survival')
        .map(d => decisionAsk(engine, d, d.category === 'survival' ? 'survival' : 'maintenance'));
    },
    // The attack family: the basic attack or the ranking's attack-family skill on the pass's target
    //.
    attack(v: TurnsView): CoreAsk | undefined {
      if (!v.attack || !v.target || picked(v)) return undefined;
      const ask = attack.request(v.target, v.world());
      // A8: the priest's basic attack leaves the forecast's MP to its heals.
      if (ask?.skill === 'attack' && !priestAttacks(v.world())) return undefined;
      return ask ?? undefined;
    },
    // P13: the picked routine's asks, at most `task` (the requester's rank in core:turns).
    routine(v: TurnsView): readonly SpendAsk[] | undefined { return picked(v); },
    // Damage skills on the target, where support casts may go on it (`targeting.target`).
    // Every class asks the one ranking (TRN-Q-DPS).
    offense(v: TurnsView): CoreAsk[] | undefined {
      if (!v.roleLoop || !v.combat || !v.target?.support || v.target.passing || picked(v)) return undefined;
      return engine.choices.offense(v.world(), v.target.target).map(d => decisionAsk(engine, d, 'damage'));
    },
  };
}
