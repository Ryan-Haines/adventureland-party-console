"use client";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { InventoryEntry } from "./inventory-entry";
import { ItemSprite } from "./item-sprite";
import { itemMaximumLevel } from "./item-maximum-level";
import { propertiesAtLevel } from "./properties-at-level";
import { ITEM_DETAIL_PROPERTY_RANK } from "./item-detail-property-rank";
import { STAT_SCROLLS } from "./stat-scrolls";
import { itemCardLines, titleCase, WEAPON_TYPES } from "./item-card-lines";
import { GAME_FONT } from "./item-card";
import { GAIN, LOSS } from "./stat-colors";
import { titledName } from "./item-title";

const GRAY = "gray";
// The game's card labels both the damage type and the weapon type "Type", so the table qualifies them.
const TYPE_ROWS = [["type", "Item Type"], ["wtype", "Weapon Type"], ["damage_type", "Damage Type"], ["ability", "Ability"]] as const;

export type CatalogComparisonEntry = { entry: InventoryEntry; level: number; stat: string };
export const comparisonEntry = (entry: InventoryEntry): CatalogComparisonEntry => ({
  entry, level: Number(entry.item.level) || 0, stat: entry.item.stat_type || "",
});
export const comparisonButtonClass = "border-cyan-700 bg-[#10251f] text-cyan-100 hover:border-cyan-400 hover:bg-cyan-950 hover:text-white";

export function CatalogComparison({ entries, onChange, onRemove }: {
  entries: CatalogComparisonEntry[];
  onChange: (index: number, value: CatalogComparisonEntry) => void;
  onRemove: (index: number) => void;
}) {
  const properties = entries.map(({ entry, level, stat }) => propertiesAtLevel(entry.meta || undefined, entry.item, level, stat || null));
  // Ability parameters describe different effects; keep them with their named ability.
  const keys = [...new Set(properties.flatMap(Object.keys))]
    .filter((key) => !["level", "attr0", "attr1"].includes(key) && properties.some((props) => typeof props[key] === "number" && Number.isFinite(props[key]) && props[key] !== 0))
    .sort((a, b) => (ITEM_DETAIL_PROPERTY_RANK.get(a) ?? 999) - (ITEM_DETAIL_PROPERTY_RANK.get(b) ?? 999) || a.localeCompare(b));
  const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  // The item card's lines for each column, keyed by stat, give the rows their game names, colors and values.
  const cards = entries.map(({ entry, level, stat }, index) => new Map(itemCardLines({
    meta: entry.meta, item: { ...entry.item, level, stat_type: stat || undefined }, level, properties: properties[index], usable: true,
  }).map((line) => [line.key, line])));
  return (
    <div className="min-h-0 overflow-auto rounded border border-cyan-800 bg-[#081510]">
      <table className="w-full border-collapse text-sm">
        <caption className="p-3 text-left text-slate-300">Item stats only. Every difference is against A; character bonuses and passive damage are not included.</caption>
        <thead>
          <tr>
            <th scope="col" className="min-w-32 p-3 text-left">Stat</th>
            {entries.map((value, index) => {
              const { entry, level, stat } = value;
              const name = titledName(String(entry.meta?.definition.name || entry.item.name), entry.item, entry.meta);
              const label = String.fromCharCode(65 + index);
              return (
                <th scope="col" key={index} className="min-w-52 border-l border-cyan-900 p-3 align-top text-left font-normal">
                  <p className="mb-2 font-semibold text-cyan-200">{label}{index === 0 ? " · Baseline" : ` · vs A`}</p>
                  <div className="relative mb-2 h-12 w-12">{entry.meta?.sprite && <ItemSprite sprite={entry.meta.sprite} />}</div>
                  <p className="mb-3 font-semibold">{name}</p>
                  {(entry.meta?.upgradeable || entry.meta?.compoundable) ? (
                    <div className="mb-4 rounded border border-violet-900 bg-[#07100f] p-3">
                      <div className="mb-2 flex justify-between font-mono text-xs uppercase text-violet-300">
                        <span>Preview level</span>
                        <span>+{level}</span>
                      </div>
                      <Slider
                        aria-label={`${label} ${name} preview level`}
                        min={0}
                        max={Math.max(Number(entry.item.level) || 0, itemMaximumLevel(entry.meta))}
                        step={1}
                        value={level}
                        onValueChange={(nextLevel) => onChange(index, {
                          ...value,
                          level: typeof nextLevel === "number" ? nextLevel : nextLevel[0] || 0,
                        })}
                      />
                    </div>
                  ) : null}
                  {!!entry.meta?.definition.stat && <select aria-label={`${label} ${name} stat scroll`} value={stat} onChange={(event) => onChange(index, { ...value, stat: event.target.value })}
                    className="mt-2 w-full rounded border border-cyan-700 bg-[#10251f] p-2 text-cyan-100 hover:border-cyan-400 hover:bg-cyan-950">
                    <option value="">No stat scroll</option>
                    {STAT_SCROLLS.map((choice) => <option key={choice.stat} value={choice.stat}>{choice.label}</option>)}
                  </select>}
                  {index > 0 && <Button size="sm" variant="outline" aria-label={`Remove ${label} ${name}`} className={`mt-2 ${comparisonButtonClass}`} onClick={() => onRemove(index)}>Remove</Button>}
                </th>
              );
            })}
          </tr>
        </thead>
        {/* The item card's box (docs/catalog-comparison-card.md); one body keeps each stat on one row across columns. */}
        <tbody className="border-[5px] border-[#808080] bg-black text-[13px] leading-5 text-[#E4E4E4]" style={{ fontFamily: GAME_FONT }}>
          {TYPE_ROWS.filter(([key]) => entries.some(({ entry }) => entry.meta?.definition[key])).map(([key, label]) => (
            <tr key={key} data-row={key}>
              <th scope="row" className="px-3 py-1 text-left font-normal"><span data-label style={{ color: GRAY }}>{label}</span></th>
              {entries.map(({ entry }, index) => {
                const definition = entry.meta?.definition || {};
                const lines = cards[index];
                const typeLine = key === "damage_type" ? lines.get("damage_type") : key === "ability" ? lines.get("ability") : null;
                const value = key === "type" ? titleCase(String(definition.type || ""))
                  : key === "wtype" ? `T${Number(definition.tier) || 0} ${WEAPON_TYPES[String(definition.wtype)] || titleCase(String(definition.wtype || ""))}`
                  : typeLine?.kind === "prop" ? typeLine.value : titleCase(String(definition[key] || ""));
                const effect = key === "ability" ? lines.get("ability_text") || lines.get("ability_chance") : undefined;
                return <td key={index} className="border-l border-[#333] px-3 py-1 align-top">
                  {definition[key] ? <span data-value style={typeLine ? { color: typeLine.color } : undefined}>{value}</span> : "-"}
                  {effect && <div style={{ color: effect.color }}>{effect.kind === "text" ? effect.text : `${effect.label}: ${effect.value}`}</div>}
                </td>;
              })}
            </tr>
          ))}
          {keys.map((key) => {
            const named = cards.map((lines) => lines.get(key)).find((line) => line?.kind === "prop");
            return <tr key={key} data-row={key}>
              <th scope="row" className="px-3 py-1 text-left font-normal">
                <span data-label style={{ color: named?.kind === "prop" ? named.color : GRAY }}>{named?.kind === "prop" ? named.label : titleCase(key)}</span>
              </th>
              {properties.map((props, index) => {
                const value = Number(props[key]) || 0;
                const baseline = Number(properties[0][key]) || 0;
                const delta = value - baseline;
                const line = cards[index].get(key);
                return <td key={index} className="border-l border-[#333] px-3 py-1">
                  <span data-value>{line?.kind === "prop" ? line.value : format(value)}</span>
                  {index > 0 && delta !== 0 && <span data-change className="whitespace-nowrap" style={{ color: delta > 0 ? GAIN : LOSS }}>
                    {" "}({delta > 0 ? "+" : ""}{format(delta)}{baseline !== 0 ? ` · ${delta > 0 ? "+" : ""}${format(delta / Math.abs(baseline) * 100)}%` : ""})
                  </span>}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
