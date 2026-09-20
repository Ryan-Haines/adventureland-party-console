import type { MerchantCommand } from "../merchant/work.ts";
import type { NavigationRoutePorts } from "../navigation/route-types.ts";

/** Convoy payloads retain their phase-specific fields at this legacy boundary. */
interface ConvoyState {
  activeConvoy: unknown;
  commands: Record<string, Pick<MerchantCommand, "id" | "type"> | undefined>;
}

export interface ConvoyNavigationPlatform {
  step(state: ConvoyState, now?: number): boolean;
  hold(state: ConvoyState, reason: string, code?: string): boolean;
  signal(state: ConvoyState, name: string, now?: number): unknown;
  validReport(state: ConvoyState, body: Record<string, unknown>): boolean;
  engage(state: ConvoyState, ...args: Parameters<NavigationRoutePorts["engage"]>): boolean;
}

/** Defense reads current observations and retained fights without altering them. */
export interface ConvoyDefensePlatform {
  fighting(
    state: {
      statuses: Record<string, unknown>;
      groupedCombat?: unknown;
      groupedCombatResetAt?: unknown;
    },
    names: string[],
    now?: number,
  ): boolean;
}
