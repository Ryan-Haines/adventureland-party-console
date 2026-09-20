"use client";
import { Item } from "./item";

export const same = (current: Item, marked: Item) =>
  Object.keys(marked)
    .filter((key) => key !== "q")
    .every(
      (key) =>
        JSON.stringify(current[key as keyof Item]) === JSON.stringify(marked[key as keyof Item]),
    );
