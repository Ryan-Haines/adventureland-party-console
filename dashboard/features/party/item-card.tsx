"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Item } from "./item";
import type { ItemMeta } from "./item-meta";
import { itemCardLines, type ItemCardLine } from "./item-card-lines";

export const GAME_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// The game's item box: black, a 5px gray border and a dashed underline under the
// title (render_item in the game's js/html.js). docs/item-card.md.
// A box inside a dialog that already has regions can be a labelled group (a fieldset) instead.
// A card's extras box: the fields the card draws no line for, each coloured by its key.
export function ExtrasBox({ label, extras, colors }: { label: string; extras: [string, string, ReactNode][]; colors: Record<string, string> }) {
  if (!extras.length) return null;
  return <GameBox label={label} className="min-w-[14rem] flex-1">
    {extras.map(([key, name, value]) => <GameLine key={key} line={key} label={name} value={value} color={colors[key] || "#C3C3C3"} />)}
  </GameBox>;
}
export function GameBox({ label, className = "", group = false, children }: {
  label: string; className?: string; group?: boolean; children: ReactNode;
}) {
  const props = {
    "aria-label": label,
    className: `min-w-0 border-[5px] border-[#808080] bg-black px-4 py-3 text-[13px] leading-5 text-[#E4E4E4] ${className}`,
    style: { fontFamily: GAME_FONT },
  };
  return group ? <fieldset {...props}>{children}</fieldset> : <section data-area="item-card" {...props}>{children}</section>;
}

// One "Label: value" line in the game's style, with the label in its color.
export function GameLine({ line, label, value, color, valueColor }: {
  line: string; label: string; value: ReactNode; color: string; valueColor?: string;
}) {
  return (
    <div data-line={line}>
      <span data-label style={{ color }}>{label}</span>: <span style={valueColor ? { color: valueColor } : undefined}>{value}</span>
    </div>
  );
}

function CardLine({ line, skillHint, onSkill }: {
  line: ItemCardLine;
  skillHint: (id: string) => string | undefined;
  onSkill: (id: string) => void;
}) {
  if (line.kind === "text") return <div data-line={line.key} style={{ color: line.color }}>{line.text}</div>;
  const value = line.skill ? (
    <button
      type="button"
      title={skillHint(line.skill)}
      onClick={() => onSkill(line.skill!)}
      className="underline decoration-dotted underline-offset-2 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E1924D]"
    >
      {line.value}
    </button>
  ) : line.value;
  return <GameLine line={line.key} label={line.label} value={value} color={line.color} valueColor={line.valueColor} />;
}

// The game's stat lines for the item. The dialog header already shows the name and
// explanation, so the box starts at the first stat.
export function ItemCard({ meta, item, level, properties, setName, usable, skillName, skillHint, onSkill }: {
  meta: ItemMeta | null | undefined;
  item: Item;
  level: number;
  properties: Record<string, string | number | boolean>;
  setName?: string;
  usable: boolean;
  skillName: (id: string) => string | undefined;
  skillHint: (id: string) => string | undefined;
  onSkill: (id: string) => void;
}) {
  const lines = itemCardLines({ meta, item, level, properties, setName, usable, skillName })
    .filter((line) => line.key !== "explanation");
  const [json, setJson] = useState(false);
  const informationButton = useRef<HTMLButtonElement>(null);
  // I opens the JSON for the card in the topmost visible dialog only, never from a text field, and
  // never with a modifier or a held key. The listener runs only in the browser, in this effect.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "i" || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.defaultPrevented) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]')).filter((node) => node.getClientRects().length);
      if (!informationButton.current || dialogs.at(-1) !== informationButton.current.closest('[role="dialog"]')) return;
      event.preventDefault();
      setJson(true);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, []);
  return (
    <>
      <GameBox label="Item card" className="min-w-[16rem] flex-1">
        {lines.map((line) => line.key === "info" && line.kind === "prop" ? (
          <button key={line.key} ref={informationButton} type="button" data-line="info"
            aria-label="Item information (I)" aria-keyshortcuts="I" title="Item information (I)"
            onClick={() => setJson(true)}
            className="block border border-transparent bg-black text-left text-[#E4E4E4] hover:border-gray-500 hover:bg-gray-900 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400">
            <span data-label style={{ color: line.color }}>{line.label}</span>: {line.value}
          </button>
        ) : (
          <CardLine key={line.key} line={line} skillHint={skillHint} onSkill={onSkill} />
        ))}
      </GameBox>
      <Dialog open={json} onOpenChange={setJson}>
        <DialogContent data-area="item-information" showCloseButton={false} className="max-h-[85vh] overflow-y-auto border-emerald-800 bg-[#0b1916] text-emerald-50 sm:max-w-2xl">
          <DialogHeader><DialogTitle>Item information</DialogTitle><DialogDescription>JSON for {item.name}</DialogDescription></DialogHeader>
          <pre role="region" aria-label="Item JSON" className="overflow-x-auto rounded border border-emerald-900 bg-black p-3 text-xs text-emerald-100">{JSON.stringify({ item, definition: meta?.definition || {}, properties }, null, 2)}</pre>
          <DialogClose className="justify-self-end rounded border border-emerald-700 bg-[#07100f] px-3 py-2 text-emerald-100 hover:border-emerald-400 hover:bg-[#10251f] hover:text-white">Close information</DialogClose>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Colors for the console's own fields, in the game's palette.
const EXTRA_COLORS: Record<string, string> = {
  equip_slot: "#7AC0F5", stackable: "#7AC0F5", max_stack_size: "#7AC0F5", tier: "#56A244", scroll: "#B484E5",
  extra_stat: "#B484E5", exclusive: "#FC5F39", id: "#808080", quantity: "#C3C3C3", stat_type: "#B484E5",
  // The game draws a title in the name's color; gold sets it apart in the extras box.
  title: "gold",
};
const EXTRA_LABELS: Record<string, string> = { stat_type: "Stat Scroll" };
const extraLabel = (key: string) =>
  EXTRA_LABELS[key] || key.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

// Fields from the console's stats grid that have no line on the game's card.
export function ItemExtraStats({ entries }: { entries: [key: string, value: string][] }) {
  return (
    <GameBox label="Item extras" className="min-w-[14rem] flex-1">
      {entries.map(([key, value]) => (
        <GameLine key={key} line={key} label={extraLabel(key)} value={value} color={EXTRA_COLORS[key] || "#808080"} />
      ))}
    </GameBox>
  );
}
