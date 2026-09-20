"use client";
import { PlayerStandListing } from "./player-stand-listing";

export type StandSearchState = {
  status: "idle" | "searching" | "complete" | "error";
  itemId: string | null;
  listings: PlayerStandListing[];
  error?: string | null;
  searchedAt?: number;
};
