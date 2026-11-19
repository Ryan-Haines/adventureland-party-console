'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';

// Where the dragged row's preview sits, and where the pointer took hold of it.
export interface DragPosition { x: number; y: number; width: number; offsetX: number; offsetY: number }

// The drag-to-reorder list of the event selection (event-selection-control.tsx) and the merchant
// routines (routine-priorities-dialog.tsx). Each row carries `data-<attribute>` with its id. After a
// move the rows slide from the places `remember` recorded, unless the player asks for reduced
// motion; while a row is dragged the list scrolls when the preview sits within 40 px of its top or
// bottom; `rowAt` finds the row under the pointer. `layout` is the list's order, so each new order
// runs the slide.
export function useReorderList(attribute: 'event' | 'routine', dragged: string | null, dragPosition: DragPosition | null, layout: unknown) {
  const listRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLElement>(`[data-${attribute}]`) ?? []);
  useLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const row of rows()) {
      const previous = positions.current.get(row.dataset[attribute]!);
      if (previous !== undefined && row.dataset[attribute] !== dragged) {
        const delta = previous - row.getBoundingClientRect().top;
        if (delta) row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:150,easing:'ease-out'});
      }
    }
    positions.current.clear();
  }, [layout, dragged]);
  useEffect(() => {
    if (!dragged || !dragPosition) return;
    let frame = 0;
    const scroll = () => {
      const list = listRef.current;
      if (list) { const rect = list.getBoundingClientRect(), y = dragPosition.y + dragPosition.offsetY;
        if (y < rect.top + 40) list.scrollTop -= 8;
        else if (y > rect.bottom - 40) list.scrollTop += 8;
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(frame);
  }, [dragged, dragPosition]);
  return {
    listRef,
    // Records each row's place before a move changes the order.
    remember() { positions.current = new Map(rows().map(row => [row.dataset[attribute]!, row.getBoundingClientRect().top])); },
    // The row under the pointer other than the dragged one, and whether the pointer is in its lower half.
    rowAt(clientY: number): { target: string; after: boolean } | null {
      for (const row of rows()) {
        const rect = row.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom && row.dataset[attribute] !== dragged)
          return { target: row.dataset[attribute]!, after: clientY > rect.top + rect.height / 2 };
      }
      return null;
    },
  };
}
