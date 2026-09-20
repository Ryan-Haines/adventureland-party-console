"use client";
import { RealmCharacter } from "./realm-character";

export type RealmOperation = {
  id: string;
  phase: string;
  realm: string;
  setHome: boolean;
  startedAt: number;
  executor?: string | null;
  error?: string | null;
  characters?: RealmCharacter[];
};
