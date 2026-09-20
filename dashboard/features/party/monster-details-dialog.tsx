"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MapPin } from "lucide-react";
import { BestiaryDrops } from "./bestiary-drops";
import { BestiaryMonster } from "./bestiary-monster";
import { DefinitionGrid } from "./definition-grid";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { MonsterAchievementProgress } from "./monster-achievement-progress";
import { SpriteCrop } from "./sprite-crop";
import { MonsterSpawns } from "./monster-spawns";

export function MonsterDetailsDialog({
  monster,
  catalog,
  achievement,
  onOpenChange,
  onInspectDrop,
  onNavigate,
}: {
  monster: BestiaryMonster | null;
  catalog: MerchantCatalogItem[];
  achievement: { score: number; owner: string | null } | null;
  onOpenChange: (open: boolean) => void;
  onInspectDrop: (itemId: string, monsterName: string) => void;
  onNavigate: (monster: BestiaryMonster) => void;
}) {
  return (
    <Dialog open={!!monster} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border border-rose-800 bg-[#0b1916] text-emerald-50 sm:max-w-2xl">
        {monster ? (
          <>
            <DialogHeader>
              <div className="flex items-center gap-3 pr-8">
                <div className="relative h-14 w-14 shrink-0">
                  {monster.sprite && <SpriteCrop sprite={monster.sprite} size={56} />}
                </div>
                <div className="min-w-0 flex-1">
                  <DialogTitle>{monster.name}</DialogTitle>
                  <DialogDescription className="mt-1 font-mono text-emerald-100/45">
                    G.monsters.{monster.id}
                  </DialogDescription>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={monster.id === "tinyp"}
                  onClick={() => onNavigate(monster)}
                  title={monster.id === "tinyp" ? "Fairy has no regular route; enable passive Fairy hunting" : `Navigate to ${monster.name}`}
                  aria-label={`Navigate to ${monster.name}`}
                  className="shrink-0 border-cyan-600 bg-black text-cyan-200 hover:bg-cyan-950 hover:text-white"
                >
                  <MapPin className="h-4 w-4" />
                </Button>
              </div>
            </DialogHeader>
            <MonsterAchievementProgress monster={monster} achievement={achievement} />
            <MonsterSpawns records={monster.spawnRecords} />
            <DefinitionGrid value={monster.definition} omit={["name", "skin", "achievements"]} />
            <section className="rounded border border-amber-900/80 bg-amber-950/10 p-4">
              <BestiaryDrops
                monster={monster}
                catalog={catalog}
                onInspectDrop={(itemId) => onInspectDrop(itemId, monster.name)}
              />
            </section>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
