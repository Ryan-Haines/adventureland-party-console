// The add-on action queue. `act` only queues: it returns the
// ticket at once and makes no call. Each add-on has at most one action pending and one in flight
// per character, so the queue holds at most two entries per enabled add-on and character. A new
// ask while one is pending replaces it, and the replaced ticket settles `refused` with `replaced`.
// The same queue runs on both sides: the character's dispatcher takes from it, and the coordinator
// carries its asks in the character's reply.
import type { ActionAsk, ActionOutcome } from '../registry.ts';

// `facts` is the coordinator's facts for the action's door, which a carried ask brings (registry.ts
// `DoorAsk`).
export interface QueuedAction { id: string; addon: string; character: string; action: ActionAsk['action']; args: Readonly<Record<string, unknown>>; reason: string;
  facts?: Readonly<Record<string, unknown>> }

export function createActionQueue(ports: { settled(outcome: ActionOutcome): void }) {
  let seq = 0;
  const pending = new Map<string, QueuedAction>(), inFlight = new Map<string, QueuedAction>();
  // Each settled outcome stays readable through `ctx.outcome(id)` until the report after the one
  // it settled before (`reported`).
  const kept = new Map<string, { outcome: ActionOutcome; reports: number }>();
  const remove = (id: string) => {
    for (const [k, a] of inFlight) if (a.id === id) inFlight.delete(k);
    for (const [k, a] of pending) if (a.id === id) pending.delete(k);
  };
  const slot = (character: string, addon: string) => JSON.stringify([character, addon]);
  function settle(outcome: ActionOutcome): void {
    remove(outcome.id);
    kept.set(outcome.id, { outcome, reports: 0 });
    ports.settled(outcome);
  }
  return {
    ask(addon: string, character: string, ask: ActionAsk): { id: string } {
      const id = `${addon}:${character}:${Date.now().toString(36)}:${++seq}`, k = slot(character, addon);
      const replaced = pending.get(k);
      pending.set(k, { id, addon, character, action: ask.action, args: { ...ask.args }, reason: String(ask.reason ?? '') });
      if (replaced) settle({ id: replaced.id, action: replaced.action, character, addon, outcome: 'refused', by: '14', reason: 'replaced' });
      return { id };
    },
    // The next action of each add-on for this character whose previous one settled; each moves to
    // in flight.
    take(character: string): QueuedAction[] {
      const out: QueuedAction[] = [];
      for (const [k, a] of pending) if (a.character === character && !inFlight.has(k)) { pending.delete(k); inFlight.set(k, a); out.push(a); }
      return out;
    },
    // Every action in flight for this character, which the coordinator carries in each reply until
    // its outcome comes back.
    inFlight: (character: string): QueuedAction[] => [...inFlight.values()].filter(a => a.character === character),
    settle,
    // An outcome the character reports for an ask the coordinator carried. An id the queue no longer
    // holds, as after a coordinator restart, settles nothing.
    reported(outcome: ActionOutcome): boolean {
      if (![...inFlight.values()].some(a => a.id === outcome.id)) return false;
      settle(outcome); return true;
    },
    outcome: (addon: string, id: string): ActionOutcome | undefined => { const o = kept.get(id)?.outcome; return o && o.addon === addon ? o : undefined; },
    // On the character: an ask the coordinator carried, queued under the coordinator's id. A newer
    // carried ask of the same add-on replaces a pending one, as a local ask does.
    carry(a: QueuedAction): void {
      const k = slot(a.character, a.addon), replaced = pending.get(k);
      pending.set(k, a);
      if (replaced) settle({ id: replaced.id, action: replaced.action, character: a.character, addon: a.addon, outcome: 'refused', by: '14', reason: 'replaced' });
    },
    // A carried ask whose outcome goes back in the report: it leaves the queue with no notice here.
    forget: remove,
    // One report of this character passed: its outcomes kept since before its previous report leave.
    passed(character: string): void { for (const [id, k] of kept) if (k.outcome.character === character && ++k.reports > 1) kept.delete(id); },
    // An add-on switched off: its pending asks settle refused, and its in-flight one settles when
    // its door answers.
    drop(addon: string): void {
      for (const a of [...pending.values()]) if (a.addon === addon) settle({ id: a.id, action: a.action, character: a.character, addon, outcome: 'refused', by: '14', reason: 'add-on off' });
    },
  };
}
export type ActionQueue = ReturnType<typeof createActionQueue>;
