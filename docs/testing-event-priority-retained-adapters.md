# Event-priority retained adapters

The direct combined-suite run exposed a heartbeat composition adapter returning
undefined for selected events when no selection was declared. The maintained
selection provider returns an array; priority-aware live-event lookup now uses
that array. Declare an empty selection in this existing adapter, preserving all
command retention and Hunt ownership assertions. No new isolated cases or
production behavior changes are needed.

The existing dropdown adapter also needs the new drag-state hook and decorative
GripVertical component dependencies. Declare inert hook state for its unchanged
selection-only checks; real drag/reorder behavior remains covered by console E2E.
