"use client";
import { MapEntity } from "./map-entity";
import { MapEvent } from "./map-event";

export type MapFrame = {
  name: string;
  map: string;
  at: number;
  x: number;
  y: number;
  target?: string | null;
  grouped?: boolean;
  eventCombat?: boolean;
  queueRevision?: string | null;
  queue?: {id:string;map:string;in?:string|number;state?:string;role?:string;server?:string;radius?:number;visible?:boolean}[];
  entities: MapEntity[];
  events?: MapEvent[];
};
