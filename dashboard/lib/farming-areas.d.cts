export type FarmingArea = { id: string; map: string; mapName?: string; x: number; y: number; boundary?: number[]; monsterIds: string[] };
export function farmingAreas(catalog: { id: string; locations?: { map: string; x: number; y: number; mapName?: string; boundary?: number[] }[] }[], ids: string[]): FarmingArea[];
export function validFarmingLocation(catalog: Parameters<typeof farmingAreas>[0], ids: string[], location: {map: string; x: number; y: number}): FarmingArea | null;
