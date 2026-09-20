"use client";
import { Sprite } from "./sprite";

export type BankVault = {
  pack: string;
  floor: string;
  gold: number;
  shells: number;
  key?: { id: string; name: string; sprite?: Sprite | null } | null;
};
