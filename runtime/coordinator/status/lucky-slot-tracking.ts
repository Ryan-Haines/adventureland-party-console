import { normalizeSlotTracking, mergeSlotStream, type LuckySlotHistory } from '../../lucky-slot-tracking.ts';
export interface LuckySlotState { luckySlotTracking?: LuckySlotHistory }
export function receiveLuckySlotTracking(state: LuckySlotState, name: string, raw: unknown): boolean {
  const incoming = normalizeSlotTracking(raw);
  if (!incoming.streamId || !Object.keys(incoming.slots).length) return false;
  const history = state.luckySlotTracking ??= {};
  const streams = history[name] ??= {};
  const previous = streams[incoming.streamId] ??= {version: 1, streamId: incoming.streamId, slots: {}};
  return mergeSlotStream(previous, incoming);
}
