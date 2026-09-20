import { requestObject, type HttpHandler, type HttpResponse } from "./contracts.ts";

interface ScopePorts<Service> {
  owned(name: string): unknown;
  merchant(): string | null;
  combat(name: string): boolean;
  owner(name: string): string;
  solo(name: string): Service | null;
  mainOwner(): string | null;
  mode(name: string): unknown;
}

/** Address settings by character; workflow acknowledgements resolve the current effective owner. */
export function createScopedFarmingRoute<Service>(main: HttpHandler,
  select: (service: Service) => HttpHandler, ports: ScopePorts<Service>, edit = false, followerMode?: HttpHandler): HttpHandler {
  return (req, res) => {
    const name = requestObject(req.body).character;
    if (name === undefined) return main(req, resultResponse(res, ports.mainOwner(), ports, edit));
    if (typeof name !== "string" || !ports.owned(name)) return res.status(400).json({ error: "unknown character" });
    if (followerMode && isFollower(name, ports))
      return followerMode(req, resultResponse(res, name, ports, true));
    const error = edit ? editError(name, ports) : null;
    if (error) return res.status(409).json({ error });
    const service = ports.solo(name);
    return (service ? select(service) : main)(req, resultResponse(res, name, ports, edit));
  };
}
function isFollower<Service>(name: string, ports: ScopePorts<Service>): boolean {
  return name !== ports.merchant() && ports.combat(name) && ports.owner(name) !== name;
}
function editError<Service>(name: string, ports: ScopePorts<Service>): string | null {
  if (name === ports.merchant() || !ports.combat(name)) return "Merchants do not run Monster Hunts";
  return ports.owner(name) !== name ? "following leader settings" : null;
}
function resultResponse<Service>(res: HttpResponse, name: string | null, ports: ScopePorts<Service>, edit: boolean): HttpResponse {
  if (!edit || !name) return res;
  return new Proxy(res, {
    get(target, key) {
      if (key === "json") return (value: unknown) => {
        const body = requestObject(value), owner = ports.owner(name);
        return res.json(body.ok ? { ...body, farmingOwner: owner,
          savedFarmingPolicy: ports.mode(name), effectiveFarmingPolicy: ports.mode(owner) } : value);
      };
      const member = Reflect.get(target, key);
      return typeof member === "function" ? member.bind(target) : member;
    },
  });
}
