// npc-orders (README.md here): standing buy orders from Ponty and Ron. The player keeps the order
// list in the dialog the top bar's "Ponty / Ron" button opens (dashboard.tsx). On the coordinator
// `merchant.job` plans one merchant job at a time, with its walk and game actions as steps, from the
// orders, the `market.ponty` read, the party store and the NPC places movement reads from the game
// data; on the merchant `merchant.step` buys Ron's lots and closes the job.
import type { AddonContext, MerchantKindAsk, Registration, RonListed } from '../../hooks/addon-api.ts';
import { NAME, ORDER_FIELDS, jobEnded, planJob, readOrders, stepAnswer, type MerchantFacts, type Point } from './orders.ts';

const KINDS: { ponty: MerchantKindAsk; ron: MerchantKindAsk } = {
  // A Ponty job runs on its lot's realm, so the merchant buys from every realm's Ponty.
  ponty: { kind: 'ponty', command: 'addon-steps', realm: 'listing', priority: 30, label: 'Ponty orders' },
  // Ron's visit donates gold, so its kind declares spends and runs only once the player switches
  // its routine on.
  ron: { kind: 'ron', command: 'addon-steps', realm: 'here', priority: 20, label: 'Ron orders', spends: true },
};
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;

// The merchant's gold from its last report, the core gold reserve, and Ponty's (`secondhands`) and
// Ron's (`lostandfound`) places.
function merchantFacts(merchant: string, settings: Readonly<Record<string, unknown>>, ctx: AddonContext): MerchantFacts {
  const report = ctx.read('status.lastReport', merchant)?.report ?? {};
  const place = (npc: string) => ctx.read('movement.npcPlace', npc) as Point | null;
  return { places: { ponty: place('secondhands'), ron: place('lostandfound') }, gold: number(report.gold),
    reserve: number(ctx.read('settings.read', { field: 'goldReserve' })) ?? 0, listings: ctx.read('market.ponty'),
    ronDonate: settings.ronDonate === true, ronDonation: number(settings.ronDonation) ?? 0, now: Date.now() };
}

export const registration: Registration = {
  name: NAME, folder: 'addons', author: 'Icelocked',
  summary: 'Standing buy orders from Ponty and Ron: buy X copies or every new copy of an item, under a unit price cap and above the gold reserve.',
  settings: {
    orders: { label: 'Orders (the Ponty / Ron dialog places them)', kind: 'records', fields: ORDER_FIELDS, default: [] },
    // Ron shows his list only after a donation, so a Ron visit spends gold the player agrees to.
    ronDonate: { label: 'Donate to Ron to see his list', kind: 'boolean', default: false },
    ronDonation: { label: 'Gold donated on each Ron visit', kind: 'number', min: 1, default: 100_000 },
  },
  hooks: {
    'merchant.jobKind'(settings) {
      return settings.ronDonate === true ? [KINDS.ponty, KINDS.ron] : [KINDS.ponty];
    },
    'merchant.job'(view, settings, ctx) {
      if (!view.merchant) return undefined;
      return planJob(view, readOrders(settings.orders), merchantFacts(view.merchant, settings, ctx), ctx.store.party);
    },
    'merchant.job.ended'(payload, _settings, ctx) { jobEnded(payload, ctx.store.party); },
    'merchant.step'(view, _settings, ctx) {
      return stepAnswer(view, ctx.store.party, () => ctx.read('npc.lostAndFoundList') as readonly RonListed[], Date.now());
    },
    // The dialog's "Visit Ron" asks the next pass for a Ron job.
    'addon.command'(view, settings, ctx) {
      const body = (view.body ?? {}) as { visitRon?: unknown };
      if (body.visitRon !== true) return { ok: false, status: 400, error: 'npc-orders takes { visitRon: true }' };
      if (settings.ronDonate !== true) return { ok: false, status: 409, error: 'Tick "Donate to Ron to see his list" first' };
      ctx.store.party.set('ronAsk', view.now);
      return { ok: true, reply: { ronAsk: view.now } };
    },
  },
};
