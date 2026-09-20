export interface LiveRecord {
  generation: string;
  sample: number;
  sampledAt: number;
  vitals: Record<string, unknown>;
  items: Record<string, unknown>;
  slots: Record<string, unknown>;
}
export interface LiveMessage {
  type: 'snapshot' | 'delta' | 'heartbeat';
  epoch: string;
  sequence: number;
  characters?: Record<string, LiveRecord | null>;
}
export function createLiveReceiver(
  write: (name: string, record: LiveRecord | null) => void,
) {
  let epoch = '',
    sequence = -1;
  const records = new Map<string, LiveRecord>();
  function accept(message: LiveMessage) {
    if (
      !message ||
      !Number.isSafeInteger(message.sequence) ||
      typeof message.epoch !== 'string'
    )
      return false;
    if (message.type === 'heartbeat') return message.epoch === epoch;
    if (message.type !== 'snapshot' && message.type !== 'delta') return false;
    if (
      message.type === 'delta' &&
      (message.epoch !== epoch || message.sequence <= sequence)
    )
      return false;
    if (message.type === 'snapshot') {
      for (const name of records.keys())
        if (!message.characters?.[name]) write(name, null);
      records.clear();
      epoch = message.epoch;
    }
    sequence = message.sequence;
    for (const [name, incoming] of Object.entries(message.characters || {})) {
      if (!incoming) {
        records.delete(name);
        write(name, null);
        continue;
      }
      const previous = records.get(name);
      if (
        previous?.generation === incoming.generation &&
        incoming.sample < previous.sample
      )
        continue;
      const same = previous?.generation === incoming.generation;
      const next = {
        ...incoming,
        vitals: { ...(same ? previous.vitals : {}), ...incoming.vitals },
        items: { ...(same ? previous.items : {}), ...incoming.items },
        slots: { ...(same ? previous.slots : {}), ...incoming.slots },
      };
      records.set(name, next);
      write(name, next);
    }
    return true;
  }
  return { accept };
}
