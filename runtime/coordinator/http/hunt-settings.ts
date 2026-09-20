import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  applyHuntThresholds,
  huntSettings,
  validHuntSettings,
  type HuntFailureState,
} from "../hunt/settings.ts";
export function createHuntSettingsRoute(
  state: HuntFailureState & { farmAreaState?: { pending?: unknown } | null },
  ports: { now(): number; persist(): void },
) {
  return (req: HttpRequest, res: HttpResponse): unknown => {
    const { character: _character, ...body } = requestObject(req.body);
    if (!validHuntSettings(body))
      return res
        .status(400)
        .json({ error: "Hunt settings require booleans and positive integer thresholds" });
    state.huntSettings = { ...huntSettings(state), ...body };
    if (
      !state.huntSettings.relocateIfCompeting &&
      (state.farmAreaState?.pending as { cause?: string } | undefined)?.cause === "farming-conflict"
    )
      state.farmAreaState!.pending = null;
    applyHuntThresholds(state, ports.now());
    ports.persist();
    return res.json({ ok: true, huntSettings: state.huntSettings });
  };
}
