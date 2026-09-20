import { exactLevelPrice } from "./exact-level-price";
import type { StandPriceHistory } from "./stand-price-history";

/** Only offer observations whose recorded level matches the selected item. */
export function levelPriceHistory(history: StandPriceHistory | undefined, level: number) {
  return {
    lowest: exactLevelPrice(history?.lowest, history?.lowestLevel, level),
    recent: exactLevelPrice(history?.recent, history?.recentLevel, level),
    marketLow: exactLevelPrice(history?.marketLow, history?.marketLowLevel, level),
    highestPublicWTB: exactLevelPrice(
      history?.highestPublicWTB,
      history?.highestPublicWTBLevel,
      level,
    ),
  };
}
