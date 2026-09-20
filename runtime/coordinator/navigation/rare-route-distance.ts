import type { PlanRequest, PlanResult, Point } from "../../navigation/contracts.ts";
/** Route walking distance plus a fixed transition cost; failed plans are not reachable candidates. */
export function createRareRouteDistance(
  plan: (request: PlanRequest) => Promise<PlanResult>,
  identity: () => { version: number; fingerprint: string },
) {
  let serial = 0;
  return async (from: Point, to: Point): Promise<number> => {
    const result = await plan({
      ...identity(),
      id: `phoenix-wait-${Date.now()}-${++serial}`,
      from,
      to,
      speed: 60,
      town: false,
    });
    let previous = from,
      distance = 0;
    for (const step of result.plot) {
      distance +=
        step.map === previous.map ? Math.hypot(step.x - previous.x, step.y - previous.y) : 400;
      previous = step;
    }
    if (previous.map !== to.map || Math.hypot(previous.x - to.x, previous.y - to.y) > 40)
      throw Error("Incomplete Phoenix waiting route");
    return distance;
  };
}
