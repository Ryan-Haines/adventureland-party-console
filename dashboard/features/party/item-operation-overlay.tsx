"use client";
import { InventoryEntry } from "./inventory-entry";
import { itemLevelLabelClass } from "./item-level-label-class";
import { ItemSprite } from "./item-sprite";

export function ItemOperationOverlay({
  operation,
}: {
  operation: NonNullable<InventoryEntry["operation"]>;
}) {
  const percent = operation.chance == null ? null : `${(operation.chance * 100).toFixed(2)}%`;
  const chanceColor = `hsl(${Math.max(0, Math.min(1, operation.chance ?? 0)) * 120} 85% 65%)`;
  return (
    <span
      className="pointer-events-none absolute inset-0 z-20"
      style={{ containerType: "inline-size" }}
      aria-label={`${operation.type}: +${operation.fromLevel} to +${operation.toLevel}${percent ? `, ${percent} success` : ""}`}
    >
      {operation.sprite ? (
        <span className="absolute inset-0 opacity-70 motion-safe:animate-pulse">
          <ItemSprite sprite={operation.sprite} />
        </span>
      ) : null}
      {percent ? (
        <span
          className="absolute inset-x-0 top-[22%] bottom-[35%] flex items-center justify-center whitespace-nowrap font-mono font-bold leading-none"
          style={{
            color: chanceColor,
            fontSize: "min(16px, 22cqw)",
            textShadow: "0 1px 2px #000",
          }}
        >
          {percent}
        </span>
      ) : null}
      <span className={`${itemLevelLabelClass} left-1`}>+{operation.fromLevel}</span>
      <span className={`${itemLevelLabelClass} left-1/2 -translate-x-1/2`}>→</span>
      <span className={`${itemLevelLabelClass} right-1`}>+{operation.toLevel}</span>
    </span>
  );
}
