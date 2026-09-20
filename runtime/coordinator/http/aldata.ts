import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";

interface ALDataRouteState {
  aldata: {
    key: string;
    auth: unknown;
    authCheckedAt: number;
    publishStatus: string;
    error: string | null;
  };
  merchantCharacter: string | null;
  statuses: Record<string, unknown>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface ALDataRoutePorts {
  now(): number;
  key(): string;
  nextCommand(): number;
  snapshot(): unknown;
  fetch(path: string): Promise<unknown>;
  refresh(): Promise<unknown>;
  persistMarket(): void;
  publish(): void;
  stamp(job: MerchantWork): MerchantWork;
  log(message: string, level: string): void;
  persist(): void;
  dispatch(): void;
}

export function createALDataRoutes(state: ALDataRouteState, ports: ALDataRoutePorts) {
  function key(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json({ key: state.aldata.key || "" });
  }
  function market(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json(ports.snapshot());
  }
  function generateKey(_req: HttpRequest, res: HttpResponse): unknown {
    state.aldata.key = ports.key();
    state.aldata.auth = "NO";
    state.aldata.authCheckedAt = 0;
    state.aldata.publishStatus = "idle";
    ports.persistMarket();
    return res.json({ key: state.aldata.key });
  }
  async function auth(_req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const character = state.merchantCharacter || Object.keys(state.statuses)[0];
    if (!character) return res.status(409).json({ error: "no online character is available" });
    try {
      const status = requestObject(
        await ports.fetch(
          "/auth/" +
            encodeURIComponent(character) +
            (state.aldata.key ? "/" + encodeURIComponent(state.aldata.key) : ""),
        ),
      );
      state.aldata.auth = status.auth || "NO";
      state.aldata.authCheckedAt = ports.now();
      state.aldata.error = null;
      ports.persistMarket();
      if (state.aldata.auth === "CORRECT") ports.publish();
      return res.json({ ...status, checkedAt: state.aldata.authCheckedAt });
    } catch (error) {
      state.aldata.error = error instanceof Error ? error.message : String(error);
      return res.status(502).json({ error: state.aldata.error });
    }
  }
  function sendAuth(_req: HttpRequest, res: HttpResponse): unknown {
    const merchant = state.merchantCharacter;
    if (!merchant || !state.statuses[merchant])
      return res.status(409).json({ error: "merchant is not online" });
    if (!state.aldata.key) return res.status(409).json({ error: "generate an ALData key first" });
    if (
      [state.merchantCurrent, ...state.merchantQueue].some(
        (job) => job?.reason === "ALData authentication",
      )
    )
      return res.json({ ok: true, duplicate: true });
    const job = ports.stamp({
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: merchant,
      reason: "ALData authentication",
      queuedAt: ports.now(),
    });
    state.merchantQueue.push(job);
    ports.log("ALData authentication mail queued", "info");
    ports.persist();
    ports.dispatch();
    return res.json({ ok: true, jobId: job.id });
  }
  async function refresh(_req: HttpRequest, res: HttpResponse): Promise<unknown> {
    return res.json(await ports.refresh());
  }
  return { key, market, generateKey, auth, sendAuth, refresh };
}

export function createMailPostageRoute(readPostage: () => Promise<number | null>) {
  return async function postage(_req: HttpRequest, res: HttpResponse): Promise<unknown> {
    try {
      return res.json({ gold: await readPostage() });
    } catch {
      return res.json({ gold: null });
    }
  };
}
