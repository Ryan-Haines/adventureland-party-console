import type { startCoordinatorMail } from "../commerce/mail-startup.ts";
import type { createMailJobs } from "../commerce/mail-jobs.ts";
import type { MerchantWork } from "../merchant/work.ts";

type CollectMail = ReturnType<typeof createMailJobs>["collect"];

/** The account inbox queues the same merchant work used by the coordinator. */
export type CreateMailInbox = Parameters<
  typeof startCoordinatorMail<MerchantWork, CollectMail>
>[2]["createInbox"];

export interface MailPostagePlatform {
  mailPostage(html: string): number | null;
}
