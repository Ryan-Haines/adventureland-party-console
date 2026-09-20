function itemKey(item) {
  const clean = { ...item, level: Number(item.level) || 0 };
  for (const key of ['rid', 'q', 'price']) delete clean[key];
  return JSON.stringify(Object.fromEntries(Object.keys(clean).sort().filter(key => clean[key] != null).map(key => [key, clean[key]])));
}
function price(item, meta, scrollPrices = {}) {
  const d = meta?.definition || {};
  if (!Number.isFinite(Number(d.g))) return null;
  let value = Number(d.g) * (d.cash ? 1 : .6);
  if (d.markup) value /= Number(d.markup);
  const grades = d.grades || [11, 12], level = Number(item.level) || 0;
  if (d.compound || meta.compoundable) for (let tier = 1; tier <= level; tier++) {
    const grade = tier > grades[1] ? 2 : tier > grades[0] ? 1 : 0;
    value *= d.cash ? 1.5 : 3.2;
    if (d.type !== 'booster') value += (scrollPrices['cscroll' + grade] ?? [6400, 240000, 9200000][grade]) / 2.4;
    else value *= .75;
  }
  if (d.upgrade || meta.upgradeable) {
    let scroll = 0;
    for (let tier = 1; tier <= level; tier++) {
      const grade = tier > grades[1] ? 2 : tier > grades[0] ? 1 : 0;
      scroll += (scrollPrices['scroll' + grade] ?? [1000, 40000, 1600000][grade]) / 2;
      if (tier >= 7) { value *= 3; scroll *= 1.32; }
      else if (tier === 6) value *= 2.4;
      else if (tier >= 4) value *= 2;
      if (tier === 9) { value *= 2.64; value += 400000; }
      if (tier === 10) value *= 5;
      if (tier === 12) value *= .8;
    }
    value += scroll;
  }
  if (item.expires) value /= 8;
  if (item.gift) value = 1;
  return Math.max(1, Math.round(value) * (d.cash ? 3 : 2));
}
function normalize(records, catalog) {
  const definitions = new Map((catalog || []).map(entry => [entry.id, entry.meta]));
  const scrollPrices = Object.fromEntries((catalog || []).filter(entry => /^c?scroll[012]$/.test(entry.id))
    .map(entry => [entry.id, Number(entry.meta?.definition?.g)]).filter(([, value]) => Number.isFinite(value)));
  return (Array.isArray(records) ? records : []).flatMap(record => {
    const { serverRegion, serverIdentifier } = record;
    const seenAt = Date.parse(record.lastSeen);
    if (!serverRegion || !serverIdentifier || !Number.isFinite(seenAt)) return [];
    return (record.items || []).flatMap(item => {
      const unitPrice = price(item, definitions.get(item.name), scrollPrices);
      if (!item.rid || !unitPrice) return [];
      const quantity = Math.max(1, Number(item.q) || 1);
      return [{ key: serverRegion + ':' + serverIdentifier + ':' + item.rid, rid: String(item.rid),
        item, groupKey: itemKey(item), quantity, unitPrice, price: unitPrice * quantity,
        serverRegion, serverIdentifier, seenAt, source: 'aldata' }];
    });
  });
}
function selectLots(listings, quantity) {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100000) return null;
  const sums = new Map([[0, []]]);
  for (const listing of listings) {
    for (const [sum, chosen] of [...sums]) {
      const next = sum + listing.quantity;
      if (next <= quantity && !sums.has(next)) sums.set(next, chosen.concat(listing));
    }
    if (sums.has(quantity)) return sums.get(quantity);
  }
  return null;
}
function prioritizeRealms(listings, currentRealm) {
  const realm = listing => String(listing.serverRegion || '') + String(listing.serverIdentifier || '');
  const current = String(currentRealm || '').replace(/^SR_/, '');
  const totals = new Map();
  for (const listing of listings) totals.set(realm(listing), (totals.get(realm(listing)) || 0) + listing.quantity);
  return listings.slice().sort((a, b) => {
    const ar = realm(a), br = realm(b);
    return Number(br === current) - Number(ar === current) ||
      (totals.get(br) - totals.get(ar)) || ar.localeCompare(br) ||
      a.quantity - b.quantity || a.unitPrice - b.unitPrice;
  });
}
function planPurchase(listings, quantity, currentRealm, allowPartial = false) {
  const ordered = prioritizeRealms(listings, currentRealm);
  const exact = selectLots(ordered, quantity);
  if (exact || !allowPartial) return exact;
  const selected = [];
  let remaining = quantity;
  for (const listing of ordered) if (listing.quantity <= remaining) {
    selected.push(listing);
    remaining -= listing.quantity;
  }
  return selected;
}
module.exports = { itemKey, price, normalize, selectLots, prioritizeRealms, planPurchase };
