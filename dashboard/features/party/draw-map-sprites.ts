import { cachedMapImage } from './cached-map-image';
import type { MapSpriteLayer } from '../../../runtime/map-sprites';
let tintedPixels = 0;
const tintedCells = new Map<string, HTMLCanvasElement>();
/** Native atlas cells remain readable through the existing game image proxy. */
export function drawMapSprites(
  ctx: CanvasRenderingContext2D,
  layers: MapSpriteLayer[],
): boolean {
  let drawn = false;
  for (const layer of layers.slice(0, 32)) {
    const image = cachedMapImage(layer.url);
    if (
      !image?.complete ||
      !image.naturalWidth ||
      ![
        layer.sx,
        layer.sy,
        layer.sw,
        layer.sh,
        layer.dx,
        layer.dy,
        layer.alpha,
        ...layer.transform,
      ].every(Number.isFinite) ||
      layer.sw <= 0 ||
      layer.sh <= 0
    )
      continue;
    ctx.save();
    ctx.transform(...layer.transform);
    ctx.globalAlpha *= layer.alpha;
    if (layer.tint !== 0xffffff) {
      const key = [
        layer.url,
        layer.sx,
        layer.sy,
        layer.sw,
        layer.sh,
        layer.tint,
      ].join(':');
      let cell = tintedCells.get(key);
      if (!cell) {
        cell = document.createElement('canvas');
        cell.width = layer.sw;
        cell.height = layer.sh;
        const paint = cell.getContext('2d')!;
        paint.drawImage(
          image,
          layer.sx,
          layer.sy,
          layer.sw,
          layer.sh,
          0,
          0,
          layer.sw,
          layer.sh,
        );
        paint.globalCompositeOperation = 'multiply';
        paint.fillStyle = '#' + layer.tint.toString(16).padStart(6, '0');
        paint.fillRect(0, 0, cell.width, cell.height);
        paint.globalCompositeOperation = 'destination-in';
        paint.drawImage(
          image,
          layer.sx,
          layer.sy,
          layer.sw,
          layer.sh,
          0,
          0,
          layer.sw,
          layer.sh,
        );
        tintedCells.set(key, cell);
        tintedPixels += cell.width * cell.height;
        while (tintedCells.size > 64 || tintedPixels > 1048576) {
          const first = tintedCells.keys().next().value!;
          const expired = tintedCells.get(first)!;
          tintedPixels -= expired.width * expired.height;
          tintedCells.delete(first);
        }
      }
      ctx.drawImage(cell, layer.dx, layer.dy);
    } else
      ctx.drawImage(
        image,
        layer.sx,
        layer.sy,
        layer.sw,
        layer.sh,
        layer.dx,
        layer.dy,
        layer.sw,
        layer.sh,
      );
    ctx.restore();
    drawn = true;
  }
  return drawn;
}
