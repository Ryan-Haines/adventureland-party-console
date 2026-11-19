// The event clock on the character:
// the game's `S` feed, the server clock by the `test` echo, and the live, staging and schedule
// reports the heartbeat carries. Moved from characters/shared.js. The kinds
// are rules.ts's and every time value is game data, a measured state or a progress rule; shared.js calls
// `installEventClock` once in the routine's install.
import { backgroundCall, callMargin } from './calls.ts';
import { eventKey, eventKinds, leadFor } from '../rules.ts';
import { cipherDropRate, nextPublishedEvent, scheduledOccurrences } from '../october.ts';
import { boundFired } from '../../status/api.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';

// The game's event feed (`S`): one entry per event, plus the published calendar (`schedule`).
type FeedEntry = Record<string, unknown> & { live?: unknown; active?: unknown; spawn?: unknown; next?: unknown; expires?: unknown; end?: unknown;
  id?: unknown; event_id?: unknown; round?: unknown; start?: unknown; nativeSpawnEpoch?: number };
interface Published { event: string; status: string; at: number }
// Each staged event's announced spawn stays on the client's root across a code reload, under the
// key shared.js kept it on.
const realm = globalThis as { __partyHalloweenStages?: Record<string, { spawnAt: number; spawnId: unknown } | undefined> };
type Feed = Record<string, FeedEntry | undefined> & { schedule?: { events?: Published[]; repeats?: Published[]; time_offset?: number }; halloween?: unknown };
export interface Staging { staging: boolean; spawnAt?: number; spawnId?: unknown }

export interface EventClockPorts {
  // The events owner's run scope handles: the feed and the echo are
  // recorded on `observe`, so they stay current through a Pause; a reconnect's sync asks the echo,
  // a game call, on `act`.
  scope: { observe: ScopeHandle; act: ScopeHandle };
  now(): number;
  socket(): { connected?: boolean; emit?(event: string, data: unknown): void } | null | undefined;
  // The client's feed: `server.status`, else `parent.server.status`, else `parent.S`.
  feed(): Feed;
  game(): { events?: Record<string, { name?: string; doors?: unknown[]; knocks?: number; ingredients?: [string, string[]][]; loot?: unknown } | undefined>;
    maps?: Record<string, { spawns?: number[][] } | undefined>;
    items?: Record<string, { name?: string; skin?: string } | undefined>; monsters?: Record<string, { name?: string; skin?: string; hp?: unknown } | undefined> };
  // The kinds table on the character (combat.ts `installEventFacts`).
  names(): string[];
  supported(name: string): boolean;
  walkBoss(name: string): boolean;
  selected(name: string): boolean;
  joined(): string | null;
  // Movement's report clock offset (the heartbeat's `clockOffset`), which the coordinator reads stamps in.
  reportOffset(): number;
  // Whether the `search` row still searches for `name` (attend.ts `searching`).
  searching(name: string, state: FeedEntry | undefined): boolean;
  // The October runtime (october-runtime.ts): its activity for an interaction row and its snapshot.
  activity(name: string): unknown;
  october(): unknown;
  doors(): { doors?: unknown; doors_left?: unknown } | null | undefined;
  cipher(): { merchant: string | null; gathering: { stock?: unknown; plan?: unknown } | null };
  ingredients(): readonly string[];
  sprite(skin: string): unknown;
  monsterSprite(skin: string | undefined): unknown;
  // The schedule's `due` leads of this member's group, which the last reply carried (`eventLeads`).
  leads(): Record<string, number> | null;
  // The walk destination of an event (attend.ts `destination`, EVT-018's order).
  destination(name: string, state: FeedEntry | undefined): { map: string; x: number; y: number; in?: string | number } | null;
  // The Cipher merchant's walk to the Witch by `gather_end` (october-runtime.ts `witchWalk`), on the
  // server's clock, or null.
  cipherWalk(): { at: number; destination: { map: string; x: number; y: number } } | null;
}

/** Socket.IO sends the feed's Date values as ISO strings, and some fields carry epoch seconds. */
function feedEpoch(input: unknown): number {
  const value = Number(input) || (typeof input === 'string' ? Date.parse(input) : 0) || 0;
  return value && value < 1000000000000 ? value * 1000 : value;
}

export function installEventClock(ports: EventClockPorts) {
  const stages = realm.__partyHalloweenStages ??= {};
  // `spread` is the round trip of the echo the offset came from, so the offset is within half of it.
  let offset = 0, spread = Infinity, synced = false, missed = false, feedAt = ports.now(), request: { wall: number } | null = null;
  // `server_info` is change-only, so the age of the last announcement is not its freshness: the feed
  // counts while this connection is up, its clock has synced, and no echo went missing.
  const feedCurrent = () => { const socket = ports.socket(); return !!(socket && socket.connected !== false && synced && !missed); };
  // The server answers `test` with its own `new Date()` inside the handler (server.js:5667-5672), so
  // its time sits at the midpoint of the request and the reply, within half the round trip. A reply
  // takes the offset when its round trip is no longer than the one in use, or when the two offsets
  // disagree by more than both errors together, which means a clock moved.
  function receiveClock(data: { date?: string } | null | undefined): void {
    if (!request) return;
    const received = ports.now(), time = Date.parse(String(data?.date)), trip = received - request.wall;
    if (Number.isFinite(time)) {
      const measured = time - (request.wall + received) / 2;
      if (trip <= spread || Math.abs(measured - offset) > (spread + trip) / 2) { offset = measured; spread = trip; }
      synced = true;
      missed = false;
    }
    request = null;
  }
  // A sync that finds the last echo still unanswered marks the clock missed until an echo returns.
  function sync(): void {
    const socket = ports.socket();
    if (!socket?.emit) return;
    backgroundCall('test', () => {
      if (request) missed = true;
      request = { wall: ports.now() };
      socket.emit!('test', {});
    });
  }
  // The clock asks the echo again when its own measures show it may have moved:
  // an echo still unanswered one call margin after it went, or a feed that lists an event live
  // before its spawn on this clock. `connect` asks it on a new connection (character/install.ts).
  function check(): void {
    if (request) {
      // A lost echo reply: the bound that sends it again tells the status owner's bound record.
      if (ports.now() - request.wall > callMargin()) {
        boundFired({ bound: 'callMargin', owner: '06', state: { method: 'test', label: 'Clock echo', ms: callMargin() } });
        sync();
      }
      return;
    }
    // A stale clock with no echo in flight asks again on each pass. The background band refuses
    // the echo while a job wait is live, as at a reload's start, and a refused first echo would
    // leave the clock stale and every walk boss unseen until the next connection.
    if (!synced || missed) { sync(); return; }
    const feed = ports.feed() as Record<string, FeedEntry | undefined>;
    if (Object.values(feed).some(entry => entry && typeof entry === 'object' && entry.live === true &&
        feedEpoch(entry.spawn) - offset > ports.now())) sync();
  }
  // The feed with its times on this client's clock; `nativeSpawnEpoch` keeps the server's spawn id.
  // The game replaces `S` with each feed (game.js `welcome` and `server_info`), so one corrected copy
  // stands while the feed and the offset stay.
  let corrected: { raw: Feed; offset: number; feed: Feed } | null = null;
  function status(): Feed {
    const raw = ports.feed();
    if (!offset) return raw;
    if (corrected?.raw !== raw || corrected.offset !== offset) corrected = { raw, offset, feed: correct(raw) };
    return corrected.feed;
  }
  function correct(raw: Feed): Feed {
    const corrected: Feed = {};
    for (const [name, value] of Object.entries(raw)) {
      if (!value || typeof value !== 'object') { (corrected as Record<string, unknown>)[name] = value; continue; }
      const entry: FeedEntry = { ...value as FeedEntry };
      if ((value as FeedEntry).spawn) entry.nativeSpawnEpoch = feedEpoch((value as FeedEntry).spawn);
      for (const key of ['next', 'expires', 'end', 'spawn'] as const) if ((value as FeedEntry)[key]) entry[key] = feedEpoch((value as FeedEntry)[key]) - offset;
      (corrected as Record<string, unknown>)[name] = entry;
    }
    return corrected;
  }
  // A staged event's next spawn on this client's clock, with the server's id for it. Old boss feeds
  // give a native spawn Date; the October walk events publish their fixed time in the calendar
  // before their feed entry exists. A passed spawn stays the event's until the schedule names a later
  // one (the schedule's `missed`).
  // Each event's scheduled occurrences, worked out again only when a new feed brings a new calendar.
  let calendar: { schedule: NonNullable<Feed['schedule']>; occurrences: Map<string, ReturnType<typeof scheduledOccurrences>> } | null = null;
  function occurrences(schedule: NonNullable<Feed['schedule']>, name: string) {
    if (calendar?.schedule !== schedule) calendar = { schedule, occurrences: new Map() };
    let listed = calendar.occurrences.get(name);
    if (!listed) calendar.occurrences.set(name, listed = scheduledOccurrences(schedule, name));
    return listed;
  }
  function nextSpawn(name: string, state: FeedEntry | undefined): { spawnAt: number; spawnId: unknown } | null {
    const schedule = ports.feed().schedule, serverNow = ports.now() + offset;
    const listed = schedule ? occurrences(schedule, name) : [];
    const occurrence = listed.find(entry => entry.at >= serverNow) ?? listed[listed.length - 1];
    const nativeSpawn = state ? feedEpoch(state.spawn) : 0;
    const spawnAt = nativeSpawn || (occurrence ? occurrence.at - offset : 0);
    return spawnAt ? { spawnAt, spawnId: nativeSpawn ? state!.nativeSpawnEpoch || spawnAt + offset : occurrence!.at } : null;
  }
  // A staged event's staging (`due` on the character): from its group's lead before the announced
  // spawn (`leadFor`, the walk estimate's) until the schedule names a later spawn (`nextSpawn`). A walk-boss event that is live is
  // attending, not staging; Slenderman has no spawn and stages while its search runs.
  function attendance(name: string, state: FeedEntry | undefined): Staging | null {
    if (!feedCurrent()) return null;
    const lead = leadFor({ eventLeads: ports.leads() }, name);
    if (eventKey(name)?.assisted && !eventKey(name)?.staged) return ports.searching(name, state) ? { staging: false } : null;
    if (state && state.live === true) { delete stages[name]; return { staging: false }; }
    const next = nextSpawn(name, state);
    if (!next) { delete stages[name]; return null; }
    let spawnAt = next.spawnAt;
    const spawnId = next.spawnId;
    const now = ports.now(), prior = stages[name];
    if (prior && prior.spawnId !== spawnId && ports.joined() === name) { delete stages[name]; return null; }
    // The server's time is fixed for an announced round, so a later report keeps its first spawn.
    if (prior && prior.spawnId === spawnId) spawnAt = prior.spawnAt;
    if (now < spawnAt - lead) return null;
    stages[name] = { spawnAt, spawnId };
    return { staging: true, spawnAt, spawnId };
  }
  // Whether a spawn at `at` is due on this client's clock: the group's lead for `name` (`leadFor`,
  // the walk estimate plus one report interval) has reached it.
  function due(name: string, at: number): boolean {
    const now = ports.now();
    return at > now && at - now <= leadFor({ eventLeads: ports.leads() }, name);
  }
  // The anniversary's walk: its next round staged in Main, at the landing of Main's town
  // transport (`G.maps.main.spawns[0]`), whatever the round's target.
  function anniversaryWalk(feed: Feed) {
    const round = feed.anniversary, spawn = ports.game().maps?.main?.spawns?.[0];
    if (!ports.selected('anniversary') || !round || round.live !== false || !spawn) return null;
    const next = feedEpoch(round.next);
    return next ? { event: 'anniversary', spawnAt: next + ports.reportOffset(), spawnId: next, destination: { map: 'main', x: spawn[0], y: spawn[1] } } : null;
  }
  // The walks the schedule times on the coordinator, their spawn on the report clock: each
  // selected staged event that is not live, with its next spawn and destination, the anniversary's
  // next round, and the Cipher merchant's walk to the Witch by `gather_end` (06 "The Cipher handoff"
  // rule 3). Each walk carries the server's id for its spawn (`spawnId`), the same in every member's
  // report, since each member's report clock moves `spawnAt` by its own clock offset.
  function walks() {
    const feed = status();
    const staged = eventKinds().filter(kind => kind.staged && ports.selected(kind.name) && feed[kind.name]?.live !== true).map(kind => {
      const next = nextSpawn(kind.name, feed[kind.name]), destination = next && ports.destination(kind.name, feed[kind.name]);
      return next && destination ? { event: kind.name, spawnAt: next.spawnAt + ports.reportOffset(), spawnId: next.spawnId, destination } : null;
    });
    const cipher = ports.cipherWalk();
    return [...staged, anniversaryWalk(feed), cipher && { event: 'witchcipher', spawnAt: cipher.at - offset + ports.reportOffset(), spawnId: cipher.at, destination: cipher.destination }].filter(Boolean);
  }
  // The selected staged events now staging, their spawn on the report clock.
  function staging() {
    const feed = status();
    return eventKinds().filter(kind => kind.staged && ports.selected(kind.name)).map(kind => {
      const at = attendance(kind.name, feed[kind.name]);
      return at && at.staging ? { name: kind.name, spawnAt: Number(at.spawnAt) + ports.reportOffset(), spawnId: at.spawnId } : null;
    }).filter(Boolean);
  }
  // The live events of the raw feed. Each instance id comes from the server's own fields, so a clock
  // sync never changes it. An interaction row is live while the October runtime has an activity
  // for it, asked only once it is selected (the activity may select a saved gathering plan); its
  // Trick or Treat occurrence is the server's day.
  function live() {
    const feed = ports.feed();
    return ports.names().filter(name => {
      if (eventKey(name)?.kind === 'interaction') return ports.selected(name) && !!ports.activity(name);
      const state = feed[name];
      return ports.supported(name) && !!state && (ports.walkBoss(name) ? feedCurrent() && state.live === true : state.live !== false);
    }).map(name => {
      if (eventKey(name)?.view === 'doors') return { name, id: 'doors:' + new Date(ports.now() + offset).toISOString().slice(0, 10) };
      const state = feed[name] || {};
      const identity = state.id || state.event_id || state.round || state.start || state.end || state.expires;
      return { name, id: identity == null ? null : String(identity) };
    });
  }
  // The heartbeat's schedule for the dashboard. Calendar epochs are absolute server times; the clock
  // correction applies to countdowns and local deadlines, never to the calendar minute.
  function schedule() {
    const feed = ports.feed(), game = ports.game(), events = game.events || {}, published = feed.schedule || {};
    return ports.names().map(id => {
      const value = feed[id] || {}, now = ports.now() + offset, row = eventKey(id);
      const occurrence = nextPublishedEvent(published, id, now);
      const doors = ports.doors(), cipher = ports.cipher(), witch = events.witchcipher || {};
      return { id, confirmed: !!occurrence,
        occurrences: scheduledOccurrences(published, id).filter(entry => entry.at > now),
        // The game's doors_left is capped by the account's quota, not the account's own balance,
        // so the door history goes with it for the dashboard's projection. The October runtime's
        // `doorStatus` holds back the day before's status until the game's daily resend.
        trickOrTreat: row?.view === 'doors' && doors ? {
          day: new Date(now).toISOString().slice(0, 10), doors: doors.doors, doorsLeft: doors.doors_left,
          characterLimit: (events[id]?.doors || []).length, accountLimit: events[id]?.knocks,
        } : undefined,
        cipher: row?.view === 'cipher' ? { board: feed[id] || null, runtime: ports.october(),
          ingredients: ports.ingredients().map(name => ({ id: name, name: game.items?.[name]?.name || name, sprite: ports.sprite(game.items?.[name]?.skin || name) })),
          gathering: witch.ingredients, merchant: cipher.merchant, stock: cipher.gathering && cipher.gathering.stock, gatheringPlan: cipher.gathering && cipher.gathering.plan,
          sources: (witch.ingredients || []).flatMap(entry => entry[1].map(monsterId => {
            const monster = game.monsters?.[monsterId] || {};
            return { ingredient: entry[0], id: monsterId, name: monster.name || monsterId, sprite: ports.monsterSprite(monster.skin),
              rate: cipherDropRate(witch.loot, monster.hp) };
          })) } : undefined,
        // The anniversary row's label stands for the game's round name; an event the game data
        // names keeps the game's name, and the kinds table names the rest.
        name: row?.kind === 'anniversary' ? row.label : events[id]?.name || row?.label || id,
        live: row?.view === 'doors' ? !!feed.halloween : !!feed[id] && value.live !== false && value.active !== false,
        next: occurrence ? occurrence.at : feedEpoch(value.next || value.spawn) || undefined,
        clockOffsetMs: offset - ports.reportOffset(),
        realmOffsetHours: Number.isFinite(published.time_offset) ? published.time_offset : undefined,
        expires: feedEpoch(value.expires || value.end) || undefined };
    });
  }
  const receiveFeed = (): void => { feedAt = ports.now(); };
  // The clock's game listeners, registered at the routine's start; the generation's stop
  // removes them with its scope.
  function start(): void {
    const socket = ports.socket() as Parameters<ScopeHandle['on']>[0];
    ports.scope.observe.on(socket, 'server_info', receiveFeed);
    ports.scope.observe.on(socket, 'test', receiveClock as (...args: unknown[]) => unknown);
    ports.scope.act.on(socket, 'connect', sync);
    sync();
  }
  return {
    start,
    check, status, attendance, staging, walks, due, live, schedule, feedCurrent,
    feed: ports.feed,
    epoch: feedEpoch,
    // The server's time on the character's clock (the October runtime's clock).
    serverNow: () => ports.now() + offset,
    feedAt: () => feedAt,
    stale: () => !synced || missed,
  };
}
Object.assign(globalThis, { installEventClock });
