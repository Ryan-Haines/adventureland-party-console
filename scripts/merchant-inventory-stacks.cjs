// Plan one conservative merge at an existing idle/stand reconciliation boundary.
const { identity } = require('./bank-stack-routing.cjs');
function plan(party, status) {
  const merchant = party.merchantCharacter;
  if (!status || status.name !== merchant || party.merchantCurrent || party.bankboiTransaction ||
      Number(status.inventoryStackRetryAt || 0) > Date.now() || status.banking || status.gatheringActive || status.anniversaryState?.busy || status.rip) return null;
  const reserved = new Set();
  function reserve(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.name === 'string') reserved.add(value.name);
    Object.values(value).forEach(reserve);
  }
  [party.marked?.[merchant], party.merchantMarked?.[merchant], party.upgrades?.[merchant],
    party.compounds?.[merchant], party.statScrolls?.[merchant], party.withdrawals?.[merchant],
    party.standListings, party.npcSaleMarks, (party.deconstructionMarks || []).filter(mark => mark.state !== "complete"), party.merchantDeliveries, party.merchantCargo,
    party.merchantQueue].forEach(reserve);
  const groups = new Map();
  for (const entry of status.items || []) {
    const item = entry?.item, limit = Number(entry?.meta?.definition?.s) || 1;
    if (!item || !Number.isSafeInteger(entry.slot) || item.l || item.b || reserved.has(item.name) ||
        limit <= 1 || !Number.isSafeInteger(item.q) || item.q <= 0 || item.q >= limit) continue;
    // PvP-marked loot cannot stack with unmarked loot. Timestamp equality is
    // irrelevant: the game checks marker presence. Replan from each new report.
    const key = JSON.stringify([identity(item), !!item.v]), previous = groups.get(key);
    if (previous && previous.item.q + item.q <= limit)
      return { to: previous.slot, from: entry.slot, target: previous.item, source: item };
    if (!previous || item.q < previous.item.q) groups.set(key, entry);
  }
  return null;
}
module.exports = { plan };
