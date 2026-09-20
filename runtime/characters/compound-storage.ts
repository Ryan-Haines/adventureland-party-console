import { compoundStorageLeftovers } from '../compound-storage.ts';
import type { InventoryEntry } from '../coordinator/contracts/item.ts';
import type { CompoundRule } from '../coordinator/merchant/automatic-improvements.ts';
interface StoragePorts {
  refresh(): Promise<void>;
  rules(): CompoundRule[];
  stock(): (InventoryEntry | null | undefined)[];
  inventorySize(): number;
  visitBank(): Promise<void>;
  deposit(slot: number): Promise<void>;
  log(message: string): void;
}
export async function storeCompoundLeftovers(ports: StoragePorts): Promise<void> {
  const leftovers = () => {
    const stock = ports.stock();
    return compoundStorageLeftovers(ports.rules(), stock.slice(0, ports.inventorySize()), stock);
  };
  await ports.refresh();
  if (!leftovers().length) return;
  await ports.visitBank();
  // Recompute after every confirmed transfer; no persistent bank marks are created.
  for (let remaining = ports.inventorySize(); remaining > 0; remaining--) {
    await ports.refresh();
    const entry = leftovers().find(value => Number.isSafeInteger(value.slot));
    if (!entry) break;
    await ports.deposit(entry.slot!);
    ports.log('Banked ' + entry.item!.name + ' while waiting for an auto compound group');
  }
}
Object.assign(globalThis, {partyStoreCompoundLeftovers: storeCompoundLeftovers});
