import type { QueryClient } from '@tanstack/react-query';
import type { Char } from './char';
import { receivedLiveRecord } from './live-metrics';

export type CharacterDomain = 'vitals' | 'position' | 'inventory' | 'diagnostics' | 'presence';
export type CharacterPosition = Pick<Char, 'x' | 'y' | 'map' | 'in'>;
export const characterKey = (name: string, kind: CharacterDomain) => ['party', 'character', name, kind] as const;
const positionFields = new Set(['x', 'y', 'map', 'in']);
export function splitPosition(value: Partial<Char>) {
  return {
    position: Object.fromEntries(Object.entries(value).filter(([key]) => positionFields.has(key))) as Partial<CharacterPosition>,
    vitals: Object.fromEntries(Object.entries(value).filter(([key]) => !positionFields.has(key))) as Partial<Char>,
  };
}

// Query's structural sharing retains equal nested values. Skip the entire write
// when the receiver has preserved all top-level field references.
export function writeCharacter(client: QueryClient, name: string, kind: CharacterDomain, value: Record<string, unknown> | null, sampledAt?: number) {
  const previous = client.getQueryData<Record<string, unknown> | null>(characterKey(name, kind));
  if (previous === value || previous && value && Object.keys(previous).length === Object.keys(value).length &&
      Object.keys(value).every(key => Object.is(previous[key], value[key]))) return;
  const stored = client.setQueryData(characterKey(name, kind), value);
  if (sampledAt && stored !== previous && (kind === 'vitals' || kind === 'position' || kind === 'inventory'))
    receivedLiveRecord(name, sampledAt, kind);
}
export function writeVitals(client: QueryClient, name: string, value: Partial<Char>, sampledAt?: number) {
  const { position, vitals } = splitPosition(value);
  writeCharacter(client, name, 'position', position, sampledAt);
  writeCharacter(client, name, 'vitals', vitals, sampledAt);
}
