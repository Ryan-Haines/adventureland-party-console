import { requestObject, type HttpRequest, type HttpResponse } from "../../../lifecycle/api.ts";
import type { SettingsWrite, SettingsWriteResult } from "../../api.ts";

interface Thresholds {
  threshold: number;
  itemCollectionThreshold: number;
  buyUpgradeBatchSize?: number;
}
interface ThresholdPorts {
  collectionChanged(): void;
  write(batch: SettingsWrite): SettingsWriteResult;
}
// The fields the route takes; each declaration holds the route's words for a refused value
// (items/saved-fields.ts `refusal`).
const fields = ["threshold", "itemCollectionThreshold", "buyUpgradeBatchSize"] as const;

// The route parses a number from text and passes any other value as sent, so a boolean meets the
// declared range check and is refused. The settings writer checks the three ranges, the
// ones the import shares, before it writes any.
export function createThresholdRoute(state: Thresholds, ports: ThresholdPorts) {
  return function configureThresholds(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    const posted = fields.filter(field => Object.hasOwn(body, field));
    if (!posted.length) return response.status(400).json({ error: "no configuration value supplied" });
    const written = ports.write({ by: "dashboard:config", changes: posted.map(field =>
      ({ field, value: typeof body[field] === "string" ? Number(body[field]) : body[field] })) });
    if (!written.ok) return response.status(400).json({ error: written.error });
    if (posted.includes("itemCollectionThreshold")) ports.collectionChanged();
    return response.json({
      buyUpgradeBatchSize: state.buyUpgradeBatchSize ?? 1,
      threshold: state.threshold,
      itemCollectionThreshold: state.itemCollectionThreshold,
    });
  };
}
