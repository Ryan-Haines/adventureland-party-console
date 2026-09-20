"use client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowDown, ArrowUp, Info } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { BestiaryMonster } from "./bestiary-monster";
import { MerchantCatalogItem } from "./merchant-catalog-item";
import { SpriteCrop } from "./sprite-crop";
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SharedTracktrixBonuses } from './tracktrix-bonuses';

const sortOptions = [
  {value: "threat", label: "Threat rate"},
  {value: "hp", label: "HP"},
  {value: "attack", label: "Attack"},
  {value: "xp", label: "XP reward"},
  {value: "range", label: "Attack range"},
  {value: "name", label: "Name"},
  {value: "tracktrix", label: "Tracktrix score"},
  {value: "next", label: "Score to next"},
];
function achievementMilestones(monster: BestiaryMonster): number[] {
  const entries = monster.definition.achievements;
  return Array.isArray(entries) ? entries.map(entry => Array.isArray(entry) ? Number(entry[0]) : 0)
    .filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b) : [];
}

export function BestiaryDialog({
  open,
  onOpenChange,
  monsters,
  onInspectMonster,
  achievements,
  characterNames = [],
}: {
  open: boolean;
  characterNames?: string[];
  onOpenChange: (open: boolean) => void;
  monsters: BestiaryMonster[];
  catalog: MerchantCatalogItem[];
  onInspectDrop: (itemId: string, monsterName: string) => void;
  onInspectMonster: (monster: BestiaryMonster) => void;
  achievements: Record<string, { score: number; owner: string | null }> | null;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("threat");
  const [ascending, setAscending] = useState(true);
  const [selectedMap, setSelectedMap] = useState("all");
  const maps = [...new Set(monsters.flatMap(monster => (monster.spawnRecords || []).map(spawn => spawn.map)))].sort();
  const score = (monster: BestiaryMonster) => Math.max(0, Number(achievements?.[monster.id]?.score) || 0);
  const scoreToNext = (monster: BestiaryMonster) => {
    if (!achievements) return null;
    const next = achievementMilestones(monster).find(value => value > score(monster));
    return next === undefined ? null : next - score(monster);
  };
  const filtered = monsters
    .filter(monster => selectedMap === "all" || monster.spawnRecords?.some(spawn => spawn.map === selectedMap))
    .filter((monster) =>
      `${monster.name} ${monster.id}`.toLowerCase().includes(search.toLowerCase()),
    )
    .slice()
    .sort((a, b) => {
      const direction = ascending ? 1 : -1;
      if (sort === "name") return direction * a.name.localeCompare(b.name);
      if (sort === "tracktrix") {
        return direction * (score(a) - score(b)) || a.name.localeCompare(b.name);
      }
      if (sort === "next") {
        const remainingA = scoreToNext(a), remainingB = scoreToNext(b);
        if (remainingA === null && remainingB !== null) return 1;
        if (remainingB === null && remainingA !== null) return -1;
        return direction * ((remainingA ?? 0) - (remainingB ?? 0)) || a.name.localeCompare(b.name);
      }
      const key = sort as "threat" | "hp" | "attack" | "xp" | "range";
      return direction * ((a[key] || 0) - (b[key] || 0)) || a.name.localeCompare(b.name);
    });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[92vh] flex-col border-rose-900 bg-[#0b1916] text-emerald-50"
        style={{ width: "calc(100vw - 2rem)", maxWidth: "1500px" }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>Bestiary</DialogTitle>
            <Popover>
              <PopoverTrigger render={<button type="button" aria-label="Current Tracktrix bonuses" title="Current Tracktrix bonuses" className="rounded border border-rose-700 bg-black p-1 text-rose-200 hover:border-rose-400 hover:bg-rose-950 hover:text-white" />}>
                <Info aria-hidden="true" className="h-3.5 w-3.5" />
              </PopoverTrigger>
              <PopoverContent className="max-h-[70vh] w-80 overflow-y-auto border border-rose-800 bg-[#1c1014] text-rose-50">
                <SharedTracktrixBonuses names={characterNames} />
              </PopoverContent>
            </Popover>
          </div>
          <DialogDescription className="text-emerald-100/55">
            Compare monsters before choosing a farming target. Use the arrow to switch between
            lowest and highest first.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="text-sm text-emerald-100">Show monsters in</legend>
          <div className="flex max-h-28 flex-wrap gap-2 overflow-y-auto">
            {["all", ...maps].map(map => (
              <button key={map} type="button" aria-pressed={selectedMap === map} onClick={() => setSelectedMap(map)}
                className={`rounded-full border px-3 py-1 text-xs focus-visible:outline-2 focus-visible:outline-emerald-300 ${selectedMap === map
                  ? "border-emerald-300 bg-emerald-900 text-white hover:bg-emerald-800"
                  : "border-emerald-800 bg-[#10251f] text-emerald-100 hover:border-emerald-400 hover:bg-[#20392f] hover:text-white"}`}>
                {map === "all" ? "All" : map}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search monsters…"
            className="min-w-40 flex-1 border-rose-900 bg-[#08110e] text-emerald-50"
          />
          <Select items={sortOptions} value={sort} onValueChange={(value) => value && setSort(value)}>
            <SelectTrigger className="w-48 border-rose-800 bg-[#10251f] text-emerald-50 hover:border-rose-400 hover:bg-[#20392f]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border border-rose-800 bg-[#10251f] text-emerald-50">
              {sortOptions.map(option => <SelectItem key={option.value} value={option.value}
                className="text-emerald-50 data-highlighted:bg-emerald-900 data-highlighted:text-white">{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            aria-label={ascending ? "Sort highest first" : "Sort lowest first"}
            title={ascending ? "Lowest first — switch to highest first" : "Highest first — switch to lowest first"}
            onClick={() => setAscending((value) => !value)}
            className="shrink-0 border border-rose-700 bg-[#10251f] text-emerald-100 hover:border-rose-400 hover:bg-[#20392f] hover:text-white"
          >
            {ascending ? <ArrowDown className="size-4" /> : <ArrowUp className="size-4" />}
          </Button>
        </div>
        {(sort === "tracktrix" || sort === "next") && !achievements && (
          <p className="text-xs text-amber-200">Tracktrix data unavailable; total scores use zero and score to next is unavailable.</p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto pr-2">
          {!filtered.length && <p className="py-8 text-center text-sm text-emerald-100">No monsters match this map and search.</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-9">
            {filtered.map((monster) => {
              const milestones = achievementMilestones(monster);
              const progress = achievements?.[monster.id] || null;
              const killed = Math.max(0, Number(progress?.score) || 0);
              const finalMilestone = milestones[milestones.length - 1] || 0;
              const nextMilestone = milestones.find((value) => value > killed);
              const unlocked = milestones.filter((value) => value <= killed).length;
              return (
                <button
                  key={monster.id}
                  type="button"
                  onClick={() => onInspectMonster(monster)}
                  className="min-w-0 rounded border border-rose-950 bg-black/25 p-2 text-center hover:border-rose-500 hover:bg-rose-400/5"
                >
                  <div className="relative mx-auto h-12 w-12">
                    {monster.sprite && <SpriteCrop sprite={monster.sprite} size={48} />}
                  </div>
                  <p className="mt-1 truncate text-xs" title={monster.name}>
                    {monster.name}
                  </p>
                  <p className="font-mono text-[9px] text-emerald-100/45">
                    {monster.hp.toLocaleString()} HP · {monster.xp.toLocaleString()} XP
                  </p>
                  <p className="font-mono text-[9px] text-rose-300/75">
                    {monster.attack.toLocaleString()} ATK · {monster.threat.toFixed(1)} threat
                  </p>
                  {!!finalMilestone && achievements && (
                    <>
                      <p className="mt-1 font-mono text-[9px] text-amber-200/80">
                        {killed.toLocaleString()} / {finalMilestone.toLocaleString()} score
                      </p>
                      {progress?.owner ? (
                        <p
                          className="truncate font-mono text-[9px] text-amber-100/65"
                          title={progress.owner}
                        >
                          High score: {progress.owner}
                        </p>
                      ) : null}
                      <p className="font-mono text-[9px] text-emerald-300/80">
                        {unlocked} / {milestones.length} achievements unlocked
                      </p>
                      <p className="font-mono text-[9px] text-violet-300/80">
                        {nextMilestone
                          ? `${(nextMilestone - killed).toLocaleString()} score to next achievement`
                          : "All achievements complete"}
                      </p>
                    </>
                  )}
                  {!!finalMilestone && !achievements && (
                    <p className="mt-1 font-mono text-[9px] text-amber-200/70">
                      Tracktrix required for score totals
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
