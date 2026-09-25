import { transportTiming } from '../telemetry/transport-timing.ts';
import { requestObject, type HttpHandler, type HttpRouter } from "./contracts.ts";
import { publishSharedRoute, routeOwner, sharedRoute } from "../navigation/shared-route-store.ts";
import type { SharedState } from "../navigation/shared-route-types.ts";
import { createSharedWalks } from "../navigation/shared-walk.ts";
import { movementBarrier } from '../navigation/movement-barrier.ts';

export function installSharedConvoyRoute(router: HttpRouter, input: unknown,
  owned: (name: string) => unknown, walks?: Parameters<typeof createSharedWalks>[1]): void {
  const state = input as SharedState;
  router.post('/party-api/movement-barrier', (req, res) => {
    const receivedAt = Date.now();
    const result = movementBarrier(state, req.body, receivedAt);
    return res.status(result.error ? 409 : 200).json({...result, transportTiming: transportTiming(receivedAt, Date.now())});
  });
  const publish: HttpHandler = (req, res) => {
    const body = requestObject(req.body);
    if (!owned(String(body.character))) return res.status(400).json({ error: "unknown character" });
    const error = publishSharedRoute(state, body, Date.now());
    return error ? res.status(409).json({ error }) : res.json({ ok: true, routeVersion: state.activeConvoy!.routeVersion });
  };
  const read: HttpHandler = (req, res) => {
    const body = requestObject(req.query);
    if (!owned(String(body.character)) || !routeOwner(state, body, Date.now())) return res.status(409).json({ error: "stale route reader" });
    const route = sharedRoute(state.activeConvoy!);
    res.set("Cache-Control", "no-store");
    return route ? res.json({ ok: true, route }) : res.status(409).json({ error: "route not published" });
  };
  router.post("/party-api/convoy-route", publish);
  router.get("/party-api/convoy-route", read);
  if (walks) {
    const service = createSharedWalks(input, walks);
    router.post("/party-api/shared-travel", (req, res) => {
      const result = service.submit(requestObject(req.body));
      return res.status(result.error ? 409 : 200).json(result);
    });
  }
}
