import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  createMailJobs,
  type MailJobState,
  type MailJobPorts,
  type OutgoingMail,
} from "../commerce/mail-jobs.ts";

function envelope(body: Record<string, unknown>): OutgoingMail | string {
  const recipient = typeof body.recipient === "string" ? body.recipient.trim() : "";
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";
  if (!/^[A-Za-z0-9_]{1,40}$/.test(recipient)) return "enter a valid character name";
  if (!subject || subject.length > 74) return "subject must be 1-74 characters";
  if (message.length > 1000) return "message must be at most 1,000 characters";
  return { recipient, subject, message };
}
function validQuantity(quantity: number, available: number): boolean {
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= available;
}
export function createSendMailRoute(
  state: MailJobState,
  ports: MailJobPorts & { identity(item: unknown): string },
) {
  const jobs = createMailJobs(state, ports);
  function attachment(
    body: Record<string, unknown>,
    mail: OutgoingMail,
    res: HttpResponse,
  ): boolean {
    const source = requestObject(body.source),
      pack = typeof source.pack === "string" ? source.pack : "",
      slot = Number(source.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= 42) {
      res.status(400).json({ error: "select an item to attach" });
      return false;
    }
    const entry = jobs.entry(pack, slot);
    if (!entry?.item || ports.identity(entry.item) !== ports.identity(source.item)) {
      res.status(409).json({ error: "the selected item is no longer in that slot" });
      return false;
    }
    const quantity = Number(body.quantity),
      available = Math.max(1, Number(entry.item.q) || 1);
    if (!validQuantity(quantity, available)) {
      res.status(400).json({ error: "enter an available whole-number quantity" });
      return false;
    }
    mail.quantity = quantity;
    mail.source = { pack, slot, item: entry.item };
    return true;
  }
  return function send(req: HttpRequest, res: HttpResponse): unknown {
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    const body = requestObject(req.body),
      mail = envelope(body);
    if (typeof mail === "string") return res.status(400).json({ error: mail });
    if (body.source && typeof body.source === "object" && !attachment(body, mail, res))
      return undefined;
    const job = jobs.send(mail);
    return res.json({ ok: true, jobId: job.id });
  };
}
