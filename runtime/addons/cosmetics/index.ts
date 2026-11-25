// Cosmetics (README.md here): a panel under Equipped on each character's card with the
// character's worn and owned looks, its CX jars and its emotes, and buttons that put a look on, take
// one off or play an emote. The character sends its wardrobe with each status through
// `status.report`; the card's `equipped` part draws it (dashboard.tsx). A press reaches
// `addon.command` on the coordinator, which asks the character for the action (commands.ts) and
// keeps the press until `addon.acted` settles it.
import type { ActionOutcome, Registration } from '../../hooks/addon-api.ts';
import { commandAsk, lastKey, lastPress, pendingKey } from './commands.ts';
import { cosmeticsReport } from './report.ts';

interface Pending { id: string; label: string }

export const registration: Registration = {
  name: 'cosmetics', folder: 'addons', author: 'Icelocked',
  summary: "Shows each character's CX jars, the looks it owns and wears, and its emotes in a Cosmetics panel under Equipped on its card, with buttons to put a look on or off and play an emote.",
  hooks: {
    'status.report'(view) { return cosmeticsReport(view) as unknown as Record<string, unknown> | undefined; },
    'addon.command'(view, _settings, ctx) {
      if (!view.character) return { ok: false, status: 400, error: 'a press names its character' };
      const press = commandAsk(view.body);
      if ('error' in press) return { ok: false, status: 400, error: press.error };
      const ticket = ctx.act({ ...press.ask, character: view.character });
      // A second press before the first settles replaces it in the action queue, which settles the
      // first `refused`. The pending key holds only the newest press, so the panel names that one.
      ctx.store.party.set(pendingKey(view.character), { id: ticket.id, label: press.label } satisfies Pending);
      return { ok: true, reply: { id: ticket.id } };
    },
    'addon.acted'(payload, _settings, ctx) {
      const outcome = payload as unknown as ActionOutcome;
      const pending = ctx.store.party.get(pendingKey(outcome.character)) as Pending | null | undefined;
      if (pending?.id !== outcome.id) return;
      ctx.store.party.set(lastKey(outcome.character), lastPress(outcome, pending.label, Date.now()));
      ctx.store.party.set(pendingKey(outcome.character), null);
    },
  },
};
