export function spriteCenterOffset(pixels: Uint8ClampedArray, width: number, height: number, size: number) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (pixels[(y * width + x) * 4 + 3] === 0) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? { x: 0, y: 0 } : {
    x: (width - left - right - 1) * size / (2 * width),
    y: (height - top - bottom - 1) * size / (2 * height),
  };
}
