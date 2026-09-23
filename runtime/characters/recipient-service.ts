export interface RecipientServiceCommand {
  id: number; jobId: string; type: string; concurrentService?: boolean;
}
interface Receipt { path: string; body: Record<string, unknown> }
interface Journal { id: number; jobId: string; started?: boolean; receipt?: Receipt; complete?: boolean }
interface Ports {
  read(): Journal | null;
  write(journal: Journal): void;
  available(): boolean;
  execute(command: RecipientServiceCommand): Promise<unknown>;
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
  report(reason: string): void;
}

/** Independent of navigation; persisted receipts replay without repeating transfers. */
export function createRecipientService(ports: Ports) {
  let current: RecipientServiceCommand | null = null, busy = false;
  function owns(command: RecipientServiceCommand): boolean {
    return current?.id === command.id && current.jobId === command.jobId;
  }
  async function complete(command: RecipientServiceCommand, path: string, body: Record<string, unknown>) {
    if (!owns(command)) throw Error('Merchant service superseded');
    const journal: Journal = { id: command.id, jobId: command.jobId, started: true, receipt: { path, body } };
    ports.write(journal);
    await ports.post(path, body);
    ports.write({ ...journal, complete: true });
  }
  async function receive(command: RecipientServiceCommand | null) {
    current = command;
    if (!command || busy || !ports.available()) return;
    busy = true;
    try {
      const saved = ports.read();
      if (await restore(saved, command)) return;
      ports.write({ id: command.id, jobId: command.jobId, started: true });
      await ports.execute(command);
    } catch (error) {
      ports.report(error instanceof Error ? error.message : String(error));
    } finally { busy = false; }
  }
  async function restore(saved: Journal | null, command: RecipientServiceCommand): Promise<boolean> {
    if (!saved) return false;
    if (saved.jobId === command.jobId && saved.id === command.id) {
      if (saved.complete) return true;
      if (saved.receipt) { await complete(command, saved.receipt.path, saved.receipt.body); return true; }
    }
    if (saved.started && !saved.complete) throw Error('Merchant transfer outcome uncertain; refusing to repeat service');
    return false;
  }
  return { receive, complete, owns, busy: () => busy };
}
Object.assign(globalThis, { createRecipientService });
