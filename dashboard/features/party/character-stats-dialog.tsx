"use client";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Char } from "./char";
import { displayRunSpeed } from "./display-character";
import type { RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';

export function CharacterStatsDialog({
  character,
  onOpenChange,
  returnFocus,
}: {
  character: Char | null;
  onOpenChange: (open: boolean) => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  if (!character) return null;
  const primary = String(character.primaryStat || "").toLowerCase();
  const equippedWeaponAttack = Object.entries(character.slots || {})
    .filter(([slot]) => slot === "mainhand" || slot === "offhand")
    .reduce((sum, [, entry]) => sum + Number(entry?.meta?.properties?.attack || 0), 0);
  const primaryAttack = (stat: string, value: number) => {
    if (character.ctype === "paladin" && stat === "int") return `weapon ATK × ${value}/40`;
    if (primary === stat) return `weapon ATK × ${value}/20`;
    return null;
  };
  const attributeEffect = (stat: "str" | "int" | "dex", value: number) => {
    const effects: string[] = [];
    const attack = primaryAttack(stat, value);
    if (attack) {
      const divisor = character.ctype === "paladin" && stat === "int" ? 40 : 20;
      effects.push(
        `+${((equippedWeaponAttack * value) / divisor).toFixed(1)} attack total · +${(equippedWeaponAttack / divisor).toFixed(2)} per point`,
      );
    }
    if (stat === "str") {
      effects.push(`+${Math.round(value * 21).toLocaleString()} max HP · +21 per point`);
      effects.push(
        `+${(Math.min(value, 160) + Math.max(0, value - 160) * 0.25).toLocaleString()} armor · +${value < 160 ? "1" : "0.25"} per next point`,
      );
      effects.push(
        `+${(Math.min(value, 256) / 64).toFixed(2)} run speed · +${value < 256 ? "0.0156" : "0"} per next point`,
      );
    } else if (stat === "int") {
      effects.push(`+${Math.round(value * 15).toLocaleString()} max MP · +15 per point`);
      effects.push(
        `+${(Math.min(value, 180) + Math.max(0, value - 180) * 0.25).toLocaleString()} resistance · +${value < 180 ? "1" : "0.25"} per next point`,
      );
      effects.push(`+${(value / 1575).toFixed(3)} attacks/sec · +0.000635 per point`);
    } else {
      effects.push(
        `+${(Math.min(value, 256) / 32).toFixed(2)} run speed · +${value < 256 ? "0.0313" : "0"} per next point`,
      );
      effects.push(
        `+${(Math.min(160, value) / 640 + Math.max(value - 160, 0) / 925).toFixed(3)} attacks/sec · +${value < 160 ? "0.00156" : "0.00108"} per next point`,
      );
    }
    return `${value.toLocaleString()}${primary === stat ? " · PRIMARY" : ""}\n${effects.join(" · ")}`;
  };
  const damageMultiplier = (defense: number) =>
    Math.min(
      1.32,
      Math.max(
        0.05,
        1 -
          (Math.max(0, Math.min(100, defense)) * 0.001 +
            Math.max(0, Math.min(100, defense - 100)) * 0.001 +
            Math.max(0, Math.min(100, defense - 200)) * 0.00095 +
            Math.max(0, Math.min(100, defense - 300)) * 0.0009 +
            Math.max(0, Math.min(100, defense - 400)) * 0.00082 +
            Math.max(0, Math.min(100, defense - 500)) * 0.0007 +
            Math.max(0, Math.min(100, defense - 600)) * 0.0006 +
            Math.max(0, Math.min(100, defense - 700)) * 0.0005 +
            Math.max(0, defense - 800) * 0.0004),
      ),
    );
  const vitality = Number(character.vit || 0);
  const fortitude = Number(character.fortitude || 0);
  const vitalityHp = vitality * (48 + character.level / 3);
  const fortitudeMultiplier = damageMultiplier(fortitude * 5);
  const armorMultiplier = damageMultiplier(Number(character.armor || 0));
  const resistanceMultiplier = damageMultiplier(Number(character.resistance || 0));
  const extraStats = [
    ["Strength", attributeEffect("str", Number(character.str || 0))],
    ["Intelligence", attributeEffect("int", Number(character.int || 0))],
    ["Dexterity", attributeEffect("dex", Number(character.dex || 0))],
    [
      "Vitality",
      `${vitality.toLocaleString()}\n+${Math.round(vitalityHp).toLocaleString()} max HP · ${(48 + character.level / 3).toFixed(2)} HP per VIT at level ${character.level}`,
    ],
    [
      "Fortitude",
      `${fortitude.toLocaleString()}\n${((1 - fortitudeMultiplier) * 100).toFixed(2)}% less incoming PvP damage · no PvE reduction`,
    ],
    ["Luck", `${Number(character.luck || 100).toLocaleString()}%`],
    ["Armor piercing", Number(character.combatStats?.armorPiercing || 0).toLocaleString()],
    [
      "Resistance piercing",
      Number(character.combatStats?.resistancePiercing || 0).toLocaleString(),
    ],
    ["Poison resistance", Number(character.combatStats?.poisonResistance || 0).toLocaleString()],
    ["Fire resistance", Number(character.combatStats?.fireResistance || 0).toLocaleString()],
    ["Freeze resistance", Number(character.combatStats?.freezeResistance || 0).toLocaleString()],
    [
      "Physical resistance",
      Number(character.combatStats?.physicalResistance || 0).toLocaleString(),
    ],
    ["Status resistance", Number(character.combatStats?.statusResistance || 0).toLocaleString()],
    ["Blast resistance", Number(character.combatStats?.blastResistance || 0).toLocaleString()],
    ["Critical chance", `${Number(character.combatStats?.crit || 0).toLocaleString()}%`],
    [
      "Critical damage",
      `${(200 + Number(character.combatStats?.critDamage || 0)).toLocaleString()}%`,
    ],
    ["Evasion", `${Number(character.combatStats?.evasion || 0).toLocaleString()}%`],
    ["Miss chance", `${Number(character.combatStats?.miss || 0).toLocaleString()}%`],
    ["Lifesteal", `${Number(character.combatStats?.lifesteal || 0).toLocaleString()}%`],
    ["Manasteal", `${Number(character.combatStats?.manasteal || 0).toLocaleString()}%`],
    ["Damage return", `${Number(character.combatStats?.damageReturn || 0).toLocaleString()}%`],
    ["Reflection", `${Number(character.combatStats?.reflection || 0).toLocaleString()}%`],
    ["MP cost", Number(character.combatStats?.mpCost || 0).toLocaleString()],
    ["Heal", Number(character.combatStats?.heal || 0).toLocaleString()],
    ["Output", `${Number(character.combatStats?.output || 0).toLocaleString()}%`],
  ] as const;
  const stats = [
    ["Level", character.level],
    ["HP", `${character.hp.toLocaleString()} / ${character.max_hp.toLocaleString()}`],
    ["MP", `${character.mp.toLocaleString()} / ${character.max_mp.toLocaleString()}`],
    ["Attack", Number(character.attack || 0).toLocaleString()],
    ["Attack speed", Number(character.frequency || 0).toFixed(2)],
    ["Range", Number(character.range || 0).toLocaleString()],
    ["Run speed", displayRunSpeed(character) === null ? "Waiting for speed data" :
      `${displayRunSpeed(character)!.toFixed(2)}${character.ctype === "merchant" ? " · before movement restrictions" : ""}`],
    [
      "Armor",
      `${Number(character.armor || 0).toLocaleString()}\n${((1 - armorMultiplier) * 100).toFixed(2)}% physical damage reduction · a 100-damage physical hit becomes ${(100 * armorMultiplier).toFixed(1)}`,
    ],
    [
      "Resistance",
      `${Number(character.resistance || 0).toLocaleString()}\n${((1 - resistanceMultiplier) * 100).toFixed(2)}% magical damage reduction · a 100-damage magical hit becomes ${(100 * resistanceMultiplier).toFixed(1)}`,
    ],
    ...extraStats,
  ] as const;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent finalFocus={returnFocus} showCloseButton={false} className="max-h-[88vh] overflow-y-auto border-emerald-800 bg-[#0b1916] text-emerald-50 sm:max-w-3xl">
        <DialogClose render={<Button variant="outline" size="icon-sm" className="absolute top-2 right-2 border-emerald-700 bg-[#07100f] text-emerald-100 hover:border-emerald-400 hover:bg-[#10251f] hover:text-white" />}>
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>{character.name}</DialogTitle>
          <DialogDescription className="uppercase text-emerald-100/55">
            Level {character.level} {character.ctype} {character.primaryStat || ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded border border-emerald-900/80 bg-black/25 p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-emerald-100/45">
                {label}
              </div>
              <div
                className={`mt-1 whitespace-pre-line font-mono font-semibold text-emerald-100 ${["Strength", "Intelligence", "Dexterity", "Vitality", "Fortitude"].includes(label) ? "text-sm leading-6" : "text-lg"}`}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
