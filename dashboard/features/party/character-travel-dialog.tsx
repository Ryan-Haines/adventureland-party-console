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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MapPin } from "lucide-react";
import { useState } from "react";
import { Location } from "./location";
import { Place } from "./place";

export function CharacterTravelDialog({
  character,
  places,
  onClose,
  error,
  setError,
  onTravel,
}: {
  character: string | null;
  places: Place[];
  onClose: () => void;
  error?: string | null;
  setError: (error: string | null) => void;
  onTravel: (character: string, location: Location, label: string) => Promise<void>;
}) {
  const [destination, setDestination] = useState(""),
    [travelMap, setTravelMap] = useState("main"),
    [travelX, setTravelX] = useState("-174"),
    [travelY, setTravelY] = useState("121");
  const draftIdentity1 = [character];
  const [previousDraftIdentity1, setDraftIdentity1] = useState<readonly unknown[] | null>(null);
  if (
    !previousDraftIdentity1 ||
    draftIdentity1.some((value, index) => !Object.is(value, previousDraftIdentity1[index]))
  ) {
    setDraftIdentity1(draftIdentity1);
    (() => {
      if (character) {
        setDestination("");
        setTravelMap("main");
        setTravelX("-174");
        setTravelY("121");
      }
    })();
  }
  const selectPlace = (id: string | null) => {
    setError(null);
    if (!id) return;
    const place = places.find((entry) => entry.id === id);
    setDestination(id);
    if (place) {
      setTravelMap(place.id);
      setTravelX(String(place.x));
      setTravelY(String(place.y));
    }
  };
  const submit = () => {
    setError(null);
    const location = {
      map: travelMap.trim(),
      x: Number(travelX),
      y: Number(travelY),
    };
    if (!character || !location.map || !Number.isFinite(location.x) || !Number.isFinite(location.y))
      return setError("Enter a map and finite coordinates");
    const label =
      places.find((entry) => entry.id === destination)?.name ||
      `${location.map} [${location.x}, ${location.y}]`;
    void onTravel(character, location, label);
  };
  return (
    <Dialog
      open={!!character}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border border-cyan-800 bg-[#0b1916] text-emerald-50 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send {character} to…</DialogTitle>
          <DialogDescription className="text-emerald-100/55">
            Choose a known area, or enter an exact map and coordinate.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-2 text-sm text-emerald-100/70">
            Known area
            <Select value={destination} onValueChange={selectPlace}>
              <SelectTrigger className="border-emerald-800 bg-[#07100f] text-emerald-50">
                <SelectValue placeholder="Travel → Places" />
              </SelectTrigger>
              <SelectContent>
                {places.map((place) => (
                  <SelectItem key={place.id} value={place.id}>
                    {place.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-[1fr_110px_110px] gap-2">
            <label className="grid gap-1 text-xs text-emerald-100/55">
              Map
              <Input
                value={travelMap}
                onChange={(event) => {
                  setError(null);
                  setDestination("");
                  setTravelMap(event.target.value);
                }}
                className="border-emerald-800 bg-black/30"
              />
            </label>
            <label className="grid gap-1 text-xs text-emerald-100/55">
              X
              <Input
                inputMode="numeric"
                value={travelX}
                onChange={(event) => {
                  setError(null);
                  setDestination("");
                  setTravelX(event.target.value);
                }}
                className="border-emerald-800 bg-black/30 font-mono"
              />
            </label>
            <label className="grid gap-1 text-xs text-emerald-100/55">
              Y
              <Input
                inputMode="numeric"
                value={travelY}
                onChange={(event) => {
                  setError(null);
                  setDestination("");
                  setTravelY(event.target.value);
                }}
                className="border-emerald-800 bg-black/30 font-mono"
              />
            </label>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-rose-200">{error}</p>}
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            className="border-emerald-800 bg-[#07100f] text-emerald-200 hover:bg-emerald-950"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            className="bg-cyan-400 text-cyan-950 hover:bg-cyan-300"
          >
            <MapPin className="mr-2 h-4 w-4" />
            Send character
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
