interface BankSnapshot {
  seenAt?: number;
  [field: string]: unknown;
}
interface BankReport {
  name: string;
  bank?: Record<string, unknown> | null;
}
interface BankState {
  snapshot: BankSnapshot | null;
  observer: string | null;
}
interface BankPorts {
  now(): number;
  adoptReservedCargo(): void;
  persist(): void;
}

/** A bank observation replaces the snapshot only when its content or observer changes. */
export function consumeBankReport(body: BankReport, state: BankState, ports: BankPorts): void {
  if (!body.bank) {
    if (state.observer === body.name) state.observer = null;
    return;
  }
  const next = { ...body.bank, character: body.name };
  const previous = state.snapshot && { ...state.snapshot };
  if (previous) delete previous.seenAt;
  if (state.observer !== body.name || JSON.stringify(previous) !== JSON.stringify(next)) {
    state.snapshot = { ...next, seenAt: ports.now() };
    ports.adoptReservedCargo();
    ports.persist();
  }
  state.observer = body.name;
  delete body.bank;
}
