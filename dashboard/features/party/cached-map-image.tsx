"use client";
import { mapImages } from "./map-images";
import { gameImageUrl } from './game-image-url';

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
    image.src = url;
    mapImages.set(url, image);
  }
  return image;
}
