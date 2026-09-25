import type { ConvoyNavigationPlatform } from "../infrastructure/convoy-platform.ts";
import type { SharedConvoy } from "../navigation/shared-route-types.ts";

/** Replacement commands retain the target for movement-neutral attacks only. */
export function propagateHuntTarget(input: Parameters<ConvoyNavigationPlatform["step"]>[0]): void {
  const state = input as { activeConvoy: SharedConvoy | null; commands: Record<string, { convoyId?: string; huntTarget?: string; combatHandoffAllowed?: boolean } | undefined> }, convoy = state.activeConvoy;
  if (!convoy?.huntTarget) return;
  convoy.combatHandoffAllowed = false;
  for (const name of convoy.participants) {
    const command = state.commands[name];
    if (command?.convoyId !== convoy.id) continue;
    command.huntTarget = convoy.huntTarget;
    command.combatHandoffAllowed = false;
  }
}


/** Hunt travel always finishes its installed route, even for old clients requesting a handoff. */
export function engageHunt(input: Parameters<ConvoyNavigationPlatform["engage"]>[0], body: Record<string, unknown>,
  options: Parameters<ConvoyNavigationPlatform["engage"]>[2], legacy: Pick<ConvoyNavigationPlatform, "engage" | "validReport">, _now = Date.now()): boolean {
  const state = input as { activeConvoy?: { purpose?: string | null } | null };
  return state.activeConvoy?.purpose !== "monster-hunt" && legacy.engage(input, body, options);
}
