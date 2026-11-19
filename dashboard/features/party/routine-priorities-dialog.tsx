'use client';
import { AddonSlot, OverlaidBy } from '../../../runtime/hooks/dashboard/slots';
import type { AddonKindRow } from '../../../runtime/merchant-jobs/api';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { GripVertical } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useEffect, useRef, useState } from 'react';
import { useReorderList, type DragPosition } from '@/lib/use-reorder-list';
import { automaticRoutine, defaultMerchantRoutinePriorities, merchantRoutinePriority, movedRoutinePriorities, ROUTINE_DIALOG_LABELS, typedRoutinePriority } from '../../../runtime/merchant-jobs/api.ts';

export function RoutinePrioritiesDialog({
  open,
  onOpenChange,
  priorities,
  enabled,
  kinds = [],
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  priorities: Record<string, number>;
  enabled: Record<string, boolean>;
  kinds?: readonly AddonKindRow[];
  onSave: (
    priorities: Record<string, number>,
    enabled: Record<string, boolean>,
  ) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, number>>(priorities);
  const [enabledDraft, setEnabledDraft] =
    useState<Record<string, boolean>>(enabled);
  const [dragged, setDragged] = useState<string | null>(null);
  const [dragPosition, setDragPosition] = useState<DragPosition | null>(null);
  const dragOriginal = useRef<Record<string,number> | null>(null);
  const { listRef, remember, rowAt } = useReorderList('routine', dragged, dragPosition, draft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const wasOpen = useRef(false);
  // Polling replaces `priorities` with a fresh object every second. Seed the
  // form only as the dialog opens; never overwrite a draft while it is open.
  useEffect(() => {
    if (open && !wasOpen.current) {
      setError('');
      setDragged(null);
      setDraft(priorities);
      setEnabledDraft(enabled);
    }
    wasOpen.current = open;
  }, [open, priorities, enabled]);
  // the merchant jobs owner's merchantRoutinePriority orders the list: a routine with no saved value sorts at its fallback
  // of 50, and a saved one is clamped to the merchant jobs owner's range.
  const sortedRoutines = Object.entries(ROUTINE_DIALOG_LABELS).sort(
    ([keyA, labelA], [keyB, labelB]) =>
      merchantRoutinePriority(draft, keyB) - merchantRoutinePriority(draft, keyA) || labelA.localeCompare(labelB),
  );
  const disabledRoutine = (key: string) => ["deliveries", "withdrawals"].includes(key) && enabled[key] === false;
  const movableRoutines = sortedRoutines.filter(([key]) => !disabledRoutine(key));
  const move = (source: string, target: string, after: boolean) => {
    if (source === target || disabledRoutine(source) || disabledRoutine(target)) return;
    const keys = movableRoutines
      .map(([key]) => key)
      .filter((key) => key !== source);
    const index = keys.indexOf(target) + (after ? 1 : 0);
    keys.splice(index, 0, source);
    const next = movedRoutinePriorities(draft, keys, index);
    remember();
    setDraft(next);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-area="routines" className="flex max-h-[85vh] flex-col overflow-hidden border-amber-800 bg-[#091614] text-emerald-50 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merchant routines · {Object.keys(ROUTINE_DIALOG_LABELS).filter(key => !disabledRoutine(key) && (!(automaticRoutine(key) || key === 'fishing' || key === 'mining') || enabledDraft[key] !== false)).length}/{Object.keys(ROUTINE_DIALOG_LABELS).length} enabled</DialogTitle>
          <DialogDescription>
            Higher priorities run first. Equal priorities run oldest first.
            Enabled controls only automatic scheduling.
          </DialogDescription>
        </DialogHeader>
        <OverlaidBy fields={["merchantRoutinePriorities"]} />
        <div ref={listRef}
                onPointerMove={event => {
                  if(!dragged || !dragPosition)return;
                  setDragPosition({...dragPosition,x:event.clientX-dragPosition.offsetX,y:event.clientY-dragPosition.offsetY});
                  const list=listRef.current;if(!list)return;
                  const bounds=list.getBoundingClientRect();
                  if(event.clientY<bounds.top+45)list.scrollTop-=15;
                  if(event.clientY>bounds.bottom-45)list.scrollTop+=15;
                  const hit=rowAt(event.clientY);
                  if(hit)move(dragged,hit.target,hit.after);
                }}
                onPointerUp={() => {setDragged(null);setDragPosition(null);dragOriginal.current=null;}}
                onPointerCancel={() => {if(dragOriginal.current)setDraft(dragOriginal.current);setDragged(null);setDragPosition(null);}}
 className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          {sortedRoutines.map(([key, label]) => (
            <div
              key={key}
              data-routine={key}
              aria-disabled={disabledRoutine(key) || undefined}
              aria-describedby={disabledRoutine(key) ? `${key}-routine-help` : undefined}
              className={`flex items-center gap-3 rounded border bg-slate-950 px-3 py-2 transition-transform ${disabledRoutine(key) ? "text-slate-400" : "text-emerald-50"} ${dragged === key ? "border-cyan-300 opacity-25" : "border-emerald-900/70"}`}
            >
              {automaticRoutine(key) ||
              key === 'fishing' ||
              key === 'mining' ? (
                <Checkbox
                  aria-label={`Enable ${label}`}
                  checked={enabledDraft[key] !== false}
                  onCheckedChange={(checked) =>
                    setEnabledDraft((old) => ({
                      ...old,
                      [key]: checked === true,
                    }))
                  }
                />
              ) : null}
              <span className="min-w-0 flex-1 text-sm">{label}
                {disabledRoutine(key) && <span id={`${key}-routine-help`} className="block text-xs text-slate-300">Enable in Merchant settings</span>}
              </span>
              <Input
                aria-label={`${label} priority`}
                disabled={disabledRoutine(key)}
                aria-describedby={disabledRoutine(key) ? `${key}-routine-help` : undefined}
                inputMode="numeric"
                value={disabledRoutine(key) ? priorities[key] ?? defaultMerchantRoutinePriorities()[key] : draft[key] ?? merchantRoutinePriority(priorities, key)}
                onChange={(event) => {
                  const value = typedRoutinePriority(event.target.value);
                  setDraft((old) => ({ ...old, [key]: value }));
                }}
                className="h-8 w-20 border-amber-700 bg-slate-950 text-right font-mono text-amber-100 disabled:border-slate-600 disabled:text-slate-400"
              />
              <button
                type="button"
                aria-label={`Move ${label}`}
                disabled={disabledRoutine(key)}
                aria-describedby={disabledRoutine(key) ? "delivery-routine-help" : undefined}
                title="Drag to reorder; use arrow keys to move"
                style={{touchAction:'none'}}
                onPointerDown={event => {
                  if (event.button !== 0 || disabledRoutine(key)) return;
                  event.preventDefault();event.currentTarget.focus();listRef.current!.setPointerCapture(event.pointerId);
                  const rect=event.currentTarget.parentElement!.getBoundingClientRect();
                  dragOriginal.current={...draft};setDragged(key);
                  setDragPosition({x:rect.left,y:rect.top,width:rect.width,offsetX:event.clientX-rect.left,offsetY:event.clientY-rect.top});
                }}
                onKeyDown={(event) => {
                  if (disabledRoutine(key)) return;
                  if(event.key === 'Escape' && dragOriginal.current){event.preventDefault();event.stopPropagation();setDraft(dragOriginal.current);setDragged(null);setDragPosition(null);return;}
                  const index = movableRoutines.findIndex(([id]) => id === key);
                  const target =
                    movableRoutines[index + (event.key === 'ArrowUp' ? -1 : 1)];
                  if (
                    (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
                    target
                  ) {
                    event.preventDefault();
                    move(key, target[0], event.key === 'ArrowDown');
                  }
                }}
                className="cursor-grab rounded border border-slate-600 bg-[#10201b] p-1 text-slate-200 hover:bg-slate-700 hover:text-white active:cursor-grabbing disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-950 disabled:text-slate-500"
              >
                <GripVertical className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <AddonSlot name="merchant-routines" part="routines" priorities={draft} enabled={enabledDraft} kinds={kinds} />
        {dragged && !disabledRoutine(dragged) && dragPosition && createPortal(<div aria-hidden="true" className="pointer-events-none fixed z-[100] flex items-center justify-between rounded border border-cyan-300 bg-slate-900 px-3 py-3 text-slate-100 shadow-2xl" style={{left:dragPosition.x,top:dragPosition.y,width:dragPosition.width}}><span>{ROUTINE_DIALOG_LABELS[dragged]}</span><span>{draft[dragged]} <GripVertical className="ml-3 inline size-4" /></span></div>, document.body)}
        {error && (
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
        )}
        <DialogFooter className="shrink-0 border-t border-emerald-900 bg-[#091614] pt-3">
          <Button
            disabled={saving}
            className="border-slate-600 bg-black text-slate-100 hover:bg-slate-800 hover:text-white"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setError('');
              try {
                const nextPriorities = { ...draft };
                if (disabledRoutine("deliveries")) delete nextPriorities.deliveries;
                if (disabledRoutine("withdrawals")) delete nextPriorities.withdrawals;
                const nextEnabled = { ...enabledDraft };
                delete nextEnabled.deliveries; // This toggle belongs to Merchant settings.
                delete nextEnabled.withdrawals;
                await onSave(nextPriorities, nextEnabled);
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'Could not save routines',
                );
              } finally {
                setSaving(false);
              }
            }}
            className="bg-amber-400 text-amber-950"
          >
            Save routines
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
