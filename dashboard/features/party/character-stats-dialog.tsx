"use client";
import { AddonSlot } from '../../../runtime/hooks/dashboard/slots';
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
import type { ReactNode, RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { XIcon } from 'lucide-react';
import { GameBox, GameLine } from "./item-card";
import { useStoredBoolean } from "@/hooks/use-stored-boolean";
import { STAT_COLORS as S } from "./stat-colors";
import {
  attackDivisor, attributeStats, BASE_LUCK_PERCENT, critDamagePercent, damageMultiplier, fortitudeDefense, itemAttack,
} from "@/lib/game-formulas";

// docs/character-card.md: the game's character panel (render_character in the game's
// js/html.js) beside every other entry the console computes.
type Effect = { key: string; value: string; color: string; detail?: string };
type Extra = { key: string; label: string; value: string; color: string; note?: ReactNode; effects?: Effect[];
};

// The panel's lines take their stat colors (docs/stat-colors.md) instead of the game's gray.
const HP = S.hp, MP = S.mp, ARMOR = S.armor, RESISTANCE = S.resistance, SPEED = S.speed, ATTACK = S.attack;

function ExtraEntry({ entry }: { entry: Extra }) {
  // Each breakdown starts open and keeps its open or closed state across characters and reloads.
  const [open, setOpen] = useStoredBoolean(`party-character-effects-${entry.key}`,
    true,
  );
  const heading = (
    <>
      <span data-label style={{ color: entry.color }}>
        {entry.label}
      </span>
      : {entry.value}
      {entry.note}
    </>
  );
  if (!entry.effects?.length)
    return (
      <div data-line={entry.key} className="break-inside-avoid">
        {heading}
      </div>
    );
  return (
    <div data-line={entry.key} className="break-inside-avoid">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="-ml-3 text-left hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#808080]"
      >
        <span
          aria-hidden
          className={`inline-block w-3 text-[#808080] transition-transform ${open ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        {heading}
      </button>
      {open &&
        entry.effects.map((effect) => (
          <div
            key={effect.key}
            data-effect={effect.key}
            className="pl-3 text-[12px]"
          >
            <span data-value style={{ color: effect.color }}>
              {effect.value}
            </span>
            {effect.detail ? (
              <span className="text-[#808080]"> {effect.detail}</span>
            ) : null}
          </div>
        ))}
    </div>
  );
}

export function CharacterStatsDialog({
  character,
  onOpenChange,
  returnFocus,
  offline = false,
}: {
  character: Char | null;
  offline?: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocus?: RefObject<HTMLButtonElement | null>;
}) {
  if (!character) return null;
  const primary = String(character.primaryStat || '').toLowerCase();
  // The weapons' attack as calculate_player_stats sums it (`item_attack`).
  const weaponAttack = itemAttack(
    Object.entries(character.slots || {}).filter((pair): pair is [string, NonNullable<(typeof pair)[1]>] => !!pair[1]),
  );
  // Each line shows the attribute's share of a stat and the change of one more point, both from
  // the game's own lines in dashboard/lib/game-formulas.ts.
  const perPoint = (share: (points: number) => number, value: number, digits: number, next = true) =>
    `+${Number((share(value + 1) - share(value)).toFixed(digits))} per ${next ? 'next ' : ''}point`;
  const attributeEffects = (
    stat: 'str' | 'int' | 'dex',
    value: number,
  ): Effect[] => {
    const effects: Effect[] = [];
    const divisor = attackDivisor(character.ctype, primary, stat);
    if (divisor)
      effects.push({
        key: 'attack',
        color: ATTACK,
        value: `+${((weaponAttack * value) / divisor).toFixed(1)} Attack`,
        detail: `+${(weaponAttack / divisor).toFixed(2)} per point`,
      });
    if (stat === 'str') {
      const hp = (points: number) => attributeStats.maxHp(points, 0, character.level);
      effects.push({
        key: 'max_hp',
        color: HP,
        value: `+${Math.round(hp(value)).toLocaleString()} Max HP`,
        detail: perPoint(hp, value, 2, false),
      });
      effects.push({
        key: 'armor',
        color: ARMOR,
        value: `+${attributeStats.armor(value).toLocaleString()} Armor`,
        detail: perPoint(attributeStats.armor, value, 2),
      });
      const speed = (points: number) => attributeStats.runSpeed(points, 0);
      effects.push({
        key: 'run_speed',
        color: SPEED,
        value: `+${speed(value).toFixed(2)} Run Speed`,
        detail: perPoint(speed, value, 4),
      });
    } else if (stat === 'int') {
      effects.push({
        key: 'max_mp',
        color: MP,
        value: `+${Math.round(attributeStats.maxMp(value)).toLocaleString()} Max MP`,
        detail: perPoint(attributeStats.maxMp, value, 2, false),
      });
      effects.push({
        key: 'resistance',
        color: RESISTANCE,
        value: `+${attributeStats.resistance(value).toLocaleString()} Resistance`,
        detail: perPoint(attributeStats.resistance, value, 2),
      });
      const frequency = (points: number) => attributeStats.frequency(points, 0);
      effects.push({
        key: 'attack_speed',
        color: S.frequency,
        value: `+${frequency(value).toFixed(3)} Attacks/sec`,
        detail: perPoint(frequency, value, 6, false),
      });
    } else {
      const speed = (points: number) => attributeStats.runSpeed(0, points);
      effects.push({
        key: 'run_speed',
        color: SPEED,
        value: `+${speed(value).toFixed(2)} Run Speed`,
        detail: perPoint(speed, value, 4),
      });
      const frequency = (points: number) => attributeStats.frequency(0, points);
      effects.push({
        key: 'attack_speed',
        color: S.frequency,
        value: `+${frequency(value).toFixed(3)} Attacks/sec`,
        detail: perPoint(frequency, value, 5),
      });
    }
    return effects;
  };
  const vitality = Number(character.vit || 0);
  const fortitude = Number(character.fortitude || 0);
  const vitalityHp = attributeStats.maxHp(0, vitality, character.level);
  const fortitudeMultiplier = damageMultiplier(fortitudeDefense(fortitude));
  const armorMultiplier = damageMultiplier(Number(character.armor || 0));
  const resistanceMultiplier = damageMultiplier(
    Number(character.resistance || 0),
  );
  const combat = character.combatStats || {};
  const attribute = (
    key: 'str' | 'int' | 'dex',
    label: string,
    color: string,
  ): Extra => ({
    key,
    label,
    color,
    value: Number(character[key] || 0).toLocaleString(),
    effects: attributeEffects(key, Number(character[key] || 0)),
    note:
      primary === key ? (
        <span className="text-[gold]"> Primary</span>
      ) : undefined,
  });
  const runSpeed = displayRunSpeed(character);
  const plain = (
    key: string,
    label: string,
    color: string,
    value: string,
  ): Extra => ({ key, label, color, value });
  const extras: Extra[] = [
    attribute('str', 'Strength', S.str),
    attribute('int', 'Intelligence', S.int),
    attribute('dex', 'Dexterity', S.dex),
    {
      key: 'vit',
      label: 'Vitality',
      color: HP,
      value: vitality.toLocaleString(),
      effects: [
        {
          key: 'max_hp',
          color: HP,
          value: `+${Math.round(vitalityHp).toLocaleString()} Max HP`,
          detail: `${attributeStats.maxHp(0, 1, character.level).toFixed(2)} HP per VIT at level ${character.level}`,
        },
      ],
    },
    {
      key: 'for',
      label: 'Fortitude',
      color: S.for,
      value: fortitude.toLocaleString(),
      effects: [
        {
          key: 'pvp',
          color: S.for,
          value: `${((1 - fortitudeMultiplier) * 100).toFixed(2)}% less incoming PvP damage`,
          detail: 'no PvE reduction',
        },
      ],
    },
    {
      key: 'armor',
      label: 'Armor',
      color: ARMOR,
      value: Number(character.armor || 0).toLocaleString(),
      effects: [
        {
          key: 'reduction',
          color: ARMOR,
          value: `${((1 - armorMultiplier) * 100).toFixed(2)}% physical damage reduction`,
          detail: `a 100-damage physical hit becomes ${(100 * armorMultiplier).toFixed(1)}`,
        },
      ],
    },
    {
      key: 'resistance',
      label: 'Resistance',
      color: RESISTANCE,
      value: Number(character.resistance || 0).toLocaleString(),
      effects: [
        {
          key: 'reduction',
          color: RESISTANCE,
          value: `${((1 - resistanceMultiplier) * 100).toFixed(2)}% magical damage reduction`,
          detail: `a 100-damage magical hit becomes ${(100 * resistanceMultiplier).toFixed(1)}`,
        },
      ],
    },
    {
      key: 'run_speed',
      label: 'Run Speed',
      color: SPEED,
      value: runSpeed === null ? 'Waiting for speed data' : runSpeed.toFixed(2),
      note:
        runSpeed !== null && character.ctype === 'merchant' ? (
          <span className="text-[#808080]"> before movement restrictions</span>
        ) : undefined,
    },
    plain(
      'luck',
      'Luck',
      S.luck,
      `${Number(character.luck ?? BASE_LUCK_PERCENT).toLocaleString()}%`,
    ),
    // The gold find bonus, the character's own reported stat, signed and in percent.
    plain(
      'gold',
      'Gold',
      S.gold,
      `${Number(character.goldBonus || 0) >= 0 ? '+' : ''}${Number(character.goldBonus || 0).toLocaleString()}%`,
    ),
    plain(
      'crit',
      'Crit',
      S.crit,
      `${Number(combat.crit || 0).toLocaleString()}%`,
    ),
    plain(
      'critdamage',
      'Crit Damage',
      S.critdamage,
      `${critDamagePercent(Number(combat.critDamage || 0)).toLocaleString()}%`,
    ),
    plain(
      'evasion',
      'Evasion',
      S.evasion,
      `${Number(combat.evasion || 0).toLocaleString()}%`,
    ),
    plain(
      'miss',
      'Miss',
      S.miss,
      `${Number(combat.miss || 0).toLocaleString()}%`,
    ),
    plain(
      'lifesteal',
      'Lifesteal',
      S.lifesteal,
      `${Number(combat.lifesteal || 0).toLocaleString()}%`,
    ),
    plain(
      'manasteal',
      'Manasteal',
      S.manasteal,
      `${Number(combat.manasteal || 0).toLocaleString()}%`,
    ),
    plain(
      'dreturn',
      'D.Return',
      S.dreturn,
      `${Number(combat.damageReturn || 0).toLocaleString()}%`,
    ),
    plain(
      'reflection',
      'Reflection',
      S.reflection,
      `${Number(combat.reflection || 0).toLocaleString()}%`,
    ),
    plain(
      'apiercing',
      'A.Piercing',
      ARMOR,
      Number(combat.armorPiercing || 0).toLocaleString(),
    ),
    plain(
      'rpiercing',
      'R.Piercing',
      RESISTANCE,
      Number(combat.resistancePiercing || 0).toLocaleString(),
    ),
    plain(
      'pnresistance',
      'Poison Res.',
      S.pnresistance,
      Number(combat.poisonResistance || 0).toLocaleString(),
    ),
    plain(
      'firesistance',
      'Fire Res.',
      S.firesistance,
      Number(combat.fireResistance || 0).toLocaleString(),
    ),
    plain(
      'fzresistance',
      'Freeze Res.',
      S.fzresistance,
      Number(combat.freezeResistance || 0).toLocaleString(),
    ),
    plain(
      'phresistance',
      'Physical Res.',
      S.phresistance,
      Number(combat.physicalResistance || 0).toLocaleString(),
    ),
    plain(
      'stresistance',
      'Status Res.',
      S.stresistance,
      Number(combat.statusResistance || 0).toLocaleString(),
    ),
    plain(
      'blastresistance',
      'Blast Res.',
      S.blastresistance,
      Number(combat.blastResistance || 0).toLocaleString(),
    ),
    plain(
      'mp_cost',
      'MP Cost',
      MP,
      Number(combat.mpCost || 0).toLocaleString(),
    ),
    plain('heal', 'Heal', S.heal, Number(combat.heal || 0).toLocaleString()),
    plain(
      'output',
      'Output',
      S.output,
      `${Number(combat.output || 0).toLocaleString()}%`,
    ),
  ];
  // The game tags ATT while cursed and ATTSPD while poisoned (info_line in js/html.js).
  const has = (id: string) =>
    (character.conditions || []).some((condition) => condition.id === id);
  const tag = (text: string, color: string) => (
    <span style={{ color }}> [{text}]</span>
  );
  const heal = Number(combat.heal || 0);
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent data-area="character-stats"
        finalFocus={returnFocus}
        showCloseButton={false}
        className="max-h-[88vh] overflow-y-auto border-emerald-800 bg-[#0b1916] text-emerald-50 sm:max-w-5xl"
      >
        <DialogClose
          render={
            <Button
              variant="outline"
              size="icon-sm"
              className="absolute top-2 right-2 border-emerald-700 bg-[#07100f] text-emerald-100 hover:border-emerald-400 hover:bg-[#10251f] hover:text-white"
            />
          }
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>{character.name}</DialogTitle>
          <DialogDescription className="uppercase text-emerald-100/55">
            Level {character.level} {character.ctype}{' '}
            {character.primaryStat || ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <GameBox
            label="Character card"
            className="w-full shrink-0 sm:w-[14rem]"
          >
            <GameLine
              line="name"
              label="NAME"
              color="gray"
              value={character.name}
            />
            <GameLine
              line="level"
              label="LEVEL"
              color={S.level}
              value={character.level}
            />
            <GameLine
              line="hp"
              label="HP"
              color={HP}
              value={`${character.hp}/${character.max_hp}`}
            />
            <GameLine
              line="mp"
              label="MP"
              color={MP}
              value={`${character.mp}/${character.max_mp}`}
            />
            {heal > 0 && (
              <GameLine
                line="heal"
                label="HEAL"
                color={S.heal}
                value={Math.round(heal)}
              />
            )}
            <GameLine
              line="attack"
              label="ATT"
              color={ATTACK}
              value={
                <>
                  {Math.round(Number(character.attack || 0))}
                  {has('cursed') && tag('C', '#7D4DAA')}
                </>
              }
            />
            <GameLine
              line="frequency"
              label="ATTSPD"
              color={S.frequency}
              value={
                <>
                  {Math.round(Number(character.frequency || 0) * 100)}
                  {has('poisoned') && tag('P', '#45993F')}
                </>
              }
            />
            <GameLine
              line="range"
              label="RANGE"
              color={S.range}
              value={Number(character.range || 0)}
            />
            <GameLine
              line="speed"
              label="RUNSPD"
              color={SPEED}
              value={Math.round(Number(character.speed || 0))}
            />
            <GameLine
              line="armor"
              label="ARMOR"
              color={ARMOR}
              value={Number(character.armor || 0)}
            />
            <GameLine
              line="resistance"
              label="RESIST."
              color={RESISTANCE}
              value={Number(character.resistance || 0)}
            />
            <GameLine
              line="code"
              label="CODE"
              color="gold"
              value={offline ? 'Offline snapshot' : 'Active'}
            />
          </GameBox>
          <GameBox
            label="Character extras"
            className="min-w-[min(100%,20rem)] flex-1 columns-1 gap-6 pl-7 sm:columns-2"
          >
            {extras.map((entry) => (
              <ExtraEntry key={entry.key} entry={entry} />
            ))}
          </GameBox>
        </div>
        <AddonSlot name="dialog-section" part="character-stats" subject={character} />
      </DialogContent>
    </Dialog>
  );
}
