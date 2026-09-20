import {
  distance,
  isTransition,
  type PlanRequest,
  type PlanResult,
  type Step,
} from "../navigation/contracts.ts";
import { validateRoute, type ValidationPorts } from "../navigation/validation.ts";
import { repairDoorApproaches } from "../navigation/door-approach.ts";
import type { MovementPorts } from "./movement-host.ts";

export function routeDuration(request: PlanRequest, plot: Step[]): number {
  let at = request.from,
    ms = 0;
  for (const step of plot) {
    ms += step.town
      ? 7000
      : isTransition(step)
        ? 1000
        : (distance(at, step) * 1000) / Math.max(1, request.speed);
    at = step;
  }
  return ms;
}
export async function planReturnCandidates(
  ports: MovementPorts,
  validation: ValidationPorts,
  request: PlanRequest,
  tolerance: number,
): Promise<PlanResult> {
  const outcomes = await Promise.allSettled(
    [false, true].map(async (town) => {
      // The coordinator keys in-flight work by ID, including parallel candidates.
      const candidateId = `${request.id}:${town ? "town" : "walk"}`;
      const response = (await ports.request("/movement-plan", {
        method: "POST",
        timeout: 2000,
        body: { ...request, id: candidateId, town },
      })) as PlanResult & { error?: string; mode?: string };
      if (response.error) throw Error(response.error);
      if (
        response.id !== candidateId ||
        response.version !== request.version ||
        response.fingerprint !== request.fingerprint
      )
        throw Error("Planner response identity mismatch");
      if (response.mode === "shadow") return response;
      const plot = repairDoorApproaches(validation, request.from, response.plot);
      const issue = validateRoute(validation, request.from, request.to, plot, town, tolerance);
      if (issue) throw Error((town ? "Town" : "Walking") + " route: " + issue.reason);
      return { ...response, plot };
    }),
  );
  const valid = outcomes.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (!valid.length)
    throw Error(
      "Return route candidates failed: " +
        outcomes.map((r) => (r.status === "rejected" ? String(r.reason) : "")).join("; "),
    );
  const selected = valid.sort((a, b) => routeDuration(request, a.plot) - routeDuration(request, b.plot))[0];
  // Candidate identity is transport-local; movement still owns the parent journey.
  return { ...selected, id: request.id };
}
