// The character's action dispatcher. Every game call
// runs on the character, because only the character holds the socket. A character-side ask comes
// here from the queue; a coordinator-side ask comes here from the reply's `addonActions`. The
// steps run in order and stop at the first refusal:
//   1. the owner's `ACTIONS` row: a missing row refuses, and a closed row refuses with its code;
//   2. the common holds, which a heal already obeys, so survival comes first;
//   3. the owner's door with the args, which applies the owner's own refusals;
//   4. inside the door, the call budget's band, as the owner's own calls ask it.
import type { ActionOutcome, ActionRow, Door } from '../registry.ts';
import type { QueuedAction } from './queue.ts';

// The first common hold, named by its owner, or nothing.
export type Holds = () => { by: string; reason: string } | undefined;

export interface DispatchPorts {
  row(action: string): ActionRow | undefined;
  door(name: string): Door | undefined;
  holds: Holds;
}

// `on` is the band the ask runs in, and on a C2 step the job that holds the merchant.
export async function runAction(a: QueuedAction, ports: DispatchPorts, on: { band: 'background' | 'job'; holder?: string } = { band: 'background' }): Promise<ActionOutcome> {
  const base = { id: a.id, action: a.action, character: a.character, addon: a.addon };
  const row = ports.row(a.action);
  if (!row) return { ...base, outcome: 'refused', by: '14', reason: `no owner offers the action ${JSON.stringify(a.action)}` };
  if ('closed' in row) return { ...base, outcome: 'refused', by: row.closed, reason: row.cite };
  const held = ports.holds();
  if (held) return { ...base, outcome: 'refused', by: held.by, reason: held.reason };
  const door = ports.door(row.door);
  if (!door) return { ...base, outcome: 'refused', by: '14', reason: `the door ${row.door} is not installed on this character` };
  try {
    return { ...base, ...await door(a.args, { id: a.id, action: a.action, band: on.band, addon: a.addon, character: a.character, reason: a.reason,
      ...(on.holder ? { holder: on.holder } : {}), ...(a.facts ? { facts: a.facts } : {}) }) };
  } catch (error) {
    return { ...base, outcome: 'failed', error: String(error) };
  }
}
