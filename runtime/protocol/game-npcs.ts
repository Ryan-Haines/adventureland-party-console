// The NPCs' places from the game's maps, the one copy movement's `movement.npcPlace` read answers.
// The coordinator sets the maps from the data.js its planner prepares (movement's
// coordinator/runtime.ts `prepareMovement`), and a character reads its own game's `G`.
type MapNpc = { id?: string; position?: readonly number[]; positions?: readonly (readonly number[])[] };
type GameMaps = Readonly<Record<string, { ignore?: unknown; npcs?: readonly MapNpc[] } | undefined>>;
let maps: GameMaps | null = null;
export function setGameMaps(table: GameMaps | null): void { maps = table; }
// The first map that lists the NPC, at its first position, as the game's find_npc finds it; null for
// an NPC no map lists or before the game data loads.
export function npcPlace(id: string): { map: string; x: number; y: number } | null {
  const table = maps ?? (globalThis as { G?: { maps?: GameMaps } }).G?.maps ?? {};
  for (const [map, data] of Object.entries(table)) {
    if (!data || data.ignore) continue;
    const npc = data.npcs?.find(entry => entry.id === id), at = npc?.position ?? npc?.positions?.[0];
    if (at && Number.isFinite(at[0]) && Number.isFinite(at[1])) return { map, x: at[0]!, y: at[1]! };
  }
  return null;
}
