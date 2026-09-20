"use client";
import { croppedTileCache } from "./cropped-tile-cache";

export function croppedTile(
  image: HTMLImageElement,
  url: string,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const key = `${url}:${x}:${y}:${width}:${height}`;
  let tile = croppedTileCache.get(key);
  if (!tile) {
    tile = document.createElement("canvas");
    tile.width = width;
    tile.height = height;
    const context = tile.getContext("2d");
    if (context) {
      context.imageSmoothingEnabled = false;
      context.drawImage(image, x, y, width, height, 0, 0, width, height);
    }
    croppedTileCache.set(key, tile);
  }
  return tile;
}
