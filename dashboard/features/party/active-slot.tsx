"use client";

export type ActiveSlot = {
  index: number;
  kind: "native" | "headless";
  primary?: boolean;
  character: string | null;
  state: "empty" | "starting" | "online" | "stopping" | "offline" | "failed";
};
