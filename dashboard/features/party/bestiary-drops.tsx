"use client";
import { BestiaryDrop } from "./bestiary-drop";
import { BestiaryMonster } from "./bestiary-monster";
import { indirectBestiaryDrops } from "./indirect-bestiary-drops";
import { ItemSprite } from "./item-sprite";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { effectiveDropRate, formatDropRate } from "./drop-rate";

type EventDrop = BestiaryDrop & { condition?: string };

function eventDropsFor(monster: BestiaryMonster, catalog: MerchantCatalogItem[]): EventDrop[] {
  const seen = new Set<string>();
  return catalog.flatMap(item => {
    if (seen.has(item.id)) return [];
    seen.add(item.id);
    return (item.meta?.world?.drops || []).filter(source =>
      source.monsterId === monster.id && source.sourceType === "monster" &&
      // The native catalog retains this condition even outside the event.
      source.acquisitionPath?.includes("Witch's Cipher: gathering window only")
    ).map(source => ({ id: item.id, name: item.name, sprite: item.sprite,
      rate: effectiveDropRate(source), quantity: source.quantity || 1,
      condition: source.acquisitionPath!.join(" · ") }));
  }).sort((a, b) => b.rate - a.rate || a.name.localeCompare(b.name));
}

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
  const eventDrops = eventDropsFor(monster, catalog);
  const eventItems = new Set(eventDrops.map(drop => drop.id));
  const normalDrops = monster.drops.filter(drop => !eventItems.has(drop.id));
  const cards = (drops: EventDrop[], indirect = false) => {
    const groups = new Map<string, EventDrop[]>();
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
                {rolls.map((roll, index) => <span className="block whitespace-pre" key={index}>{formatDropRate(roll)}</span>)}
              </span>
              {drop.condition && <span className="block text-[10px] text-violet-200">{drop.condition}</span>}
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
      <p className="mt-4 text-xs text-emerald-100/70">Base odds at full contribution and neutral luck, level and event modifiers. Your contribution, luck and monster level scale each chance.</p>
      <h4 className="mb-2 mt-5 font-mono text-xs uppercase text-amber-300">
        Monster-specific drops ({normalDrops.length})
      </h4>
      {cards(normalDrops)}
      {eventDrops.length > 0 && <>
        <h4 className="mb-2 mt-5 font-mono text-xs uppercase text-violet-300">Event drops ({eventDrops.length})</h4>
        <p className="mb-2 text-xs text-emerald-100/70">Available only during the event conditions shown below.</p>
        {cards(eventDrops)}
      </>}
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
