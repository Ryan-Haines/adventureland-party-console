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
import { AppearanceChoice } from "./appearance-choice";
import { CharacterPortrait } from "./character-portrait";

export function CreateCharacter({
  open,
  onOpenChange,
  name,
  setName,
  ctype,
  setCtype,
  look,
  setLook,
  appearances,
  classes,
  busy,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  setName: (name: string) => void;
  ctype: string;
  setCtype: (ctype: string) => void;
  look: number;
  setLook: (look: number) => void;
  appearances: AppearanceChoice[];
  classes: string[];
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border border-cyan-800 bg-[#0b1916] text-emerald-50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create character</DialogTitle>
          <DialogDescription className="text-emerald-100/55">
            Choose the class and one of its official starting appearances. The companion will never
            spend Shells.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm text-emerald-100/70">
            Name
            <Input
              value={name}
              maxLength={12}
              onChange={(event) => setName(event.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
              className="border-cyan-800 bg-black/30"
              placeholder="NewRanger"
            />
          </label>
          <label className="grid gap-1.5 text-sm text-emerald-100/70">
            Class
            <Select
              value={ctype}
              onValueChange={(value) => {
                if (value) setCtype(value);
              }}
            >
              <SelectTrigger className="border-cyan-800 bg-black/30">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {classes.map((value) => (
                  <SelectItem key={value} value={value} className="capitalize">
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <fieldset>
            <legend className="mb-2 text-sm text-emerald-100/70">Appearance</legend>
            <div className="grid grid-cols-4 gap-2">
              {appearances.map((choice) => (
                <button
                  type="button"
                  key={choice.index}
                  onClick={() => setLook(choice.index)}
                  aria-label={`Appearance ${choice.index + 1}`}
                  className={`relative h-24 overflow-hidden rounded border bg-black/30 ${look === choice.index ? "border-cyan-300 ring-2 ring-cyan-400/25" : "border-emerald-900 hover:border-emerald-500"}`}
                >
                  {choice.html ? (
                    <CharacterPortrait html={choice.html} sprite={null} skin={undefined} centered />
                  ) : <span className="text-xs text-slate-300">Loading preview…</span>}
                </button>
              ))}
            </div>
            {!appearances.length ? (
              <p className="text-xs text-amber-300">
                Waiting for an active character to provide current appearance data…
              </p>
            ) : null}
          </fieldset>
        </div>
        <DialogFooter className="border-t border-cyan-900 bg-[#0b1916]">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-slate-500 bg-slate-950 text-slate-100 hover:bg-slate-800 hover:text-white"
          >
            Cancel
          </Button>
          <Button
            disabled={busy || name.length < 4 || !appearances.length}
            onClick={onCreate}
            className="bg-cyan-400 text-cyan-950 hover:bg-cyan-300"
          >
            {busy ? "Creating…" : "Create and spawn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
