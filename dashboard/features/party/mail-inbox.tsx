"use client";
import { ReceivedMail } from "./received-mail";

export type MailInbox = {
  messages: ReceivedMail[];
  count: number;
  updatedAt: number | null;
  error: string | null;
};
