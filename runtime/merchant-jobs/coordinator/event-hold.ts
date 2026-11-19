// The merchant's event hold, which the dispatcher, the checkpoint, the stand return and the
// reply read: the tasks owner's live event task holds it, or the merchant's own report of a live event it selected.
import { eventDeferredReturn, selectedEvents } from '../../events/api.ts';
import { tasks } from '../../tasks/api.ts';
import type { MerchantEventState } from '../rules.ts';
import { fresh } from '../../protocol/reports.ts';

// The events owner's event work holds the merchant while its group's live task
// is the event's attendance or its return (the tasks owner's `task.live`). A merchant offline during an
// anniversary return holds a deferred return, which also reserves it until that return runs
// (the events owner's eventDeferredReturn, b9b5c91e merchant/event-control.ts:18).
export function merchantEventRecoveryReserved(state: Pick<MerchantEventState, 'merchantCharacter'>): boolean {
  const name = state.merchantCharacter;
  if (!name) return false;
  const answers = tasks(), group = answers.groupOf(name), kind = group ? answers.live(group)?.kind : null;
  return kind === 'event-attendance' || kind === 'event-return' || eventDeferredReturn(name);
}

// Or the merchant's own report holds it: a fresh report says an event it selected is live, a report
// before the coordinator admits it (runtime/events/character/merchant.ts).
export function merchantEventReserved(state: MerchantEventState, now: number): boolean {
  if (merchantEventRecoveryReserved(state)) return true;
  const name = state.merchantCharacter;
  if (!name) return false;
  const status = state.statuses[name];
  return !!status && fresh(Number(status.seenAt), now, 'presence') && !!status.merchantEventReserved &&
    selectedEvents(state, name).some(event => event !== 'anniversary');
}
