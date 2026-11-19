// The add-on API for play code. An add-on's play code imports the core only through this module, so
// an owner can rework its internals without breaking an add-on. Each owner publishes its functions
// and types in its own api/<NN>-<area>.ts, and this module re-exports all fourteen. A change here
// shows in the hook list's diff. `addon:check` and owner:check fail any other core import.
import type { AskableHook, HookRegistry, ReadAnswer, ReadArgs, ReadName, Registration } from './registry.ts';

export * from './api/01-tasks.ts';
export * from './api/02-movement.ts';
export * from './api/03-turns.ts';
export * from './api/04-targeting.ts';
export * from './api/05-survival.ts';
export * from './api/06-events.ts';
export * from './api/07-hunting.ts';
export * from './api/08-merchant.ts';
export * from './api/09-calls.ts';
export * from './api/10-items.ts';
export * from './api/11-settings.ts';
export * from './api/12-status.ts';
export * from './api/13-lifecycle.ts';
export * from './api/14-addons.ts';

// The types a hook signature or a published read names that no owner's api file exports
//, so an add-on can name each type its answer takes or returns.
export type { AddonCommandView, AddonWalkAnswer, AddonWalkView, BankLayoutView, CallAnswer, CallQuestion, CrossingAsk, EscapeHold,
  EventAttendAsk, FormationAnswer, FormationAsk, GroupFightView, GroupView, ItemSourceAsk, MemberHold, MemberHoldAsk, MerchantRoutineAnswer,
  MerchantRoutineView, Monster, MovementLive, NoticeName, OverlayAsk, OwnTaskHook, PassingCause, PublishedReads, QueueSelection, RareSearchAsk,
  RecoveryView, RespawnAnswer, RetryAnswer, RetryAsk, RouteAvoidAsk, RoutineView, StepPointAsk, SurvivalChoiceAsk, SurvivalQuestion,
  SurvivalRefusalAsk, TargetSettingsAnswer, TargetingRuleAsk, TurnsTargetAnswer, WalkAsk, WalkEndCode, WalkFlagsAnswer, WalkFlagsView } from './registry.ts';
export type { MovementIncident, MovementRecord, MovementRequest, StepOptions, StepResult, WalkView } from '../protocol/records.ts';
export type { Rung } from '../protocol/ladder.ts';
export type { ItemMark } from '../coordinator/contracts/item.ts';
export type { GameMonster } from '../movement/api/coordinator.ts';
export type { DeclaredSetting } from '../settings/api.ts';
export type { EventKindAnswer } from '../events/api.ts';
export type { FarmSpotAnswer, FarmSpotAsk, HuntQuestAsk } from '../hunting/api.ts';

// What the coordinator delivers to the add-on `name` with each status reply: its `target.mode`
// answer for the character's scope. It reads the realm's one registry from `globalThis`, as
// runtime/hooks/index.ts keeps it, since importing index.ts would import every add-on back.
export function delivered(name: string): unknown {
  return (globalThis as { __partyHooks?: HookRegistry }).__partyHooks?.delivered(name);
}

// A published read's own signature, as its one core answer declares it.
type Answer<H extends AskableHook> = NonNullable<Registration['hooks'][H]> extends (...args: infer A) => infer R ? (...args: A) => R : never;
// An add-on asks a published read: only a row marked `addonMayAsk: true`, a read that changes
// nothing, typechecks, and `addon:check` fails an ask whose name is not a string literal.
export function ask<H extends AskableHook>(name: H, ...question: Parameters<Answer<H>>): ReturnType<Answer<H>> {
  const registry = (globalThis as { __partyHooks?: HookRegistry }).__partyHooks;
  if (!registry) throw Error(`ask ${name}: this realm has no hook registry`);
  return registry.askRow(name, question) as ReturnType<Answer<H>>;
}
// The one read call: a hook row an add-on may ask, or an owner's `READS`
// row. `ask` above stays as its alias for one release.
export function read<N extends ReadName>(name: N, ...question: ReadArgs<N>): ReadAnswer<N> {
  const registry = (globalThis as { __partyHooks?: HookRegistry }).__partyHooks;
  if (!registry) throw Error(`read ${name}: this realm has no hook registry`);
  return registry.askRow(name as AskableHook, question) as ReadAnswer<N>;
}
