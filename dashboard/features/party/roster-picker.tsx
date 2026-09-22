"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ActiveSlot } from "./active-slot";
import { RosterMember } from "./roster-member";

export function RosterPicker({
  slot,
  slots,
  roster,
  onClose,
  onChoose,
  onCreate,
}: {
  slot: number | null;
  slots: ActiveSlot[];
  roster: RosterMember[];
  onClose: () => void;
  onChoose: (name: string, hosting: "headless" | "steam") => void;
  onCreate: () => void;
}) {
  const [hosting, setHosting] = useState<"headless" | "steam">("headless");
  const active = new Set(slots.map((entry) => entry.character).filter(Boolean));
  const choices = roster.filter(
    (member) => slot === 0 || (!active.has(member.name) && !member.online),
  );
  return (
    <Dialog
      open={slot !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="border border-emerald-800 bg-[#0b1916] text-emerald-50 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {slot === 0 ? "Switch Steam character" : "Choose a roster member"}
          </DialogTitle>
          <DialogDescription className="text-emerald-100/55">
            {slot === 0
              ? "The Steam bridge changes the primary view and restores the other Steam characters afterward."
              : "Choose an offline character, or create a new character."}
          </DialogDescription>
        </DialogHeader>
        {slot !== 0 && <><div className="flex gap-2" aria-label="Login hosting">
          {(["headless", "steam"] as const).map(value => <button key={value} type="button" aria-pressed={hosting === value}
            onClick={() => setHosting(value)} className={`rounded border px-3 py-2 ${hosting === value ? "border-cyan-300 bg-[#164e63] text-white hover:bg-[#155e75]" : "border-slate-600 bg-[#111c19] text-slate-100 hover:bg-[#263c34]"}`}>{value === "steam" ? "Steam" : "Headless"}</button>)}
        </div>
        <p className="text-sm text-emerald-100/80">
          {hosting === "headless"
            ? "Runs on the computer hosting Party Console, without a game window."
            : "Runs in your connected Adventure Land Steam client."}
          {" Characters already online elsewhere are hidden; stop them there before loading them here."}
        </p></>}
        <div className="grid max-h-80 gap-2 overflow-y-auto">
          {choices.map((member) => (
            <button
              key={member.name}
              onClick={() => onChoose(member.name, hosting)}
              className="flex items-center justify-between rounded border border-emerald-900 bg-[#07100f] px-4 py-3 text-left text-emerald-50 hover:border-emerald-500 hover:bg-emerald-950 hover:text-white"
            >
              <span>
                <span className="block font-medium">{member.name}</span>
                <span className="font-mono text-xs uppercase text-emerald-100/45">
                  Lv {member.level} {member.ctype}
                </span>
              </span>
              <Plus className="h-4 w-4 text-emerald-400" />
            </button>
          ))}
          {!choices.length ? (
            <p className="py-8 text-center text-sm text-emerald-100/45">
              No available roster members.
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onCreate}
          className="border-cyan-700 bg-[#07100f] text-cyan-100 hover:bg-cyan-950 hover:text-white"
        >
          <Plus className="h-4 w-4" /> Create character
        </Button>
      </DialogContent>
    </Dialog>
  );
}
