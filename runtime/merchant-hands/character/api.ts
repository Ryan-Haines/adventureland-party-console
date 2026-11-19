// The hands owner's character door: 09 owns the game's
// equip and unequip, so every equip and unequip outside the hands' own lease (character/owner.ts
// `handCall`) goes out here. rules.ts and ../api.ts stay free of game calls, so the dashboard
// still loads the other door.
import { partyHooks } from '../../hooks/index.ts';
import type { CallBand } from '../../hooks/registry.ts';

// handsSend asks the call budget's band once and, on `send`, makes the call in the same synchronous
// turn. On "not now" it makes no call and returns null, and the caller
// waits a call window on its own handle and asks again, as each caller did before the call moved here.
export function handsSend(band: CallBand, method: 'equip', slot: number, slotName?: string): Promise<unknown> | null;
export function handsSend(band: CallBand, method: 'unequip', slot: string): Promise<unknown> | null;
export function handsSend(band: CallBand, method: 'equip' | 'unequip', slot: number | string, slotName?: string): Promise<unknown> | null {
  if (partyHooks().calls.band({ band, method }) !== 'send') return null;
  return method === 'equip' ? equip(slot as number, slotName as any) : unequip(slot as any);
}
