'use client';
import { useRef, useState, type MouseEvent } from 'react';
import {
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import type { InventoryEntry } from './inventory-entry';
import { itemMaximumLevel } from './item-maximum-level';
/** Selection is scoped to one physical/prospective container. Item replacement
 * invalidates its selection, so a moved slot never inherits an old disposition. */
export function useItemSelection<T>(entries: T[], key: (entry: T) => string) {
  const [selected, setSelected] = useState<Record<string, string>>({}),
    anchor = useRef<string | null>(null);
  const identity = (entry: T) =>
    JSON.stringify((entry as { item?: unknown }).item ?? entry);
  const has = (entry: T) => selected[key(entry)] === identity(entry);
  const current = entries.filter(has);
  function click(event: MouseEvent, entry: T): boolean {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) {
      setSelected({});
      anchor.current = key(entry);
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey && anchor.current) {
      const a = entries.findIndex((e) => key(e) === anchor.current),
        b = entries.findIndex((e) => key(e) === key(entry));
      const range =
        a < 0 ? [entry] : entries.slice(Math.min(a, b), Math.max(a, b) + 1);
      setSelected((previous) => ({
        ...previous,
        ...Object.fromEntries(range.map((e) => [key(e), identity(e)])),
      }));
    } else {
      setSelected((previous) => {
        const next = { ...previous };
        if (next[key(entry)] === identity(entry)) delete next[key(entry)];
        else next[key(entry)] = identity(entry);
        return next;
      });
      anchor.current = key(entry);
    }
    return true;
  }
  return {
    has,
    click,
    count: current.length,
    context(entry: T) {
      if (!has(entry)) {
        setSelected({ [key(entry)]: identity(entry) });
        anchor.current = key(entry);
      }
    },
    forEntry(entry: T) {
      return has(entry) ? current : [entry];
    },
    clear() {
      setSelected({});
    },
  };
}
export function BatchItemActions({
  entries,
  merchant,
  onCommand,
  onBank,
  onMerchant,
  onUpgrade,
  onExchange,
  exchangeable = () => false,
  onCompound,
  onError,
}: {
  entries: InventoryEntry[];
  merchant?: boolean;
  onCommand?: (
    type:
      | 'auto-item-mark'
      | 'auto-upgrade-mark'
      | 'auto-compound-mark'
      | 'auto-exchange'
      | 'upgrade-mark',
    entry: InventoryEntry,
    extra: Record<string, unknown>,
  ) => unknown;
  onBank?: (entry: InventoryEntry) => unknown;
  onMerchant?: (entry: InventoryEntry) => unknown;
  onUpgrade?: (entry: InventoryEntry) => unknown;
  onExchange?: (entry: InventoryEntry) => unknown;
  exchangeable?: (entry: InventoryEntry) => boolean;
  onCompound?: (entry: InventoryEntry) => unknown;
  onError?: (message: string) => void;
}) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const unlocked =
    !busy &&
    entries.length > 0 &&
    entries.every((e) => !e.item.l && !e.item.b && !e.operation);
  const compound =
    unlocked &&
    entries.every(
      (e) =>
        e.meta?.compoundable &&
        (e.item.level || 0) < Math.min(7, itemMaximumLevel(e.meta)),
    ) &&
    entries.every((entry) =>
      entries
        .filter((other) => other.item.name === entry.item.name)
        .every((other) => (other.item.level || 0) === (entry.item.level || 0)),
    );
  const uniqueCompoundEntries = entries.filter(
    (entry, index) =>
      entries.findIndex((other) => other.item.name === entry.item.name) ===
      index,
  );
  const upgrade =
    unlocked &&
    entries.every(
      (e) =>
        e.meta?.upgradeable &&
        (Number(e.item.level) || 0) < itemMaximumLevel(e.meta),
    );
  async function each(action: (entry: InventoryEntry) => unknown) {
    setError('');
    setBusy(true);
    try {
      for (const entry of entries) await action(entry);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <p role="alert" className="px-2 py-1 text-black">
          {error}
        </p>
      )}
      <div className="px-2 py-1 text-xs text-black">
        {entries.length} selected items
      </div>
      <ContextMenuSeparator />
      {unlocked && onBank && (
        <ContextMenuItem onClick={() => void each(onBank)}>
          Mark selected for bank
        </ContextMenuItem>
      )}
      {unlocked && onMerchant && (
        <ContextMenuItem onClick={() => void each(onMerchant)}>
          Mark selected for merchant
        </ContextMenuItem>
      )}
      {unlocked && onCommand && (
        <ContextMenuItem
          onClick={() =>
            void each((e) => onCommand('auto-item-mark', e, { mode: 'bank' }))
          }
        >
          Auto mark for bank
        </ContextMenuItem>
      )}
      {upgrade && (onUpgrade || onCommand) && (
        <ContextMenuItem
          onClick={() =>
            void each((e) =>
              onUpgrade
                ? onUpgrade(e)
                : onCommand!('upgrade-mark', e, { slot: e.slot, tiers: 1 }),
            )
          }
        >
          Upgrade each by one level
        </ContextMenuItem>
      )}
      {upgrade && onCommand && (
        <ContextMenuItem
          onClick={() =>
            void each((e) =>
              onCommand('auto-upgrade-mark', e, { slot: e.slot, tiers: 1 }),
            )
          }
        >
          Auto upgrade each by one level
        </ContextMenuItem>
      )}
      {unlocked && entries.every(exchangeable) && (onExchange || onCommand) && (
        <ContextMenuItem
          onClick={() =>
            void each((e) =>
              onExchange
                ? onExchange(e)
                : onCommand!('auto-exchange', e, { slot: e.slot }),
            )
          }
        >
          {onExchange ? 'Exchange selected' : 'Auto exchange'}
        </ContextMenuItem>
      )}
      {compound && onCompound && (
        <ContextMenuItem onClick={() => void each(onCompound)}>
          Compound each by one level
        </ContextMenuItem>
      )}
      {compound && onCommand && (
        <ContextMenuItem
          onClick={() =>
            void each((e) =>
              uniqueCompoundEntries.includes(e)
                ? onCommand('auto-compound-mark', e, {
                    targetTier: (e.item.level || 0) + 1,
                  })
                : undefined,
            )
          }
        >
          Auto compound each by one level
        </ContextMenuItem>
      )}
    </>
  );
}
