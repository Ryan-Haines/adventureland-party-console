import type { Item } from "../contracts/item.ts";
import type { MarketListing } from "../merchant/work.ts";

interface PontyListing extends MarketListing {
  rid?: string;
  item?: Item;
}
interface PontyReport {
  listings?: (PontyListing | null)[];
  error?: unknown;
  updatedAt?: number;
}
interface StatusReport {
  name: string;
  server?: string;
  ponty?: PontyReport;
}
type ValidListing = PontyListing & { rid: string; item: Item & { name: string } };

function validListing(entry: PontyListing | null): entry is ValidListing {
  return (
    !!entry?.rid &&
    !!entry.item?.name &&
    Number.isFinite(Number(entry.price)) &&
    Number(entry.price) > 0
  );
}

function listings(
  report: PontyReport,
  server: string,
  itemKey: (item: Item) => string,
): MarketListing[] {
  const reported = Array.isArray(report.listings) ? report.listings : [];
  return reported.filter(validListing).map((entry) => {
    const serverRegion = entry.serverRegion || server.match(/^(US|EU|ASIA)/)?.[1];
    const serverIdentifier = entry.serverIdentifier || server.replace(/^(US|EU|ASIA)/, "");
    return {
      ...entry,
      groupKey: itemKey(entry.item),
      seenAt: Number(report.updatedAt) || 0,
      serverRegion,
      serverIdentifier,
      key: serverRegion + ":" + serverIdentifier + ":" + entry.rid,
    };
  });
}

/** Local Ponty observations remain authoritative for their reported realm and timestamp. */
export function consumePontyReport(
  body: StatusReport,
  merchant: string | null,
  itemKey: (item: Item) => string,
) {
  const report = body.ponty;
  delete body.ponty;
  if (body.name !== merchant || !report || typeof report !== "object") return null;
  const server = String(body.server || "");
  return {
    report: report.error
      ? undefined
      : { realm: server.replace(/^(US|EU|ASIA)/, "$1:"), seenAt: Number(report.updatedAt) || 0 },
    listings: listings(report, server, itemKey),
  };
}
