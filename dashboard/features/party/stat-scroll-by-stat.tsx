"use client";
import { STAT_SCROLLS } from "./stat-scrolls";

export const STAT_SCROLL_BY_STAT = new Map(STAT_SCROLLS.map((entry) => [entry.stat, entry]));
