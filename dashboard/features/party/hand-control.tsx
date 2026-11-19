"use client";
import { Checkbox } from "@/components/ui/checkbox";
import type { ActiveSlot } from "./active-slot";
import { HAND_CONTROL_DEFAULT, type HandControl } from "../../../runtime/tasks/api.ts";

// Hand control of one
// character. The coordinator's task owner holds the member while `on` stands; the card only sends
// the choice (formation route `handControl`). The shape and default are the tasks owner's (runtime/tasks/rules.ts).
export type { HandControl };

// A character online in a game client (Steam) gets "Manual". A headless one gets "Pause", and
// the console runs no code for it until you turn Pause off.
const toggleWord = (slot: ActiveSlot | undefined) => slot?.kind === 'native' ? 'Manual' : 'Pause';

export function HandControlToggle({ name, slot, value, onChange }: {
  name: string; slot: ActiveSlot | undefined; value: HandControl | undefined;
  onChange(patch: Partial<HandControl>): void;
}) {
  const hand = { ...HAND_CONTROL_DEFAULT, ...value }, word = toggleWord(slot), manual = word === 'Manual';
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor={`hand-${name}`} className="flex items-center gap-2">
        <Checkbox id={`hand-${name}`} checked={hand.on} onCheckedChange={checked => onChange({ on: !!checked })} />
        <span>{word}</span>
      </label>
      {manual && hand.on ? (
        <fieldset data-testid={`hand-switches-${name}`} className="flex flex-wrap items-center gap-3 text-xs text-emerald-100/80">
          <legend className="sr-only">While I play this character, the console still runs</legend>
          <label className="flex items-center gap-1">
            <Checkbox checked={hand.usePotions} onCheckedChange={checked => onChange({ usePotions: !!checked })} />
            <span>Use potions</span>
          </label>
          <label className="flex items-center gap-1">
            <Checkbox checked={hand.combat} onCheckedChange={checked => onChange({ combat: !!checked })} />
            <span>Combat</span>
          </label>
          <label className="flex items-center gap-1">
            <span>While I play this character, the party</span>
            <select value={hand.party} onChange={event => onChange({ party: event.target.value as HandControl['party'] })}
              className="rounded border border-emerald-700 bg-[#0b1916] px-1 py-0.5 text-emerald-50">
              <option value="follows-me">Follows me</option>
              <option value="carries-on">Carries on</option>
            </select>
          </label>
        </fieldset>
      ) : null}
    </div>
  );
}

// "N characters on Manual" (or Pause) in the top bar while any hold stands; there is no timer.
export function HandControlCount({ hands, slots }: { hands?: Record<string, HandControl>; slots?: ActiveSlot[] }) {
  const on = Object.entries(hands ?? {}).filter(([, hand]) => hand.on).map(([name]) => toggleWord(slots?.find(s => s.character === name)));
  if (!on.length) return null;
  const manual = on.filter(word => word === 'Manual').length, paused = on.length - manual;
  const text = [manual ? `${manual} character${manual === 1 ? '' : 's'} on Manual` : '', paused ? `${paused} character${paused === 1 ? '' : 's'} on Pause` : '']
    .filter(Boolean).join(', ');
  return <output data-hand-control className="ml-3 rounded border border-sky-400 bg-sky-950 px-2 py-0.5 font-mono text-xs font-semibold text-sky-100">{text}</output>;
}
