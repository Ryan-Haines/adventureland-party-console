"use client";
import { Sprite } from "./sprite";

export function SpriteCrop({
  sprite,
  size = 48,
  width = size,
  height = size,
}: {
  sprite: Sprite;
  size?: number;
  width?: number;
  height?: number;
}) {
  return (
    <span
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden"
      style={{ width, height }}
    >
      <span
        aria-hidden="true"
        className="block max-w-none"
        style={{
          width,
          height,
          backgroundImage: `url(${JSON.stringify(sprite.url)})`,
          backgroundSize: `${sprite.columns * width}px ${sprite.rows * height}px`,
          backgroundPosition: `${-sprite.x * width}px ${-sprite.y * height}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
    </span>
  );
}
