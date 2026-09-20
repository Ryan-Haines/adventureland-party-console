"use client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { farmingAreas, defaultPhoenixOrder, type FarmingArea } from "@/lib/farming-areas";
import { Maximize2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Char } from "./char";
import { FarmingAreaPreview } from "./farming-area-preview";
import { ItemSprite } from "./item-sprite";
import { Location } from "./location";
import { MonsterChoice } from "./monster-choice";
import { MonsterSpawns } from "./monster-spawns";

export function FarmingAreaPicker({
  catalog,
  ids,
  character,
  waypoint,
  radius,
  override,
  busy,
  onClose,
  onStart,
  preparation,
  phoenixRouteOrder,
}: {
  phoenixRouteOrder?: string[];
  preparation?: ReactNode;
  catalog: MonsterChoice[];
  ids: string[];
  character?: Char;
  waypoint?: Location | null;
  radius: number;
  override: boolean;
  busy: boolean;
  onClose: () => void;
  onStart: (area: FarmingArea, phoenixRouteOrder?: string[]) => Promise<void>;
}) {
  const phoenix = ids.includes("phoenix") && !preparation;
  const areas = useMemo(() => farmingAreas(catalog, phoenix ? ["phoenix"] : ids), [catalog, ids, phoenix]);
  const routeAreas = areas;
  const [order, setOrder] = useState<string[]>(() => {
    const saved = (phoenixRouteOrder || []).filter(id => routeAreas.some(a => a.id === id));
    return saved.length === 5 && new Set(saved).size === 5 ? saved : defaultPhoenixOrder(routeAreas);
  });
  const [choice, setChoice] = useState<string | null>(null),
    [large, setLarge] = useState(false),
    [error, setError] = useState<string | null>(null);
  const idsKey = ids.join(",");
  const draftIdentity1 = [idsKey];
  const [previousDraftIdentity1, setDraftIdentity1] = useState<readonly unknown[] | null>(null);
  if (
    !previousDraftIdentity1 ||
    draftIdentity1.some((value, index) => !Object.is(value, previousDraftIdentity1[index]))
  ) {
    setDraftIdentity1(draftIdentity1);
    (() => {
      setChoice(null);
    })();
  }
  const highest = areas[0]?.monsterIds.length;
  const preferred = areas
    .filter((a) => a.monsterIds.length === highest)
    .slice()
    .sort((a, b) => {
      const score = (area: FarmingArea) =>
        waypoint && area.map === waypoint.map && area.x === waypoint.x && area.y === waypoint.y
          ? -1
          : character && area.map === character.map
            ? Math.hypot(area.x - character.x, area.y - character.y)
            : Number.MAX_SAFE_INTEGER;
      return score(a) - score(b);
    })[0];
  const selected = choice === null ? preferred : areas.find((a) => a.id === choice);
  const group = (a: FarmingArea) =>
    ids.length === 1
      ? "Spawn areas"
      : a.monsterIds.length === ids.length
        ? "Shared by all selected monsters"
        : a.monsterIds.length > 1
          ? `Shared by ${a.monsterIds.length} selected monsters`
          : catalog.find((m) => m.id === a.monsterIds[0])?.name || a.monsterIds[0];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>
            {phoenix ? "Choose Phoenix search order" : preparation ? "Getting ready to hunt" : "Choose a farming area"}
          </DialogTitle>
          <DialogDescription className="text-emerald-100/80">
            {phoenix ? "Select all five regions in the order to search. Click a selected region to remove it. Starting selects Phoenix alone."
              : preparation
              ? "Select backup farming monsters and an area. Hunt will return here when it ends."
              : override
                ? "Starting selects this monster, switches farming to Auto, leaves the current combat event, and starts a party convoy."
                : "Choose a waypoint for the selected monsters. Your monster selections and hunt radius stay the same."}
          </DialogDescription>
        </DialogHeader>
        {phoenix && <Button type="button" disabled={busy} onClick={() => setOrder([])}
          className="border border-slate-500 bg-[#07110f] text-slate-100 hover:bg-slate-800">Clear order ({order.length}/5)</Button>}
        {preparation}
        <div className="grid gap-4 md:grid-cols-[minmax(240px,1fr)_minmax(0,1.4fr)]">
          <div className="max-h-[55vh] space-y-2 overflow-y-auto">
            {!areas.length && (
              <div className="space-y-3">
                <p className="text-amber-200">No ordinary hunt routes available for these monsters.</p>
                {ids.map(id => {
                  const monster = catalog.find(entry => entry.id === id);
                  return <div key={id}><p className="mb-1 font-semibold text-emerald-100">{monster?.name || id}</p>
                    <MonsterSpawns records={monster?.spawnRecords} /></div>;
                })}
              </div>
            )}
            {routeAreas.map((area, index) => (
              <div key={area.id}>
                {(!index || group(routeAreas[index - 1]) !== group(area)) && (
                  <h3 className="mb-2 mt-3 font-semibold text-cyan-200">{group(area)}</h3>
                )}
                <button
                  type="button"
                  disabled={busy}
                  aria-pressed={phoenix ? order.includes(area.id) : selected?.id === area.id}
                  onClick={() => {
                    setChoice(area.id);
                    if (phoenix) setOrder(current => current.includes(area.id) ? current.filter(id => id !== area.id) : [...current, area.id]);
                    setError(null);
                  }}
                  className={`relative w-full rounded border p-3 pr-12 text-left text-emerald-50 hover:border-cyan-300 hover:bg-[#17352e] focus-visible:outline-2 focus-visible:outline-cyan-300 ${(phoenix ? order.includes(area.id) : selected?.id === area.id) ? "border-cyan-300 bg-[#17352e]" : "border-emerald-800 bg-[#07110f]"}`}
                >
                  {phoenix && order.includes(area.id) && <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded border border-cyan-200 bg-cyan-900 font-bold text-white">{order.indexOf(area.id)+1}</span>}
                  <p className="font-semibold">
                    {area.mapName || area.map}{" "}
                    <span className="font-mono text-xs text-cyan-200">
                      ({area.x}, {area.y})
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {area.monsterIds.map((id) => {
                      const monster = catalog.find((m) => m.id === id);
                      return (
                        <span key={id} className="flex items-center gap-1 text-sm">
                          <span className="relative h-7 w-7">
                            {monster?.sprite && <ItemSprite sprite={monster.sprite} />}
                          </span>
                          {monster?.name || id}
                        </span>
                      );
                    })}
                  </div>
                </button>
              </div>
            ))}
          </div>
          <div>
            {selected && (
              <>
                <div className="h-80">
                  <FarmingAreaPreview area={selected} radius={radius} />
                </div>
                <p className="mt-2 text-sm text-cyan-200">Cyan: spawn area · White: waypoint</p>
                <p className="text-sm text-amber-200">{phoenix ? "Search uses shared sightings and overlapping visibility coverage." : `Gold circle: hunt radius (${radius})`}</p>
                <Button
                  type="button"
                  onClick={() => setLarge(true)}
                  className="mt-2 border border-emerald-600 bg-[#07110f] text-emerald-100 hover:bg-[#17352e]"
                >
                  <Maximize2 className="mr-2 h-4 w-4" />
                  Enlarge map
                </Button>
              </>
            )}
          </div>
        </div>
        {error && (
          <p role="alert" className="text-rose-200">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="border border-slate-500 bg-black text-slate-100 hover:bg-slate-800"
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy || (phoenix ? order.length !== 5 : !selected)}
            onClick={async () => {
              const starting = phoenix ? routeAreas.find(a => a.id === order[0]) : selected;
              if (!starting) return;
              setError(null);
              try {
                await onStart(starting, phoenix ? order : undefined);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Farming route failed");
              }
            }}
            className="border border-cyan-300 bg-cyan-400 text-black hover:bg-cyan-300"
          >
            {busy ? "Starting…" : phoenix ? "Start Phoenix patrol" : preparation ? "Save backup and start Hunt" : "Start farming"}
          </Button>
        </DialogFooter>
        <Dialog open={large} onOpenChange={setLarge}>
          <DialogContent className="border-emerald-700 bg-[#081713] text-emerald-50 sm:max-w-6xl">
            <DialogHeader>
              <DialogTitle>{selected?.mapName || selected?.map} farming area</DialogTitle>
            </DialogHeader>
            <div className="h-[70vh]">
              {selected && <FarmingAreaPreview area={selected} radius={radius} />}
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
