'use client';
import {
  createContext,
  useContext,
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import { useItemSelection } from './item-selection';
import type { InventoryEntry } from './inventory-entry';
type Entry = InventoryEntry & { selectionKey: string };
function useSelection() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const selection = useItemSelection(entries, (e) => e.selectionKey);
  const register = useCallback((entry: Entry) => {
    setEntries((previous) => {
      const index = previous.findIndex(
        (e) => e.selectionKey === entry.selectionKey,
      );
      if (
        index >= 0 &&
        JSON.stringify(previous[index]) === JSON.stringify(entry)
      )
        return previous;
      return index < 0
        ? [...previous, entry]
        : previous.map((old, i) => (i === index ? entry : old));
    });
    return () =>
      setEntries((previous) =>
        previous.filter((e) => e.selectionKey !== entry.selectionKey),
      );
  }, []);
  return { ...selection, register };
}
const Selection = createContext<ReturnType<typeof useSelection> | null>(null);
export function ExchangeItemSelection({ children }: { children: ReactNode }) {
  const selection = useSelection();
  return <Selection.Provider value={selection}>{children}</Selection.Provider>;
}
export function useExchangeItemSelection() {
  return useContext(Selection);
}
