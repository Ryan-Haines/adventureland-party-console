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

const consumed = new WeakMap<BankState, { source: object; snapshot: BankSnapshot | null }>();

// A report that omits an unchanged bank gets the same object back (inventory-carry.ts).
// While that object produced the current snapshot, consumeBankReport's comparison finds no change.
function unchangedCarriedBank(body: BankReport, state: BankState): boolean {
  const last = consumed.get(state);
  return !!last && last.source === body.bank && last.snapshot === state.snapshot && state.observer === body.name;
}

/** A bank observation replaces the snapshot only when its content or observer changes. */
export function consumeBankReport(body: BankReport, state: BankState, ports: BankPorts): void {
  if (!body.bank) {
    if (state.observer === body.name) state.observer = null;
    return;
  }
  if (unchangedCarriedBank(body, state)) {
    delete body.bank;
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
  consumed.set(state, { source: body.bank, snapshot: state.snapshot });
  delete body.bank;
}
