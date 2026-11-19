import { createManaIncome } from './budget.ts';
import { cooldownOf, familyOf } from '../api.ts';
import { blocked, reserve } from './eligibility.ts';
import { rank, type Ranking } from './ranking.ts';
import { absorbDecision, auraCondition as auraFacts, paladinSupport, rogueSupport, combatBuffSupport, opener } from './protection.ts';
import type { Combatant, SkillDecision, SkillDiagnostic, SkillId, SkillWorld } from './types.ts';

// The skill engine: its choices and what the console books
// for each decision. The turns executor makes every cast, so the engine sends nothing.
export interface SkillPorts {
  world(): SkillWorld;
  publishAfterCast?(d: SkillDecision): boolean;
  evidence(target: Combatant, state: 'pending' | 'engaged' | 'rejected', action?: string): string | null;
  diagnostic(d: SkillDiagnostic): void;
  // The turns executor's one ledger: the MP of every spend in flight and
  // whether a cooldown family has one in flight.
  ledger: { mp(): number; flying(family: string): boolean };
  // The ranking's walk to a better spot, asked of movement's combat step (the movement owner's `movement.step`).
  position?(move: NonNullable<Ranking['move']>): void;
}
export function createSkillEngine(ports: SkillPorts) {
  const income = createManaIncome();
  // The paladin switches its aura only when the aura's deciding condition changed since it set the
  // current one. The mix's verdict changes only when a monster enters or leaves the party's fight.
  // Between fights no monster is on the party, so the last fight's verdict stands and the aura does
  // not flip at each pull.
  let auraState = '', auraSetUnder = '', auraNow = '', verdict: boolean | null = null, perMp = 0;
  function auraCondition(w: SkillWorld): string {
    const facts = auraFacts(w);
    if (facts.magical !== null) verdict = facts.magical;
    return auraNow = facts.key + '|' + verdict;
  }
  const world = () => ports.world();
  function report(w: SkillWorld, d: SkillDecision, status: SkillDiagnostic['status'], reason = d.reason) {
    ports.diagnostic({ at: w.now, skill: d.skill, targets: d.targets.map(t => t.id || t.name),
      category: d.category, reserve: reserve(w), reason, status });
  }
  function affordable(w: SkillWorld, d: SkillDecision): boolean {
    const reason = blocked(w, d, ports.ledger.mp());
    if (reason) { report(w, d, 'skipped', reason); return false; }
    // The ledger books each spend under the one family rule (api.ts `familyOf`, design 3.2).
    return !ports.ledger.flying(familyOf(w.skills, d.skill));
  }
  // The ranking at this edge (ranking.ts), with the MP in flight and the observed income. Its damage
  // per MP stays for the status report (TRN-Q-DPS DPS-4) until the next edge ranks again. One pass
  // builds one world, so the attack and offense sources of a pass read one ranking of its target.
  const rankings = new WeakMap<SkillWorld, Map<string, Ranking>>();
  function ranked(w: SkillWorld, target: Combatant): Ranking {
    const own = rankings.get(w) ?? new Map<string, Ranking>(), kept = own.get(target.id);
    if (kept) return kept;
    const r = rank(w, target, ports.ledger.mp(), income.observe(w.now, w.actor.mp, cooldownOf(w.skills, 'regen_mp', Number(w.actor.frequency) || 1)));
    own.set(target.id, r); rankings.set(w, own);
    perMp = r.perMp;
    return r;
  }
  function settle(d: SkillDecision, actions: (string | null)[], result: unknown) {
    const response = result as { targets?: string[]; target?: string } | undefined;
    const accepted = new Set(response?.targets || (response?.target ? [response.target] : []));
    d.targets.forEach((t, i) => {
      if (!actions[i]) return;
      const success = accepted.has(t.id) || !response?.targets && d.targets.length === 1;
      ports.evidence(t, success ? 'engaged' : 'rejected', actions[i]!);
    });
  }
  function rejectActions(d: SkillDecision, actions: (string | null)[]) {
    actions.forEach((a, i) => { if (a) ports.evidence(d.targets[i], 'rejected', a); });
  }
  function recordAura(d: SkillDecision) {
    if (d.skill === 'paladin_aura') { auraSetUnder = auraNow; auraState = String(d.argument ?? ''); }
  }
  // What the console books for one decision the turns executor sends: the queue evidence at the
  // send, and on the reply the evidence's settle and the aura record.
  function book(d: SkillDecision) {
    const w = world();
    let actions: (string | null)[] = [];
    const publishAfterCast = !!ports.publishAfterCast?.(d);
    const hostile = !!w.skills[d.skill]?.hostile;
    if (!publishAfterCast) actions = d.targets.map(t => hostile ? ports.evidence(t, 'pending') : null);
    return {
      sent() {
        if (publishAfterCast) actions = d.targets.map(t => hostile ? ports.evidence(t, 'pending') : null);
      },
      accepted(result: unknown) { settle(d, actions, result); recordAura(d); },
      rejected() { rejectActions(d, actions); },
    };
  }
  // The decisions of one pass for the turns executor's core source, each checked against the
  // world of that pass.
  const choices = {
    support(w: SkillWorld): SkillDecision[] {
      const list = w.actor.ctype === 'paladin' ? paladinSupport(w) : w.actor.ctype === 'rogue' ? rogueSupport(w) : combatBuffSupport(w);
      // A condition whose aura is the one already set counts as answered.
      const condition = w.actor.ctype === 'paladin' ? auraCondition(w) : auraSetUnder;
      const asked = list.find(d => d.skill === 'paladin_aura');
      if (auraState && (!asked || asked.argument === auraState)) auraSetUnder = condition;
      return list.filter(d => (d.skill !== 'paladin_aura' || condition !== auraSetUnder && d.argument !== auraState) && affordable(w, d));
    },
    absorb(w: SkillWorld): SkillDecision | null { const d = absorbDecision(w); return d && affordable(w, d) ? d : null; },
    // The other cooldown families' casts, and a better spot asked of movement; the next edge ranks
    // again from wherever the walk got to.
    offense(w: SkillWorld, target: Combatant): SkillDecision[] {
      const r = ranked(w, target);
      if (r.move) ports.position?.(r.move);
      return r.casts.filter(d => affordable(w, d));
    },
    attack(w: SkillWorld, target: Combatant): SkillDecision | null {
      if (w.context.mode === 'blocked') return null;
      const opening = opener(w, target);
      if (opening && affordable(w, opening)) return opening;
      const d = ranked(w, target).attack;
      return d && affordable(w, d) ? d : null;
    },
  };
  return {
    choices, book,
    ready(d: SkillDecision) { return affordable(world(), d); },
    perMp: () => perMp,
    reset() { income.reset(); auraState = auraSetUnder = auraNow = ''; verdict = null; perMp = 0; },
  };
}
