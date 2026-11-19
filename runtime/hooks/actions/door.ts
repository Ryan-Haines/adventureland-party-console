// the add-on owner's door for the game events no owner's keyword names (addon-capabilities.md C1 "The one
// table, derived"). It sends the event with the add-on's args under the common holds, which the
// dispatcher runs first, and the `background` band only: near the call limit the band answers
// "not now" and the action settles refused, so survival and job calls keep their room.
import type { CallAnswer, CallQuestion, Door } from '../registry.ts';

export interface GameEventPorts {
  emit(event: string, data: unknown): void;
  band(question: CallQuestion): CallAnswer;
}
export function gameEvent(ports: GameEventPorts): Door {
  return (args, ask) => {
    if (ports.band({ band: 'background', method: ask.action, data: args }) !== 'send')
      return { outcome: 'refused', by: '09', reason: 'the call budget holds background calls near the limit' };
    ports.emit(ask.action, args);
    return { outcome: 'sent' };
  };
}
