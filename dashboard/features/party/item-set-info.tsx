"use client";
import { Sprite } from "./sprite";

export type ItemSetInfo = {
  id: string;
  name: string;
  explanation?: string;
  items: {
    id: string;
    name: string;
    quantity: number;
    sprite: Sprite | null;
  }[];
  bonuses: {
    pieces: number;
    stats: Record<string, string | number | boolean>;
  }[];
};
