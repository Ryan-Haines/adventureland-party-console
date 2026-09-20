import { createPartyConvoys } from "./convoy.ts";
import { createConvoyRestartRecovery } from "./restart-recovery.ts";

type ConvoyState = Parameters<typeof createPartyConvoys>[0];
type ConvoyPorts = Parameters<typeof createPartyConvoys>[1];
interface SelectionState<CatalogEntry> extends ConvoyState {
  nextCommandId: number;
  monsterChoices?: CatalogEntry[] | null;
  farmingPolicy: string;
  monsterHunt?: { target?: string | null } | null;
  monsterFocus?: string[] | null;
}
type CompositionPorts<CatalogEntry> = Pick<
  ConvoyPorts,
  "now" | "activeNames" | "intent" | "persist"
> & {
  log?: (message: string) => void;
  resolveArea: (
    catalog: CatalogEntry[],
    monsters: string[],
    location: Parameters<ConvoyPorts["resolve"]>[0],
  ) => ReturnType<ConvoyPorts["resolve"]>;
};

/** Resolve each new convoy against current Hunt selection or shared farming focus. */
export function createCoordinatorPartyConvoys<CatalogEntry>(
  state: SelectionState<CatalogEntry>,
  ports: CompositionPorts<CatalogEntry>,
) {
  const convoyPorts = {
    now: () => ports.now(),
    nextCommand: () => state.nextCommandId++,
    activeNames: () => ports.activeNames(),
    intent: (name: string) => ports.intent(name),
    persist: () => ports.persist(),
    resolve: (input: Parameters<ConvoyPorts["resolve"]>[0]) =>
      ports.resolveArea(
        state.monsterChoices || [],
        state.farmingPolicy === "hunt" && state.monsterHunt?.target
          ? [state.monsterHunt.target]
          : state.monsterFocus || [],
        input,
      ),
  };
  const convoys = createPartyConvoys(state, convoyPorts);
  return {
    ...convoys,
    recoverRestart: createConvoyRestartRecovery(state, convoyPorts, convoys, ports.log),
  };
}
