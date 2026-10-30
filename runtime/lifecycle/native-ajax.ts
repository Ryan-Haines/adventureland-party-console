import http from "node:http";

// jQuery's transport contract (jQuery 3 ajaxTransport). These interfaces type
// only the fields this transport reads; jQuery owns the rest of the settings.
interface AjaxOptions {
  url: string;
  type: string;
  async?: boolean;
  crossDomain?: boolean;
  hasContent?: boolean;
  data?: unknown;
  dataTypes: string[];
}
type Complete = (status: number, statusText: string, responses?: { text: string }, headers?: string) => void;
interface Transport {
  send(headers: Record<string, string>, complete: Complete): void;
  abort(): void;
}
interface JQueryAjax {
  ajaxTransport(dataTypes: string, factory: (options: AjaxOptions) => Transport | undefined): void;
  ajax: (url?: unknown, options?: unknown) => unknown;
  ajaxSettings: { url?: unknown; crossDomain?: unknown };
}

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"]);
// The coordinator keeps Node's default 5 s keep-alive timeout. Idle sockets
// close first, so the server never resets a reused socket mid-request.
const agent = new http.Agent({ keepAlive: true, timeout: 4000 });

/** Asynchronous HTTP requests to this host with a string or empty body. */
export function nativeAjaxEligible(options: AjaxOptions): boolean {
  if (options.async === false) return false;
  if (options.dataTypes.some((type) => type === "script" || type === "jsonp")) return false;
  if (options.hasContent && options.data != null && typeof options.data !== "string") return false;
  let url: URL;
  try { url = new URL(options.url); } catch { return false; }
  return url.protocol === "http:" && loopback.has(url.hostname);
}

function headerText(raw: string[]): string {
  let text = "";
  for (let index = 0; index + 1 < raw.length; index += 2) text += raw[index] + ": " + raw[index + 1] + "\r\n";
  return text;
}

function originKey(url: URL): string {
  return url.protocol + "//" + url.host;
}

/**
 * jQuery decides crossDomain for each request by assigning the URL to a jsdom
 * anchor element and reading its protocol and host back. jsdom parses that URL
 * in JavaScript, about 200 us per request (half of a status POST's CPU in the
 * runner benchmark, docs/efficiency.md, CT9). For an absolute http(s) URL this
 * wrapper computes the same comparison with Node's URL parser and passes it as
 * the crossDomain option. jQuery keeps its own decision for relative and
 * protocol-relative URLs, unparseable URLs, and requests whose options or
 * ajaxSetup already set crossDomain. The wrapper copies the caller's options
 * object and never edits it.
 */
function presetCrossDomain(host: JQueryAjax): void {
  let origin: string;
  try { origin = originKey(new URL(String(host.ajaxSettings.url))); } catch { return; }
  const decide = (target: unknown, settings: Record<string, unknown> | undefined): boolean | undefined => {
    if (typeof target !== "string" || !/^\s*https?:\/\//i.test(target)) return undefined;
    if (settings?.crossDomain != null || host.ajaxSettings.crossDomain != null) return undefined;
    try { return originKey(new URL(target)) !== origin; } catch { return undefined; }
  };
  const ajax = host.ajax;
  host.ajax = function (this: unknown, url?: unknown, options?: unknown) {
    const object = typeof url === "object" && url !== null;
    const settings = (object ? url : options) as Record<string, unknown> | undefined;
    const crossDomain = decide(object ? settings?.url : url || settings?.url, settings);
    if (crossDomain === undefined) return Reflect.apply(ajax, this, arguments);
    // jQuery merges options with for-in, so the copy keeps their prototype.
    const preset = Object.assign(Object.create(settings ? Object.getPrototypeOf(settings) : null), settings, { crossDomain });
    return Reflect.apply(ajax, this, object ? [preset] : [url, preset]);
  };
}

/**
 * Headless CODE runs inside jsdom. Its XMLHttpRequest builds a new keep-alive
 * agent, so a new TCP connection, for every request, and converts each body
 * with a JavaScript USVString pass over every character. Status reports are
 * hundreds of KB and combat reports go out up to ten times a second. This
 * transport sends the same method, headers and UTF-8 bytes through Node's HTTP
 * client over one keep-alive agent. jQuery still owns timeouts, conversion,
 * deferreds and global ajax events, so callers see the same outcomes.
 */
export function installNativeAjax(jquery: unknown): void {
  const host = jquery as Partial<JQueryAjax> | null;
  if (!host || typeof host.ajaxTransport !== "function") return;
  if (typeof host.ajax === "function" && host.ajaxSettings) presetCrossDomain(host as JQueryAjax);
  host.ajaxTransport("+*", (options) => {
    if (!nativeAjaxEligible(options)) return undefined;
    let request: http.ClientRequest | undefined;
    let settled = false;
    return {
      send(headers, complete) {
        const finish: Complete = (...args) => { if (!settled) { settled = true; complete(...args); } };
        const body = options.hasContent && typeof options.data === "string" ? options.data : null;
        const outgoing: Record<string, string> = { ...headers };
        // jQuery's XHR transport sets this header only for same-origin requests.
        if (!options.crossDomain && !outgoing["X-Requested-With"]) outgoing["X-Requested-With"] = "XMLHttpRequest";
        if (body !== null) outgoing["Content-Length"] = String(Buffer.byteLength(body));
        const send = (retry: boolean) => {
          const current = http.request(options.url, { method: options.type, headers: outgoing, agent }, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk: Buffer) => chunks.push(chunk));
            response.on("end", () => finish(response.statusCode || 0, response.statusMessage || "",
              { text: Buffer.concat(chunks).toString("utf8") }, headerText(response.rawHeaders)));
            response.on("aborted", () => finish(0, ""));
            response.on("error", () => finish(0, ""));
          });
          request = current;
          current.on("error", (error: NodeJS.ErrnoException) => {
            if (settled) return;
            // Node's documented keep-alive race: the server closed an idle socket
            // while the agent reused it, so the request never reached the server.
            if (retry && current.reusedSocket && error.code === "ECONNRESET") return send(false);
            // jQuery's XHR transport reports a network failure as status 0 with
            // an empty status text; jQuery then rejects with "error".
            finish(0, "");
          });
          current.end(body ?? undefined);
        };
        send(true);
      },
      abort() {
        settled = true;
        request?.destroy();
      },
    };
  });
}
