import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  anniversarySlices as slices,
  anniversaryLabels as labels,
  type AnniversaryRound,
} from "../anniversary/contracts.ts";
import {
  currentTradeCounts,
  canSwapSlice,
  tradeCompletionMessage,
  type SliceTrade,
} from "../anniversary/trades.ts";
import type { InventoryEntry } from "../contracts/item.ts";

interface CommerceState {
  nativeSlice: string | null;
  rounds: Record<string, AnniversaryRound | undefined>;
  advertisedRounds: Record<string, unknown>;
  chatAdvertisement?: { id: string; message: string; queuedAt: number } | null;
  reciprocal: Record<string, SliceTrade | undefined>;
  pendingReturns: Record<string, unknown>;
  crafted: number;
}
interface CommercePorts {
  autoChat?(): boolean;
  now(): number;
  nextCommand(): number;
  merchant(): string | null;
  owned(name: string): unknown;
  snapshot(): {
    message: string;
    chatMessage: string;
    tradableNative: number;
    counts: Record<string, number>;
    live?: { round?: unknown } | null;
  };
  merchantItems(): (InventoryEntry | null)[] | undefined;
  identity(owner: unknown, sender: string): string;
  alreadyTraded(identity: string): boolean;
  persist(): void;
  publish(): void;
  log(message: string, level: string): void;
}

export function createAnniversaryCommerceRoutes(state: CommerceState, ports: CommercePorts) {
  function advertise(req: HttpRequest, res: HttpResponse): unknown {
    if (!ports.autoChat?.()) return res.json({ ok: true, skipped: true, message: "" });
    const roundId = requestText(requestObject(req.body).round || "");
    if (!state.rounds[roundId]?.claims?.[String(ports.merchant())])
      return res.status(409).json({ error: "merchant kiss is not confirmed" });
    if (state.advertisedRounds[roundId])
      return res.json({ ok: true, duplicate: true, message: "" });
    const live = ports.snapshot();
    if (!live.message || live.tradableNative < 1)
      return res.json({ ok: true, skipped: true, message: "" });
    // Persist the reservation before exposing a public chat line to the caller.
    state.advertisedRounds[roundId] = { at: ports.now(), message: live.chatMessage };
    ports.log("Published the round's slice trade offer", "info");
    ports.persist();
    ports.publish();
    return res.json({ ok: true, message: live.chatMessage });
  }

  function chat(_req: HttpRequest, res: HttpResponse): unknown {
    const live = ports.snapshot();
    if (!ports.merchant() || !live.chatMessage)
      return res
        .status(409)
        .json({ error: "no anniversary chat advertisement is currently available" });
    if (state.chatAdvertisement) return res.json({ ok: true, queued: true, duplicate: true });
    state.chatAdvertisement = {
      id: "anniversary-chat-" + ports.now() + "-" + ports.nextCommand(),
      message: live.chatMessage,
      queuedAt: ports.now(),
    };
    ports.log("Queued a manual chat advertisement for " + ports.merchant(), "info");
    ports.persist();
    return res.json({ ok: true, queued: true });
  }

  function chatComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      pending = state.chatAdvertisement;
    if (!pending || body.id !== pending.id)
      return res.status(409).json({ error: "chat advertisement is no longer pending" });
    state.chatAdvertisement = null;
    ports.log(
      (ports.merchant() || "Merchant") + " sent the manual anniversary chat advertisement",
      "success",
    );
    ports.persist();
    return res.json({ ok: true });
  }

  function reserveTrade(
    body: Record<string, unknown>,
    sender: string,
    incoming: string,
    identity: string,
    key: string,
    native: string,
    res: HttpResponse,
  ): unknown {
    state.reciprocal[key] = {
      key,
      identity,
      owner: body.owner || null,
      at: ports.now(),
      sender,
      incoming,
      outgoing: native,
      state: "reserved",
      map: body.map || null,
      x: Number(body.x) || 0,
      y: Number(body.y) || 0,
      server: body.server || null,
    };
    ports.log(
      "Accepted 1:1 slice trade with " + sender + ": " + (labels[incoming] || incoming),
      "success",
    );
    ports.persist();
    return res.json({ action: "swap", item: native, key });
  }

  function offer(
    body: Record<string, unknown>,
    sender: string,
    incoming: string,
    round: string,
    counts: Record<string, number>,
    res: HttpResponse,
  ): unknown {
    if (ports.owned(sender) || incoming === state.nativeSlice)
      return res.json({ action: "ignore" });
    const identity = ports.identity(body.owner, sender),
      key = round + ":" + identity;
    if (ports.alreadyTraded(identity) || state.reciprocal[key])
      return res.json({ action: "return", item: incoming, reason: "identity limit reached" });
    const current = currentTradeCounts(counts, body.counts, ports.merchantItems());
    if (!canSwapSlice(state.nativeSlice, incoming, current))
      return res.json({ action: "return", item: incoming });
    return reserveTrade(body, sender, incoming, identity, key, state.nativeSlice!, res);
  }

  function trade(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      sender = requestText(body.sender || ""),
      incoming = requestText(body.item || "");
    const live = ports.snapshot(),
      round = requestText(body.round || live.live?.round || "none");
    if (!sender || !slices.includes(incoming))
      return res.status(400).json({ error: "invalid anniversary trade" });
    return offer(body, sender, incoming, round, live.counts, res);
  }

  function tradeComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      key = requestText(body.key || ""),
      trade = state.reciprocal[key];
    if (!trade) return res.status(404).json({ error: "anniversary trade not found" });
    trade.state =
      body.state === "completed"
        ? "completed"
        : body.state === "returned"
          ? "returned"
          : "return_owed";
    trade.completedAt = ports.now();
    if (trade.state === "return_owed")
      state.pendingReturns[key] = {
        key,
        sender: trade.sender,
        item: trade.incoming,
        map: trade.map,
        x: trade.x,
        y: trade.y,
        server: trade.server,
      };
    else delete state.pendingReturns[key];
    ports.log(tradeCompletionMessage(trade), trade.state === "return_owed" ? "error" : "info");
    ports.persist();
    return res.json({ ok: true });
  }

  function cakeComplete(_req: HttpRequest, res: HttpResponse): unknown {
    state.crafted = Math.max(0, Number(state.crafted) || 0) + 1;
    ports.log("GoldMajesty crafted and banked a Sixfold Cake", "success");
    ports.persist();
    return res.json({ ok: true });
  }
  return { advertise, chat, chatComplete, trade, tradeComplete, cakeComplete };
}
