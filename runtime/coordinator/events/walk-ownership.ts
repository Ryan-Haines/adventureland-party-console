import type { ReturnConvoy, Waypoints } from "./return-types.ts";

/** A workflow can retire its walk without superseding newer manual navigation. */
export function ownsWorkflowWalk(convoy: ReturnConvoy, owner: { participants?: string[]; waypoints?: Waypoints }, current: Waypoints): boolean {
  if (convoy.nonPreemptible || convoy.purpose !== "shared-walk") return false;
  return convoy.participants.every(name => {
    const revision = convoy.walkingParents?.[name]?.revision;
    return revision !== undefined && !!owner.participants?.includes(name) &&
      owner.waypoints?.[name]?.revision === revision && current[name]?.revision === revision;
  });
}
