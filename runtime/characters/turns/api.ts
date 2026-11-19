// The turns owner's public file: what other owners import from runtime/characters/turns/. The family table,
// the request and answer shapes and the reason of a rejection are defined here; the class roles
// and the skill engine's shapes are re-exported from their modules. Add-ons import the shapes
// from runtime/hooks/addon-api.ts instead.
import type { Role, Target } from './role-types.ts';
// The role, combat state and combat root shapes other owners' character code types against.
export type { CombatRoot, CombatState, Role, RoleRunner, SharedCombat, Target } from './role-types.ts';
import type { AttackContext, SpendAsk, SpendRequester } from '../../hooks/registry.ts';
import type { SpendRank } from '../../protocol/ranks.ts';
import type { Combatant, SkillWorld } from './skills/types.ts';
import type { TargetAnswer } from '../targeting/api.ts';
export type { SpendRank, TargetAnswer };
export type { Combatant, SkillDiagnostic, SkillWorld } from './skills/types.ts';
export { health } from './skills/types.ts';
// The server's area read targeting's group lock and Franky rows ask.
export { hitsAroundCaster } from './skills/server.ts';
export { healFirstBelowOf } from './saved-fields.ts';
// The basic attack's source and its ready time, which the status owner's handoff notes name
// (runtime/status/character/rings.ts).
export { ATTACK_SOURCE } from './executor.ts';
export { attackReadyAt } from './attack.ts';
export { installTurns, type TurnsInstall } from './install.ts';
// The turns owner's add-on action doors (addon-capabilities.md C1, rows/03-turns.ts `ACTIONS`):
// `spend` and `emote`, through the spend table with H9 and H10 lifted for the one spend. The role runner's
// install sets them.
import type { Door } from '../../hooks/registry.ts';
type TurnsDoorRoot = { __partyTurnsDoors?: import('./install.ts').TurnsInstall['doors'] };
function turnsDoors() {
  const doors = (globalThis as TurnsDoorRoot).__partyTurnsDoors;
  if (!doors) throw Error('The turns owner is not installed on this character');
  return doors;
}
export const spend: Door = (args, ask) => turnsDoors().spend(args, ask);
export const emote: Door = (args, ask) => turnsDoors().emote(args, ask);
export { defaultRole } from './classes/default.ts';
export { role as mage } from './classes/mage.ts';
export { role as merchant } from './classes/merchant.ts';
export { role as paladin } from './classes/paladin.ts';
export { role as priest } from './classes/priest.ts';
export { role as ranger } from './classes/ranger.ts';
export { role as rogue } from './classes/rogue.ts';
export { role as warrior } from './classes/warrior.ts';

// The reason a game call's rejection names: its `reason`, else its `message`.
export function errorReason(error: unknown): string {
  if (error && typeof error === "object") {
    if ("reason" in error && typeof error.reason === "string") return error.reason;
    if ("message" in error && typeof error.message === "string") return error.message;
  }
  return String(error);
}

type SkillData = { cooldown_group?: string; share?: string; cooldown?: number; reuse_cooldown?: number; cooldown_multiplier?: number; hostile?: boolean; multi?: boolean; target?: unknown };
export type Skills = Record<string, SkillData | undefined>;

// A family is the server's cooldown: `cooldown_group`, else `share`, else the skill itself (game
// data 18285). use_hp, use_mp, regen_hp and regen_mp carry `cooldown_group: "potion"`, and the
// server keeps one `player.last.potion` for all four (server.js:7807-7811, 7856, 12042-12048 at
// the game pin), so they form one family even where regen_hp and regen_mp also carry a `share`.
export function familyOf(skills: Skills, skill: string): string {
  const data = skills[skill];
  return data?.cooldown_group ?? data?.share ?? skill;
}

// The `next_skill` entry that says when a family is ready: the end of the `share` chain, which the
// game's own `is_on_cooldown` follows (runner_functions.js:828-832). The potion group reads
// `use_hp`: the client's `pot_timeout` sets `use_hp` and `use_mp` together and never writes
// `next_skill.potion` (functions.js:5414-5419).
export function readyKey(skills: Skills, skill: string): string {
  if (familyOf(skills, skill) === 'potion') return 'use_hp';
  const seen = new Set<string>();
  let key = skill;
  while (skills[key]?.share && !seen.has(key)) { seen.add(key); key = skills[key]!.share!; }
  return key;
}

// Every skill of the game data by its family, built once at load.
export function familyTable(skills: Skills): Record<string, string[]> {
  const table: Record<string, string[]> = {};
  for (const skill of Object.keys(skills)) (table[familyOf(skills, skill)] ??= []).push(skill);
  return table;
}

// The cooldown a spend starts on the server (server.js:9858-9867): the basic attack's
// `1000 / frequency` (the client's own `skill_timeout`, functions.js:5486), a skill's own
// `cooldown` or `reuse_cooldown`, or its share's cooldown times `cooldown_multiplier`.
export function cooldownOf(skills: Skills, skill: string, frequency: number): number {
  if (skill === 'attack' || readyKey(skills, skill) === 'attack') return 1000 / (frequency || 1);
  const data = skills[skill];
  if (data?.cooldown || data?.reuse_cooldown) return Number(data.cooldown || data.reuse_cooldown);
  const share = data?.share ? skills[data.share] : undefined;
  return Number(share?.cooldown || 0) * (data?.cooldown_multiplier || 1);
}

// What a requester inside the console adds to its ask: `before` refuses the send at its last
// moment (the passing admission, 3.5), and `book` books what the console books today on the send
// and on the reply (3.4 "Settle").
interface Booking { sent?(): void; accepted?(result: unknown): void; rejected?(error: unknown): void }
// `belowReserve` is the MP table's urgent Cleave row (rules.ts `mpRefusal`). Its targets are the role runner's
// entity or the skill engine's monster; the executor reads each only by its `id`.
export interface CoreAsk extends SpendAsk<Target | Combatant> { before?(): string | null; book?: Booking; belowReserve?: true; context?: AttackContext<Target> }
export type TurnsRecord = { part: 'turns'; kind: 'refusal' | 'wait' | 'lost' | 'cooldown' | 'stale'; family: string; skill: string;
  rank?: SpendRank; by?: string; reason?: string; waitedMs?: number; ms?: number };
// A pass's cause: a role loop event, the attack edge, a push, or the passive pulse.
export type PassKind = 'event' | 'edge' | 'push' | 'pulse';
// What each requester sees on one pass: the spend table's read of it. `roleLoop` is false while the spend table row holds
// the role loop, `pulse` marks the passive pulse's pass, `attack` lets the attack family ask;
// `world` builds the skill engine's world, with its combat context, on first read.
export interface TurnsView {
  kind: PassKind; now: number; character: typeof character; role: Role; roleLoop: boolean; pulse: boolean; attack: boolean;
  combat: boolean; potions: boolean; target: TargetAnswer | null; healFirstBelow: number; world(): SkillWorld;
  inFlightMp: number; flying(family: string): boolean;
}
// The answer of `skills.ready`: whether the skill's family is ready, whether a spend of it is in
// flight and on which target (the Cave revival waits for the attack family's, targeting's
// selection keeps a started target), its cost, the reserve and the family's lost-reply margin
// (survival's escape and respawn read it).
export interface Readiness { ready: boolean; flying: boolean; target: string | null; cost: number; reserve: number; margin: number }
// What a class decision on the target gets from the role loop: the cast path, the readiness
// and the stand-in reads.
export interface ClassTurn {
  casts: import('./skills/runtime.ts').ClassCasts;
  ready(skill: string): Readiness;
  facts: import('./stand-ins/holds.ts').TurnsFacts;
}
