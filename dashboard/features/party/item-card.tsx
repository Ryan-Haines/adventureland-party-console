"use client";
import type { ReactNode } from "react";
import type { Item } from "./item";
import type { ItemMeta } from "./item-meta";
import { itemCardLines, type ItemCardLine } from "./item-card-lines";

export const GAME_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// The game's item box: black, a 5px gray border and a dashed underline under the
// title (render_item in the game's js/html.js). docs/item-card.md.
// A box inside a dialog that already has regions can be a labelled group (a fieldset) instead.
export function GameBox({ label, className = "", group = false, children }: {
  label: string; className?: string; group?: boolean; children: ReactNode;
}) {
  const props = {
    "aria-label": label,
    className: `min-w-0 border-[5px] border-[#808080] bg-black px-4 py-3 text-[13px] leading-5 text-[#E4E4E4] ${className}`,
    style: { fontFamily: GAME_FONT },
  };
  return group ? <fieldset {...props}>{children}</fieldset> : <section {...props}>{children}</section>;
}

export function GameHeading({ color = "#E4E4E4", children, aside }: { color?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-1 mt-3 flex flex-wrap items-end justify-between gap-2 first:mt-0">
      <h3 className="inline-block border-b-2 border-dashed border-[#808080] font-semibold" style={{ color }}>
        {children}
      </h3>
      {aside}
    </div>
  );
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
  return (
    <GameBox label="Item card" className="min-w-[16rem] flex-1">
      {lines.map((line) => (
        <CardLine key={line.key} line={line} skillHint={skillHint} onSkill={onSkill} />
      ))}
    </GameBox>
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
