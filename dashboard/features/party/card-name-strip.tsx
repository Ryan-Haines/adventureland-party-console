'use client';
import { memo, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { Char } from './char';
import { CharacterPortrait } from './character-portrait';
import { CharacterMapSection } from './character-map-section';
import { useReportStrip } from './map-dock-state';
import { useCharacterData } from './dashboard-live';
import { characterActivity, type ActivityState, type MonsterNames } from './character-activity';

// One ResizeObserver tracks the pinned party header for every card. Its
// height wraps with the button rows, so the strips read it instead of a constant.
let headerHeight = 0;
const listeners = new Set<() => void>();
let observer: ResizeObserver | null = null;
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!observer && typeof ResizeObserver !== 'undefined') {
    const header = document.querySelector<HTMLElement>('[data-party-header]');
    if (header) {
      observer = new ResizeObserver(() => {
        const next = Math.round(header.getBoundingClientRect().height);
        if (next === headerHeight) return;
        headerHeight = next;
        document.documentElement.style.setProperty('--party-header-height', `${next}px`);
        for (const notify of listeners) notify();
      });
      observer.observe(header);
    }
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) { observer?.disconnect(); observer = null; headerHeight = 0; }
  };
}
const height = () => headerHeight;
const serverHeight = () => 0;

/** True while `identity` sits fully above the bottom edge of the pinned header. */
function useScrolledUnderHeader(identity: RefObject<HTMLElement | null>): boolean {
  const offset = useSyncExternalStore(subscribe, height, serverHeight);
  const [under, setUnder] = useState(false);
  useEffect(() => {
    const element = identity.current;
    if (!element) return;
    const watch = new IntersectionObserver(([entry]) => {
      setUnder(!entry.isIntersecting && entry.boundingClientRect.bottom <= offset);
    }, { rootMargin: `-${offset}px 0px 0px 0px` });
    watch.observe(element);
    return () => watch.disconnect();
  }, [identity, offset]);
  return under;
}

function title(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

const heightKey = (name: string) => 'party-ui:map-dock-height:' + name;
function savedHeight(name: string): number | null {
  try { const value = Number(localStorage.getItem(heightKey(name))); return value > 0 ? value : null; } catch { return null; }
}

/** Height of the docked map: 35% of the viewport until the bottom handle drags it. */
function useDockHeight(name: string) {
  const [height, setHeight] = useState<number | null>(() => savedHeight(name));
  function drag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dock = event.currentTarget.previousElementSibling as HTMLElement | null;
    if (!dock) return;
    event.preventDefault();
    const handle = event.currentTarget, start = event.clientY, from = dock.getBoundingClientRect().height;
    handle.setPointerCapture(event.pointerId);
    let next = from;
    const move = (moved: PointerEvent) => {
      next = Math.round(Math.min(window.innerHeight * 0.8, Math.max(120, from + moved.clientY - start)));
      setHeight(next);
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      try { localStorage.setItem(heightKey(name), String(next)); } catch { /* the height resets on reload */ }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  return { height, drag };
}

/**
 * A slim copy of the card's name line that pins below the party header once
 * the card's own name has scrolled under it, so each inventory column stays
 * labelled. It takes no layout space: the sticky wrapper is zero height and
 * the card's overflow-clip trims the strip at the card's bottom edge. The
 * location row is a second CharacterMapSection, so its map docks under the
 * strip and the card content stays usable below it.
 */
export const CardNameStrip = memo(function CardNameStrip({ char, state, monsterName, identity }: {
  char: Char;
  state: ActivityState;
  monsterName: MonsterNames;
  identity: RefObject<HTMLElement | null>;
}) {
  const visible = useScrolledUnderHeader(identity);
  useReportStrip(char.name, visible);
  // The card's merged character leaves map, x and y to the position domain.
  const position = useCharacterData(char.name, 'position');
  const activity = characterActivity({ ...char, ...position }, state, monsterName);
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  // Escape with focus inside the docked map presses the strip's own collapse arrow.
  useEffect(() => {
    if (!dock) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dock.contains(document.activeElement)) return;
      strip.current?.querySelector<HTMLButtonElement>('[aria-label="Collapse live map"]')?.click();
    };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [dock]);
  const { height, drag } = useDockHeight(char.name);
  return (
    <div className="sticky z-20 h-0" style={{ top: 'var(--party-header-height, 0px)' }}>
      <div data-card-name-strip={char.name} hidden={!visible} className="absolute inset-x-0 top-0 text-emerald-50 shadow-lg shadow-black/40">
        {/* Two lines: identity and location on top, the full activity label below. */}
        <div ref={strip} data-card-strip-line className="flex items-center gap-2 border-b border-emerald-900/70 bg-[#0b1916] px-3 py-1">
          <span className="relative h-9 w-6 shrink-0 overflow-hidden rounded border border-emerald-800/80 bg-[#07100f]">
            <span className="absolute left-0 top-0 h-20 w-14 origin-top-left scale-[0.45]">
              <CharacterPortrait html={char.characterDollHtml} sprite={char.characterSprite} skin={char.skin} />
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-sm font-semibold">{char.name}</span>
              <span className="shrink-0 font-mono text-[11px] text-emerald-200/60">
                {char.level} {title(char.ctype)} {(char.primaryStat || '').toUpperCase()}
              </span>
              {/* The location gives way first; its arrow stays visible. */}
              <span data-card-strip-location className="ml-auto flex min-w-5 shrink-[1000] justify-end">
                <CharacterMapSection char={char} dock={dock} />
              </span>
            </span>
            <span data-card-activity className="truncate text-xs text-emerald-100/80" title={activity}>{activity}</span>
          </span>
        </div>
        <div ref={setDock} data-card-strip-map aria-label={`${char.name} docked map`}
          className="peer bg-[#07110f] empty:hidden"
          style={{ height: height ? `${height}px` : '35vh' }} />
        <button type="button" aria-label={`Resize ${char.name} docked map`} onPointerDown={drag}
          className="block h-2 w-full cursor-ns-resize touch-none border-b border-emerald-900/70 bg-[#0b1916] peer-empty:hidden hover:bg-emerald-900/60" />
      </div>
    </div>
  );
});
