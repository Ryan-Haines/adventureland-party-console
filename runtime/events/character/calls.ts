// The events owner's game calls on the character ask the call budget owner's call budget before they go:
// the join, the anniversary's kiss, the merchant's chat
// adverts and the October runtime's knock, Cipher read and brew ask the `job` band and wait for the
// call window while it answers "not now", as the merchant jobs owner's hand calls do; the clock's `test` echo asks the `background` band and skips its sync when refused.
import { partyHooks } from '../../hooks/index.ts';
import { scope } from '../../lifecycle/api.ts';

// The events owner's run scope handle, `act`: a band wait and a reply's bound
// hold with the character and resume at release.
const act = () => scope('06', 'act');

// `method` and `data` are the socket event and its payload, which 09 prices (call-budget.ts `charge`).
export async function jobCall<T>(method: string, call: () => Promise<T>, data?: unknown): Promise<T> {
  await partyHooks().calls.wait({ band: 'job', method, data }, act());
  return call();
}
export function backgroundCall(method: string, call: () => void): boolean {
  if (partyHooks().calls.band({ band: 'background', method }) !== 'send') return false;
  call();
  return true;
}
// The window's largest round trip (`calls.margin`), which bounds a reply the server sends from
// inside its handler.
export const callMargin = (): number => partyHooks().calls.margin();
// the call budget owner's margin call (hooks/rows/09-calls.ts `calls.marginCall`) on the events owner's run scope and bound record.
export function marginCall<T>(method: string, call: () => Promise<T>, label: string, data?: unknown, bound = callMargin()): Promise<T> {
  return partyHooks().calls.marginCall('06', act(), method, call, label, data, bound);
}

// The events owner's add-on doors: `chat.say` and `event.join`. Each asks the band the
// dispatcher names once and answers sent or refused; a game error rejects. events/api.ts reaches
// them through `__partyEventDoors`.
type Untyped = (...args: any[]) => any;
declare const say: Untyped, party_say: Untyped, join: Untyped, parent: { private_say: Untyped };
declare const G: { events?: Record<string, { join?: unknown } | undefined> };
// The coordinator's admission answer for one event.join ask (events/coordinator/api.ts `eventAskFacts`),
// which the dispatcher hands the door beside the add-on's args. A character-side ask carries none.
export interface EventDoorFacts { admitted?: boolean }
export type ChatBand = 'job' | 'background';
export type ChatAnswer = { outcome: 'sent'; reply?: unknown } | { outcome: 'refused'; by: string; reason: string };
const refused = (reason: string): ChatAnswer => ({ outcome: 'refused', by: '06', reason });
async function doorCall(band: ChatBand, method: string, call: () => unknown): Promise<ChatAnswer> {
  if (band === 'background') {
    if (partyHooks().calls.band({ band, method }) !== 'send') return refused('call budget refused the background band');
  } else await partyHooks().calls.wait({ band: 'job', method }, act());
  return { outcome: 'sent', reply: await call() };
}
export const eventDoors = {
  // Public chat, party chat, or a whisper to any player named by `name` (decisions.md: the player's choice).
  chatSay(args: Readonly<Record<string, unknown>>, band: ChatBand): Promise<ChatAnswer> {
    const { message, party, name } = args;
    if (typeof message !== 'string' || !message.trim()) return Promise.resolve(refused('chat.say needs a message'));
    if (name !== undefined && (typeof name !== 'string' || !name)) return Promise.resolve(refused('a whisper needs a player name'));
    return doorCall(band, 'say', () => typeof name === 'string' ? parent.private_say(name, message) : party === true ? party_say(message) : say(message));
  },
  // A join the game offers (`G.events[event].join`, `eventJoins`) that the coordinator's admission checks admit
  // for this member: not over a limit, not refused, not left, and the Cave allows it.
  // The player's selection is the add-on's ask. The next report's admission then records the attendance.
  eventJoin(args: Readonly<Record<string, unknown>>, band: ChatBand, facts: EventDoorFacts = {}): Promise<ChatAnswer> {
    const { event } = args;
    if (typeof event !== 'string' || !G.events?.[event]?.join) return Promise.resolve(refused('event.join needs an event the game joins'));
    if (facts.admitted === undefined) return Promise.resolve(refused("06's admission is not known for this ask"));
    if (!facts.admitted) return Promise.resolve(refused("06's admission refuses that event for this member"));
    return doorCall(band, 'join', () => join(event));
  },
};
Object.assign(globalThis, { __partyEventDoors: eventDoors });
