// The status owner's character telemetry:
// what the character records of the
// game for the dashboard and posts beside its report. It decides nothing in the game. createTelemetry's
// socket listeners and intervals register through the status owner's run scope handle as `observe`;
// the host pieces the lifecycle owner's host and loader install (the game log panel's DOM handlers, the add_log and
// phrase.message echo, the set_texture and tint_logic rendering guards) replace their own last
// install instead. It holds:
// - the fast telemetry under the dashboard's viewer lease, and the map frames with their projectiles
//   and native sprite cells;
// - the combat log lines (skills, kill credits, loot, potions and items, deaths) and their queue;
// - the metrics collector and its caracAL outbox;
// - the fight packet record the report carries, and the character's last death;
// - the game host's pieces: the game log capture and its stdout echo, the headless rendering guards,
//   and movement's planning schedule counters.
// shared.js builds `createTelemetry` once at load; the lifecycle owner's runner host and lifecycle bundle install the
// host pieces before CODE runs.
import type { CharacterEntity, Entity, GAnimation, ItemInfo, MonsterEntity, ServerToClient_chest_opened, ServerToClient_chest_opened_loot, ServerToClient_game_log, ServerToClient_hit } from 'typed-adventureland';
import type { ServerToClient_action_base } from 'typed-adventureland/dist/src/socket-events/server-to-client/events/ServerToClient_action.js';
import type { MapProjectile, MapSpriteLayer, MapVisual } from '../../map-sprites.ts';
import type { DeathRecord, MetricBatch, MetricFrame, MetricSample } from '../api.ts';
import { HISTORY_KEPT_MS, METRIC_BUCKET_MS, METRIC_OUTBOX_PREFIX, SECRET_TEXT, STATUS_PICKS, encouragementLuck, metricNumber, parseMetricFrame } from '../rules.ts';
import { CREDIT_COVERAGE_MS, DIAGNOSTIC_TEXT_CHARS, FIGHT_PACKETS, METRIC_SEEN_MS, MISSING_FRAMES_REPORTED, STATUS_FAILURES_KEPT, GAME_LOG_BATCH, COMBAT_LOG_BATCH,
  STATUS_FAILURE_CHARS, STATUS_STACK_CHARS, TEXTURE_URL_CHARS, METRICS_POST_MS, TELEMETRY_POST_MS } from '../rules.ts';
import { boundFired, capReached } from './bounds.ts';
import { CHARACTER_PICKS, scope } from '../../lifecycle/api.ts';
import { partyHooks } from '../../hooks/index.ts';
import { fresh } from '../../protocol/reports.ts';
import { MARKER_ROLES, markerRadius } from './marker-style.ts';
import { classifyGameLog, defaultLogFilters, logFilters, showGameLog, type GameLog } from '../game-log.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the game's character, G and socket packets are read as the client gives them */
type Game = any;
// What shared.js's `request` attaches to a request it rejects: the failure's kind and HTTP status.
const failedRequest = (error: Game): { kind?: string; status?: number } => error?.partyRequest || {};
const picks = STATUS_PICKS;
// The lifecycle owner's report period: the metrics frames and the queues ride each report.
const reportMs = () => CHARACTER_PICKS.lifecycleReportMs;

export interface TelemetryPorts {
  /** The game's character, G, the game window and the shared root. */
  me(): Game; G(): Game; parent(): Game; root(): Game;
  /** The movement owner's walk clock, the coordinator's time, and this runtime's id. */
  now(): number; runtime(): string;
  /** The lifecycle owner's run: whether this runner still runs, and its coordinator request. */
  current(): boolean;
  request(path: string, options: { method?: string; body?: unknown; timeout?: number }): Promise<unknown>;
  /** The game's own reads. */
  entity(id: string): Game; player(name: string): Game;
  /** The tasks owner's game party list. */
  party(): string[];
  /** The status owner's report: the sprite cells, the doll markup and the active conditions. */
  report: { sprite(skin: string): unknown; mapDollHtml(entity: Game, direction: unknown): unknown; activeConditions(): unknown };
  /** The items owner's bag reads. */
  items: { fingerprint(item: Game): unknown; itemDefinition(item: Game): unknown; inventoryOperationEntry(item: Game, slot: number): unknown;
    inventoryTotals(): Record<string, number>; safeItemDefinition(data: unknown): unknown };
  /** What a map frame names: the hunting owner's Cave floor and grouped farming, the targeting owner's target and queue, the events owner's event fight. */
  map: { definition(): unknown; definitionNeeded(map: string): void; selected(): unknown; markers(): unknown;
    grouped(): boolean; eventCombat(): boolean };
  /** The last death's trip: the hunting owner's Hunt trip and the events owner's joined event. */
  death: { huntTrip(): Game; joinedEvent(): string | null | undefined };
  /** The movement owner's party walk the character is on, which a status failure names. */
  walk(): { id?: unknown; phase?: unknown; epoch?: unknown } | null | undefined;
  /** The game's own log line. */
  log(message: string, color: string): void;
}

// A status failure's text with every URL query, bearer and secret (rules.ts
// `SECRET_TEXT`) redacted, bounded for the game log line and the combat log entry. A cut counts
// under its cap's name.
const TEXT_CAPS = { DIAGNOSTIC_TEXT_CHARS, STATUS_STACK_CHARS };
export function diagnosticText(value: unknown, cap: keyof typeof TEXT_CAPS = 'DIAGNOSTIC_TEXT_CHARS'): string {
  const text = String(value == null ? '' : value)
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/gi, '$1?[redacted]')
    .replace(/\b(Bearer)\s+\S+/gi, '$1 [redacted]')
    .replace(SECRET_TEXT, '$1=[redacted]');
  if (text.length > TEXT_CAPS[cap]) capReached(cap, '12');
  return text.slice(0, TEXT_CAPS[cap]);
}

// ---------------------------------------------------------------------------------------------------
// The fast telemetry: one request in flight, one newest pending sample, and no sampling
// outside the viewer lease. The lease holds from a reply that says a dashboard watches until a reply
// says none does, the telemetry route answers `accepted: false`, or a post fails (the coordinator
// did not answer); the next reply that says one watches starts it again.
type Values = Record<string, unknown>;
export interface DashboardSample { vitals: Values; items: Values; slots: Values }
interface Lease { epoch: string; generation: string; watched: boolean }
interface SamplerPorts {
  now(): number; current(): boolean; name(): string; runtime(): string; sample(): DashboardSample;
  entry(value: unknown, slot: string, equipment: boolean): unknown; send(body: Values): Promise<unknown>;
}
function changes(before: Values, after: Values, entry?: (value: unknown, slot: string) => unknown) {
  const result: Values = {};
  for (const slot of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[slot]) !== JSON.stringify(after[slot]))
      result[slot] = after[slot] == null ? null : entry ? entry(after[slot], slot) : after[slot];
  }
  return result;
}
export function createDashboardSampler(ports: SamplerPorts) {
  let lease: Lease | undefined, watched = false, sequence = 0, busy = false;
  let confirmed: DashboardSample = { vitals: {}, items: {}, slots: {} };
  let pending: { data: DashboardSample } | undefined;
  function renew(value?: Lease) {
    if (!value?.generation || !value.watched) { watched = false; pending = undefined; return; }
    if (lease?.generation !== value.generation || lease?.epoch !== value.epoch) {
      confirmed = { vitals: {}, items: {}, slots: {} };
      sequence = 0;
    }
    lease = value;
    watched = true;
  }
  const sameLease = (sent: Lease) => lease?.generation === sent.generation && lease?.epoch === sent.epoch;
  async function flush() {
    if (busy || !pending || !lease || !ports.current() || !watched) return;
    const next = pending, sentLease = lease;
    pending = undefined;
    const data = {
      vitals: changes(confirmed.vitals, next.data.vitals),
      items: changes(confirmed.items, next.data.items, (value, slot) => ports.entry(value, slot, false)),
      slots: changes(confirmed.slots, next.data.slots, (value, slot) => ports.entry(value, slot, true)),
    };
    if (!Object.values(data).some(value => Object.keys(value).length)) return;
    busy = true;
    try {
      const answer = await ports.send({ name: ports.name(), runtime: ports.runtime(), epoch: sentLease.epoch, generation: sentLease.generation,
        sample: ++sequence, data }) as { accepted?: boolean } | undefined;
      if (answer?.accepted === false) watched = false;
      else if (sameLease(sentLease)) confirmed = next.data;
    } catch {
      // The coordinator did not answer; the next reply that says a dashboard watches resumes.
      watched = false;
    } finally {
      busy = false;
    }
    if (pending) void flush();
  }
  function pulse() {
    if (!ports.current() || !watched) { pending = undefined; return; }
    // Detach mutable game objects before retaining an in-flight or pending observation.
    pending = { data: JSON.parse(JSON.stringify(ports.sample())) as DashboardSample };
    void flush();
  }
  return { renew, pulse };
}

// ---------------------------------------------------------------------------------------------------
// The map's native sprite cells: copy the current native cells, never extract pixels or
// serialize renderer graphs. Weak texture caches bound repeated work, and the game's display tree
// bounds the walk.
// Pixi texture and scene descriptors are renderer internals absent from typed-adventureland.
interface Vector { x: number; y: number }
interface Texture {
  frame?: { x: number; y: number; width: number; height: number };
  orig?: { width: number; height: number };
  trim?: { x: number; y: number };
  rotate?: number;
  baseTexture?: {
    width?: number; height?: number;
    imageUrl?: string;
    resource?: { url?: string; source?: { src?: string; currentSrc?: string } };
    source?: { src?: string; currentSrc?: string };
  };
}
export interface NativeMapSprite {
  texture?: Texture; children?: NativeMapSprite[]; position?: Vector; x?: number; y?: number; real_x?: number; real_y?: number;
  scale?: Vector; pivot?: Vector; skew?: Vector; rotation?: number; anchor?: Vector; alpha?: number; tint?: number;
  visible?: boolean; renderable?: boolean; _destroyed?: boolean; to_delete?: boolean; atype?: string;
}
type Matrix = MapSpriteLayer['transform'];
const textureCache = new WeakMap<Texture, { key: string; value: Pick<MapSpriteLayer, 'url' | 'sx' | 'sy' | 'sw' | 'sh' | 'dx' | 'dy'> }>();
const baseUrls = new WeakMap<NonNullable<Texture['baseTexture']>, string>();
function textureCell(texture: Texture, anchor: Vector) {
  const frame = texture.frame, base = texture.baseTexture;
  if (!frame || !base || ![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) || frame.x < 0 || frame.y < 0 ||
      texture.rotate || frame.width <= 0 || frame.height <= 0 ||
      // A cell lies inside its atlas, which bounds its size.
      frame.x + frame.width > Number(base.width ?? Infinity) || frame.y + frame.height > Number(base.height ?? Infinity)) return null;
  let url = baseUrls.get(base);
  if (!url) {
    url = base.resource?.url || base.resource?.source?.currentSrc || base.resource?.source?.src || base.source?.currentSrc ||
      base.source?.src || base.imageUrl;
    if (url && url.length > TEXTURE_URL_CHARS) capReached('TEXTURE_URL_CHARS', '12');
    if (!url || url.length > TEXTURE_URL_CHARS) return null;
    if (url.startsWith('/')) url = 'https://adventure.land' + url;
    if (!/^(https?:\/\/|data:image\/)/.test(url)) return null;
    baseUrls.set(base, url);
  }
  const orig = texture.orig || frame, trim = texture.trim,
    key = [frame.x, frame.y, frame.width, frame.height, orig.width, orig.height, trim?.x, trim?.y, anchor.x, anchor.y].join(':');
  const cached = textureCache.get(texture);
  if (cached?.key === key) return cached.value;
  const value = { url, sx: frame.x, sy: frame.y, sw: frame.width, sh: frame.height,
    dx: (trim?.x || 0) - anchor.x * orig.width, dy: (trim?.y || 0) - anchor.y * orig.height };
  textureCache.set(texture, { key, value });
  return value;
}
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}
function local(node: NativeMapSprite, root: boolean): Matrix {
  const rotation = node.rotation || 0, scale = node.scale || { x: 1, y: 1 }, skew = node.skew || { x: 0, y: 0 },
    pivot = node.pivot || { x: 0, y: 0 },
    a = Math.cos(rotation + skew.y) * scale.x, b = Math.sin(rotation + skew.y) * scale.x,
    c = -Math.sin(rotation - skew.x) * scale.y, d = Math.cos(rotation - skew.x) * scale.y;
  return [a, b, c, d, (root ? 0 : (node.position?.x ?? node.x ?? 0)) - pivot.x * a - pivot.y * c,
    (root ? 0 : (node.position?.y ?? node.y ?? 0)) - pivot.x * b - pivot.y * d];
}
export function captureNativeLayers(sprite: NativeMapSprite): MapSpriteLayer[] {
  const layers: MapSpriteLayer[] = [];
  // The walk ends at the sprite tree's own leaves: the game's display tree bounds the layers.
  function visit(node: NativeMapSprite, transform: Matrix, alpha: number, root = false) {
    if (!node || node.visible === false || node.renderable === false || node._destroyed || node.to_delete) return;
    const opacity = alpha * (node.alpha ?? 1);
    if (!Number.isFinite(opacity) || opacity <= 0) return;
    const matrix = multiply(transform, local(node, root));
    if (!matrix.every(Number.isFinite)) return;
    const cell = node.texture && textureCell(node.texture, node.anchor || { x: 0, y: 0 });
    if (cell) layers.push({ ...cell, transform: matrix, alpha: Math.min(1, opacity),
      tint: Number.isFinite(node.tint) ? Math.max(0, Math.min(0xffffff, node.tint!)) : 0xffffff });
    for (const child of node.children || []) visit(child, matrix, opacity);
  }
  visit(sprite, [1, 0, 0, 1, 0, 0], 1, true);
  return layers;
}
// The game's own map animations bound the visuals: each live one is captured whole.
export function captureMapVisuals(animations: Record<string, NativeMapSprite>): MapVisual[] {
  return Object.entries(animations).flatMap(([id, sprite]) => {
    if (!sprite || sprite.to_delete || sprite._destroyed || !['map', 'cmap', 'wmap'].includes(sprite.atype || '')) return [];
    const layers = captureNativeLayers(sprite);
    return layers.length ? [{ id, x: Number(sprite.real_x ?? sprite.position?.x ?? sprite.x) || 0,
      y: Number(sprite.real_y ?? sprite.position?.y ?? sprite.y) || 0, layers }] : [];
  });
}

// A headless client's projectile. Upstream action declarations omit native origin_offset;
// the caller resolves it through native projectile_origin before this projection. A ray lives
// `mapRayMs`, the game's ray animation length, since its action carries no eta of its own.
export function projectHeadlessAction(
  action: Pick<ServerToClient_action_base, 'pid' | 'eta'>, origin: Vector, target: Vector,
  animation: Partial<Pick<GAnimation, 'file' | 'frames' | 'framefps' | 'scale' | 'directional'>>, now = Date.now(), ray = false,
): MapProjectile | null {
  // The pid, eta and animation are the game's own: the action packet and G.animations bound them.
  if (typeof action.pid !== 'string' || !action.pid || !Number.isFinite(action.eta) ||
      (!ray && action.eta <= 0) || !animation.file || !Number.isFinite(animation.frames) ||
      animation.frames! < 1 || ![origin.x, origin.y, target.x, target.y].every(Number.isFinite)) return null;
  const url = animation.file.startsWith('/') ? 'https://adventure.land' + animation.file : animation.file;
  if (!/^https?:\/\//.test(url)) return null;
  return { ray, id: action.pid, url, frames: Math.floor(animation.frames!), frameMillis: Math.max(1, animation.framefps || 15),
    scale: ray ? 1 : animation.scale || 1, directional: !!animation.directional,
    startedAt: now, expiresAt: now + (ray ? picks.mapRayMs : action.eta),
    x: origin.x, y: origin.y, targetX: target.x, targetY: target.y };
}

// A metrics sample's ping. The game's `start` handler resets its ping list to the login handshake
// alone (game.js `pings = [character.ping]`), which is not steady-state latency, so the character's
// ping counts once the game has added a measured round trip to that list.
export function steadyPing(ping: unknown, pings: unknown): number | null {
  const measured = Array.isArray(pings) && pings.length > 1;
  return measured && typeof ping === 'number' && isFinite(ping) && ping >= 0 ? ping : null;
}

// ---------------------------------------------------------------------------------------------------
// The metrics collector (DSH-200s, docs/metrics.md): one per CODE generation. Retries keep their
// original bucket and sequence. It seals a frame on each of the lifecycle owner's reports, so live kills and damage
// reach the coordinator once per report period.
interface MetricPorts {
  now(): number; current(): boolean; connected(): boolean; name(): string; own(actor: string): boolean;
  ownedCharacter(name: string): boolean;
  context(): { server: string; map: string; instance: string; party: string[] };
  sample(): Omit<MetricSample, 'at'>;
  send(batch: MetricBatch): Promise<unknown>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
}
type Frame = MetricFrame & { server: string };
interface Journal { runtime: string; sequence: number; queue: Frame[]; lost: boolean; goldMovement: number; consumableCost: number; consumablePurchases: number }
// Upstream hit declarations omit `dead` and `actor`, seen in native AoE packets.
type Hit = Omit<ServerToClient_hit, 'source'> & { source?: string; dead?: boolean; actor?: string; skill?: string; mtype?: string };
// Native cache_item preserves properties omitted by upstream chest item types.
type LootReward = Omit<ServerToClient_chest_opened_loot, 'items'> & {
  items: Array<ServerToClient_chest_opened_loot['items'][number] & Partial<Pick<ItemInfo, 'p' | 'stat_type'>>>;
};
type LootOutcome = LootReward | Extract<ServerToClient_chest_opened, { gone: true }>;
type Target = Pick<Entity, 'id' | 'mtype' | 'type'>;
type MonsterTarget = Pick<MonsterEntity, 'id' | 'mtype' | 'type'>;
const isMonsterTarget = (target: Target | null | undefined): target is MonsterTarget =>
  !!target && target.type === 'monster' && typeof target.mtype === 'string' && target.mtype.length > 0;
const itemProperties = (item: Partial<Pick<ItemInfo, 'p' | 'stat_type'>>) =>
  ({ ...(item.p ? { p: item.p } : {}), ...(item.stat_type ? { stat_type: item.stat_type } : {}) });

export function installPartyMetrics(ports: MetricPorts) {
  const key = METRIC_OUTBOX_PREFIX + ports.name();
  const persistedFrames = new Set<number>();
  const framePrefix = key + ':frame:', frameKey = (sequence: number) => framePrefix + sequence;
  // The game's local_cm_logic walks every localStorage key every 16 ms, so the outbox keeps a frame's
  // key only while the queue holds the frame. persist() removes the keys of frames that left the
  // queue (confirmed, or older than the history keeps) after it writes the header. The queue drains
  // on each report the coordinator confirms, so an outage alone grows it.
  function removeReleased(released: Iterable<number>) {
    const retained = new Set(journal.queue.map(frame => frameKey(frame.sequence)));
    for (const sequence of released) if (!retained.has(frameKey(sequence))) ports.storage.removeItem(frameKey(sequence));
  }
  // At install, removeStale removes every frame key the restored header does not list: 1.5 kept
  // confirmed frames in a ring of 1,024 keys, and restore never adopts a frame whose header write a
  // crash cut off.
  function removeStale() {
    const retained = new Set(journal.queue.map(frame => frameKey(frame.sequence))), stale: string[] = [];
    for (let index = 0; index < ports.storage.length; index++) {
      const name = ports.storage.key(index);
      if (name?.startsWith(framePrefix) && !retained.has(name)) stale.push(name);
    }
    for (const name of stale) ports.storage.removeItem(name);
  }
  // A frame older than the history keeps would expire on arrival, so the outbox drops it.
  function expire(at: number) {
    const kept = journal.queue.findIndex(frame => at - frame.at <= HISTORY_KEPT_MS);
    const dropped = kept < 0 ? journal.queue.length : kept;
    if (!dropped) return;
    journal.queue.splice(0, dropped);
    journal.lost = true;
  }
  const journal: Journal = { runtime: Date.now() + '-' + Math.random().toString(36).slice(2), sequence: 0, queue: [], lost: false,
    goldMovement: 0, consumableCost: 0, consumablePurchases: 0 };
  // Restored data crosses a storage boundary. Accept only our bounded versioned envelope; the
  // coordinator performs full frame validation before accepting measurements.
  try {
    const saved: unknown = JSON.parse(ports.storage.getItem(key) || 'null');
    if (saved && typeof saved === 'object' && 'runtime' in saved && typeof saved.runtime === 'string' &&
        'sequence' in saved && typeof saved.sequence === 'number' && 'queue' in saved && Array.isArray(saved.queue)) {
      journal.runtime = saved.runtime;
      journal.sequence = saved.sequence;
      if ('goldMovement' in saved && metricNumber(saved.goldMovement, -Number.MAX_SAFE_INTEGER)) journal.goldMovement = saved.goldMovement;
      if ('consumableCost' in saved && metricNumber(saved.consumableCost)) journal.consumableCost = saved.consumableCost;
      if ('consumablePurchases' in saved && metricNumber(saved.consumablePurchases)) journal.consumablePurchases = saved.consumablePurchases;
      for (const entry of saved.queue) {
        const value: unknown = typeof entry === 'number' ? JSON.parse(ports.storage.getItem(frameKey(entry)) || 'null') : entry;
        const parsed = parseMetricFrame(value);
        // Never adopt a mismatched sequence after an interrupted header write.
        if (typeof entry === 'number' && parsed?.sequence !== entry) { journal.lost = true; continue; }
        if (typeof entry === 'number' && parsed) persistedFrames.add(entry);
        if (parsed && value && typeof value === 'object' && 'server' in value && typeof value.server === 'string')
          journal.queue.push({ ...parsed, server: value.server });
        else journal.lost = true;
      }
      journal.lost ||= 'lost' in saved && saved.lost === true;
      expire(ports.now());
    }
  } catch { journal.lost = true; }
  try { removeStale(); } catch { /* The next confirmation removes its own keys. */ }
  let active: Frame | undefined, busy = false, previousAt = ports.now(), previousServer = ports.context().server;
  // The coordinator commit that will write each accepted frame, by sequence. Not persisted: a reload
  // sends every queued frame again.
  const acceptedIn = new Map<number, number>();
  let coordinatorEpoch: string | undefined;
  const seen = new Map<string, number>();
  const targets = new Map<string, { target: MonsterTarget; at: number; context: string }>();
  const observedDeaths = new Map<string, number>();
  // Each write prunes. Both maps hold their entries oldest first (a target moves to the end when seen
  // again), so a prune stops at the first entry still inside METRIC_SEEN_MS and costs only the
  // entries it drops. Each dropped entry counts under METRIC_SEEN_MS.
  function prune(at: number) {
    let dropped = 0;
    for (const [id, time] of seen) { if (at - time <= METRIC_SEEN_MS) break; seen.delete(id); dropped++; }
    for (const [id, value] of targets) { if (at - value.at <= METRIC_SEEN_MS) break; targets.delete(id); dropped++; }
    if (dropped) capReached('METRIC_SEEN_MS', '12', dropped);
  }
  function remember(id: string, at: number) {
    prune(at);
    if (seen.has(id)) return false;
    seen.set(id, at);
    return true;
  }
  function sample(at: number): MetricSample {
    const value = ports.sample();
    return { ...value, at,
      goldMovement: journal.goldMovement, consumableCost: journal.consumableCost, consumablePurchases: journal.consumablePurchases };
  }
  function persist() {
    try {
      // Frames are immutable after sealing. Each is written once under its own sequence key, then
      // its sequence goes in the small journal header, so a growing outage never reserializes the
      // older damage and loot frames on every pulse.
      for (const frame of journal.queue) if (!persistedFrames.has(frame.sequence)) {
        ports.storage.setItem(frameKey(frame.sequence), JSON.stringify(frame));
        persistedFrames.add(frame.sequence);
      }
      ports.storage.setItem(key, JSON.stringify({ ...journal, queue: journal.queue.map(frame => frame.sequence) }));
      const retained = new Set(journal.queue.map(frame => frame.sequence));
      const released = [...persistedFrames].filter(sequence => !retained.has(sequence));
      for (const sequence of released) persistedFrames.delete(sequence);
      removeReleased(released);
    } catch { journal.lost = true; }
  }
  function seal() {
    const sealed = active;
    if (!sealed) return;
    // Resolve credit coverage when sealing, after native hit and credit callbacks have had a chance
    // to arrive in either order.
    // A credit with no observed death inside CREDIT_COVERAGE_MS marks the frame partial and fires the
    // bound, since the game sent the credit without the death's hit reaching this window.
    const uncovered = sealed.credits.find(credit => (observedDeaths.get(credit.monster) || 0) < sealed.first.at - CREDIT_COVERAGE_MS);
    if (uncovered) {
      sealed.partial = true;
      boundFired({ bound: 'CREDIT_COVERAGE_MS', owner: '12', state: { monster: uncovered.monster, frame: sealed.sequence, ms: CREDIT_COVERAGE_MS } });
    }
    journal.queue.push(sealed);
    active = undefined;
    expire(ports.now());
    persist();
  }
  function goldMovement(data: unknown) {
    // Native bank gold replies are absent from the upstream response union. Parse the raw socket
    // boundary without widening the game's declared types.
    if (!ports.current() || !data || typeof data !== 'object' || !('response' in data) || !('gold' in data) ||
        !metricNumber(data.gold) || 'failed' in data && data.failed) return;
    const response = data.response;
    const transfer = response === 'gold_sent' || response === 'gold_received';
    const bank = response === 'bank_store' || response === 'bank_withdraw';
    if (!transfer && !bank) return;
    // The native response names the other character. External gifts and payments remain real income
    // and expenses; moving gold within this account does not.
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
    const at = ports.now(), context = ports.context(), place = JSON.stringify([context.server, context.map, context.instance]);
    prune(at);
    if (isMonsterTarget(target)) {
      targets.delete(String(target.id));
      targets.set(String(target.id), { target: { id: target.id, type: target.type, mtype: target.mtype }, at, context: place });
    }
    const remembered = targets.get(String(data.id));
    const monster = isMonsterTarget(target) ? target : remembered?.context === place ? remembered.target : null;
    if (!monster) return;
    const rawActor = String(data.hid || data.actor || ''), own = ports.own(rawActor), actor = own ? ports.name() : rawActor;
    if (data.pid && !remember(JSON.stringify(['hit', place, data.pid, data.id, actor]), at)) return;
    if (own && Number(data.damage) > 0 && !data.miss && !data.evade && !data.avoid) {
      const current = frame(at), skill = data.source || data.skill || 'attack';
      const damage = current.damage.find(entry => entry.monster === monster.mtype && entry.skill === skill);
      if (damage) { damage.amount += Number(data.damage); damage.hits++; }
      else current.damage.push({ monster: monster.mtype, skill, amount: Number(data.damage), hits: 1 });
    }
    if (!(data.kill || data.dead) || (!own && !context.party.includes(actor))) return;
    observedDeaths.set(monster.mtype, at);
    const id = JSON.stringify([context.server, context.map, context.instance, String(monster.id), data.pid || 'death']);
    if (!remember(id, at)) return;
    const current = frame(at);
    current.kills.push({ id, at, monster: monster.mtype, actor });
  }
  // Native kill_credit has no encounter ID in the installed client contract, so the frame keeps the
  // character's credits in their own list, apart from the party's deaths.
  function credit(data: Pick<MonsterEntity, 'mtype'>) {
    if (!ports.current()) return;
    const at = ports.now(), current = frame(at), entry = current.credits.find(value => value.monster === data.mtype);
    if (entry) entry.count++;
    else current.credits.push({ monster: data.mtype, count: 1 });
  }
  function loot(data: LootOutcome) {
    if (!ports.current() || 'gone' in data) return;
    const at = ports.now(), context = ports.context(), current = frame(at);
    // Native chest outcomes name the recipient. Inventory diffs cannot distinguish transfers,
    // simultaneous chests, banking, purchases, or production.
    data.items.forEach((item, index) => {
      if (item.looter !== ports.name()) return;
      const id = JSON.stringify([context.server, context.map, context.instance, data.id, index, item.looter]);
      if (!remember(id, at)) return;
      const variant = JSON.stringify({ level: item.level || 0, ...itemProperties(item) });
      current.loot.push({ id, at, item: item.name, variant, quantity: item.q || 1 });
    });
  }
  // The coordinator answers before its commit writes a frame (docs/efficiency.md, Metrics history).
  // A frame stays in the outbox until an answer from the process that accepted it names a
  // durableCommit at or above the commit that took the frame. flush sends each due frame of one
  // server once and, while accepted frames wait, an empty batch that reads durableCommit. An answer
  // from another process (commitEpoch) means a restart may have lost the waiting frames, so flush
  // sends them again; the coordinator ignores a frame it already holds by its receipt. While the
  // last answer was 503 (the metrics storage is out or a reset runs, http.ts `closed`), flush sends
  // the empty batch alone, and the frames go again once it is answered.
  let closed = false;
  async function flush() {
    if (busy || !journal.queue.length || !ports.current() || !ports.connected()) return;
    busy = true;
    const due = journal.queue.filter(next => !acceptedIn.has(next.sequence));
    const server = (due[0] || journal.queue[0]).server;
    const frames = closed ? [] : due.filter(next => next.server === server);
    try {
      const result = await ports.send({ character: ports.name(), server, runtime: journal.runtime, frames });
      closed = false;
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
    } catch (error) {
      // The frames stay journaled and go out again on a later report.
      closed = failedRequest(error).status === 503;
    }
    finally { busy = false; }
  }
  // One pulse per report. Elapsed time counts toward its original server and bucket while the
  // reports keep coming. A gap of a skipped report period or more (a suspended frame, a disconnect)
  // stays a gap in the frames.
  function pulse() {
    if (!ports.current()) return;
    const at = ports.now(), server = ports.context().server;
    if (!ports.connected()) { seal(); previousAt = at; previousServer = ''; return; }
    if (at >= previousAt && at - previousAt <= 2 * reportMs() && server === previousServer) {
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
    // Seal each pulse so live kills and damage reach the coordinator every report. Frame identities
    // remain immutable across retries.
    if (active) seal();
    void flush();
  }
  function consumable(cost: number, purchase = false) {
    if (!ports.current() || !metricNumber(cost)) return;
    // Establish a pre-action cumulative baseline even if the action falls between pulses.
    frame(ports.now());
    journal[purchase ? 'consumablePurchases' : 'consumableCost'] += cost;
    persist();
  }
  return { hit, loot, credit, goldMovement, consumable, pulse };
}

// ---------------------------------------------------------------------------------------------------
// The game log capture (DSH-090s): each add_log line queues for the coordinator, filtered in the
// native log by the player's filter buttons, with a resize handle.
interface LogHost {
  caracAL?: { install_game_logs?: (send: Capture['send']) => ReturnType<typeof installHostGameLogs> };
  add_log?: (message: unknown, color?: string) => unknown;
  document?: Document;
  localStorage?: Storage;
  __partyGameLogCapture?: Capture;
}
interface Capture { original: NonNullable<LogHost['add_log']>; wrapped: NonNullable<LogHost['add_log']>; queue: GameLog[]; seq: number; session: string;
  send: (events: GameLog[]) => Promise<unknown>; busy: boolean; filters: Record<string, boolean> }
export function installGameLogs(host: LogHost, send: Capture['send']) {
  // caracAL exposes guarded, dynamically resolved methods to CODE. Installing an override through
  // that facade would make the saved add_log call itself.
  if (host.caracAL?.install_game_logs) return host.caracAL.install_game_logs(send);
  return installHostGameLogs(host, send);
}
export function installHostGameLogs(host: LogHost, send: Capture['send']) {
  let capture = host.__partyGameLogCapture;
  if (!host.add_log) return null;
  let filters = { ...defaultLogFilters };
  try { filters = { ...filters, ...JSON.parse(host.localStorage?.getItem('party-game-log-filters') || '{}') }; } catch { /* Defaults. */ }
  capture ??= { original: host.add_log, wrapped: host.add_log, queue: [], seq: 0, session: Date.now() + '-' + Math.random().toString(36).slice(2), send, busy: false, filters };
  capture.send = send;
  capture.filters = { ...defaultLogFilters, ...capture.filters };
  const state = capture;
  function filterDOM() {
    host.document?.querySelectorAll<HTMLElement>('#gamelog .gameentry').forEach(entry => {
      entry.style.display = showGameLog(classifyGameLog(entry.textContent || ''), state.filters) ? '' : 'none';
    });
  }
  state.wrapped = function (message, color) {
    const log = host.document?.getElementById('gamelog');
    const top = log?.scrollTop || 0;
    const following = !log || log.scrollHeight - top - log.clientHeight <= 1;
    const viewportTop = log?.getBoundingClientRect().top || 0;
    const anchor = !following && log
      ? Array.from(log.querySelectorAll<HTMLElement>('.gameentry')).find(element => element.getBoundingClientRect().bottom > viewportTop)
      : undefined;
    const offset = anchor ? anchor.getBoundingClientRect().top - viewportTop : 0;
    const raw = typeof message === 'string' ? message : String(message);
    const text = host.document?.createElement('div'); if (text) text.innerHTML = raw;
    const plain = text?.textContent || raw.replace(/<[^>]*>/g, '');
    // The coordinator keeps a line at `gameLineChars` and the newest `gameLogLines` (coordinator/logs.ts).
    const entry: GameLog = { session: state.session, seq: ++state.seq, at: Date.now(), message: plain.slice(0, picks.gameLineChars),
      color: color || 'white', category: classifyGameLog(plain) };
    state.queue.push(entry);
    if (state.queue.length > picks.gameLogLines) state.queue.splice(0, state.queue.length - picks.gameLogLines);
    const result = state.original.call(host, host.document ? `<span style="color:#94a3b8">${new Date(entry.at).toLocaleTimeString()} | </span>${raw}` : message, color);
    filterDOM();
    // The native renderer scrolls unconditionally. Restore the visible entry after rendering and
    // filtering, including when old entries were trimmed.
    if (log) {
      log.scrollTop = following ? log.scrollHeight : anchor && log.contains(anchor)
        ? log.scrollTop + anchor.getBoundingClientRect().top - log.getBoundingClientRect().top - offset
        : top;
    }
    return result;
  };
  host.add_log = state.wrapped; host.__partyGameLogCapture = state;
  const doc = host.document, log = doc?.getElementById('gamelog');
  if (doc && log) {
    doc.getElementById('party-game-log-filters')?.remove();
    let layout = doc.getElementById('party-game-log-layout');
    if (!layout) { layout = doc.createElement('style'); layout.id = 'party-game-log-layout'; doc.head.appendChild(layout); }
    layout.textContent = `
      #bottomrightcorner { text-align:right; }
      #bottomrightcorner > .xpsui { margin-bottom:0 !important; vertical-align:bottom; }
      #party-game-log-panel { position:relative; max-width:100vw; margin-left:auto; padding-top:0; box-sizing:border-box; }
      #party-game-log-panel #gamelog { width:100% !important; min-width:0; cursor:text; }
      #party-game-log-panel #gamelog, #party-game-log-panel #gamelog * { user-select:text !important; -webkit-user-select:text !important; }
      #party-game-log-resize { position:absolute; left:0; top:0; bottom:0; width:6px; z-index:1; cursor:ew-resize; touch-action:none; background:#475569; border:0; padding:0; }
      #party-game-log-resize:hover, #party-game-log-resize:focus-visible { background:#38bdf8; outline:1px solid white; }
    `;
    // Keep the controls within the native log's footprint. Adding a sibling above it grows the
    // bottom-anchored UI upward into the tutorial and XP controls.
    let panel = doc.getElementById('party-game-log-panel');
    if (!panel) {
      const height = log.getBoundingClientRect().height || parseFloat(doc.defaultView?.getComputedStyle(log).height || '') || 200;
      panel = doc.createElement('div'); panel.id = 'party-game-log-panel';
      panel.style.cssText = `display:grid;grid-template-rows:auto minmax(0,1fr);height:${height}px;min-height:0;overflow:hidden;`;
      // insertBefore places the panel: the dashboard's type check reaches this file through movement's
      // door and types Element.before and prepend as the Cloudflare worker's.
      log.parentNode?.insertBefore(panel, log); panel.appendChild(log);
      log.style.setProperty('height', '100%', 'important');
      log.style.setProperty('min-height', '0', 'important');
      log.style.boxSizing = 'border-box';
    }
    installLogResize(host, doc, panel);
    // Stop the game's mouse and keyboard handlers without cancelling the browser's native
    // selection, context menu, or Ctrl/Cmd+C behavior.
    const stopGameInput = (event: Event) => event.stopPropagation();
    log.onmousedown = log.onpointerdown = log.onclick = log.oncontextmenu = stopGameInput;
    log.onkeydown = log.onkeyup = event => event.stopPropagation();
    log.onselectstart = event => { event.stopPropagation(); return true; };
    log.tabIndex = 0;
    const bar = doc.createElement('div'); bar.id = 'party-game-log-filters'; bar.className = 'enableclicks';
    bar.style.cssText = 'display:flex;flex-wrap:wrap;background:#020617;border:1px solid #64748b;';
    for (const filter of logFilters) {
      const button = doc.createElement('button'); button.textContent = filter.label;
      button.style.cssText = 'flex:1 0 auto;padding:4px;font:12px/20px sans-serif;white-space:nowrap;border:1px solid #475569;background:#0f172a;color:white;cursor:pointer;';
      const update = () => { button.setAttribute('aria-pressed', String(state.filters[filter.id])); button.style.color = state.filters[filter.id] ? '#fff' : '#94a3b8'; };
      update();
      button.onclick = () => {
        state.filters[filter.id] = !state.filters[filter.id];
        try { host.localStorage?.setItem('party-game-log-filters', JSON.stringify(state.filters)); } catch { /* The filter still applies now. */ }
        update(); filterDOM();
      };
      bar.appendChild(button);
    }
    panel.insertBefore(bar, panel.firstChild); filterDOM();
  }
  return { pulse: () => pulseGameLogs(state) };
}
function installLogResize(host: LogHost, doc: Document, panel: HTMLElement) {
  doc.getElementById('party-game-log-resize')?.remove();
  const nativeWidth = () => doc.querySelector('.xpsui')?.getBoundingClientRect().width || doc.querySelector('.tutorialui')?.getBoundingClientRect().width || 330;
  const handle = doc.createElement('div'); handle.id = 'party-game-log-resize'; handle.className = 'enableclicks';
  handle.tabIndex = 0; handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize game logs'); handle.title = 'Drag left to widen logs. Double-click to reset.';
  const setWidth = (width: number) => {
    const maximum = doc.defaultView?.innerWidth || 1920;
    const next = Math.min(maximum, Math.max(nativeWidth(), width));
    panel.style.width = next + 'px'; handle.setAttribute('aria-valuenow', String(Math.round(next)));
    handle.setAttribute('aria-valuemin', String(Math.min(nativeWidth(), maximum))); handle.setAttribute('aria-valuemax', String(maximum));
    return next;
  };
  const save = (width: number) => { try { host.localStorage?.setItem('party-game-log-width', String(width)); } catch { /* The width still applies now. */ } };
  let saved = 0; try { saved = Number(host.localStorage?.getItem('party-game-log-width')); } catch { /* The native width. */ }
  setWidth(Number.isFinite(saved) && saved > 0 ? saved : nativeWidth());
  let drag: { id: number; x: number; width: number } | null = null;
  handle.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); drag = { id: event.pointerId, x: event.clientX, width: parseFloat(panel.style.width) }; handle.setPointerCapture(event.pointerId); };
  handle.onpointermove = event => { if (drag?.id === event.pointerId) setWidth(drag.width + drag.x - event.clientX); };
  handle.onpointerup = event => { if (drag?.id !== event.pointerId) return; save(parseFloat(panel.style.width)); drag = null; handle.releasePointerCapture(event.pointerId); };
  handle.onpointercancel = () => { if (drag) setWidth(drag.width); drag = null; };
  handle.onlostpointercapture = () => { drag = null; };
  handle.ondblclick = event => { event.stopPropagation(); save(setWidth(nativeWidth())); };
  handle.onkeydown = event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return;
    event.preventDefault(); event.stopPropagation();
    save(setWidth(event.key === 'Home' ? nativeWidth() : parseFloat(panel.style.width) + (event.key === 'ArrowLeft' ? 20 : -20)));
  };
  panel.appendChild(handle);
}
// Each report posts the oldest GAME_LOG_BATCH lines, the batch the coordinator's route takes.
async function pulseGameLogs(state: Capture) {
  if (state.busy || !state.queue.length) return;
  state.busy = true;
  if (state.queue.length > GAME_LOG_BATCH) capReached('GAME_LOG_BATCH', '12');
  const events = state.queue.slice(0, GAME_LOG_BATCH);
  try { await state.send(events); const last = events[events.length - 1]!.seq; state.queue = state.queue.filter(e => e.seq > last); }
  catch { /* Retained for the next report. */ }
  finally { state.busy = false; }
}

// caracAL prints every game_logs entry of every character thread to stdout. The game sends each
// party event (a kill, a find) to every member's client, so a party of three printed each kill three
// times: 89% of the console log was kill and gold lines, measured live (docs/efficiency.md, Requests
// and logs). installGameLogEcho replaces caracAL's echo hook: a party kill or find goes to stdout
// only from the thread of the character it names, chosen by the event's phrase arguments. Each event
// still reaches add_log, so the console's own capture sees every line as before.
// typed-adventureland 0.0.57 types the object form of game_log with color and message only. Party
// kills and finds also carry phrase and phrase_args, which the game's game_log handler passes to
// phrase.message.
type GameLogEvent = Partial<Exclude<ServerToClient_game_log, string>> & { phrase?: unknown; phrase_args?: { player?: unknown } };
interface EchoHost {
  add_log: (message: unknown, color?: string) => unknown;
  game_logs: [unknown, unknown][];
  character?: Pick<CharacterEntity, 'name'> | null;
  phrase?: { message?: (data: unknown, html?: boolean) => unknown };
}
interface EchoLog { info(details: { col: unknown; type: 'game_logs' }, message: unknown): void }
// The game sends these to the named player too (observed live: a killer's own thread logs
// "<killer> killed a Tiny Crab", a finder's "<finder> found a Seashell").
const namedPlayerPhrases = ['server.kill.player.', 'server.item.named_found.'];
function namedPlayer(data: GameLogEvent | null | undefined): string | undefined {
  const phrase = data?.phrase, player = data?.phrase_args?.player;
  if (typeof phrase !== 'string' || typeof player !== 'string') return undefined;
  return namedPlayerPhrases.some(prefix => phrase.startsWith(prefix)) ? player : undefined;
}
/** Returns false when the game client has no phrase lookup; caracAL then keeps its own hook. */
export function installGameLogEcho(host: EchoHost, log: EchoLog, siblings: () => string[] | undefined): boolean {
  const phrase = host.phrase;
  if (!phrase || typeof phrase.message !== 'function') return false;
  const message = phrase.message;
  // The rendered text of a sibling's event, until the add_log call it feeds.
  let quiet: unknown = null;
  phrase.message = function (data, html) {
    const rendered = message.call(this, data, html);
    // The add_log call this render feeds reads the text and clears it (below).
    if (siblingEvent(data as GameLogEvent)) quiet = rendered;
    return rendered;
  };
  function siblingEvent(data: GameLogEvent | null | undefined): boolean {
    const player = namedPlayer(data), self = host.character?.name;
    return !!player && !!self && player !== self && (siblings() || []).includes(player);
  }
  const original = host.add_log;
  host.add_log = function (text, color) {
    // The console capture adds a timestamp prefix before this call.
    const silent = typeof quiet === 'string' && typeof text === 'string' && text.endsWith(quiet);
    quiet = null;
    const before = host.game_logs.length;
    original(text, color);
    host.game_logs.forEach(([entry, col], index) => {
      if (!silent || index < before) log.info({ col, type: 'game_logs' }, entry);
    });
    host.game_logs = [];
  };
  return true;
}

// ---------------------------------------------------------------------------------------------------
// The headless rendering guards (docs/efficiency.md). Native renderer descriptors are Pixi
// animation state, not game entity reports; these fields are absent from typed-adventureland.
interface Sprite { skin: string; stype: string; frames?: number; cskin?: string }
// Native skill-bar and progress tints (functions.js add_tint). Tint lists only the fields tint_logic
// reads outside its DOM calls.
interface Tint { type?: string; end?: Date; i?: number; mid?: Date; on_end?(): void }
export interface GameRenderHost {
  textures: Record<string, unknown>;
  set_texture(this: void, sprite: Sprite, i: number, j?: number): void;
  console?: Pick<Console, 'warn'>;
  __partyTextureGuard?: GameRenderHost['set_texture'];
  no_graphics?: unknown;
  tints?: Tint[];
  tint_logic?(this: void): void;
  delete_indices?(this: void, list: unknown[], indices: number[]): void;
  __partyHeadlessTints?: () => void;
}
const sheets = new Set(['full', 'wings', 'body', 'armor', 'skin', 'tail', 'character', 'upper']);
const directional = new Set(['v_animation', 'head', 'hair', 'hat', 's_wings', 'face', 'makeup', 'beard']);
const animated = new Set(['animation', 'animatable']);
const layered = new Set(['a_makeup', 'a_hat']);
const at = (value: unknown, index: number | undefined): unknown => Array.isArray(value) && index !== undefined ? value[index] : undefined;
function textureFrame(game: GameRenderHost, sprite: Sprite, i: number, j?: number): unknown {
  const texture = game.textures[(sprite.stype === 'upper' ? 'upper' : '') + sprite.skin];
  if (sheets.has(sprite.stype)) return at(at(texture, i), j);
  if (animated.has(sprite.stype)) return at(texture, i % Number(sprite.frames));
  if (sprite.stype === 'emote') return at(texture, i % 3);
  const row = at(texture, i % Number(sprite.frames));
  if (layered.has(sprite.stype)) return at(row, Number(j) % (at(texture, 0) as unknown[])?.length);
  return Array.isArray(row) ? at(row, (j || 0) % row.length) : row;
}
const supported = (sprite: Sprite): boolean => sheets.has(sprite.stype) || directional.has(sprite.stype) || animated.has(sprite.stype) ||
  layered.has(sprite.stype) || sprite.stype === 'emote';
const ending = new Set(['skill', 'progress', 'dissipate', 'brute', 'fill']);
/** One headless tint_logic frame for one tint; true when the tint ended. */
function tintFrame(tint: Tint, start: Date): boolean {
  const over = ending.has(String(tint.type)) && tint.end !== undefined && start > tint.end;
  if (over && tint.type === 'fill') { tint.type = 'glow'; tint.on_end?.(); }
  if (tint.type === 'dissipate') {
    if (!over && tint.i === 19) tint.mid = new Date();
    tint.i = Number(tint.i) + 1;
  }
  return over;
}
// The game's 16 ms draw loop calls tint_logic, which restyles the skill bar and progress tints with
// jQuery on every frame: 2.1 s of the 9.5 s draw loop in a headless priest's 150 s farming profile
// (docs/efficiency.md). A headless client has no renderer and no viewer of that DOM, so
// headlessTints keeps only tint_logic's list work: it drops ended tints, turns an ended fill into glow
// before its on_end callback, and advances the dissipate counter.
function headlessTints(game: GameRenderHost): void {
  if (!game.no_graphics || typeof game.tint_logic !== 'function' || typeof game.delete_indices !== 'function' ||
      game.tint_logic === game.__partyHeadlessTints) return;
  const remove = game.delete_indices;
  const logic = () => {
    const tints = game.tints;
    if (!Array.isArray(tints)) return;
    const start = new Date(), ended: number[] = [];
    for (let index = 0; index < tints.length; index++) if (tintFrame(tints[index], start)) ended.push(index);
    remove(tints, ended);
  };
  game.tint_logic = game.__partyHeadlessTints = logic;
}
/** An unavailable cosmetic frame must not end native draw and physics scheduling. */
export function installGameRendering(game: GameRenderHost): void {
  headlessTints(game);
  if (typeof game.set_texture !== 'function' || game.set_texture === game.__partyTextureGuard) return;
  const original = game.set_texture, reported = new Set<string>();
  const guarded: GameRenderHost['set_texture'] = function (sprite, i, j) {
    if (supported(sprite) && sprite.cskin !== String(i) + String(j) && textureFrame(game, sprite, i, j) == null) {
      const id = JSON.stringify([sprite.skin, sprite.stype, i, j]);
      if (!reported.has(id)) {
        // The set forgets its oldest key past MISSING_FRAMES_REPORTED, so that frame warns again.
        if (reported.size >= MISSING_FRAMES_REPORTED) { reported.delete(reported.values().next().value!); capReached('MISSING_FRAMES_REPORTED', '12'); }
        reported.add(id);
        game.console?.warn('Native sprite frame unavailable; retaining previous texture', { skin: sprite.skin, stype: sprite.stype, i, j });
      }
      // cskin stays unset, so a later draw retries a newly available texture.
      return;
    }
    original(sprite, i, j);
  };
  game.set_texture = game.__partyTextureGuard = guarded;
}

// Movement's planning schedule counters (the movement owner's journey diagnostics): application diagnostics, not
// game state. Constant memory, passive counters.
interface Timing { calls: number; first: number; last: number; total: number; min: number; max: number }
export function createPlanningScheduleMetrics() {
  const timing = (): Timing => ({ calls: 0, first: 0, last: 0, total: 0, min: Infinity, max: 0 });
  const scheduler = timing(), plan = timing();
  let ownedCallbacks = 0, blockedMoving = 0, blockedTransporting = 0, pausedCallbacks = 0;
  function observe(sample: Timing) {
    const now = performance.now();
    if (sample.calls) { const gap = Math.max(0, now - sample.last); sample.total += gap; sample.min = Math.min(sample.min, gap); sample.max = Math.max(sample.max, gap); }
    else sample.first = now;
    sample.last = now; sample.calls++;
  }
  const snapshot = (sample: Timing) => ({ calls: sample.calls, elapsedMs: sample.calls ? sample.last - sample.first : 0,
    intervals: { minMs: sample.calls > 1 ? sample.min : 0, maxMs: sample.max, meanMs: sample.calls > 1 ? sample.total / (sample.calls - 1) : 0 } });
  return {
    scheduler(owner: boolean) { observe(scheduler); if (owner) ownedCallbacks++; },
    plan() { observe(plan); },
    blockedMoving() { blockedMoving++; }, blockedTransporting() { blockedTransporting++; }, paused() { pausedCallbacks++; },
    report: () => ({ scheduler: snapshot(scheduler), plan: snapshot(plan), ownedCallbacks, blockedMoving, blockedTransporting, pausedCallbacks }),
  };
}

// ---------------------------------------------------------------------------------------------------
// The character's telemetry, built once at load.
interface CombatLine { type: string; message: string; details: unknown; at: number; session: string; seq: number }
interface Credit { at: number; mtype: string; own: boolean; level: number; xp: number; maxXp: number }

export function createTelemetry(p: TelemetryPorts) {
  const observe = scope('12', 'observe');
  const me = () => p.me(), G = () => p.G(), parent = () => p.parent();
  const own = (actor: unknown) => String(actor || '') === String(me().id || '') || String(actor || '') === me().name;
  const label = (id: string | undefined, fallback?: string) => { const definition = id && G().items && G().items[id]; return definition && definition.name || fallback || id || 'Unknown'; };

  // The combat log lines. A skill's two packets (its `action` and its game response) name one use, and
  // the skill cannot be used again within its cooldown, so a skill line repeats only after it; a
  // skill with no cooldown of its own repeats after one round trip, the character's measured ping.
  // Each line and each status failure takes this runtime's session and the next seq when queued,
  // and keeps them on a resend, so coordinator/logs.ts keeps a batch sent again after a lost answer
  // once (as installHostGameLogs does for game logs).
  let lines: CombatLine[] = [], linesBusy = false;
  const lineSession = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let lineSeq = 0;
  const skillLines: Record<string, number> = {};
  function skillCooldown(skill: string): number {
    const definition = G().skills?.[skill], shared = definition?.share && G().skills?.[definition.share];
    return Number(definition?.cooldown) || Number(shared?.cooldown) || Number(me().ping) || 0;
  }
  // Movement's journey metric: a navigation line per phase, or its end, with the engine.
  function movementMetric(event: { id?: unknown; phase?: string; done?: boolean; engine?: string }): void {
    line('navigation', 'Movement ' + (event.phase || (event.done ? 'completed' : 'stopped')) + ' · ' + (event.engine || 'ALClient comparison'),
      event, 'movement-metrics:' + event.id + ':' + (event.phase || 'done'));
  }
  function line(type: string, message: string, details?: unknown, key?: string) {
    const now = Date.now();
    if (type === 'skill' && key) {
      if (skillLines[key] !== undefined && now - skillLines[key] < skillCooldown(key.slice('skill:'.length))) return;
      skillLines[key] = now;
    }
    lines.push({ type, message, details: details || null, at: now, session: lineSession, seq: ++lineSeq });
    if (lines.length > picks.combatLinesQueued) lines.splice(0, lines.length - picks.combatLinesQueued);
    void flushLines();
  }
  // A failed batch goes again on the next report.
  async function flushLines() {
    if (linesBusy || !lines.length) return;
    linesBusy = true;
    // A post carries COMBAT_LOG_BATCH lines, the newest the coordinator's route keeps, and an answered
    // post sends the next batch at once.
    if (lines.length > COMBAT_LOG_BATCH) capReached('COMBAT_LOG_BATCH', '12');
    const batch = lines.splice(0, COMBAT_LOG_BATCH);
    let sent = false;
    try { await p.request('/combat-log', { method: 'POST', body: { character: me().name, events: batch } }); sent = true; }
    catch { lines = batch.concat(lines).slice(-picks.combatLinesQueued); }
    finally { linesBusy = false; }
    if (sent) void flushLines();
  }

  // The fight packets the report carries (DSH-034's diagnostics): the newest few kill credits, deaths
  // and lethal disappears, kept on the shared root so a reload keeps them.
  const fightPackets: { event: string; at: number; data: unknown }[] = p.root().__partyFightPackets || [];
  function packet(event: string, data: unknown) {
    if (!data) return;
    fightPackets.push({ event, at: Date.now(), data });
    if (fightPackets.length > FIGHT_PACKETS) { fightPackets.shift(); capReached('FIGHT_PACKETS', '12'); }
    p.root().__partyFightPackets = fightPackets;
  }

  // The character's last death: the survival owner's `survival.died` names it once per rip, and the
  // record joins the Hunt trip or event it ended.
  let lastDeath: DeathRecord | null = p.root().__partyLastDeathInfo || parent().__partyLastDeathInfo || null;
  function died(notice: Record<string, unknown>) {
    if (notice.name !== me().name) return;
    const at = Number(notice.at) || Date.now(), trip = p.death.huntTrip(), joined = p.death.joinedEvent();
    const eventTrip = trip && !trip.endedAt ? { ...trip } : !trip && joined ? { event: joined, startedAt: at } : null;
    const message = String(notice.cause || ''), details = notice.details ?? null;
    lastDeath = p.root().__partyLastDeathInfo = parent().__partyLastDeathInfo = { at, message, details, eventTrip };
    line('death', message, details, 'death:self');
  }

  // The metrics and fast telemetry posts end at their timeout; a post the coordinator never answers
  // fires its bound, and the data waits for the next post as on any failure.
  const timedPost = (path: string, body: unknown, timeout: number, bound: string) => p.request(path, { method: 'POST', body, timeout })
    .catch((error: Game) => {
      if (failedRequest(error).kind === 'timeout') boundFired({ bound, owner: '12', state: { path, ms: timeout } });
      throw error;
    });
  const metrics = installPartyMetrics({
    now: p.now, current: p.current,
    connected: () => !!me() && (!parent().socket || parent().socket.connected !== false),
    name: () => me().name, own,
    ownedCharacter: name => {
      const player = p.player(name);
      return name === me().name || !!player && player.owner === me().owner || p.party().includes(name);
    },
    context: () => ({ server: String(parent().server_region || '') + String(parent().server_identifier || '') || 'unknown',
      map: me().map, instance: String(me().in || me().map), party: p.party() }),
    sample: () => {
      const character = me(), luck = encouragementLuck(character.encouragement, character.s);
      return { gold: Number(character.gold) || 0, luck: Number(character.luckm) || 1, encouragementLuck: luck === null ? undefined : luck,
        ping: steadyPing(character.ping, parent().pings),
        level: Number(character.level) || 1, xp: Number(character.xp) || 0, maxXp: Number(character.max_xp) || 0 };
    },
    storage: p.root().localStorage,
    send: body => timedPost('/metrics', body, METRICS_POST_MS, 'METRICS_POST_MS'),
  });

  const sampler = createDashboardSampler({
    now: p.now, current: p.current, name: () => me().name, runtime: p.runtime,
    sample: () => {
      const c = me();
      return { vitals: { hp: c.hp, mp: c.mp, max_hp: c.max_hp, max_mp: c.max_mp, cc: Math.ceil(Number(c.cc) || 0),
        x: c.real_x === undefined ? c.x : c.real_x, y: c.real_y === undefined ? c.y : c.real_y, map: c.map, in: c.in,
        xp: c.xp || 0, max_xp: c.max_xp || 0, gold: c.gold, rip: !!c.rip, target: c.target || null, standOpen: !!c.stand,
        conditions: p.report.activeConditions(), inventorySize: Number(c.isize) || c.items.length },
        items: Object.assign({}, c.items), slots: Object.assign({}, c.slots) };
    },
    entry: (item, slot, equipment) => equipment ? { item: p.items.fingerprint(item), meta: p.items.itemDefinition(item) }
      : p.items.inventoryOperationEntry(item, Number(slot)),
    send: body => timedPost('/dashboard-telemetry', body, TELEMETRY_POST_MS, 'TELEMETRY_POST_MS'),
  });

  const gameLogs = installGameLogs(parent(), events => p.request('/game-logs', { method: 'POST', body: { character: me().name, events } }));

  // The map frames, while the dashboard's map shows this character (the reply's `mapTelemetry`).
  let mapOn = false, mapBusy = false;
  // Each frame takes every event since the last one, and a projectile ends at its hit or its eta,
  // so the game's own actions bound both lists.
  let mapEvents: { kind: string; at: number; data: unknown }[] = [];
  let projectiles: Record<string, MapProjectile & { map?: string }> = {};
  function mapEvent(kind: string, data: unknown) {
    if (!mapOn || !data) return;
    mapEvents.push({ kind, at: Date.now(), data: p.items.safeItemDefinition(data) });
  }
  function mapEntity(entity: Game, id: string) {
    if (!entity || entity.dead) return null;
    const type = entity.type || (entity.mtype ? 'monster' : null);
    if (!['character', 'monster', 'npc'].includes(type)) return null;
    const skin = entity.skin || entity.mtype;
    const layers = captureNativeLayers(entity);
    return {
      id: String(entity.id || id), name: entity.name || entity.mtype || String(id), type, ctype: entity.ctype || null, mtype: entity.mtype || null,
      x: Number(entity.real_x !== undefined ? entity.real_x : entity.x) || 0, y: Number(entity.real_y !== undefined ? entity.real_y : entity.y) || 0,
      hp: Number(entity.hp) || 0, max_hp: Number(entity.max_hp) || 0, mp: Number(entity.mp) || 0, max_mp: Number(entity.max_mp) || 0,
      target: entity.target || null, moving: !!entity.moving, angle: Number(entity.angle) || 0, direction: Number(entity.direction) || 0,
      sprite: skin ? p.report.sprite(skin) : null,
      layers: layers.length ? layers : undefined,
      dollHtml: !layers.length && (type === 'character' || entity.cx) ? p.report.mapDollHtml(entity, entity.direction) : null,
      stand: entity.stand || null,
      standSprite: entity.stand ? (p.report.sprite(typeof entity.stand === 'string' ? entity.stand : 'stand0') || p.report.sprite('stand0')) : null,
      weapons: ['mainhand', 'offhand'].map(hand => {
        const item = entity.slots && entity.slots[hand], definition = item && G().items[item.name];
        return definition ? { hand, name: item.name, sprite: p.report.sprite(definition.skin_c || definition.skin) } : null;
      }).filter(Boolean),
    };
  }
  // The coordinator keeps a supplied floor for the run and answers {definition:"needed"} when it
  // lacks one, so each floor is sent once.
  function publishMapFrame() {
    if (!mapOn || mapBusy) return;
    mapBusy = true;
    const c = me(), self = mapEntity(c, c.name);
    if (self) { self.id = c.name; self.name = c.name; self.type = 'character'; }
    const entities = Object.keys(parent().entities || {}).map(id => mapEntity(parent().entities[id], id)).filter(Boolean) as { id: string }[];
    if (self && !entities.some(entry => entry.id === self.id)) entities.push(self);
    const events = mapEvents.splice(0, mapEvents.length), frameMap = c.map, now = Date.now();
    const live = Object.keys(projectiles).filter(id => {
      const projectile = projectiles[id]!;
      if (projectile.expiresAt <= now || projectile.map !== c.map) { delete projectiles[id]; return false; }
      return true;
    }).map(id => projectiles[id]);
    p.request('/map-frame', { method: 'POST', body: { name: c.name, map: frameMap, definition: p.map.definition(), at: now,
      x: Number(c.real_x !== undefined ? c.real_x : c.x) || 0, y: Number(c.real_y !== undefined ? c.real_y : c.y) || 0,
      projectilesAt: now, projectiles: live, target: c.target || p.map.selected() || null, eventCombat: p.map.eventCombat(),
      queue: p.map.markers(), grouped: p.map.grouped(), entities,
      visuals: captureMapVisuals(parent().map_animations || {}), events } })
      .then((reply: Game) => { if (reply && reply.definition === 'needed') p.map.definitionNeeded(frameMap); })
      .catch(() => { /* The next frame goes as usual. */ })
      .finally(() => { mapBusy = false; });
  }
  function onMapAction(data: Game) {
    mapEvent('action', data);
    const game = parent(), c = me();
    if (!mapOn || !game.no_graphics || !data) return;
    const attacker = game.get_entity && game.get_entity(data.attacker);
    if (!attacker || attacker.map && attacker.map !== c.map) return;
    const target = game.get_entity && game.get_entity(data.target);
    let origin = game.projectile_origin && game.projectile_origin(attacker, target || { x: data.x, y: data.y }, data.origin_offset || 0);
    const projectile = G().projectiles && G().projectiles[data.projectile];
    const animation = projectile && G().animations && G().animations[projectile.animation || projectile.ray];
    if (!origin || !animation) return;
    const end = { x: target && game.get_x ? game.get_x(target) : data.x,
      y: target && game.get_y ? game.get_y(target) - (game.get_height ? game.get_height(target) / 2 : 0) : data.y };
    const ray = !projectile.animation && !!projectile.ray;
    if (ray) origin = { x: game.get_x ? game.get_x(attacker) : attacker.x,
      y: (game.get_y ? game.get_y(attacker) : attacker.y) - (game.get_height ? game.get_height(attacker) / 2 : 0) };
    const projection = projectHeadlessAction(data, origin, end, animation, Date.now(), ray);
    if (!projection) return;
    projectiles[data.pid] = { ...projection, map: c.map };
  }
  function onMapHit(data: Game) {
    mapEvent('hit', data);
    if (data && projectiles[data.pid] && !projectiles[data.pid]!.ray) delete projectiles[data.pid];
  }

  // The kill credits. The game sends a kill's XP separately from its credit: as a "+N"
  // XP text, or in the next character update. A credit resolves at the first of the two, within
  // `killXpWindowMs` of the credit; an own kill marks the credit while it is that young.
  let credits: Credit[] = [];
  let ownKills: { at: number; mtype: string }[] = [];
  const young = (at: number) => Date.now() - at < picks.killXpWindowMs;
  function resolveCredit(credit: Credit, xp: number) {
    credits = credits.filter(entry => entry !== credit);
    const monster = G().monsters && G().monsters[credit.mtype], name = monster && monster.name || credit.mtype;
    line('kill', (credit.own ? 'Killed ' : 'Party killed ') + name + ', got ' + xp.toLocaleString() + ' XP',
      { monster: credit.mtype, xp, killingBlow: credit.own }, 'kill-credit:' + credit.mtype + ':' + credit.at);
  }
  function xpSince(credit: Credit): number {
    const c = me(), level = Number(c.level) || credit.level;
    if (level === credit.level) return Math.max(0, (Number(c.xp) || 0) - credit.xp);
    if (level < credit.level) return 0;
    let gained = Math.max(0, credit.maxXp - credit.xp) + (Number(c.xp) || 0);
    for (let next = credit.level + 1; next < level; next += 1) gained += Number(G().levels && G().levels[String(next)]) || 0;
    return gained;
  }
  function onKillCredit(data: Game) {
    if (!data || !data.mtype) return;
    metrics.credit(data);
    packet('kill_credit', data);
    ownKills = ownKills.filter(kill => young(kill.at));
    const index = ownKills.findIndex(kill => kill.mtype === data.mtype);
    if (index >= 0) ownKills.splice(index, 1);
    const c = me();
    credits = credits.filter(credit => young(credit.at));
    credits.push({ at: Date.now(), mtype: data.mtype, own: index >= 0, level: Number(c.level) || 1, xp: Number(c.xp) || 0, maxXp: Number(c.max_xp) || 0 });
  }
  function onXpText(data: Game) {
    credits = credits.filter(credit => young(credit.at));
    if (!data || !credits.length) return;
    const args = data.args || {}, color = String(args.color || args.c || '').toLowerCase();
    if (color !== '#753d8c' && color !== '#ad73e0') return;
    const match = String(data.message || '').match(/^\+([\d,]+)$/);
    if (match) resolveCredit(credits[0]!, Number(match[1]!.replace(/,/g, '')) || 0);
  }

  // The potion line. Regeneration skills and potions both answer `used: hp/mp`; only a potion stack
  // that fell is an item use. The bag is compared with the bag as of the last report (table A's 12
  // row), at the answer and, when the bag has not changed yet, at the next character update, the
  // packet that carries the server's new bag.
  let bagBefore: Record<string, number> = {};
  let potionPending = false;
  function potionUsed(): boolean {
    const after = p.items.inventoryTotals();
    const consumed = Object.keys(bagBefore).find(name => {
      const definition = G().items && G().items[name];
      return (definition && (definition.type === 'pot' || /^hpot|^mpot/.test(name))) && (bagBefore[name] || 0) > (after[name] || 0);
    });
    if (!consumed) return false;
    line('item', 'Used ' + label(consumed), { item: consumed });
    bagBefore = after;
    return true;
  }
  // The character update: a waiting potion answer and the young kill credits read the new bag and XP.
  function onPlayer() {
    if (potionPending) { potionPending = false; if (!potionUsed()) bagBefore = p.items.inventoryTotals(); }
    for (const credit of credits.slice()) {
      if (!young(credit.at)) { credits = credits.filter(entry => entry !== credit); continue; }
      const gained = xpSince(credit);
      if (gained) resolveCredit(credit, gained);
    }
  }

  function onAction(data: Game) {
    onMapAction(data);
    if (!data || !own(data.attacker)) return;
    const skill = data.source || data.skill;
    if (!skill || skill === 'attack' || !(G().skills && G().skills[skill])) return;
    const target = data.target && p.entity(data.target);
    line('skill', 'Used ' + (G().skills[skill].name || skill), { skill, target: target && (target.name || target.mtype) || data.target || null }, 'skill:' + skill);
  }
  function onLoot(data: Game) {
    if (!data || !Array.isArray(data.items)) return;
    metrics.loot(data);
    // The chest names each item's looter, the field the metrics count reads, so the loot line counts
    // the same items.
    for (const item of data.items) {
      if (!item || item.looter !== me().name) continue;
      const quantity = Number(item.q) || 1;
      line('loot', 'Looted ' + quantity + 'x ' + label(item.name), { item: item.name, quantity });
    }
  }
  function onResponse(data: Game) {
    if (!data || data.failed) return;
    metrics.goldMovement(data);
    const items = G().items;
    if (data.success === true) {
      const usedName = data.used && items[data.used] ? data.used : data.response === 'elixir' && me().slots.elixir ? me().slots.elixir.name : null;
      const used = usedName && items[usedName];
      if (used && (used.type === 'pot' || used.type === 'elixir')) metrics.consumable(Number(used.g) || 0);
      if (data.response === 'buy_success' && items[data.name] && ['pot', 'elixir'].includes(items[data.name].type))
        metrics.consumable(Number(data.cost) || 0, true);
    }
    const skill = data.place === 'skill' ? (data.skill || data.name) : data.place;
    if (skill && skill !== 'attack' && G().skills && G().skills[skill]) line('skill', 'Used ' + (G().skills[skill].name || skill), { skill }, 'skill:' + skill);
    if (data.used === 'hp' || data.used === 'mp') { if (!potionUsed()) potionPending = true; }
    else if (data.used) line('item', 'Used ' + label(data.used, data.used), { item: data.used });
  }

  // Each report sends the queues and seals a metrics frame; `survival.died` writes the last death.
  partyHooks().publish({ name: 'core:status', folder: 'core', author: 'adventureland-party-console',
    summary: "Records the character's combat lines, game logs, metrics and last death for the dashboard.",
    hooks: {
      'report.sent': (payload: Record<string, unknown>) => {
        if (!p.current() || payload.character !== me().name) return;
        void flushLines(); void gameLogs?.pulse(); metrics.pulse();
      },
      'survival.died': (notice: Record<string, unknown>) => { if (p.current()) died(notice); },
    } });

  // A failed status request is one red game log line and one combat log entry. A failure
  // equal to the last entry counts as its repeat and writes nothing; the entry goes out when the
  // failure changes. An entry delivered before its last repeats goes again once, under a new seq,
  // when a different failure follows, so the combat log holds its final repeat count. The newest
  // STATUS_FAILURES_KEPT entries wait for delivery, which the next answered report sends once.
  interface StatusFailure { at: number; type: string; message: string; details: Values & { repeats: number; lastAt: number }; key: string;
    delivered: boolean; sentRepeats?: number; session: string; seq: number }
  const failures = (): StatusFailure[] => p.root().__partyStatusDiagnostics || (p.root().__partyStatusDiagnostics = []);
  function statusFailure(error: Game, phase: string): void {
    const now = Date.now(), walk = p.walk();
    const details = { character: me().name, phase, error: diagnosticText(error && (error.message || error.reason) || error),
      stack: diagnosticText(error && error.stack, 'STATUS_STACK_CHARS'), request: error && error.partyRequest || null,
      convoy: walk ? { id: walk.id, phase: walk.phase, epoch: walk.epoch } : null, repeats: 1, lastAt: now };
    const history = failures(), key = JSON.stringify([phase, details.error, details.request, details.convoy]), previous = history[history.length - 1];
    if (previous && previous.key === key) { previous.details.repeats++; previous.details.lastAt = now; return; }
    if (previous?.delivered && previous.details.repeats > (previous.sentRepeats ?? 1)) { previous.delivered = false; previous.seq = ++lineSeq; }
    const text = 'Party status failed [' + phase + ']: ' + details.error;
    if (text.length > STATUS_FAILURE_CHARS) capReached('STATUS_FAILURE_CHARS', '12');
    const message = text.slice(0, STATUS_FAILURE_CHARS);
    history.push({ at: now, type: 'status-error', message, details, key, delivered: false, session: lineSession, seq: ++lineSeq });
    if (history.length > STATUS_FAILURES_KEPT) { capReached('STATUS_FAILURES_KEPT', '12', history.length - STATUS_FAILURES_KEPT); history.splice(0, history.length - STATUS_FAILURES_KEPT); }
    p.log(message, 'red');
  }
  async function flushStatusFailures(): Promise<void> {
    const root = p.root();
    if (root.__partyStatusDiagnosticsSending) return;
    const batch = failures().filter(entry => !entry.delivered);
    if (!batch.length) return;
    root.__partyStatusDiagnosticsSending = true;
    const sent = batch.map(entry => entry.details.repeats);
    try {
      await p.request('/combat-log', { method: 'POST', body: { character: me().name,
        events: batch.map(entry => ({ at: entry.at, type: entry.type, message: entry.message, details: { ...entry.details }, session: entry.session, seq: entry.seq })) } });
      batch.forEach((entry, index) => { entry.delivered = true; entry.sentRepeats = sent[index]; });
    } catch {
      // The next answered report sends it again; a failed send never retries itself.
    } finally { root.__partyStatusDiagnosticsSending = false; }
  }

  return {
    /** DSH-272's own-actor rule, which survival's death packets read too. */
    ownActor: own,
    movementMetric,
    /** DSH-037: a failed status request's record, and its delivery after the next answered report. */
    statusFailure, flushStatusFailures,
    /** Table A's `failures` row: the recorded status failures post without holding the apply. */
    failuresReply(): void { void flushStatusFailures(); },
    /** The run's start: the socket listeners and the frame timers. */
    start() {
      const socket = parent().socket;
      observe.on(socket, 'action', onAction);
      observe.on(socket, 'hit', onMapHit);
      observe.on(socket, 'kill_credit', onKillCredit);
      observe.on(socket, 'disappearing_text', onXpText);
      observe.on(socket, 'chest_opened', onLoot);
      observe.on(socket, 'game_response', onResponse);
      observe.on(socket, 'player', onPlayer);
      // Deaths and lethal disappears join the fight packet record.
      observe.on(socket, 'death', (data: unknown) => packet('death', data));
      observe.on(socket, 'disappear', (data: unknown) => packet('disappear', data));
      // The dashboard draws at `telemetryMs`; the game sends no packet for a client-side step.
      observe.setInterval(publishMapFrame, picks.telemetryMs);
      observe.setInterval(sampler.pulse, picks.telemetryMs);
    },
    /** Table A's 12 row before each report: the bag the potion line compares with. */
    beforeReport() { if (!potionPending) bagBefore = p.items.inventoryTotals(); },
    /** The reply's map telemetry switch and dashboard lease. */
    map(on: boolean) { mapOn = on; if (!on) projectiles = {}; },
    /** Table A's `status` row: the reply's dashboard lease. */
    statusReply(state: { dashboardLease?: Lease }) { sampler.renew(state.dashboardLease); },
    /** A combat log line from another owner (a walk event, a Hunt step). */
    line,
    /** The hunting owner's hit readers: the metrics damage and kills, and an own kill for the next credit. */
    hit: metrics.hit,
    ownKill(data: Game, entity: Game) {
      const killed = entity && entity.mtype || data.mtype;
      if (!(data.kill || data.dead) || !killed) return;
      ownKills = ownKills.filter(kill => young(kill.at));
      ownKills.push({ at: Date.now(), mtype: killed });
    },
    lastDeath: () => lastDeath,
    fightPackets: () => fightPackets,
  };
}

// DSH-056: the combat queue's rings, which the game window's overlay
// (runtime/status/character/markers.ts), the map frames, the combat trace and the lifecycle owner's drain read. The rings show
// what the character fights now: the return defence's attacker, the selected event boss, each
// fighter's own target while scattered, or the grouped queue's first three.
interface MarkerTarget { id: string | number; map?: string; in?: string; server?: string; state?: string; awidth?: unknown; visible?: boolean; dead?: boolean; hp?: number; mtype?: string }
export interface QueueMarker { id: string; map?: string; in?: string; server?: string; role: typeof MARKER_ROLES[number]; state?: string; radius: number; visible: boolean }
export interface QueueMarkerPorts {
  character(): { cave?: unknown; rip?: unknown; map?: string; in?: string };
  entity(id: string | number): MarkerTarget | null | undefined;
  realm(): string;
  // The time on the coordinator's clock, which stamps the party positions: the character's clock
  // and its measured offset.
  now(): number;
  // The survival owner's return defence and the attacker it answers.
  returnCombat(): boolean;
  returnDefense(): MarkerTarget | null | undefined;
  // The events owner's event monsters and the targeting owner's selected target and its allow rule.
  eventTypes(): readonly string[];
  selected(): string | null | undefined;
  allowed(entity: MarkerTarget): boolean;
  // The hunting owner's farming mode, and the travel intent the player cancelled.
  grouped(): boolean;
  mode(): string;
  cancelled(): boolean;
  // Each fighter's own target while scattered: this character's and the party's reported ones.
  activeTarget(): MarkerTarget | null | undefined;
  partyPositions(): readonly { seenAt?: unknown; rip?: unknown; activeCombatTarget?: MarkerTarget | null }[];
  // The hunting owner's Hunt travel control, the targeting owner's queue, and the movement owner's group walk with its hold's defence target.
  huntControl(): { defending?: unknown; primary?: MarkerTarget } | null | undefined;
  queue(): { queue?: MarkerTarget[]; pairRevision?: unknown } | null | undefined;
  travel(): { holdRequested?: unknown; communication?: unknown; phase?: string } | null | undefined;
  holdDefense(): MarkerTarget | null | undefined;
  entityReport(entity: MarkerTarget): MarkerTarget;
  // The lifecycle owner's drain: while it runs, a fight it does not let start shows as next, not current.
  draining(): boolean;
  drainAllows(entity: MarkerTarget | null | undefined): boolean;
}
export function createQueueMarkers(p: QueueMarkerPorts) {
  const here = (t: MarkerTarget) => t.server === p.realm() && t.map === p.character().map && t.in === p.character().in;
  const live = (e: MarkerTarget | null | undefined) => !!(e && e.visible && !e.dead);
  function rings(): QueueMarker[] {
    const character = p.character();
    if (!character.cave && p.returnCombat()) {
      const attacker = p.returnDefense();
      return attacker ? [{ id: String(attacker.id), map: character.map, in: character.in, server: p.realm(), role: 'current', state: 'engaged', radius: markerRadius(attacker), visible: true }] : [];
    }
    if (!character.cave && p.eventTypes().length && !character.rip) {
      const id = p.selected(), selected = id ? p.entity(id) : null;
      if (!selected || !selected.visible || selected.dead || Number(selected.hp) <= 0 || !p.eventTypes().includes(String(selected.mtype)) || !p.allowed(selected)) return [];
      return [{ id: String(selected.id), map: character.map, in: character.in, state: 'event', role: 'current', radius: markerRadius(selected), visible: true }];
    }
    if (!p.grouped() && p.mode() === 'scatter' && !p.cancelled() && !character.rip) {
      // A party member's target counts while its position report is fresh (the protocol's report age).
      const now = p.now(), seen = new Set<string>();
      const targets = [p.activeTarget(), ...p.partyPositions().filter(position => fresh(position.seenAt, now, 'report') && !position.rip).map(position => position.activeCombatTarget)];
      return targets.flatMap(t => {
        if (!t || seen.has(String(t.id)) || !here(t)) return [];
        seen.add(String(t.id));
        return [{ ...t, id: String(t.id), role: 'current' as const, state: 'scatter', radius: markerRadius(t), visible: live(p.entity(t.id)) }];
      });
    }
    const travel = !character.cave ? p.huntControl() : null, queue = p.queue();
    let markers: MarkerTarget[] = queue?.queue || [];
    if (travel && !travel.defending && travel.primary) markers = [travel.primary];
    const walk = !character.cave ? p.travel() : null;
    if (walk && (walk.holdRequested || walk.communication || walk.phase === 'held')) {
      const defense = p.holdDefense();
      markers = defense ? [{ ...p.entityReport(defense), server: p.realm() }] : [];
    }
    markers = markers.filter(t => { const e = p.entity(t.id); return (queue?.pairRevision || live(e) && e!.hp !== 0) && here(t); });
    return p.grouped() && (character.cave || !p.cancelled()) ? markers.slice(0, MARKER_ROLES.length).map((t, index) => {
      const e = p.entity(t.id);
      return { id: String(t.id), map: t.map, in: t.in, server: t.server, role: MARKER_ROLES[index], state: t.state, radius: markerRadius(e), visible: live(e) && here(t) };
    }) : [];
  }
  return {
    // A planned successor may lead the coordinator queue after the old fight dies; the drain keeps it
    // yellow instead of admitting a red target.
    markers: (): QueueMarker[] => rings().map(marker => marker.role === 'current' && p.draining() && !p.drainAllows(p.entity(marker.id))
      ? { ...marker, role: 'next' as const } : marker),
  };
}

const status = ((globalThis as { partyStatus?: Record<string, unknown> }).partyStatus ||= {});
status.telemetry = createTelemetry;
status.queueMarkers = createQueueMarkers;
// DSH-037: the request client in shared.js redacts its failure reasons with the same rule.
status.diagnosticText = diagnosticText;
// The request client's default timeout reports its cut through the status owner's bound record.
status.boundFired = boundFired;
// The headless rendering guards in a browser game window, before CODE scope creation; caracAL's
// worker installs them through the lifecycle bundle.
const game = (globalThis as unknown as { parent?: GameRenderHost & { caracAL?: unknown } }).parent;
if (game && !game.caracAL) installGameRendering(game);
