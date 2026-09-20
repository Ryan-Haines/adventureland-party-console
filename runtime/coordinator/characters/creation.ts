import { requestObject, requestText } from "../http/contracts.ts";
import type { createRosterProjection } from "./roster-projection.ts";

type AccountSnapshot = Record<string, unknown> &
  ReturnType<Parameters<typeof createRosterProjection>[1]>;

interface CreationReply {
  ok: boolean;
  statusText: string;
  payload: unknown;
}
export interface CharacterCreationPorts {
  request(name: string, characterClass: string, look: number): Promise<CreationReply>;
  adopt(snapshot: AccountSnapshot): void;
  owned(name: string): unknown;
  refresh(): Promise<unknown>;
  delay(milliseconds: number): Promise<void>;
}

function messages(payload: unknown): Record<string, unknown>[] {
  const entries = Array.isArray(payload) ? payload : requestObject(payload).infs;
  return Array.isArray(entries) ? entries.map(requestObject) : [];
}

function failedResult(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) return null;
  const body = requestObject(payload),
    result = requestObject(body.result || body.response || body);
  return result.failed || result.success === false || result.reason ? result : null;
}

function preferredMessage(
  details: Record<string, unknown> | null | undefined,
  preferReason: boolean,
): unknown {
  return preferReason ? details?.reason || details?.message : details?.message || details?.reason;
}

function failureReason(
  reply: CreationReply,
  entries: Record<string, unknown>[],
  preferReason: boolean,
): unknown {
  const failure = entries.find(
    (entry) => entry.type === "ui_error" || entry.type === "error" || entry.reason,
  );
  const result = failedResult(reply.payload);
  if (reply.ok && !failure && !result) return null;
  const details = failure || result;
  const message = preferredMessage(details, preferReason);
  return message || reply.statusText || "creation failed";
}

/** Confirm an accepted creation before another name or worker can be attempted. */
export function createCharacterCreation(ports: CharacterCreationPorts) {
  async function confirm(name: string, entries: Record<string, unknown>[]): Promise<unknown> {
    const snapshot = entries.find(
      (entry): entry is AccountSnapshot =>
        entry.type === "servers_and_characters" && Array.isArray(entry.characters),
    );
    if (snapshot) ports.adopt(snapshot);
    for (let attempt = 0; !ports.owned(name) && attempt < 5; attempt++) {
      if (attempt) await ports.delay(500);
      await ports.refresh();
    }
    return ports.owned(name);
  }
  async function create(name: string, characterClass: string, look: number, preferReason = false) {
    const reply = await ports.request(name, characterClass, look),
      entries = messages(reply.payload);
    const failure = failureReason(reply, entries, preferReason);
    if (failure) return { accepted: false, confirmed: false, error: failure };
    return { accepted: true, confirmed: await confirm(name, entries), error: null };
  }
  async function bankboi(prefix: string): Promise<string> {
    let lastReason = "no available Bankboi name";
    for (let number = 0; number < Math.min(10000, 10 ** (12 - prefix.length)); number++) {
      const name = prefix + number;
      if (ports.owned(name)) continue;
      const result = await create(name, "merchant", 0, true);
      if (!result.accepted) {
        lastReason = requestText(result.error);
        if (/name|used|exist/i.test(lastReason)) continue;
        throw new Error(lastReason);
      }
      if (!result.confirmed)
        throw new Error(
          "Adventure Land accepted the request, but the account roster did not confirm " +
            name +
            ". No additional name was attempted.",
        );
      return name;
    }
    throw new Error(lastReason);
  }
  return { create, bankboi };
}
