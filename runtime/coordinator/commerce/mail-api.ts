import { requestObject, requestText } from "../http/contracts.ts";

interface MailResponse {
  ok: boolean;
  json(): Promise<unknown>;
}
interface MailApiPorts {
  post(method: string, args: unknown): Promise<MailResponse>;
}
function decode(raw: unknown): { messages: unknown[]; result: Record<string, unknown> } {
  if (Array.isArray(raw)) return { messages: raw, result: {} };
  const payload = requestObject(raw);
  return {
    messages: Array.isArray(payload.infs) ? payload.infs : [],
    result: requestObject(payload.result || payload.response || payload),
  };
}
/** The account API returns either an array of messages or an envelope with infs/result. */
export function createMailApi(ports: MailApiPorts) {
  return async function api(method: string, args: unknown): Promise<unknown[]> {
    const response = await ports.post(method, args),
      { messages, result } = decode(await response.json());
    const failure = messages
      .map(requestObject)
      .find((entry) => ["error", "ui_error"].includes(requestText(entry.type)));
    if (!response.ok || failure || result.failed || result.success === false)
      throw new Error(requestText(failure?.message || result.reason || "Mail request failed"));
    return messages;
  };
}
