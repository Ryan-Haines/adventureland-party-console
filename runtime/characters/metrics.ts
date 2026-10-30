import type { Entity, ItemInfo, MonsterEntity, ServerToClient_hit, ServerToClient_chest_opened, ServerToClient_chest_opened_loot } from 'typed-adventureland';
import { METRIC_BUCKET_MS, METRIC_OUTBOX_PREFIX, type MetricBatch, type MetricFrame, type MetricSample } from '../metrics/contracts.ts';
import { metricNumber, parseMetricFrame } from '../metrics/parse.ts';
import { encouragementLuck } from '../metrics/luck.ts';

interface Ports {
  now(): number;
  current(): boolean;
  connected(): boolean;
  name(): string;
  own(actor: string): boolean;
  ownedCharacter(name: string): boolean;
  context(): { server: string; map: string; instance: string; party: string[] };
  sample(): Omit<MetricSample, 'at'>;
  send(batch: MetricBatch): Promise<unknown>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}
type Frame = MetricFrame & { server: string };
interface Journal { runtime: string; sequence: number; queue: Frame[]; lost: boolean; goldMovement: number; consumableCost:number; consumablePurchases:number }
// Upstream hit declarations omit `dead` and `actor`, seen in native AoE packets.
type Hit = Omit<ServerToClient_hit, 'source'> & { source?: string; dead?: boolean; actor?: string; skill?: string; mtype?: string };
// Native cache_item preserves properties omitted by upstream chest item types.
type LootReward = Omit<ServerToClient_chest_opened_loot, 'items'> & {
  items: Array<ServerToClient_chest_opened_loot['items'][number] & Partial<Pick<ItemInfo, 'p' | 'stat_type'>>>;
};
type LootOutcome = LootReward | Extract<ServerToClient_chest_opened, { gone: true }>;
type Target = Pick<Entity, 'id' | 'mtype' | 'type'>;
type MonsterTarget = Pick<MonsterEntity, 'id' | 'mtype' | 'type'>;
function isMonsterTarget(target: Target | null | undefined): target is MonsterTarget {
  return !!target && target.type === 'monster' && typeof target.mtype === 'string' && target.mtype.length > 0;
}

/** One collector per CODE generation. Retries keep their original bucket and sequence. */
export function installPartyMetrics(ports: Ports) {
  const key = METRIC_OUTBOX_PREFIX + ports.name();
  const persistedFrames = new Set<number>();
  const frameKey = (sequence: number) => key + ':frame:' + (sequence % 1024);
  // The game's local_cm_logic walks every localStorage key every 16 ms, so the outbox
  // keeps a ring key only while the queue holds its frame. persist() removes the keys of
  // frames that left the queue (confirmed, or dropped past 720) after it writes the
  // header, and never a slot that a queued frame uses.
  function removeReleased(released: Iterable<number>) {
    const retained = new Set(journal.queue.map(frame => frameKey(frame.sequence)));
    for (const sequence of released) if (!retained.has(frameKey(sequence))) ports.storage.removeItem(frameKey(sequence));
  }
  // At install, removeStale removes every ring key the restored header does not list:
  // 1.5 kept confirmed frames until the ring wrapped, and restore never adopts a frame
  // whose header write a crash cut off.
  function removeStale() {
    const retained = new Set(journal.queue.map(frame => frameKey(frame.sequence)));
    for (let slot = 0; slot < 1024; slot++) {
      const ring = key + ':frame:' + slot;
      if (!retained.has(ring) && ports.storage.getItem(ring) != null) ports.storage.removeItem(ring);
    }
  }
  const journal: Journal = { runtime: Date.now() + '-' + Math.random().toString(36).slice(2), sequence: 0, queue: [], lost: false, goldMovement: 0, consumableCost:0, consumablePurchases:0 };
  // Restored data crosses a storage boundary. Accept only our bounded versioned envelope;
  // the coordinator performs full frame validation before accepting measurements.
  try {
    const saved: unknown = JSON.parse(ports.storage.getItem(key) || 'null');
    if (saved && typeof saved === 'object' && 'runtime' in saved && typeof saved.runtime === 'string' &&
        'sequence' in saved && typeof saved.sequence === 'number' && 'queue' in saved && Array.isArray(saved.queue)) {
      journal.runtime = saved.runtime;
      journal.sequence = saved.sequence;
      if ('goldMovement' in saved && metricNumber(saved.goldMovement, -Number.MAX_SAFE_INTEGER)) journal.goldMovement = saved.goldMovement;
      if ('consumableCost' in saved && metricNumber(saved.consumableCost)) journal.consumableCost=saved.consumableCost;
      if ('consumablePurchases' in saved && metricNumber(saved.consumablePurchases)) journal.consumablePurchases=saved.consumablePurchases;
      for (const entry of saved.queue.slice(-720)) {
        const value: unknown = typeof entry === 'number'
          ? JSON.parse(ports.storage.getItem(frameKey(entry)) || 'null') : entry;
        const parsed = parseMetricFrame(value);
        // A ring slot can be overwritten only after its old frame expires.
        // Never adopt a mismatched sequence after an interrupted header write.
        if (typeof entry === 'number' && parsed?.sequence !== entry) { journal.lost = true; continue; }
        if (typeof entry === 'number' && parsed) persistedFrames.add(entry);
        if (parsed && value && typeof value === 'object' && 'server' in value && typeof value.server === 'string')
          journal.queue.push({ ...parsed, server: value.server });
        else journal.lost = true;
      }
      journal.lost ||= 'lost' in saved && saved.lost === true;
    }
  } catch { journal.lost = true; }
  try { removeStale(); } catch { /* The next confirmation removes its own keys. */ }
  let active: Frame | undefined, busy = false, previousAt = ports.now(), previousServer = ports.context().server;
  // The coordinator commit that will write each accepted frame, by sequence.
  // Not persisted: a reload sends every queued frame again.
  const acceptedIn = new Map<number, number>();
  let coordinatorEpoch: string | undefined;
  const seen = new Map<string, number>();
  const targets = new Map<string, { target: MonsterTarget; at: number; context: string }>();
  const observedDeaths = new Map<string, number>();
  let prunedAt = 0;
  function prune(at: number) {
    if (at - prunedAt < 1000) return;
    prunedAt = at;
    for (const [key, time] of seen) if (at - time > 30_000) seen.delete(key);
    for (const [id, value] of targets) if (at - value.at > 30_000) targets.delete(id);
  }
  function remember(id: string, at: number) {
    prune(at);
    if (seen.has(id)) return false;
    seen.set(id, at);
    return true;
  }
  let connectedSince: number | null = ports.connected() ? ports.now() : null;
  function sample(at: number): MetricSample {
    const value = ports.sample();
    // Native login pings include connection establishment and are not steady-state latency.
    return { ...value, ping: connectedSince === null || at - connectedSince < 10_000 ? null : value.ping, at, goldMovement: journal.goldMovement, consumableCost:journal.consumableCost, consumablePurchases:journal.consumablePurchases };
  }
  function persist() {
    try {
      // Frames are immutable after sealing. Write each once to a bounded ring,
      // then publish its sequence in the small journal header. A growing outage
      // never reserializes all historical damage/loot frames on every pulse.
      for (const frame of journal.queue) if (!persistedFrames.has(frame.sequence)) {
        ports.storage.setItem(frameKey(frame.sequence), JSON.stringify(frame));
        persistedFrames.add(frame.sequence);
      }
      ports.storage.setItem(key, JSON.stringify({...journal,queue:journal.queue.map(frame=>frame.sequence)}));
      const retained=new Set(journal.queue.map(frame=>frame.sequence));
      const released=[...persistedFrames].filter(sequence=>!retained.has(sequence));
      for(const sequence of released)persistedFrames.delete(sequence);
      removeReleased(released);
    }
    catch { journal.lost = true; }
  }
  function seal() {
    const sealed = active;
    if (!sealed) return;
    // Resolve credit coverage when sealing, after native hit/credit callbacks
    // have had a chance to arrive in either order.
    if (sealed.credits.some(credit => (observedDeaths.get(credit.monster) || 0) < sealed.first.at - 3000)) sealed.partial = true;
    journal.queue.push(sealed);
    active = undefined;
    if (journal.queue.length > 720) {
      journal.queue.splice(0, journal.queue.length - 720);
      journal.lost = true;
    }
    persist();
  }
  function goldMovement(data: unknown) {
    // Native bank gold replies are absent from the upstream response union.
    // Parse the raw socket boundary without widening the game's declared types.
    if (!ports.current() || !data || typeof data !== 'object' ||
        !('response' in data) || !('gold' in data) || !metricNumber(data.gold) ||
        'failed' in data && data.failed) return;
    const response = data.response;
    const transfer = response === 'gold_sent' || response === 'gold_received';
    const bank = response === 'bank_store' || response === 'bank_withdraw';
    if (!transfer && !bank) return;
    // The native response names the other character. External gifts/payments
    // remain real income/expenses; moving gold within this account does not.
    if (transfer && (!('name' in data) || typeof data.name !== 'string' || !ports.ownedCharacter(data.name))) return;
    journal.goldMovement += (response === 'gold_sent' || response === 'bank_store' ? 1 : -1) * data.gold;
    persist();
  }
  function frame(at: number) {
    const server = ports.context().server, bucket = Math.floor(at / METRIC_BUCKET_MS) * METRIC_BUCKET_MS;
    if (active && (active.at !== bucket || active.server !== server)) seal();
    if (!active) {
      const value = sample(at);
      active = { at: bucket, server, sequence: ++journal.sequence, observedMs: 0, partial: journal.lost,
        damage: [], credits: [], kills: [], loot: [], first: value, last: value };
      journal.lost = false;
    }
    return active;
  }
  function hit(data: Hit, target?: Target | null) {
    if (!ports.current()) return;
    const at = ports.now(), context = ports.context(), scope = JSON.stringify([context.server, context.map, context.instance]);
    prune(at);
    if (isMonsterTarget(target)) targets.set(String(target.id), { target: { id: target.id, type: target.type, mtype: target.mtype }, at, context: scope });
    const remembered = targets.get(String(data.id));
    const monster = isMonsterTarget(target) ? target : remembered?.context === scope ? remembered.target : null;
    if (!monster) return;
    const rawActor = String(data.hid || data.actor || ''), own = ports.own(rawActor), actor = own ? ports.name() : rawActor;
    if (data.pid && !remember(JSON.stringify(['hit', scope, data.pid, data.id, actor]), at)) return;
    if (own && Number(data.damage) > 0 && !data.miss && !data.evade && !data.avoid) {
      const current = frame(at), skill = data.source || data.skill || 'attack';
      const damage = current.damage.find(entry => entry.monster === monster.mtype && entry.skill === skill);
      if (damage) { damage.amount += Number(data.damage); damage.hits++; }
      else if (current.damage.length < 128) current.damage.push({ monster: monster.mtype, skill, amount: Number(data.damage), hits: 1 });
      else current.partial = true;
    }
    if (!(data.kill || data.dead) || (!own && !context.party.includes(actor))) return;
    observedDeaths.set(monster.mtype, at);
    const id = JSON.stringify([context.server, context.map, context.instance, String(monster.id), data.pid || 'death']);
    if (!remember(id, at)) return;
    const current = frame(at);
    if (current.kills.length < 256) current.kills.push({ id, at, monster: monster.mtype, actor });
    else current.partial = true;
  }
  // Native kill_credit has no encounter ID in the installed client contract.
  // Retain character credits separately rather than guessing a party death ID.
  function credit(data: Pick<MonsterEntity, 'mtype'>) {
    if (!ports.current()) return;
    const at = ports.now(), current = frame(at), entry = current.credits.find(value => value.monster === data.mtype);
    if (entry) entry.count++;
    else if (current.credits.length < 128) current.credits.push({ monster: data.mtype, count: 1 });
    else current.partial = true;
  }
  function loot(data: LootOutcome) {
    if (!ports.current() || 'gone' in data) return;
    const at = ports.now(), context = ports.context(), current = frame(at);
    // Native chest outcomes name the recipient. Inventory diffs cannot distinguish
    // transfers, simultaneous chests, banking, purchases, or production.
    data.items.forEach((item, index) => {
      if (item.looter !== ports.name()) return;
      const id = JSON.stringify([context.server, context.map, context.instance, data.id, index, item.looter]);
      if (!remember(id, at)) return;
      const variant = JSON.stringify({ level: item.level || 0, ...itemProperties(item) });
      if (current.loot.length < 256) current.loot.push({ id, at, item: item.name, variant, quantity: item.q || 1 });
      else current.partial = true;
    });
  }
  // The coordinator answers before its commit writes a frame (docs/efficiency.md,
  // Metrics history). A frame stays in the outbox until an answer from the
  // process that accepted it names a durableCommit at or above the commit that
  // took the frame. flush sends each frame once and, while accepted frames wait,
  // an empty batch that reads durableCommit. An answer from another process
  // (commitEpoch) means a restart may have lost the waiting frames, so flush
  // sends them again; the coordinator ignores a frame it already holds by its
  // receipt.
  async function flush() {
    if (busy || !journal.queue.length || !ports.current() || !ports.connected()) return;
    busy = true;
    const due = journal.queue.filter(next => !acceptedIn.has(next.sequence));
    const server = (due[0] || journal.queue[0]).server;
    const frames: Frame[] = [];
    for (const next of due) { if (next.server !== server || frames.length >= 6) break; frames.push(next); }
    try {
      const result = await ports.send({ character: ports.name(), server, runtime: journal.runtime, frames });
      if (!ports.current()) return;
      if (result && typeof result === 'object' && 'expired' in result && typeof result.expired === 'number' && result.expired > 0) journal.lost = true;
      const durable = result && typeof result === 'object' && 'commitEpoch' in result && typeof result.commitEpoch === 'string' &&
        'commit' in result && typeof result.commit === 'number' && 'durableCommit' in result && typeof result.durableCommit === 'number'
        ? { epoch: result.commitEpoch, commit: result.commit, through: result.durableCommit } : undefined;
      const before = journal.queue.length;
      if (!durable) {
        // A coordinator built before commitEpoch wrote each frame before it answered.
        journal.queue.splice(0, journal.queue.length, ...journal.queue.filter(next => !frames.includes(next)));
      } else {
        if (durable.epoch !== coordinatorEpoch) acceptedIn.clear();
        coordinatorEpoch = durable.epoch;
        for (const next of frames) acceptedIn.set(next.sequence, durable.commit);
        journal.queue.splice(0, journal.queue.length, ...journal.queue.filter(next => {
          const commit = acceptedIn.get(next.sequence);
          return commit === undefined || commit > durable.through;
        }));
      }
      for (const sequence of acceptedIn.keys()) if (!journal.queue.some(next => next.sequence === sequence)) acceptedIn.delete(sequence);
      if (journal.queue.length !== before) persist();
    } catch { /* Original frames remain journaled and go out again on the next pulse. */ }
    finally { busy = false; }
  }
  function pulse() {
    if (!ports.current()) { clearInterval(timer); return; }
    const at = ports.now(), server = ports.context().server;
    if (!ports.connected()) { seal(); connectedSince = null; previousAt = at; previousServer = ''; return; }
    connectedSince ??= at;
    // Attribute observed elapsed time to its original server and bucket. Long
    // suspension/disconnect intervals remain gaps rather than invented inactivity.
    if (at >= previousAt && at - previousAt <= 2500 && server === previousServer) {
      const end = Math.floor(previousAt / METRIC_BUCKET_MS) * METRIC_BUCKET_MS + METRIC_BUCKET_MS;
      const old = frame(previousAt);
      old.observedMs += Math.min(at, end) - previousAt;
      old.last = sample(Math.min(at, end));
      if (at > end) {
        const next = frame(at);
        next.observedMs += at - end;
        next.last = sample(at);
      }
    } else {
      seal();
      frame(at).partial = true;
    }
    previousAt = at; previousServer = server;
    // Seal each pulse so live kills and damage can be delivered every second.
    // Frame identities remain immutable across retries.
    if (active) seal();
    void flush();
  }
  const timer = setInterval(pulse, 1000);
  function consumable(cost:number, purchase=false) {
    if (!ports.current() || !metricNumber(cost)) return;
    // Establish a pre-action cumulative baseline even if the action falls between pulses.
    frame(ports.now());
    journal[purchase?'consumablePurchases':'consumableCost']+=cost;
    persist();
  }
  return { hit, loot, credit, goldMovement, consumable };
}
function itemProperties(item: Partial<Pick<ItemInfo, 'p' | 'stat_type'>>) {
  return { ...(item.p ? { p: item.p } : {}), ...(item.stat_type ? { stat_type: item.stat_type } : {}) };
}
Object.assign(globalThis, { installPartyMetrics, partyMetricsEncouragementLuck: encouragementLuck });
