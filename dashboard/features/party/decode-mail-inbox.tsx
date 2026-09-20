"use client";
import { Item } from "./item";
import { MailInbox } from "./mail-inbox";

export function decodeMailInbox(data: MailInbox): MailInbox {
  // Accept snapshots from a coordinator that has not yet restarted with the decoder.
  return {
    ...data,
    messages: data.messages.map((mail) => ({
      ...mail,
      item: typeof mail.item === "string" ? (JSON.parse(mail.item) as Item) : mail.item,
    })),
  };
}
