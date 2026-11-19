"use client";
import { dollLayerCache } from "./doll-layer-cache";
import { sanitizeDollHtml } from './sanitize-doll-html';
import { countCap } from './cap-counts';

// The game's character doll frame, 27 by 38 px, for doll HTML that names no size of its own.
const DOLL_FRAME = { width: 27, height: 38 };
// The parsed-doll cache's memory bound: the oldest entry leaves past this many dolls (b9b5c91e).
// An eviction is normal operation, so it adds to the cap's count (cap-counts.ts).
const DOLL_CACHE_ENTRIES = 64;
export function dollLayers(html: string) {
  const cached = dollLayerCache.get(html);
  if (cached) return cached;
  const host = new DOMParser().parseFromString(sanitizeDollHtml(html), 'text/html');
  const layers = Array.from(host.querySelectorAll<HTMLImageElement>("img[src]")).map((img) => {
    const parent = img.parentElement as HTMLElement;
    const px = (value: string) => Number.parseFloat(value || "0") || 0;
    return {
      outerWidth: px((host.body.firstElementChild as HTMLElement)?.style.width || '') || DOLL_FRAME.width,
      outerHeight: px((host.body.firstElementChild as HTMLElement)?.style.height || '') || DOLL_FRAME.height,
      url: new URL(img.getAttribute('src') || '', document.baseURI).href,
      left: px(parent.style.left),
      bottom: px(parent.style.bottom),
      width: px(parent.style.width),
      height: px(parent.style.height),
      imageWidth: px(img.style.width),
      imageHeight: px(img.style.height),
      marginLeft: px(img.style.marginLeft),
      marginTop: px(img.style.marginTop),
    };
  });
  dollLayerCache.set(html, layers);
  if (dollLayerCache.size > DOLL_CACHE_ENTRIES) {
    dollLayerCache.delete(dollLayerCache.keys().next().value!);
    countCap('DOLL_CACHE_ENTRIES', '12');
  }
  return layers;
}
