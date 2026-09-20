"use client";
import { AutoUpgradeRule } from "./auto-upgrade-rule";

export const upgradeRuleTiers = (rule?: AutoUpgradeRule) =>
  Number(typeof rule === "object" ? rule.tiers : rule) || 0;
