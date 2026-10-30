import { createHash } from "node:crypto";
import { requestText, type HttpRequest, type HttpResponse } from "../http/contracts.ts";

/**
 * Large sections the dashboard polls every 1-10 s although they often stay
 * the same: bank (4.4 MB live), logs (1.2 MB) and market (1.75 MB).
 */
export const revisionSections = new Set(["bank", "logs", "market"]);

/**
 * The revision is a hash of the serialized section, so any field the section
 * carries changes it. It replaces the hash Express computes for its ETag.
 * A client opts in with `revision=` (browsers add `Cache-Control: no-cache`
 * to a fetch that sets If-None-Match, and Express then never answers 304) or
 * with If-None-Match; either match answers 304 without a body. A client that
 * sends neither gets the full body as before.
 */
export function sendWithRevision(request: HttpRequest, response: HttpResponse, value: unknown): unknown {
  const body = JSON.stringify(value);
  const revision = createHash("sha1").update(body).digest("base64url");
  response.set("ETag", `"${revision}"`);
  if (requestText(request.query?.revision) === revision || request.get?.("If-None-Match") === `"${revision}"`)
    return response.status(304).end();
  response.set("Content-Type", "application/json; charset=utf-8");
  return response.send(body);
}
