// The groups and tasks owner's public file:
// the answers every
// other owner may ask and the types it publishes. Its values come from rules.ts alone, so the
// dashboard's bundle loads no coordinator code through it; the hunting owner's coordinator code calls the
// coordinator values through coordinator/api.ts. Nothing else under runtime/tasks/ is importable
// from another owner (owner:check), and an add-on imports these types only through
// runtime/hooks/addon-api.ts. The coordinator's install (coordinator/install.ts) sets the answers.
import type { Tier } from '../protocol/ranks.ts';
import type { FailOptions, Reunion, Rung, TaskKind } from './rules.ts';
import type { GroupStatus } from './coordinator/owner.ts';

export type { EndCode, TaskKind } from './rules.ts';
// `groups`, which the coordinator's one combat group composition reads, and
// `hunt`'s hand-in and `events-pending`, which the hunting owner's Hunt files read.
export { GROUPS, priority } from './rules.ts';
// The event yield and the Hunt record, and the source shapes, which the hunting owner's task sources
// (runtime/hunting/coordinator/install.ts) answer with.
export { dueYields, type HuntRecord } from './rules.ts';
// The tiers and their order, which the events owner's return repair reads a participant's live task by.
export { above, taskTier } from './rules.ts';
// The declared source order, which the registry's task dispatch (hooks/rows/01-tasks.ts) asks in.
export { GROUP_KINDS, SOURCE_ORDER } from './rules.ts';
// A farming scope's owner, which the coordinator's scopes and the dashboard's card read.
export { scopeGroups, scopeOwner } from './rules.ts';
export type { SourceAnswer, SourceAsk, SourceView } from './coordinator/sources.ts';
export type { GroupStatus } from './coordinator/owner.ts';
export type { MemberAssignment as Assignment } from './coordinator/assignment.ts';
export type { TargetModeView, TargetModePorts, HuntModePorts } from './coordinator/slots.ts';
// The hand control a character's Manual switch saves, which the formation route checks.
export { HAND_CONTROL_DEFAULT, type HandControl } from './rules.ts';
// A farming scope's saved profiles (groups.ts), which the hunting owner's farming record types.
export type { FarmingProfiles } from './coordinator/groups.ts';
// The saved trips as the settings journal holds them, for the coordinator's load.
export { savedManual } from './rules.ts';

// A source's view of its group's task ladder. It acts only while the group's live task is one
// of the source's kinds, so one source never climbs another's task (rule 2.3.6).
export interface LadderPort {
  fail(code: string, options?: FailOptions): { rung: Rung } | null;
  progress(): void;
  rung(): Rung | null;
}
interface LiveTask { kind: TaskKind; owner: string; tier: Tier; members: string[]; since: number }
// The questions a reader of another owner asks.
export interface TaskAnswers {
  live(group: string): LiveTask | null;
  // The group a member's assignment comes from, or null.
  groupOf(name: string): string | null;
  assignment(name: string): { kind: TaskKind; owner: string; tier: Tier; goal?: unknown; phase?: string; reunion: Reunion } | null;
  // `death-recovery` reads the member's presence; the other two read its group's live task.
  allows(question: 'merchant-visit' | 'event-attendance' | 'death-recovery', name: string): boolean;
  // `turn-in`: the group's Hunt record holds travel for its hand-in. `heartbeat` also reads
  // the yield to a due event (`dueYields`); `travel` reads it without, as today.
  turnInHolds(group: string, reader: 'heartbeat' | 'travel'): boolean;
  // The member or group is under a hold that keeps the console from moving it.
  held(name: string): boolean;
  // `runs`: whether a source may act in the group now; null names the party's group.
  runs(group: string | null, source: 'mode' | 'rare' | 'anniversary' | 'event-return' | 'farm-area'): boolean;
  // The group's Hunt hand-in yields to a due event, and no hold stops the group acting.
  huntYields(group: string): boolean;
  status(target: string): GroupStatus | null;
}
type Root = { __partyTaskAnswers?: TaskAnswers };
export function tasks(): TaskAnswers {
  const answers = (globalThis as Root).__partyTaskAnswers;
  if (!answers) throw Error('The groups and tasks owner is not installed in this realm');
  return answers;
}
export function publishTasks(answers: TaskAnswers): void { (globalThis as Root).__partyTaskAnswers = answers; }
// The character doors targeting's ports hold.
export type { CharacterHolds } from './character/holds.ts';
export type { TaskAssignment } from './character/assignment.ts';
export type { PartyMembership } from './character/membership.ts';
