"use client";
import { displayValue } from "./display-value";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";
import { useState } from "react";
import { DefinitionGrid } from "./definition-grid";
import { ItemSprite } from "./item-sprite";
import { SkillClass } from "./skill-class";
import { SkillEntry } from "./skill-entry";
import { skillRangeLabel } from "./skill-range-label";

export function SkillsDialog({
  open,
  onOpenChange,
  classes,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classes: SkillClass[];
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SkillEntry | null>(null);
  const filteredClasses = classes
    .map((entry) => ({
      ...entry,
      skills: entry.skills.filter((skill) =>
        `${skill.name} ${skill.id} ${entry.name}`.toLowerCase().includes(search.toLowerCase()),
      ),
    }))
    .filter((entry) => entry.skills.length);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setSelected(null);
      }}
    >
      <DialogContent
        className="flex max-h-[92vh] flex-col border-violet-900 bg-[#0b1916] text-emerald-50"
        style={{ width: "calc(100vw - 2rem)", maxWidth: "1500px" }}
      >
        <DialogHeader>
          <DialogTitle>Class skills</DialogTitle>
          <DialogDescription className="text-emerald-100/55">
            Browse every class-bound skill and the shared game actions. Click any skill for its
            complete definition.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search classes or skills…"
          className="border-violet-900 bg-black/30"
        />
        <div
          className="grid min-h-0 flex-1 gap-4 transition-[grid-template-columns] duration-300 ease-out"
          style={{
            gridTemplateColumns: selected
              ? "minmax(0, 3fr) minmax(380px, 2fr)"
              : "minmax(0, 1fr) 0fr",
          }}
        >
          <div className="min-h-0 space-y-5 overflow-y-auto pr-2">
            {filteredClasses.map((entry) => (
              <section key={entry.id}>
                <h3 className="sticky top-0 z-10 mb-2 border-b border-violet-900 bg-[#0b1916] py-2 font-mono text-xs uppercase tracking-widest text-violet-300">
                  {entry.name}
                </h3>
                <div
                  className={`grid grid-cols-2 gap-2 sm:grid-cols-4 ${selected ? "lg:grid-cols-5" : "md:grid-cols-6 lg:grid-cols-8"}`}
                >
                  {entry.skills.map((skill) => (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => setSelected(skill)}
                      className="min-w-0 rounded border border-violet-800 bg-[#101d1b] p-2 text-center text-emerald-50 hover:border-violet-400 hover:bg-[#202b2b]"
                    >
                      <div className="relative mx-auto h-11 w-11">
                        {skill.sprite && <ItemSprite sprite={skill.sprite} />}
                      </div>
                      <p className="mt-1 truncate text-[11px]" title={skill.name}>
                        {skill.name}
                      </p>
                      <p className="truncate font-mono text-[9px] text-emerald-100/35">
                        {skill.id}
                      </p>
                      <p className="mt-2 text-xs leading-4 text-violet-200">
                        Range: {skillRangeLabel(skill)}
                      </p>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <aside
            className={`min-h-0 overflow-hidden transition-opacity duration-300 ${selected ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            {selected && (
              <div className="relative h-full overflow-y-auto rounded border border-violet-800 bg-black/30 p-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelected(null)}
                  className="absolute right-2 top-2 h-7 w-7 text-violet-200 hover:bg-violet-950 hover:text-white"
                  title="Close skill details"
                  aria-label="Close skill details"
                >
                  <X className="h-4 w-4" />
                </Button>
                <div className="mb-3 flex items-center gap-3">
                  <div className="relative h-12 w-12">
                    {selected.sprite && <ItemSprite sprite={selected.sprite} />}
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold">{selected.name}</h3>
                    <p className="font-mono text-[10px] text-violet-300">G.skills.{selected.id}</p>
                  </div>
                </div>
                {selected.definition.explanation ? (
                  <p className="mb-4 text-sm leading-6 text-emerald-50/80">
                    {displayValue(selected.definition.explanation)}
                  </p>
                ) : null}
                <div className="mb-4 rounded border border-violet-800 bg-[#101d1b] p-3 text-sm text-violet-100">
                  <p>
                    Range: <strong>{skillRangeLabel(selected)}</strong>
                  </p>
                  <p className="mt-1 text-xs text-emerald-100/80">
                    Base range in game distance units. Attack range depends on the character’s
                    equipment. “Not specified” means the game definition does not supply a range.
                  </p>
                </div>
                <DefinitionGrid
                  value={selected.definition}
                  omit={["name", "skin", "explanation"]}
                />
              </div>
            )}
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}
