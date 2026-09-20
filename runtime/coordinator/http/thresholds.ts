import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";

interface Thresholds {
  threshold: number;
  itemCollectionThreshold: number;
}
interface ThresholdPorts {
  collectionChanged(): void;
  persist(): void;
}

function updateThreshold(
  state: Thresholds,
  body: Record<string, unknown>,
  key: keyof Thresholds,
  min: number,
  max: number,
): boolean {
  if (!Object.hasOwn(body, key)) return true;
  const value = Number(body[key]);
  if (!Number.isSafeInteger(value) || value < min || value > max) return false;
  state[key] = value;
  return true;
}

export function createThresholdRoute(state: Thresholds, ports: ThresholdPorts) {
  return function configureThresholds(request: HttpRequest, response: HttpResponse): unknown {
    const body = requestObject(request.body);
    if (!updateThreshold(state, body, "threshold", 0, 1_000_000_000_000))
      return response.status(400).json({ error: "invalid threshold" });
    if (!updateThreshold(state, body, "itemCollectionThreshold", 1, 42))
      return response.status(400).json({ error: "invalid item collection threshold" });
    if (Object.hasOwn(body, "itemCollectionThreshold")) ports.collectionChanged();
    if (!Object.hasOwn(body, "threshold") && !Object.hasOwn(body, "itemCollectionThreshold"))
      return response.status(400).json({ error: "no configuration value supplied" });
    ports.persist();
    return response.json({
      threshold: state.threshold,
      itemCollectionThreshold: state.itemCollectionThreshold,
    });
  };
}
