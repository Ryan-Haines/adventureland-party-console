"use client";
import { BestiaryDrop } from "./bestiary-drop";
import { BestiaryMonster } from "./bestiary-monster";
import { indirectBestiaryDrops } from "./indirect-bestiary-drops";
import { ItemSprite } from "./item-sprite";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { formatDropRate } from "./drop-rate";

export function BestiaryDrops({
  monster,
  catalog,
  onInspectDrop,
}: {
  monster: BestiaryMonster;
  catalog: MerchantCatalogItem[];
  onInspectDrop: (itemId: string, monsterName: string) => void;
}) {
  const otherDrops = indirectBestiaryDrops(monster, catalog);
  const cards = (drops: BestiaryDrop[], indirect = false) =>
    drops.length ? (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {drops.map((drop, index) => (
          <button
            type="button"
            key={`${drop.id}-${drop.sourceType || "monster"}-${drop.mapName || ""}-${index}`}
            onClick={() => onInspectDrop(drop.id, monster.name)}
            className="flex items-center gap-2 rounded border border-amber-950 p-2 text-left hover:border-amber-500"
          >
            <div className="relative h-9 w-9 shrink-0">
              {drop.sprite && <ItemSprite sprite={drop.sprite} />}
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">{drop.name}</span>
              <span className="font-mono text-[9px] text-amber-300">
                {formatDropRate(drop)}
              </span>
              {indirect ? (
                <span className="block truncate font-mono text-[9px] text-cyan-300/70">
                  {drop.sourceType === "world"
                    ? "World drop"
                    : `${drop.mapName || "Map"} zone drop`}
                </span>
              ) : null}
            </span>
          </button>
        ))}
      </div>
    ) : (
      <p className="text-xs text-emerald-100/40">None listed in the current game data.</p>
    );
  return (
    <>
      <h4 className="mb-2 mt-5 font-mono text-xs uppercase text-amber-300">
        Monster-specific drops ({monster.drops.length})
      </h4>
      {cards(monster.drops)}
      <h4 className="mb-2 mt-5 font-mono text-xs uppercase text-cyan-300">
        Zone &amp; world drops ({otherDrops.length})
      </h4>
      <p className="mb-2 text-xs text-emerald-100/45">
        Shared loot-table rolls available while defeating this monster in the listed area.
      </p>
      {cards(otherDrops, true)}
    </>
  );
}
