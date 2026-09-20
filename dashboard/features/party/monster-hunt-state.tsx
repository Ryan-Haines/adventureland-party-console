"use client";
import { Location } from "./location";

export type MonsterHuntState = {
  backup?: {members:Record<string,{target:string|null;remainingMs:number;ready:boolean;fresh:boolean}>};
  batchPickup?: boolean;
  returnLocation?: Location | null;
  cycleId: string;
  stage: string;
  participants: string[];
  owner?: string;
  turnIn?: { owner: string; phase: "returning" | "claiming" | "complete" };
  target?: string | null;
  message?: string;
  returnRetries?: number;
  returnDisableTown?: boolean;
  currentIndex?: number;
  missions?: { target: string; owners: string[]; skipped?: boolean }[];
};
