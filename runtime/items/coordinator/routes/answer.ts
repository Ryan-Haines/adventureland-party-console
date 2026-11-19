// A route's reply: each route
// parses its request and makes one call to its area file, which decides and answers with an
// ItemsAnswer.
import { requestObject, type HttpHandler, type HttpResponse } from '../../../lifecycle/api.ts';

/** An area file's answer to one route call: the HTTP status (200 when absent) and the body. */
export interface ItemsAnswer {
  status?: number;
  body: unknown;
}
export function send(res: HttpResponse, answer: ItemsAnswer): unknown {
  return answer.status ? res.status(answer.status).json(answer.body) : res.json(answer.body);
}
/** The route's one call, with the request's body parsed. */
export function route(answer: (body: Record<string, unknown>) => ItemsAnswer): HttpHandler {
  return (req, res) => send(res, answer(requestObject(req.body)));
}
export function asyncRoute(answer: (body: Record<string, unknown>) => Promise<ItemsAnswer>): HttpHandler {
  return async (req, res) => send(res, await answer(requestObject(req.body)));
}
