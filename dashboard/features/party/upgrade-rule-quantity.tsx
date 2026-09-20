"use client";
import { AutoUpgradeRule } from "./auto-upgrade-rule";

export const upgradeRuleQuantity = (rule?: AutoUpgradeRule) =>
  typeof rule === "object" && Number.isSafeInteger(Number(rule.quantity))
    ? Number(rule.quantity)
    : -1;
