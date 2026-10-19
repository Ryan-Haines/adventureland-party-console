'use client';
import {
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from '@/components/ui/context-menu';
import { ArrowRightLeft, Blender } from 'lucide-react';
import { AutoActionIcon } from './auto-action-icon';
import { itemMaximumLevel } from './item-maximum-level';
import type { InventoryEntry } from './inventory-entry';
export function BankProductionActions({
  entry,
  exchangeable,
  onExchange,
  onCompound,
}: {
  entry: InventoryEntry;
  exchangeable: boolean;
  onExchange: (auto: boolean) => void;
  onCompound: (tier: number, auto: boolean) => void;
}) {
  if (entry.item.l || entry.item.b || entry.operation) return null;
  const level = entry.item.level || 0,
    max = Math.min(7, itemMaximumLevel(entry.meta));
  return (
    <>
      {exchangeable && (
        <>
          <ContextMenuItem onClick={() => onExchange(false)}>
            <ArrowRightLeft />
            Exchange
          </ContextMenuItem>
          <ContextMenuItem onClick={() => onExchange(true)}>
            <AutoActionIcon>
              <ArrowRightLeft />
            </AutoActionIcon>
            Auto exchange
          </ContextMenuItem>
        </>
      )}
      {entry.meta?.compoundable && level < max && (
        <>
          <ContextMenuItem onClick={() => onCompound(level + 1, false)}>
            <Blender />
            Compound one level
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <AutoActionIcon>
                <Blender />
              </AutoActionIcon>
              Auto compound
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {Array.from({ length: max - level }, (_, i) => level + i + 1).map(
                (tier) => (
                  <ContextMenuItem
                    key={tier}
                    onClick={() => onCompound(tier, true)}
                  >
                    To +{tier}
                  </ContextMenuItem>
                ),
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}
    </>
  );
}
