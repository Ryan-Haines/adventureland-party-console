"use client";
import { Sprite } from "./sprite";

export type SkillEntry = {
  id: string;
  name: string;
  sprite?: Sprite | null;
  definition: Record<string, unknown>;
};
