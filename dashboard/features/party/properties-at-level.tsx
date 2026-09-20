"use client";
import { calculatedLevelProperties } from "./calculated-level-properties";
import { Item } from "./item";
import { ItemMeta } from "./item-meta";

export function propertiesAtLevel(
  meta: ItemMeta | undefined,
  item: Item,
  level: number,
  statType?: string | null,
) {
  const actualLevel = Math.max(0, Number(item.level) || 0);
  const actualCalculated = calculatedLevelProperties(meta, item, actualLevel);
  const previewItem = { ...item };
  if (statType) previewItem.stat_type = statType;
  else delete previewItem.stat_type;
  const previewCalculated = calculatedLevelProperties(meta, previewItem, level);
  const reported = meta?.properties || {};
  return Object.keys({
    ...actualCalculated,
    ...previewCalculated,
    ...reported,
  }).reduce<Record<string, string | number | boolean>>((out, key) => {
    const reportedValue = reported[key];
    if (
      reportedValue !== undefined &&
      typeof reportedValue !== "number" &&
      typeof reportedValue !== "string"
    ) {
      out[key] = reportedValue;
      return out;
    }
    const current = Number(reportedValue ?? actualCalculated[key] ?? 0);
    const value =
      current + Number(previewCalculated[key] || 0) - Number(actualCalculated[key] || 0);
    if (value) out[key] = value;
    return out;
  }, {});
}
