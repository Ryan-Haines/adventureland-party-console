import { createMailApi } from "./mail-api.ts";
import { createMailInboxRoutes } from "../http/mail-inbox.ts";
import type { MailInbox } from "../http/mail-inbox.ts";

type MailResponse = Awaited<ReturnType<Parameters<typeof createMailApi>[0]["post"]>>;
type MailFetch = (
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body: string | undefined;
    signal: AbortSignal;
  },
) => Promise<MailResponse>;
interface MailState<Job> {
  merchantCurrent?: Job | null;
  merchantQueue: (Job | null | undefined)[];
}
interface MailAccount {
  response: { characters?: { name: string }[] | null };
}
interface MailStartupPorts<Job, Enqueue> {
  session: string | undefined;
  loadFetch: () => Promise<MailFetch>;
  timeout: (milliseconds: number) => AbortSignal;
  createInbox: (options: {
    api: ReturnType<typeof createMailApi>;
    names: () => string[];
    jobs: () => Job[];
    enqueue: Enqueue;
  }) => MailInbox;
  enqueue: Enqueue;
  retain: (inbox: MailInbox) => void;
  current: () => MailInbox;
  every: (callback: () => void, milliseconds: number) => { unref: () => unknown };
}

/** Keep credentials and transport loading at the account boundary, with the existing request deadline. */
function mailApi<Job, Enqueue>(ports: MailStartupPorts<Job, Enqueue>) {
  return createMailApi({
    post: async (method, args) => {
      const fetch = await ports.loadFetch();
      return fetch("https://adventure.land/api/" + method, {
        method: "POST",
        headers: {
          Cookie: "auth=" + ports.session,
          "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(args),
        signal: ports.timeout(20000),
      });
    },
  });
}

/** Start one refresh immediately, then refresh the current inbox every thirty seconds without holding shutdown open. */
export function startCoordinatorMail<Job, Enqueue>(
  state: MailState<Job>,
  account: MailAccount,
  ports: MailStartupPorts<Job, Enqueue>,
) {
  ports.retain(
    ports.createInbox({
      api: mailApi(ports),
      names: () => (account.response.characters || []).map((character) => character.name),
      jobs: () =>
        [state.merchantCurrent, ...state.merchantQueue].filter((job): job is Job => Boolean(job)),
      enqueue: ports.enqueue,
    }),
  );
  const refresh = () => {
    void ports
      .current()
      .refresh()
      .catch(() => {});
  };
  refresh();
  ports.every(refresh, 30000).unref();
  return createMailInboxRoutes(ports.current());
}
