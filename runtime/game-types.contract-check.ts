import type { ItemInfo } from 'typed-adventureland';
import type { Character as MovementCharacter } from './characters/movement-host.ts';
import type { Item } from './coordinator/contracts/item.ts';
import type { GameData, Geometry, Point } from './navigation/contracts.ts';

type Assert<T extends true> = T;
type Accepts<Contract, Input> = Input extends Contract ? true : false;
type Rejects<Contract, Input> = Input extends Contract ? false : true;

// These contracts deliberately accept partial observations, not only complete game objects.
export type GameTypeContractChecks = [
  Assert<Accepts<Item, ItemInfo>>,
  Assert<Accepts<Item, {}>>,
  Assert<Accepts<Item, { name: 'future-item'; p: 'future-modifier'; stat_type: 'future-stat'; extra: { value: number } }>>,
  Assert<Rejects<Item, { level: string }>>,
  Assert<Rejects<Item, { q: string }>>,
  Assert<Accepts<Point, { map: 'future-map'; x: number; y: number; in: number }>>,
  Assert<Accepts<Point, { map: 'future-map'; x: number; y: number; in: string }>>,
  Assert<Rejects<Point, { x: number; y: number }>>,
  Assert<Rejects<Geometry, { h: number; v: null; vn: number }>>,
  Assert<Accepts<MovementCharacter, {
    map: 'future-map'; in: number; x: number; y: number;
    name: string; real_x: number; real_y: number; speed: number; moving: boolean;
    base: { h: number; v: number; vn: number };
    items: ({ name: 'future-item' } | null)[];
  }>>,
  Assert<Rejects<MovementCharacter, Omit<MovementCharacter, 'rip'> & { rip: number }>>,
  Assert<Accepts<GameData, {
    maps: { 'future-map': { spawns: number[][]; instance: boolean; event: 'future-event' } };
    geometry: unknown;
    npcs: {};
    events: { 'future-event': { join: boolean } };
  }>>,
];
