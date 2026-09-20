"use client";

export type RestockPolicy = {
  hp: { min: number; max: number; item: string };
  mp: { min: number; max: number; item: string };
};
