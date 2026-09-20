import { createCompletionResults } from '../merchant/completion-results.ts';
import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { createMerchantCompletion } from "../merchant/completion.ts";
import type {
  CompletionState,
  CompletionPorts,
  CompletionReport,
} from "../merchant/completion-types.ts";

export function createMerchantCompletionRoute(state: CompletionState, ports: CompletionPorts) {
  const completion = createMerchantCompletion(state, ports);
  function validReceipt(body: Record<string, unknown>): body is Record<string, unknown> & {target: string; deliveryId: string} {
    return body.character === state.merchantCharacter && typeof body.target === 'string' &&
      typeof body.deliveryId === 'string' && ['confirmed', 'uncertain'].includes(String(body.phase));
  }
  function receipt(body: Record<string, unknown>, res: HttpResponse): unknown {
      if (!validReceipt(body))
        return res.status(400).json({error: 'invalid delivery receipt'});
      const mark = state.merchantDeliveries[body.target]?.find(entry => entry.id === body.deliveryId);
      if (mark && !mark.awaitingEquip && body.phase !== 'confirmed') {
        mark.blocked = 'Transfer outcome uncertain';
      } else if (mark) {
        createCompletionResults(state, ports).resolve({id: 'delivery-receipt', target: body.target, reason: 'delivery'},
          {merchantDeliveriesDelivered: [{...mark}]});
      }
      ports.persist();
      return res.json({ok: true, pending: !!mark && !mark.awaitingEquip});
  }
  return function complete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (body.deliveryReceipt === true) return receipt(body, res);
    if (!current || body.jobId !== current.id)
      return res.status(409).json({ error: "merchant job is no longer current" });
    completion.complete(current, body as CompletionReport);
    return res.json({ ok: true });
  };
}
