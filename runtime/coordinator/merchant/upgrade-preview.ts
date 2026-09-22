import { randomUUID } from 'node:crypto';
import { requestObject, type HttpRequest, type HttpResponse, type HttpRouter } from '../http/contracts.ts';
import { unavailablePreview, previewOptions, type UpgradePreviewRequest, type UpgradePreviewResult } from '../../upgrade-preview.ts';
import type { InventoryEntry, Item } from '../contracts/item.ts';

interface Status { seenAt?: number; upgradePreviewSession?: string; items?: (InventoryEntry | null)[] }
interface State { merchantCharacter?: string | null; statuses: Record<string, Status | undefined> }
interface Pending { request: UpgradePreviewRequest; finish(value: UpgradePreviewResult): void }

/** Ephemeral preview requests never enter the durable merchant job or command queues. */
export function createUpgradePreviews(state: State, now = Date.now) {
  const pending = new Map<string, Pending>();
  function fail(executor: string, item: Item, reason: string, res: HttpResponse) {
    return res.json(unavailablePreview(executor, item, reason));
  }
  function request(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body), item = requestObject(body.item), executor = state.merchantCharacter || '';
    if (typeof item.name !== 'string' || !Number.isInteger(body.slot) || Number(body.slot) < 0)
      return res.status(400).json({ error: 'Invalid preview item' });
    if (body.character !== executor || body.equipped)
      return fail(executor, item, 'Item not in merchant inventory', res);
    const reason = unavailable(executor, Number(body.slot), item);
    if (reason) return fail(executor, item, reason, res);
    const request: UpgradePreviewRequest = { id: randomUUID(), executor, item, slot: Number(body.slot), session: state.statuses[executor]!.upgradePreviewSession!, expiresAt: now() + 10000 };
    const timer = setTimeout(() => finish(unavailablePreview(executor, item, 'Preview timed out; refresh')), 10000);
    const finish = (value: UpgradePreviewResult) => {
      if (pending.get(executor)?.request.id !== request.id) return;
      pending.delete(executor); clearTimeout(timer); res.json(value);
    };
    pending.set(executor, { request, finish });
  }
  function unavailable(executor: string, slot: number, item: Item): string | null {
    const status = state.statuses[executor];
    if (!status?.seenAt || now() - status.seenAt > 15000) return 'Merchant offline';
    if (!status.upgradePreviewSession) return 'Merchant preview runtime unavailable';
    if (pending.has(executor)) return 'Merchant preview busy; refresh';
    const live = status.items?.find(entry => entry?.slot === slot)?.item;
    return live && Object.entries(item).every(([key, value]) => JSON.stringify(live[key]) === JSON.stringify(value))
      ? null : 'Item changed; reopen the menu';
  }
  function response(req: HttpRequest, res: HttpResponse) {
    const body = requestObject(req.body), entry = pending.get(String(body.character));
    if (!entry || !validResponse(body, entry.request)) return res.status(409).json({ error: 'Preview expired or changed' });
    entry.finish(body.result as UpgradePreviewResult);
    return res.json({ ok: true });
  }
  function validResponse(body: Record<string, unknown>, request: UpgradePreviewRequest): boolean {
    if (body.id !== request.id || body.session !== request.session || now() >= request.expiresAt ||
        state.merchantCharacter !== request.executor || state.statuses[request.executor]?.upgradePreviewSession !== request.session) return false;
    const result = requestObject(body.result), options = requestObject(result.options);
    return result.executor === request.executor && JSON.stringify(result.item) === JSON.stringify(request.item) &&
      previewOptions.every(option => {
        const value = requestObject(options[option]), preview = requestObject(value.preview);
        return typeof value.reason === 'string' || preview.calculate === true && typeof preview.chance === 'number' && Number.isFinite(preview.chance) && preview.chance >= 0 && typeof value.observedAt === 'number';
      });
  }
  return {
    next(name: string) { return pending.get(name)?.request; },
    install(router: HttpRouter) {
      router.post('/party-api/upgrade-preview', request);
      router.post('/party-api/upgrade-preview/result', response);
    },
  };
}
