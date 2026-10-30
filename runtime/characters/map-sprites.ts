import type { MapSpriteLayer, MapVisual } from "../map-sprites.ts";
// Pixi texture/scene descriptors are renderer internals absent from typed-adventureland.
interface Vector {
  x: number;
  y: number;
}
interface Texture {
  frame?: { x: number; y: number; width: number; height: number };
  orig?: { width: number; height: number };
  trim?: { x: number; y: number };
  rotate?: number;
  baseTexture?: {
    imageUrl?: string;
    resource?: { url?: string; source?: { src?: string; currentSrc?: string } };
    source?: { src?: string; currentSrc?: string };
  };
}
export interface NativeMapSprite {
  texture?: Texture;
  children?: NativeMapSprite[];
  position?: Vector;
  x?: number;
  y?: number;
  real_x?: number;
  real_y?: number;
  scale?: Vector;
  pivot?: Vector;
  skew?: Vector;
  rotation?: number;
  anchor?: Vector;
  alpha?: number;
  tint?: number;
  visible?: boolean;
  renderable?: boolean;
  _destroyed?: boolean;
  to_delete?: boolean;
  atype?: string;
}
type Matrix = MapSpriteLayer["transform"];
const textureCache = new WeakMap<
  Texture,
  { key: string; value: Pick<MapSpriteLayer, "url" | "sx" | "sy" | "sw" | "sh" | "dx" | "dy"> }
>();
const baseUrls = new WeakMap<NonNullable<Texture["baseTexture"]>, string>();
function textureCell(texture: Texture, anchor: Vector) {
  const frame = texture.frame,
    base = texture.baseTexture;
  if (
    !frame ||
    !base ||
    ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) ||
    frame.x < 0 ||
    frame.y < 0 ||
    texture.rotate ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    frame.width > 1024 ||
    frame.height > 1024
  )
    return null;
  let url = baseUrls.get(base);
  if (!url) {
    url =
      base.resource?.url ||
      base.resource?.source?.currentSrc ||
      base.resource?.source?.src ||
      base.source?.currentSrc ||
      base.source?.src ||
      base.imageUrl;
    if (!url || url.length > 16384) return null;
    if (url.startsWith("/")) url = "https://adventure.land" + url;
    if (!/^(https?:\/\/|data:image\/)/.test(url)) return null;
    baseUrls.set(base, url);
  }
  const orig = texture.orig || frame,
    trim = texture.trim,
    key = [
      frame.x,
      frame.y,
      frame.width,
      frame.height,
      orig.width,
      orig.height,
      trim?.x,
      trim?.y,
      anchor.x,
      anchor.y,
    ].join(":");
  const cached = textureCache.get(texture);
  if (cached?.key === key) return cached.value;
  const value = {
    url,
    sx: frame.x,
    sy: frame.y,
    sw: frame.width,
    sh: frame.height,
    dx: (trim?.x || 0) - anchor.x * orig.width,
    dy: (trim?.y || 0) - anchor.y * orig.height,
  };
  textureCache.set(texture, { key, value });
  return value;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function local(node: NativeMapSprite, root: boolean): Matrix {
  const rotation = node.rotation || 0,
    scale = node.scale || { x: 1, y: 1 },
    skew = node.skew || { x: 0, y: 0 },
    pivot = node.pivot || { x: 0, y: 0 },
    a = Math.cos(rotation + skew.y) * scale.x,
    b = Math.sin(rotation + skew.y) * scale.x,
    c = -Math.sin(rotation - skew.x) * scale.y,
    d = Math.cos(rotation - skew.x) * scale.y;
  return [
    a,
    b,
    c,
    d,
    (root ? 0 : (node.position?.x ?? node.x ?? 0)) - pivot.x * a - pivot.y * c,
    (root ? 0 : (node.position?.y ?? node.y ?? 0)) - pivot.x * b - pivot.y * d,
  ];
}
/** Copy current native cells, never extract pixels or serialize renderer graphs.
 * Weak texture caches and per-frame traversal budgets bound repeated work. */
export function captureNativeLayers(sprite: NativeMapSprite): MapSpriteLayer[] {
  const layers: MapSpriteLayer[] = [];
  let visited = 0;
  function visit(
    node: NativeMapSprite,
    transform: Matrix,
    alpha: number,
    depth: number,
    root = false,
  ) {
    if (
      !node ||
      ++visited > 96 ||
      depth > 6 ||
      layers.length >= 32 ||
      node.visible === false ||
      node.renderable === false ||
      node._destroyed ||
      node.to_delete
    )
      return;
    const opacity = alpha * (node.alpha ?? 1);
    if (!Number.isFinite(opacity) || opacity <= 0) return;
    const matrix = multiply(transform, local(node, root));
    if (!matrix.every(Number.isFinite)) return;
    const cell = node.texture && textureCell(node.texture, node.anchor || { x: 0, y: 0 });
    if (cell)
      layers.push({
        ...cell,
        transform: matrix,
        alpha: Math.min(1, opacity),
        tint: Number.isFinite(node.tint) ? Math.max(0, Math.min(0xffffff, node.tint!)) : 0xffffff,
      });
    for (const child of node.children || []) {
      if (visited >= 96 || layers.length >= 32) break;
      visit(child, matrix, opacity, depth + 1);
    }
  }
  visit(sprite, [1, 0, 0, 1, 0, 0], 1, 0, true);
  return layers;
}
export function captureMapVisuals(
  animations: Record<string, NativeMapSprite>,
  limit = 64,
): MapVisual[] {
  let remaining = Math.max(0, Math.min(128, limit));
  return Object.entries(animations)
    .slice(0, 64)
    .flatMap(([id, sprite]) => {
      if (
        !remaining ||
        !sprite ||
        sprite.to_delete ||
        sprite._destroyed ||
        !["map", "cmap", "wmap"].includes(sprite.atype || "")
      )
        return [];
      const layers = captureNativeLayers(sprite).slice(0, remaining);
      remaining -= layers.length;
      return layers.length
        ? [
            {
              id,
              x: Number(sprite.real_x ?? sprite.position?.x ?? sprite.x) || 0,
              y: Number(sprite.real_y ?? sprite.position?.y ?? sprite.y) || 0,
              layers,
            },
          ]
        : [];
    });
}
Object.assign(globalThis, {
  capturePartyMapLayers: captureNativeLayers,
  capturePartyMapVisuals: captureMapVisuals,
});
