"use client";
import { Sprite } from "./sprite";

export type Condition = {
  id: string;
  name: string;
  explanation?: string;
  remainingMs?: number | null;
  stacks?: number | string | null;
  source?: string | number | null;
  definition: Record<string, unknown>;
  live: Record<string, unknown>;
  sprite?: Sprite | null;
};
