"use client";
import { Item } from "./item";

export type ReceivedMail = {
  id: string;
  from: string;
  to: string;
  subject: string;
  message: string;
  sent: string;
  item?: Item | null;
  taken: boolean | "pending";
  collection?: string | null;
  collectionError?: string | null;
};
