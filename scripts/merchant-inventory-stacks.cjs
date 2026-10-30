// Plan one conservative merge at an existing idle/stand reconciliation boundary.
const { identity } = require('./bank-stack-routing.cjs');
const { entryMeta } = require('../runtime/coordinator/inventory/catalog-meta.ts');
function plan(party, status, boundary) {
  const merchant = party.merchantCharacter;
  const current = party.merchantCurrent;
  const ownsBoundary = current && typeof boundary?.jobId === 'string' && Number.isSafeInteger(boundary.commandId) &&
    boundary.jobId === current.id && boundary.commandId === current.commandId;
  if (!status || status.name !== merchant || current && !ownsBoundary || party.bankboiTransaction ||
      Number(status.inventoryStackRetryAt || 0) > Date.now() || status.banking || status.gatheringActive || status.anniversaryState?.busy || status.rip) return null;
  const reserved = new Set();
  function reserve(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.name === 'string') reserved.add(value.name);
    if (typeof value.id === 'string') reserved.add(value.id);
    Object.values(value).forEach(reserve);
  }
  [party.marked?.[merchant], party.merchantMarked?.[merchant], party.upgrades?.[merchant],
    party.compounds?.[merchant], party.statScrolls?.[merchant], party.withdrawals?.[merchant],
    party.standListings, party.npcSaleMarks, (party.deconstructionMarks || []).filter(mark => mark.state !== "complete"), party.merchantDeliveries, party.merchantCargo,
    party.merchantQueue, current, boundary?.command].forEach(reserve);
  const groups = new Map();
  for (const entry of status.items || []) {
    // Reports carry per-copy meta, so the stack size comes from merchantCatalog.
    const item = entry?.item, limit = Number(entryMeta(party.merchantCatalog, entry)?.definition?.s) || 1;
    if (!item || !Number.isSafeInteger(entry.slot) || item.l || item.b || reserved.has(item.name) ||
        limit <= 1 || !Number.isSafeInteger(item.q) || item.q <= 0 || item.q >= limit) continue;
    // PvP-marked loot cannot stack with unmarked loot. Timestamp equality is
    // irrelevant: the game checks marker presence. Replan from each new report.
    const key = JSON.stringify([identity(item), !!item.v, !!item.acl, item.ps || []]), previous = groups.get(key);
    if (previous) {
      const quantity = Math.min(item.q, limit - previous.item.q);
      // Partial fills need a native split buffer; whole merges do not.
      if (quantity === item.q || (status.items || []).filter(Boolean).length < 42)
        return { to: previous.slot, from: entry.slot, target: previous.item, source: item, quantity };
    }
    if (!previous || item.q < previous.item.q) groups.set(key, entry);
  }
  return null;
}
module.exports = { plan };
