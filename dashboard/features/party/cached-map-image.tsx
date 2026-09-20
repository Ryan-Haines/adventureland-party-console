"use client";
import { mapImages } from "./map-images";

export function cachedMapImage(url: string) {
  let image = mapImages.get(url);
  if (!image && typeof window !== "undefined") {
    image = new Image();
    image.src = url;
    mapImages.set(url, image);
  }
  return image;
}
