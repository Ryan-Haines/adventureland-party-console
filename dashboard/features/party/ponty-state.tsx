"use client";
import { PontyListing } from "./ponty-listing";

export type PontyState = {
  listings: PontyListing[];
  updatedAt: number;
  error?: string | null;
};
