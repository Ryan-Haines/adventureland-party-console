// The panel's presses as the actions the console carries out. The card sends one of three bodies
// through `addon.command`; the coordinator turns it into the items owner's `item.wearLook` (the
// game's equip_cx) or the turns owner's `emote`, each refused by its owner's own check when the
// look is not unlocked.
import type { ActionAsk, ActionOutcome } from '../../hooks/addon-api.ts';

export type CosmeticsCommand =
  | { wear: { slot: string; name: string } }
  | { takeOff: { slot: string } }
  | { emote: string };

// What the panel shows under the buttons after a press settles, kept per character in the party store.
export interface LastPress { label: string; outcome: 'sent' | 'refused' | 'failed'; detail?: string; at: number }
export const lastKey = (character: string) => `last.${character}`;
export const pendingKey = (character: string) => `pending.${character}`;

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

// The ask for one press, or the reason the body is no press this add-on sends.
export function commandAsk(body: unknown): { ask: ActionAsk; label: string } | { error: string } {
  const b = (body ?? {}) as Partial<Record<'wear' | 'takeOff' | 'emote', unknown>>;
  if (b.wear !== undefined) {
    const w = b.wear as { slot?: unknown; name?: unknown };
    if (!text(w.slot) || !text(w.name)) return { error: 'wear needs a slot and a look' };
    return { ask: { action: 'item.wearLook', args: { slot: w.slot, name: w.name }, reason: `put on ${w.name}` }, label: `Put on ${w.name}` };
  }
  if (b.takeOff !== undefined) {
    const t = b.takeOff as { slot?: unknown };
    if (!text(t.slot)) return { error: 'takeOff needs a slot' };
    // The door sends equip_cx(slot) with no name, which the game reads as clearing the slot.
    return { ask: { action: 'item.wearLook', args: { slot: t.slot }, reason: `take off the ${t.slot} look` }, label: `Take off ${t.slot}` };
  }
  if (b.emote !== undefined) {
    if (!text(b.emote)) return { error: 'emote needs a skill name' };
    return { ask: { action: 'emote', args: { name: b.emote }, reason: `play the ${b.emote} emote` }, label: `Emote ${b.emote}` };
  }
  return { error: 'the body names no wear, takeOff or emote' };
}

// The line an `addon.acted` outcome leaves for the panel.
export function lastPress(outcome: ActionOutcome, label: string, at: number): LastPress {
  if (outcome.outcome === 'sent') return { label, outcome: 'sent', at };
  if (outcome.outcome === 'refused') return { label, outcome: 'refused', detail: `${outcome.by}: ${outcome.reason}`, at };
  return { label, outcome: 'failed', detail: outcome.error, at };
}
