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
  const cards = (drops: BestiaryDrop[], indirect = false) => {
    const groups = new Map<string, BestiaryDrop[]>();
    for (const drop of drops) { const key = `${drop.id}:${drop.sourceType || "monster"}:${drop.mapName || ""}`;
      groups.set(key, [...groups.get(key) || [], drop]); }
    return drops.length ? (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[...groups.values()].map((rolls, index) => { const drop=rolls[0]; return (
          <button
            type="button"
            key={`${drop.id}-${drop.sourceType || "monster"}-${drop.mapName || ""}-${index}`}
            onClick={() => onInspectDrop(drop.id, monster.name)}
            className="flex items-center gap-2 rounded border border-amber-800 bg-[#07100f] p-2 text-left text-emerald-50 hover:border-amber-500 hover:bg-amber-950"
          >
            <div className="relative h-9 w-9 shrink-0">
              {drop.sprite && <ItemSprite sprite={drop.sprite} />}
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">{drop.name}</span>
              <span className="font-mono text-[9px] text-amber-300">
                {rolls.map((roll, index) => <span className="block" key={index}>{rolls.length > 1 ? `Roll ${index + 1}: ` : ""}{formatDropRate(roll)}</span>)}
                {rolls.length > 1 && <span className="block text-emerald-100/70">Independent rolls</span>}
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
        ); })}
      </div>
    ) : (
      <p className="text-xs text-emerald-100/40">None listed in the current game data.</p>
    );
  };
  return (
    <>
      <h4 className="mb-2 mt-5 font-mono text-xs uppercase text-violet-300">Home rewards ({monster.homeRewards?.length || 0})</h4>
      <p className="mb-2 text-xs text-emerald-100/70">Home-server bonus required. These rolls are separate from normal monster drops.</p>
      {cards(monster.homeRewards || [])}
      <p className="mt-4 text-xs text-emerald-100/70">Base odds at full contribution and neutral luck, level and event modifiers. Your contribution, luck and monster level scale each roll; independent rolls can each yield rewards.</p>
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
