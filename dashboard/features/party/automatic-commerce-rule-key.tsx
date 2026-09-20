"use client";
import { Item } from "./item";

export const automaticCommerceRuleKey = (item: Item) =>
  JSON.stringify({
    name: item.name,
    level: Math.max(0, Number(item.level) || 0),
    p: item.p || null,
    stat_type: item.stat_type || null,
  });
