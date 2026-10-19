/** Bounded wire descriptions of native renderer texture cells and local transforms.
 * Renderer state is intentionally separate from Adventure Land entity protocols. */
export interface MapSpriteLayer {
  url: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  transform: [number, number, number, number, number, number];
  alpha: number;
  tint: number;
}
export interface MapVisual {
  id: string;
  x: number;
  y: number;
  layers: MapSpriteLayer[];
}

export interface MapProjectile {
  ray?: boolean;
  id: string;
  url: string;
  frames: number;
  frameMillis: number;
  scale: number;
  directional: boolean;
  startedAt: number;
  expiresAt: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}
