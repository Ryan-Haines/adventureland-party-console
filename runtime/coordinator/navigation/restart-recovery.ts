import type { createPartyConvoys, PartyConvoy } from "./convoy.ts";

type State = Parameters<typeof createPartyConvoys>[0];
type Ports = Parameters<typeof createPartyConvoys>[1];
type Convoys = ReturnType<typeof createPartyConvoys>;

/** Recover ordinary party travel; Hunt and event returns retain their own retry policies. */
export function createConvoyRestartRecovery(
  state: State,
  ports: Ports,
  convoys: Convoys,
  log: (message: string) => void = () => {},
) {
  function message(convoy: PartyConvoy, text: string): void {
    if (convoy.failure === text) return;
    convoy.failure = text;
    log(text);
    ports.persist();
  }
  function superseded(convoy: PartyConvoy): boolean {
    return (
      state.leader !== convoy.leader ||
      convoy.participants.some((name) => {
        const intent = ports.intent(name),
          revision = convoy.restartRevisions?.[name];
        return (
          intent.cancelled ||
          revision === undefined ||
          intent.revision !== revision ||
          (name !== state.leader && !state.followers[name])
        );
      })
    );
  }
  function ready(convoy: PartyConvoy): boolean {
    const leader = state.statuses[convoy.leader];
    return convoy.participants.every((name) => {
      const status = state.statuses[name],
        command = state.commands[name];
      if (!living(status)) return false;
      return (
        status.seenAt >= ports.now() - 3000 &&
        status.convoyProtocol === 4 &&
        !!status.convoyNavigation?.runtimeId &&
        status.server === leader?.server &&
        (!command || command.convoyId === convoy.id)
      );
    });
  }
  function living(
    status: State["statuses"][string],
  ): status is NonNullable<State["statuses"][string]> {
    return !!status && !status.rip && status.hp !== 0;
  }
  function blocked(convoy: PartyConvoy): boolean {
    return !ready(convoy) || (!!state.escape && state.escape.stage !== "released");
  }
  function eligible(convoy: PartyConvoy | null): convoy is PartyConvoy {
    return !!convoy && convoy.phase === "failed" && !!convoy.restartRecovery &&
      [null, undefined, "party-travel", "party-force-travel"].includes(convoy.purpose);
  }
  return function recover(): void {
    const convoy = state.activeConvoy;
    if (!eligible(convoy)) return;
    if (superseded(convoy)) {
      convoys.cancel();
      ports.persist();
      log("Discarded interrupted convoy superseded by current navigation");
      return;
    }
    const attempts = convoy.restartAttempts || 0;
    if (attempts >= 3) {
      message(
        convoy,
        "Convoy recovery exhausted after three attempts; select the destination again",
      );
      return;
    }
    if (blocked(convoy)) {
      message(
        convoy,
        "Convoy recovery waiting for fresh compatible party reports and command ownership",
      );
      return;
    }
    if (ports.now() - (convoy.failedAt || 0) < [5000, 15000, 30000][attempts]!) return;
    convoy.restartAttempts = attempts + 1;
    convoy.failedAt = ports.now();
    if (convoys.start(convoy.location, convoy.label, convoy.participants, convoy.purpose)) {
      state.activeConvoy!.restartAttempts = attempts + 1;
      // Only coordinator-restored travel is eligible; route failures stay with their normal owner.
      state.activeConvoy!.restartRecovery = false;
      log("Rebuilt interrupted party convoy (attempt " + (attempts + 1) + "/3)");
    }
    ports.persist();
  };
}
