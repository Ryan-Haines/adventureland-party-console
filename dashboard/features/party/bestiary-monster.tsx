"use client";
import { BestiaryDrop } from "./bestiary-drop";
import { Sprite } from "./sprite";
import type { SpawnRecord } from "./monster-choice";

export type BestiaryMonster = {
  id: string;
  name: string;
  sprite?: Sprite | null;
  hp: number;
  attack: number;
  xp: number;
  range: number;
  threat: number;
  definition: Record<string, unknown>;
  drops: BestiaryDrop[];
  spawnRecords?: SpawnRecord[];
};
