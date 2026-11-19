import type { Entity, DamageType } from 'typed-adventureland';
import type { GSkill, SkillKey } from 'typed-adventureland/dist/src/types/GTypes/skills/Skills.js';

// Verified against client 17083. Upstream 0.0.57 predates the September 2026
// paladin expansion and Fan of Knives. Review these extensions on upgrade.
export type SkillId = SkillKey | 'fanofknives' | 'aether_shield' | 'cleansing_light' |
  'guardians_oath' | 'beacon_of_resolve' | 'paladin_aura' | 'shield_slam';
export interface SkillDefinition extends Omit<GSkill, 'condition' | 'share'> {
  condition?: string;
  share?: SkillId;
  fixed_range?: boolean;
  no_self?: boolean;
  offhand_type?: string;
  max_targets?: number;
  // A skill the server resolves over several monsters' ids (G.skills[id].multi).
  multi?: boolean;
  armor_multiplier?: number;
  armor_cap?: number;
  // Purify's damage for each condition it strips (game data `purify.condition_damage`).
  condition_damage?: number;
  exclusive_condition?: string;
  // A magical skill the target's reflection does not answer (G.skills[id].no_reflection).
  no_reflection?: boolean;
}
export type Conditions = Record<string, { ms?: number; f?: string; from?: string; s?: number; citizens?: boolean } | undefined>;
// Entity/Character omit new condition IDs and Character omits damage_type.
export type Combatant = Omit<Entity, 's'> & { s: Conditions };
export type Actor = Omit<Character, 's'> & { s: Conditions; damage_type?: DamageType };
export type Spending = 'survival' | 'maintenance' | 'damage';
export interface CombatContext {
  leader: string;
  allies: Combatant[];
  monsters: Combatant[];
  mode: 'grouped' | 'scatter' | 'event' | 'blocked';
  event: string | null;
  observedAt: number;
}
export interface SkillDecision {
  skill: SkillId;
  targets: Combatant[];
  category: Spending;
  reason: string;
  // The MP table's Cleave row (rules.ts `mpRefusal`): this cast may spend below the
  // class reserve.
  belowReserve?: true;
  // The game call's argument: a paladin aura's name with no target, Energize's MP amount after
  // its target (server.js `energize` moves `mp`), or the MP of each target in order, which the
  // executor sends as Controlled Mana Burst's `[id, mp]` pairs (server.js:9806-9819).
  argument?: string | number | readonly number[];
}
export interface SkillDiagnostic {
  at: number; skill: SkillId; targets: string[]; reserve: number;
  category: Spending; reason: string; status: 'selected' | 'accepted' | 'skipped' | 'rejected';
  // The turns executor's spend rank, cooldown family and requester.
  rank?: 'survival' | 'task' | 'damage' | 'maintenance'; family?: string; by?: string;
}
export interface SkillWorld {
  actor: Actor;
  context: CombatContext;
  now: number;
  skills: Partial<Record<SkillId, SkillDefinition>>;
  item(name: string): { wtype?: string; type?: string; charge?: number } | undefined;
  condition(name: string): { cleansable?: boolean; bad?: boolean; buff?: boolean; debuff?: boolean; persistent?: boolean;
    incdmgamp?: number; frequency?: number; duration?: number;
    // The condition stops its bearer moving, attacking and casting (game data `stunned.blocked`).
    blocked?: boolean } | undefined;
  cooldown(skill: SkillId): boolean;
  range(target: Combatant, skill: SkillId): boolean;
  allowed(target: Combatant, skill: SkillId): boolean;
  incoming(target: Combatant): number;
  // The targeting owner's threat fact (`targeting.attacking`): the monster attacks a party member.
  attacking(target: Combatant): boolean;
  damageMultiplier(defense: number): number;
  // The member that owns Taunt, Absorb and Agitate when `targeting.aggroOwner` names one; with
  // none, the leader does.
  aggroOwner?: string;
  // The ranking's reads (ranking.ts, TRN-Q-DPS). `mpPotion`: the MP an MP potion gives when the survival owner's
  // potion table would drink one at that MP now (`survival.mpPotion`), else 0. `pullOnly`: 04 refuses
  // the monster only because the party has not engaged it (`targeting.pullOnly`). `healthy`: every
  // party member stands at or above the survival owner's healthy share (`survival.healthy`). With no answer the
  // ranking counts no potion and no pull, and the party reads healthy.
  mpPotion?(mpAfter: number): number;
  pullOnly?(target: Combatant, skill: SkillId): boolean;
  healthy?(): boolean;
  // The other members' turns reports, each ready time in this character's clock (TRN-Q-DPS DPS-3,
  // DPS-4), and the support casts this character's class file sets now, by skill. With no answer no
  // member reports and the class file sets none.
  reports?(): { name: string; turns?: TurnsReport }[];
  support?(): Partial<Record<SkillId, SupportSet>>;
}
// A support cast as the class file sets it: the member it goes to and the MP it moves (mage.ts's
// Energize).
export interface SupportSet { target: string; mp: number }
// What a member's status report carries for the other members' rankings (REVIEW-QUEUE TRN-Q-DPS
// DPS-3, DPS-4, DPS-9): the party damage its ranking turns one more MP into, a healer's HP per MP, the
// MP its potions trade per HP, and each support cast's ready time (the game's `next_skill`, in the
// coordinator's clock) with the target and MP its class file has set, or no target.
export interface TurnsReport {
  damagePerMp: number;
  // For a class that heals (game data `heal.class`): the HP one MP of its heal restores, its `heal`
  // stat over its `mp_cost` (server.js:3354-3356), so another member's ranking prices the HP it saves.
  healPerMp?: number;
  // For a member whose bag holds both potions: the MP its MP potion gives over the HP its HP potion
  // gives. The two share one cooldown (protocol/hold-check.ts:10), so an HP potion it need not drink
  // is one more MP potion.
  potionMpPerHp?: number;
  // Whether the character fights its selected target: the attack controller's last accepted
  // attack hit that target (attack.ts `lastTarget`). The hunt's fight check reads it, so a member
  // kiting out of range still fights until it drops or kills the target.
  fighting?: boolean;
  support: Partial<Record<SkillId, { readyAt: number; target: string | null; mp: number }>>;
}
export const health = (actor: Pick<Actor, 'hp' | 'max_hp'>) => actor.hp / Math.max(1, actor.max_hp);
export const decision = (skill: SkillId, targets: Combatant[] = [], category: Spending = 'damage', reason: string = skill): SkillDecision =>
  ({ skill, targets, category, reason });
