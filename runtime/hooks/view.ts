// The view a `movement.request` mover receives each movement tick, as the movement owner builds it
// (runtime/movement/character/movers.ts `createMoverView`). Add-ons read the game through it and never
// call the game themselves.
export interface Point { x: number; y: number }
export type ViewEntity = Partial<{ id: string; name: string; type: string; mtype: string; ctype: string; map: string; in: string | number;
  x: number; y: number; real_x: number; real_y: number; going_x: number; going_y: number; moving: boolean; speed: number; target: string | null;
  dead: boolean; rip: boolean; visible: boolean; hp: number; max_hp: number; mp: number; max_mp: number; range: number; level: number;
  attack: number; frequency: number; aggro: number }>;
export interface MoverView {
  character: ViewEntity & { name: string; ctype: string; map: string; real_x: number; real_y: number };
  target?: ViewEntity;
  entities: Record<string, ViewEntity | undefined>;
  G: { maps: Record<string, { doors?: unknown[][]; monsters?: { type: string; boundary?: number[]; boundaries?: unknown[] }[] }>;
    monsters: Record<string, { aggro?: number; range?: number; speed?: number; special?: boolean; frequency?: number }> };
  now: number; combat: boolean;
  party: readonly string[]; leader: string | null; joinedEvent?: string | null; focus: readonly string[]; farmSpot: (Point & { map: string }) | null;
  stepSafe(to: Point, target?: string): boolean;
  inFarmArea(point: Point): boolean;
  canMoveTo(to: Point): boolean;
  canStand(to: Point): boolean;
}
export const position = (e: ViewEntity): Point => ({ x: Number.isFinite(e.real_x) ? e.real_x! : Number(e.x), y: Number.isFinite(e.real_y) ? e.real_y! : Number(e.y) });
export const member = (view: MoverView, name: string) => name === view.character.name ? view.character : view.entities[name];
