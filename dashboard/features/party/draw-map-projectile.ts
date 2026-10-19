import { cachedMapImage } from './cached-map-image';
import type { MapProjectile } from '../../../runtime/map-sprites';
/** Observed server flight timing; native atlas frames, without inferred outcomes. */
export function drawMapProjectile(
  ctx: CanvasRenderingContext2D,
  p: MapProjectile,
  now: number,
) {
  if (now < p.startedAt || now >= p.expiresAt) return;
  const image = cachedMapImage(p.url);
  if (!image?.complete || !image.naturalWidth) return;
  const progress = (now - p.startedAt) / (p.expiresAt - p.startedAt),
    x = p.x + (p.targetX - p.x) * progress,
    y = p.y + (p.targetY - p.y) * progress;
  const width = Math.floor(image.naturalWidth / p.frames),
    height = image.naturalHeight;
  if (width < 1 || height < 1) return;
  const frame = p.ray
    ? 0
    : Math.floor((now - p.startedAt) / p.frameMillis) % p.frames;
  if (p.ray) {
    const dx = p.targetX - p.x,
      dy = p.targetY - p.y;
    ctx.save();
    ctx.translate((p.x + p.targetX) / 2, (p.y + p.targetY) / 2);
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    ctx.globalAlpha *= 1 - progress;
    ctx.drawImage(
      image,
      frame * width,
      0,
      width,
      height,
      (-width * p.scale) / 2,
      -Math.hypot(dx, dy) / 2,
      width * p.scale,
      Math.hypot(dx, dy),
    );
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.translate(x, y);
  if (p.directional)
    ctx.rotate(Math.atan2(p.targetY - p.y, p.targetX - p.x) + Math.PI / 2);
  ctx.scale(p.scale, p.scale);
  ctx.drawImage(
    image,
    frame * width,
    0,
    width,
    height,
    -width / 2,
    -height,
    width,
    height,
  );
  ctx.restore();
}
