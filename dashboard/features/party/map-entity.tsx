"use client";
import { Sprite } from "./sprite";

export type MapEntity = {
  layers?: import("../../../runtime/map-sprites").MapSpriteLayer[];
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  hp: number;
  max_hp: number;
  mp: number;
  max_mp: number;
  moving?: boolean;
  target?: string | null;
  sprite?: Sprite | null;
  direction?: number;
  dollHtml?: string | null;
  stand?: string | boolean | null;
  standSprite?: Sprite | null;
  weapons?: {hand:string;name:string;sprite:Sprite|null}[];
};
