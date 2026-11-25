"use client";
import { mapImages } from "./map-images";
import { gameImageUrl } from './game-image-url';

// The image proxy answers an image it has no copy of yet at once, with an error
// (dashboard/lib/game-image.ts), so the map leaves that image out until the map's
// next frame asks for it again through askMissingMapImages.
const missing = new Set<string>();
export function askMissingMapImages() {
  for (const url of missing) mapImages.delete(url);
  missing.clear();
}

export function cachedMapImage(url: string) {
  url = gameImageUrl(url);
  // Adventure Land images do not advertise canvas CORS permission. Serve its
  // fixed-origin images through the dashboard so captured canvases stay readable.
  if (url.startsWith('https://adventure.land/images/'))
    url = '/api/map-image?url=' + encodeURIComponent(url);
  let image = mapImages.get(url);
  if (!image && typeof window !== "undefined") {
    image = new Image();
    image.crossOrigin = "anonymous";
    image.onerror = () => missing.add(url);
    image.src = url;
    mapImages.set(url, image);
  }
  return image;
}
