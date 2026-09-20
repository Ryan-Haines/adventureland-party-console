import { anniversaryLabels as labels, anniversarySlices as slices } from "./contracts.ts";

export function sliceBalances(counts: Record<string, number>, native: string | null) {
  const completeSets = Math.min(...slices.map((name) => counts[name] || 0));
  const tradableNative = native ? Math.max(0, (counts[native] || 0) - completeSets) : 0;
  const totalSlices = slices.reduce((total, name) => total + (counts[name] || 0), 0);
  const perFlavorTarget = Math.floor(totalSlices / slices.length);
  const nativeCount = native ? counts[native] || 0 : 0;
  const tradeLimits = Object.fromEntries(
    slices
      .filter((name) => name !== native)
      .map((name) => [
        name,
        Math.max(
          0,
          Math.min(
            perFlavorTarget - (counts[name] || 0),
            Math.floor((nativeCount - (counts[name] || 0)) / 2),
            tradableNative,
          ),
        ),
      ]),
  );
  return {
    counts,
    completeSets,
    tradableNative,
    totalSlices,
    perFlavorTarget,
    tradeLimits,
    missing: slices.filter((name) => (tradeLimits[name] || 0) > 0),
  };
}

export function tradeAdvertisement(
  balance: ReturnType<typeof sliceBalances>,
  native: string | null,
  merchant: string | null,
  server: string,
) {
  if (!merchant || !native || !balance.missing.length || balance.tradableNative <= 0)
    return { message: "", chatMessage: "" };
  const nativeLabel = labels[native] || native || "my native slice";
  const realm = server.replace(/^SR_/, "").replace(/^(US|EU|ASIA)(I{1,3}|PVP)$/, "$1 $2");
  const wanted = balance.missing.map((name) => labels[name]).join(", ");
  const code =
    'send_item("' +
    merchant +
    '",character.items.findIndex(i=>i&&i.name==="' +
    balance.missing[0] +
    '"),1);';
  const chatMessage =
    "I trade " +
    nativeLabel +
    " Slice 1:1. Slices needed: " +
    wanted +
    ". Limit 1 per customer. Stand nearby and run: " +
    code +
    " High trust, no GP";
  const message =
    "Anniversary trade — Realm: " +
    realm +
    ". " +
    merchant +
    " trades " +
    nativeLabel +
    " Slice 1:1. Slices needed: " +
    wanted +
    ". Limit 1 per customer. Stand beside " +
    merchant +
    ", then run this complete example: " +
    code +
    " If unable to complete the trade, your original slice is returned.";
  return { message, chatMessage };
}
