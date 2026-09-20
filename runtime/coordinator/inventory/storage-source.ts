/** Normal bank panes and BankBoi inventories share the same persisted pack namespace. */
export function storagePack(value: unknown): string | null {
  return typeof value === "string" && /^(?:[a-z0-9_]+|bankboi:[A-Za-z0-9_]+)$/i.test(value)
    ? value
    : null;
}
