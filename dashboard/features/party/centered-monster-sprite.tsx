"use client";
import { useEffect, useState } from 'react';
import type { Sprite } from './sprite';
import { SpriteCrop } from './sprite-crop';
import { spriteCenterOffset } from './sprite-center';

const sheets = new Map<string, Promise<HTMLImageElement>>();
const offsets = new Map<string, Promise<{ x: number; y: number }>>();
function offset(sprite: Sprite) {
  const key = JSON.stringify(sprite);
  if (!offsets.has(key)) offsets.set(key, (async () => {
    if (!sheets.has(sprite.url)) sheets.set(sprite.url, new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image); image.onerror = reject;
      image.src = `/api/monster-sprite?url=${encodeURIComponent(sprite.url)}`;
    }));
    const image = await sheets.get(sprite.url)!;
    const width = Math.round(image.naturalWidth / sprite.columns), height = Math.round(image.naturalHeight / sprite.rows);
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return { x: 0, y: 0 };
    context.drawImage(image, sprite.x * width, sprite.y * height, width, height, 0, 0, width, height);
    return spriteCenterOffset(context.getImageData(0, 0, width, height).data, width, height, 48);
  })().catch(() => ({ x: 0, y: 0 })));
  return offsets.get(key)!;
}
export function CenteredMonsterSprite({ sprite }: { sprite: Sprite }) {
  const [shift, setShift] = useState({ x: 0, y: 0 });
  useEffect(() => {
    let active = true;
    setShift({ x: 0, y: 0 });
    void offset(sprite).then(value => { if (active) setShift(value); });
    return () => { active = false; };
  }, [sprite.url, sprite.x, sprite.y, sprite.columns, sprite.rows]);
  return <span className="absolute inset-0" style={{ transform: `translate(${shift.x}px, ${shift.y}px)` }}><SpriteCrop sprite={sprite} /></span>;
}
