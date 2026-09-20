"use client";
import { Sprite } from "./sprite";
import { SpriteCrop } from "./sprite-crop";

export function ItemSprite({ sprite }: { sprite: Sprite }) {
  return <SpriteCrop sprite={sprite} />;
}
