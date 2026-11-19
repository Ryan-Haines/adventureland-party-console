"use client";
// "Pin top bar" in Interface settings. It is off by default, so nothing sticks, as in v1.5.0.
// On, the party header sticks to the top and each card's name strip sticks under it
// (card-name-strip.tsx). It is a display choice per browser, kept with the dashboard's other
// browser preferences (use-stored-boolean.ts).
import { useStoredBoolean } from "@/hooks/use-stored-boolean";

export const usePinTopBar = () => useStoredBoolean("party-ui:pin-top-bar", false);

export function PinTopBarSetting() {
  const [pinned, setPinned] = usePinTopBar();
  return <section data-area="display" className="space-y-2 rounded border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100" aria-label="Display">
    <h3 className="font-semibold">Display</h3>
    <label className="flex items-center gap-3">
      <input type="checkbox" className="size-4 accent-emerald-500" checked={pinned} onChange={event => setPinned(event.target.checked)} />
      Pin top bar
    </label>
    <p className="text-slate-300">Keeps the top bar and each character card&apos;s name strip in view while the page scrolls.</p>
  </section>;
}
