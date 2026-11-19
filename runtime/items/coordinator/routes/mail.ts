// The mail routes: each parses
// its request and asks mail.ts once.
import { requestObject, requestText, type HttpRequest, type HttpResponse } from '../../../lifecycle/api.ts';
import { createMailJobs, createMailSend, type MailInbox, type MailJobState, type MailJobPorts } from '../mail.ts';
import { send as reply } from './answer.ts';

export function createMailInboxRoutes(inbox: MailInbox) {
  function snapshot(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json(inbox.snapshot());
  }
  function action(name: 'refresh' | 'collect' | 'delete' | 'settings' | 'seen' | 'outbox-delete') {
    return async function handle(req: HttpRequest, res: HttpResponse): Promise<unknown> {
      try {
        const id = requestText(requestObject(req.body).id || '');
        const result = name === 'settings' ? await inbox.configure(req.body) : name === 'seen' ? inbox.seen()
          : name === 'outbox-delete' ? inbox.removeSent(id) : name === 'refresh' ? await inbox.refresh()
          : name === 'collect' ? await inbox.collect(id) : await inbox.remove(id);
        return res.json(result);
      } catch (error) {
        return res.status(409).json({ error: requestObject(error).message });
      }
    };
  }
  return { snapshot, action };
}

export function createSendMailRoute(state: MailJobState, ports: MailJobPorts & { identity(item: unknown): string }) {
  const send = createMailSend(state, ports);
  return function sendRoute(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    return reply(res, send({ recipient: body.recipient, subject: body.subject, message: body.message, source: body.source, quantity: body.quantity }));
  };
}
