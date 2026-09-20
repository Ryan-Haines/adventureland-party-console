import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";

export interface MailInbox {
  snapshot(): unknown;
  refresh(): Promise<unknown>;
  collect(id: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  complete(id: string, success: boolean, error: unknown): void;
}
export function createMailInboxRoutes(inbox: MailInbox) {
  function snapshot(_req: HttpRequest, res: HttpResponse): unknown {
    return res.json(inbox.snapshot());
  }
  function action(name: "refresh" | "collect" | "delete") {
    return async function handle(req: HttpRequest, res: HttpResponse): Promise<unknown> {
      try {
        const id = requestText(requestObject(req.body).id || "");
        const result =
          name === "refresh"
            ? await inbox.refresh()
            : name === "collect"
              ? await inbox.collect(id)
              : await inbox.remove(id);
        return res.json(result);
      } catch (error) {
        return res.status(409).json({ error: requestObject(error).message });
      }
    };
  }
  return { snapshot, action };
}
