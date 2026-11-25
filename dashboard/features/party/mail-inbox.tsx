"use client";
import { ReceivedMail } from "./received-mail";

export type MailInbox = {
  messages: ReceivedMail[];
  newCount?:number;
  settings?:{autoCollect:boolean;autoDelete:boolean};
  outbox?:import("../../../runtime/items/api").SentMailRecord[];
  // The items owner's one line for the automatic actions the game refused, each kept while still due,
  // as v1.5.0 does (commerce/mailbox.ts).
  automationError?:string|null;
  count: number;
  updatedAt: number | null;
  error: string | null;
};
