import { createMailJobs, type MailJobState, type MailJobPorts } from "../commerce/mail-jobs.ts";
import { createSendMailRoute } from "./send-mail.ts";
import { createMerchantCompletionRoute } from "./merchant-completion.ts";
import type { CompletionState, CompletionPorts } from "../merchant/completion-types.ts";

type DeliveryState = MailJobState & CompletionState & { nextCommandId: number };
type DeliveryPorts = Omit<MailJobPorts, "nextCommand"> &
  Omit<CompletionPorts, "nextCommand" | "mailComplete" | "fetchAuth"> & {
    identity: (item: unknown) => string;
    inbox: () => { complete: (...args: Parameters<CompletionPorts["mailComplete"]>) => void };
    fetchMarket: (path: string) => Promise<unknown>;
  };

/** Mail requests and completion receipts share durable state; inbox lookup stays deferred until delivery. */
export function createCoordinatorMerchantDeliveryActions(
  state: DeliveryState,
  ports: DeliveryPorts,
) {
  const shared = { ...ports, nextCommand: () => state.nextCommandId++ };
  const mail = createMailJobs(state, shared);
  const send = createSendMailRoute(state, shared);
  const complete = createMerchantCompletionRoute(state, {
    ...shared,
    mailComplete: (id, success, error) => ports.inbox().complete(id, success, error),
    fetchAuth: (character, key) =>
      ports.fetchMarket(
        "/auth/" + encodeURIComponent(String(character)) + "/" + encodeURIComponent(key),
      ),
  });
  return { mail, send, complete };
}
