import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantBlock, MerchantIdentity } from "../commerce/market-types.ts";

interface BlacklistPorts {
  now(): number;
  key(entry: MerchantIdentity): string;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
}
export function createMerchantBlacklistRoute(
  state: { merchantBlacklist: Record<string, MerchantBlock>; autoBlacklistMerchants?: boolean },
  ports: BlacklistPorts,
) {
  function add(body: Record<string, unknown>, res: HttpResponse): boolean {
    const seller = requestText(body.seller || "").trim();
    if (!seller) {
      res.status(400).json({ error: "enter a merchant name" });
      return false;
    }
    const minutes = Number(body.minutes);
    if (!Number.isFinite(minutes) || (minutes !== -1 && minutes < 1)) {
      res.status(400).json({ error: "duration must be minutes or -1 for forever" });
      return false;
    }
    const entry = {
        seller,
        serverRegion: requestText(body.serverRegion || ""),
        serverIdentifier: requestText(body.serverIdentifier || ""),
      },
      key = ports.key(entry);
    state.merchantBlacklist[key] = {
      ...entry,
      reason: "manual",
      failures: 0,
      until: minutes === -1 ? -1 : ports.now() + minutes * 60000,
      updatedAt: ports.now(),
    };
    ports.log("!!!BLACKLISTED!!! - " + seller, "warning", {
      reason: "manual",
      until: state.merchantBlacklist[key].until,
    });
    return true;
  }
  return function blacklist(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      action = requestText(body.action || "add");
    if (action === "configure") {
      if (typeof body.enabled !== "boolean")
        return res.status(400).json({ error: "invalid blacklist setting" });
      state.autoBlacklistMerchants = body.enabled;
    } else if (action === "clear") {
      const key = requestText(body.key || "");
      if (key) delete state.merchantBlacklist[key];
      else state.merchantBlacklist = {};
    } else if (!add(body, res)) return undefined;
    ports.persist();
    return res.json({ ok: true, blacklist: state.merchantBlacklist });
  };
}
