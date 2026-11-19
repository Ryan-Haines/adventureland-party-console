// Reflect handling: two lists per character, "Don't hit with magic" and "Don't hit with physical". A
// character with no entry keeps b9b5c91e's monsters (monster-attack-policy.ts `defaultLists`), so
// nothing changes in play until a player edits a list. The choices are the monsters game data rates:
// `reflection` above 0 for the magic list and `dreturn` above 0 for the physical list, so a new
// reflector in the next game data is a choice with no code change.
import { defaultLists, type ReflectLists } from './gates.ts';
import type { HookRegistry } from '../../hooks/registry.ts';

export type { ReflectLists };
// The coordinator's game data, movement's published read, asked through the realm's registry. Null
// until it loads.
const gameMonsters = () => (globalThis as { __partyHooks?: HookRegistry }).__partyHooks?.movement.gameMonsters() ?? null;
const names = (value: unknown): readonly string[] | undefined =>
  Array.isArray(value) && value.every(v => typeof v === 'string') ? value as readonly string[] : undefined;
// This character's two lists from the settings its report reply delivered: each saved entry by
// character name, the default lists where it has none.
export function reflectLists(magic: unknown, physical: unknown, name: string): ReflectLists {
  const entry = (saved: unknown) => saved && typeof saved === 'object' ? (saved as Record<string, unknown>)[name] : undefined;
  return { magic: names(entry(magic)) ?? defaultLists.magic, physical: names(entry(physical)) ?? defaultLists.physical };
}
// The monsters each list can hold, from the coordinator's game data; none until it loads.
export function reflectChoices(): { magic: string[]; physical: string[] } {
  const monsters = gameMonsters() ?? {};
  const rated = (field: 'reflection' | 'dreturn') => Object.entries(monsters)
    .filter(([, m]) => Number(m?.[field]) > 0).map(([type]) => type).sort();
  return { magic: rated('reflection'), physical: rated('dreturn') };
}
// A saved value of one list: a list of monster types per character, each one game data rates for
// that list. Before the game data loads every type passes, so the load keeps a saved list
// and the write checks it once the data is there.
export function reflectCheck(list: 'magic' | 'physical') {
  return (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const loaded = gameMonsters(), choices = loaded ? new Set(reflectChoices()[list]) : null;
    return Object.values(value as Record<string, unknown>).every(entry => {
      const types = names(entry);
      return !!types && (!choices || types.every(type => choices.has(type)));
    });
  };
}
