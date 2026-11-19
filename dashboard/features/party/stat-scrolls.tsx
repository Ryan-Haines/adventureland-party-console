"use client";
// The stat scrolls the item menu offers; each one's multiplier is the game's, in
// dashboard/lib/game-formulas.ts.

export const STAT_SCROLLS = [
  {
    stat: "str",
    scroll: "strscroll",
    label: "STR",
    purchasable: true,
  },
  {
    stat: "int",
    scroll: "intscroll",
    label: "INT",
    purchasable: true,
  },
  {
    stat: "dex",
    scroll: "dexscroll",
    label: "DEX",
    purchasable: true,
  },
  {
    stat: "vit",
    scroll: "vitscroll",
    label: "VIT",
    purchasable: true,
  },
  {
    stat: "for",
    scroll: "forscroll",
    label: "FOR",
    purchasable: false,
  },
  {
    stat: "evasion",
    scroll: "evasionscroll",
    label: "Evasion",
    purchasable: false,
  },
  {
    stat: "reflection",
    scroll: "reflectionscroll",
    label: "Reflection",
    purchasable: false,
  },
  {
    stat: "gold",
    scroll: "goldscroll",
    label: "Gold",
    purchasable: false,
  },
  {
    stat: "luck",
    scroll: "luckscroll",
    label: "Luck",
    purchasable: false,
  },
  {
    stat: "xp",
    scroll: "xpscroll",
    label: "XP",
    purchasable: false,
  },
  {
    stat: "armor",
    scroll: "armorscroll",
    label: "Armor",
    purchasable: false,
  },
  {
    stat: "resistance",
    scroll: "resistancescroll",
    label: "Resistance",
    purchasable: false,
  },
  {
    stat: "speed",
    scroll: "speedscroll",
    label: "Speed",
    purchasable: false,
  },
  {
    stat: "lifesteal",
    scroll: "lifestealscroll",
    label: "Lifesteal",
    purchasable: false,
  },
  {
    stat: "manasteal",
    scroll: "manastealscroll",
    label: "Manasteal",
    purchasable: false,
  },
  {
    stat: "rpiercing",
    scroll: "rpiercingscroll",
    label: "Resistance piercing",
    purchasable: false,
  },
  {
    stat: "apiercing",
    scroll: "apiercingscroll",
    label: "Armor piercing",
    purchasable: false,
  },
  {
    stat: "crit",
    scroll: "critscroll",
    label: "Critical hit",
    purchasable: false,
  },
  {
    stat: "dreturn",
    scroll: "dreturnscroll",
    label: "Damage return",
    purchasable: false,
  },
  {
    stat: "frequency",
    scroll: "frequencyscroll",
    label: "Attack speed",
    purchasable: false,
  },
  {
    stat: "mp_cost",
    scroll: "mpcostscroll",
    label: "MP cost reduction",
    purchasable: false,
  },
  {
    stat: "output",
    scroll: "outputscroll",
    label: "Output",
    purchasable: false,
  },
] as const;
