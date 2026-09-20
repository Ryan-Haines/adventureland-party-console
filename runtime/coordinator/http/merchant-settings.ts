import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantCommand } from "../merchant/work.ts";

interface SettingsState {
  merchant: string | null;
  modes: string[];
  noTool: Record<string, boolean>;
  activity: unknown[];
}
interface SettingsPorts {
  ownedType(name: string): string | undefined;
  persist(): void;
  dispatch(): void;
  nextCommand(): number;
  command(name: string | null, command: MerchantCommand): void;
  currentJob(): { id: string } | null;
  log(message: string, level: unknown, details: unknown): void;
}

function gatheringMode(value: unknown): value is "fishing" | "mining" {
  return value === "fishing" || value === "mining";
}

export function createMerchantSettingsRoutes(state: SettingsState, ports: SettingsPorts) {
  function configure(request: HttpRequest, response: HttpResponse): unknown {
    const name = requestObject(request.body).character;
    if (typeof name !== "string" || ports.ownedType(name) !== "merchant")
      return response.status(400).json({ error: "select an owned merchant character" });
    state.merchant = name;
    ports.persist();
    ports.dispatch();
    return response.json({ ok: true, merchantCharacter: name });
  }

  function gather(request: HttpRequest, response: HttpResponse): unknown {
    const { mode, enabled } = requestObject(request.body);
    if (!gatheringMode(mode) || typeof enabled !== "boolean")
      return response.status(400).json({ error: "invalid gathering toggle" });
    if (enabled) delete state.noTool[mode];
    state.modes = enabled
      ? [...new Set(state.modes.concat(mode))]
      : state.modes.filter((entry) => entry !== mode);
    if (state.merchant)
      ports.command(state.merchant, {
        id: ports.nextCommand(),
        type: "merchant-gather",
        modes: state.modes,
      });
    ports.persist();
    return response.json({ ok: true, gatheringModes: state.modes });
  }

  function currentMerchant(body: Record<string, unknown>, response: HttpResponse): boolean {
    if (state.merchant && body.character === state.merchant) return true;
    response.status(409).json({ error: "merchant is no longer configured" });
    return false;
  }

  function recordMessage(body: Record<string, unknown>): void {
    if (body.message) ports.log(requestText(body.message), body.level || "info", body.details);
  }

  function gatherStatus(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    if (!currentMerchant(body, response)) return;
    if (body.noTool === true && gatheringMode(body.mode)) {
      state.noTool[body.mode] = true;
      state.modes = state.modes.filter((mode) => mode !== body.mode);
      ports.command(state.merchant, {
        id: ports.nextCommand(),
        type: "merchant-gather",
        modes: state.modes.slice(),
      });
    }
    recordMessage(body);
    ports.persist();
    return response.json({ ok: true });
  }

  function activity(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    if (!currentMerchant(body, response)) return;
    const job = ports.currentJob();
    if (!job || body.jobId !== job.id)
      return response.status(409).json({ error: "merchant job is no longer current" });
    recordMessage(body);
    ports.persist();
    return response.json({ ok: true });
  }

  function clearActivity(_request: HttpRequest, response: HttpResponse): unknown {
    state.activity = [];
    ports.persist();
    return response.json({ ok: true });
  }

  return { configure, gather, gatherStatus, activity, clearActivity };
}
