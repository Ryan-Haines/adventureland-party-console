// Mail: the account inbox, its
// automation, the sent history and the merchant's mail jobs. A cycle pulls the inbox once, runs each
// automatic collect and delete on that list, and pulls once more only when a delete changed it
//, so N automatic actions cost two pulls where b9b5c91e pulled before and after each.
// A mail the game refuses keeps one record per mail and action, and the cycle goes on to the next
// mail. A cycle runs every "Check mail every" seconds, the player's mailCheckSeconds
// (coordinator/owner.ts), and a mail API request ends at the kept bound mailRequestBoundMs. A failed
// automatic collect or delete waits for the next periodic cycle, so a standing failure retries once
// a period, as b9b5c91e's 30 s retryAt did at the setting's default. A refresh you ask for and the
// cycles a setting change, a send or a collection start leave a standing failure alone.
import { requestObject, requestText } from '../../lifecycle/api.ts';
import type { Item, InventoryEntry } from '../../coordinator/contracts/item.ts';
import type { EnqueueAsk, EnqueueAnswer, MerchantWork, JobReason } from '../../merchant-jobs/api.ts';
import type { WithdrawalRequest } from './storage.ts';
import { recordItems } from './records.ts';
import { BANK_PACK_CELLS, MAIL_MESSAGE_MAX, MAIL_SUBJECT_MAX, bagSize } from '../rules.ts';
import { bankboiName, isBankboiPack } from '../identity.ts';
import { initialMailbox, type MailboxState } from '../saved-fields.ts';
import { hiddenValue } from '../../settings/coordinator/api.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import type { ItemsAnswer } from './routes/answer.ts';

// The account API answers an array of messages or an envelope with `infs` and `result`.
type MailApi = (method: string, args: unknown) => Promise<unknown[]>;
interface MailResponse { ok: boolean; json(): Promise<unknown> }
function decode(raw: unknown): { messages: unknown[]; result: Record<string, unknown> } {
  if (Array.isArray(raw)) return { messages: raw, result: {} };
  const payload = requestObject(raw);
  return { messages: Array.isArray(payload.infs) ? payload.infs : [], result: requestObject(payload.result || payload.response || payload) };
}
export function createMailApi(ports: { post(method: string, args: unknown): Promise<MailResponse> }): MailApi {
  return async function api(method, args) {
    const response = await ports.post(method, args), { messages, result } = decode(await response.json());
    const failure = messages.map(requestObject).find(entry => ['error', 'ui_error'].includes(requestText(entry.type)));
    if (!response.ok || failure || result.failed || result.success === false)
      throw new Error(requestText(failure?.message || result.reason || 'Mail request failed'));
    return messages;
  };
}

/** The game's postage as the downloaded official client advertises it; no guess when it is absent. */
export function mailPostage(html: string): number | null {
  const amount = /(?:Send Mail[\s\S]{0,200}?Cost:|interface\.load_mail\.cost)[\s\S]{0,160}?color:\s*gold[^>]*>([\d,]+)</.exec(html)?.[1];
  return amount ? Number(amount.replaceAll(',', '')) : null;
}

interface Mail { id: string; from: string; to: string; subject: string; message: string; sent: unknown; item: Item | null; taken: boolean | 'pending' }
interface MailJob { reason?: string; startedAt?: unknown; mail?: { id?: unknown } }
/** One automatic action the game refused, kept while the action is still due. */
export interface MailFailure { id: string; action: 'collect' | 'delete'; error: string }
export interface MailInbox {
  snapshot(): unknown;
  // `period` is true only for the "Check mail every" timer's cycle, the one that retries a failure.
  refresh(period?: boolean): Promise<unknown>;
  collect(id: string): Promise<unknown>;
  remove(id: string): Promise<unknown>;
  configure(input: unknown): Promise<unknown>;
  seen(): unknown;
  removeSent(id: string): unknown;
  sent(id: string, mail: unknown): void;
  complete(id: string, success: boolean, error: unknown): void;
}
export interface MailInboxPorts {
  api: MailApi;
  names(): string[];
  jobs(): MailJob[];
  enqueue(mail: Mail): void;
  now(): number;
  persist(): void;
}

/** The account inbox. Listing never marks a message read or claims an item. */
export function createMailInbox(state: { mailbox?: MailboxState }, ports: MailInboxPorts): MailInbox {
  const saved = state.mailbox ||= initialMailbox(undefined);
  let list: { messages: Mail[]; count: number; updatedAt: number | null; error: string | null } = { messages: [], count: 0, updatedAt: null, error: null };
  let pulling: Promise<void> | null = null, cycling: Promise<unknown> | null = null;
  const outcomes = new Map<string, { status: 'collected' | 'failed'; error: string | null }>(), deleting = new Set<string>();
  const failures = new Map<string, MailFailure>();
  const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/\s/g, '');
  const collectJob = (id: string) => ports.jobs().find(job => job.reason === 'collect mail' && job.mail?.id === id);

  function view() {
    return list.messages.map(mail => {
      const job = collectJob(mail.id);
      return { ...mail, collection: mail.taken === true ? 'collected' : job ? (job.startedAt ? 'collecting' : 'queued') : outcomes.get(mail.id)?.status || null,
        collectionError: outcomes.get(mail.id)?.error || null };
    });
  }
  // v1.5 row 14 (aac30d45 commerce/mailbox.ts:22-25): the failures as records and as one line each.
  function snapshot() {
    const seen = new Set(saved.seenIds), automationErrors = [...failures.values()].map(f => ({ ...f }));
    const automationError = automationErrors.length ? automationErrors.map(failure =>
      `Automatic mail ${failure.action === 'delete' ? 'deletion' : 'collection'} failed (${failure.id}): ${failure.error}`).join('; ') : null;
    return { ...list, messages: view(), settings: { ...saved.settings }, outbox: saved.outbox.map(m => ({ ...m })),
      automationError, automationErrors, newCount: list.messages.filter(m => !seen.has(m.id)).length };
  }
  // One pull reads every page of the account's mail to the managed characters.
  async function pullPages(): Promise<void> {
    const owned = new Set(ports.names().map(normalize)), found = new Map<string, Mail>(), cursors = new Set<unknown>();
    let cursor: unknown = null;
    do {
      const response = await ports.api('pull_mail', cursor ? { cursor } : {});
      const page = requestObject(response.find(entry => requestObject(entry).type === 'mail'));
      if (!Array.isArray(page.mail)) throw new Error('Invalid inbox response');
      for (const raw of page.mail) {
        const mail = requestObject(raw);
        if (!mail.id || !owned.has(normalize(mail.to))) continue;
        let item: unknown = mail.item || null;
        if (typeof item === 'string') {
          try { item = JSON.parse(item); } catch { throw new Error('Invalid mail attachment data'); }
        }
        if (mail.item && (!item || typeof item !== 'object' || typeof requestObject(item).name !== 'string' || !requestObject(item).name))
          throw new Error('Invalid mail attachment data');
        found.set(String(mail.id), { id: String(mail.id), from: String(mail.fro || ''), to: String(mail.to || ''), subject: String(mail.subject || ''),
          message: String(mail.message || ''), sent: mail.sent, item: item as Item | null, taken: mail.taken === true ? true : mail.taken ? 'pending' : false });
      }
      cursor = page.more ? page.cursor : null;
      if (page.more && (!cursor || cursors.has(cursor))) throw new Error('Incomplete inbox pagination');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    list = { messages: [...found.values()].sort((a, b) => Date.parse(String(b.sent)) - Date.parse(String(a.sent))), count: found.size, updatedAt: ports.now(), error: null };
  }
  async function pull(): Promise<void> {
    if (pulling) return pulling;
    pulling = pullPages().catch(error => { list = { ...list, error: String(requestObject(error).message || error) }; throw error; });
    try { await pulling; } finally { pulling = null; }
  }

  // Each check reads the list as it stands; the callers pull first where they need a current one.
  function queueCollect(mail: Mail | undefined): void {
    if (!mail || !mail.item) throw new Error('Attachment unavailable');
    if (mail.taken === true) return;
    if (mail.taken) throw new Error('The game is still processing this attachment');
    if (deleting.has(mail.id)) throw new Error('Message deletion is in progress');
    if (!collectJob(mail.id)) { ports.enqueue(mail); outcomes.delete(mail.id); }
  }
  async function deleteListed(id: string): Promise<void> {
    const mail = list.messages.find(entry => entry.id === id);
    if (!mail) throw new Error('Message no longer exists');
    if (mail.item && mail.taken !== true) throw new Error('Collect the attachment before deleting this message');
    if (collectJob(id)) throw new Error('Wait for attachment collection to finish');
    await ports.api('delete_mail', { mid: id });
    list.messages = list.messages.filter(entry => entry.id !== id); list.count = list.messages.length;
    outcomes.delete(id);
    recordItems({ decision: 'mailed', subject: mail.to || 'account', by: 'I6', action: 'deleted', id });
  }
  // The automatic action a listed mail is due for, if any.
  function due(mail: ReturnType<typeof view>[number]): MailFailure['action'] | null {
    if (!mail.item || collectJob(mail.id)) return null;
    if (saved.settings.autoCollect && mail.taken === false && (!mail.collection || mail.collection === 'failed')) return 'collect';
    if (saved.settings.autoDelete && mail.taken === true && (!mail.collection || mail.collection === 'collected')) return 'delete';
    return null;
  }
  async function runCycle(period: boolean): Promise<unknown> {
    await pull();
    const stillDue = new Set<string>();
    let deleted = false;
    for (const mail of view()) {
      const action = due(mail);
      if (!action) continue;
      const key = mail.id + '\n' + action;
      stillDue.add(key);
      if (!period && (failures.has(key) || mail.collection === 'failed')) continue;
      try {
        if (action === 'collect') queueCollect(list.messages.find(entry => entry.id === mail.id));
        else { deleting.add(mail.id); await deleteListed(mail.id); deleted = true; }
        failures.delete(key);
      } catch (error) {
        failures.set(key, { id: mail.id, action, error: String(requestObject(error).message || error) });
      } finally { deleting.delete(mail.id); }
    }
    for (const key of failures.keys()) if (!stillDue.has(key)) failures.delete(key);
    if (deleted) await pull();
    return snapshot();
  }
  // One cycle at a time; a request during a cycle shares it.
  async function refresh(period = false): Promise<unknown> {
    if (cycling) return cycling;
    cycling = runCycle(period);
    try { return await cycling; } finally { cycling = null; }
  }

  return {
    snapshot,
    refresh,
    async collect(id) { await pull(); queueCollect(list.messages.find(mail => mail.id === id)); return snapshot(); },
    async remove(id) {
      if (deleting.has(id)) throw new Error('Message deletion is in progress');
      deleting.add(id);
      try { await pull(); await deleteListed(id); await pull(); return snapshot(); } finally { deleting.delete(id); }
    },
    complete(id, success, error) {
      outcomes.set(id, { status: success ? 'collected' : 'failed', error: success ? null : String(error || 'Collection failed') });
      if (!success) return;
      recordItems({ decision: 'mailed', subject: list.messages.find(mail => mail.id === id)?.to || 'account', by: 'I6', action: 'collected', id });
      void refresh().catch(() => {});
    },
    async configure(input) {
      const settings = requestObject(input);
      if (typeof settings.autoCollect !== 'boolean' || typeof settings.autoDelete !== 'boolean') throw Error('Choose both mailbox automation settings');
      saved.settings = { autoCollect: settings.autoCollect, autoDelete: settings.autoDelete };
      ports.persist();
      return refresh();
    },
    // A read mark is kept while its mail is listed: the pull reads every page of the
    // inbox, so the marks are the listed mail and the settings key grows only with the inbox.
    seen() {
      saved.seenIds = list.messages.map(m => m.id);
      ports.persist();
      return snapshot();
    },
    removeSent(id) { saved.outbox = saved.outbox.filter(m => m.id !== id); ports.persist(); return snapshot(); },
    sent(id, input) {
      const mail = requestObject(input);
      if (saved.outbox.some(m => m.id === id) || typeof mail.recipient !== 'string' || typeof mail.subject !== 'string' || typeof mail.message !== 'string') return;
      const source = requestObject(mail.source);
      saved.outbox.unshift({ id, recipient: mail.recipient, subject: mail.subject, message: mail.message, sent: new Date(ports.now()).toISOString(),
        ...(source.item ? { item: structuredClone(source.item) } : {}), ...(typeof mail.quantity === 'number' ? { quantity: mail.quantity } : {}) });
      ports.persist();
      recordItems({ decision: 'mailed', subject: mail.recipient, by: 'I6', action: 'sent', id });
      // A finished send reads the inbox.
      void refresh().catch(() => {});
    },
  };
}

type MailFetch = (url: string, options: { method: string; headers: Record<string, string>; body: string | undefined; signal?: AbortSignal }) => Promise<MailResponse>;
interface MailStartupState { mailbox?: MailboxState; merchantCurrent?: MerchantWork | null; merchantQueue: (MerchantWork | null | undefined)[] }
export interface MailStartupPorts {
  persist(): void;
  session: string | undefined;
  loadFetch(): Promise<MailFetch>;
  enqueue(mail: Mail): void;
}
/**
 * The account's inbox; owner.ts runs its cycles. A send and a collect start a cycle when they end
 * (the inbox's `sent` and `complete`). A request ends on its own reply, on the fetch's own failure
 *, or at the kept bound `mailRequestBoundMs` when the game's mail API never answers; a
 * firing tells the status owner's bound record and the cycle fails as on any failed request.
 */
export function startCoordinatorMail(state: MailStartupState, account: { response: { characters?: { name: string }[] | null } }, ports: MailStartupPorts): MailInbox {
  const api = createMailApi({
    post: async (method, args) => {
      const signal = AbortSignal.timeout(hiddenValue('mailRequestBoundMs'));
      try {
        return await (await ports.loadFetch())('https://adventure.land/api/' + method, {
          method: 'POST', headers: { Cookie: 'auth=' + ports.session, 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(args), signal,
        });
      } catch (error) {
        if (signal.aborted) boundFired({ bound: 'mailRequestBoundMs', owner: '10', subject: method, state: { method } });
        throw error;
      }
    },
  });
  const inbox = createMailInbox(state, {
    api,
    names: () => (account.response.characters || []).map(character => character.name),
    jobs: () => [state.merchantCurrent, ...state.merchantQueue].filter((job): job is MerchantWork => Boolean(job)) as MailJob[],
    enqueue: ports.enqueue,
    now: () => Date.now(),
    persist: ports.persist,
  });
  return inbox;
}

// The merchant's mail jobs: a send carries its envelope and, with an attachment, its source copy,
// which a BankBoi stages first; a collect names the mail.
export interface OutgoingMail { recipient: string; subject: string; message: string; quantity?: number; source?: { pack: string; slot: number; item: Item } }
export interface MailJobState {
  merchantCharacter: string | null;
  merchantQueue: MerchantWork[];
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankbois: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  withdrawals: Record<string, WithdrawalRequest[] | undefined>;
}
export interface MailJobPorts {
  now(): number;
  nextCommand(): number;
  enqueue(ask: EnqueueAsk): EnqueueAnswer;
  persist(): void;
  persistBank(): void;
  dispatch(): void;
  bankboi(): Promise<unknown>;
  log(message: string, level: string, details?: unknown): void;
}
export function createMailJobs(state: MailJobState, ports: MailJobPorts) {
  function entry(pack: string, slot: number): InventoryEntry | undefined {
    let entries = state.bankSnapshot?.packs?.[pack];
    if (pack === 'merchant') entries = state.statuses[String(state.merchantCharacter)]?.items;
    else if (isBankboiPack(pack)) entries = state.bankbois[bankboiName(pack)!]?.items;
    return entries?.find(value => value?.slot === slot) || undefined;
  }
  function stage(job: MerchantWork, source: NonNullable<OutgoingMail['source']>): void {
    (state.withdrawals[String(state.merchantCharacter)] ||= []).push({ ...source, mailJobId: job.id });
    ports.persistBank();
    void ports.bankboi().catch((error: unknown) => ports.log('Could not stage mail attachment', 'error', requestObject(error).message));
  }
  function send(mail: OutgoingMail): MerchantWork {
    const blocked = isBankboiPack(mail.source?.pack);
    const job: MerchantWork & { reason: JobReason } = { id: 'merchant-' + ports.now() + '-' + ports.nextCommand(), target: state.merchantCharacter, reason: 'send mail',
      queuedAt: ports.now(), mail, ...(mail.source ? { blockedOnBankboi: blocked } : {}) };
    ports.enqueue({ reason: job.reason, target: job.target, fields: job });
    if (blocked) stage(job, mail.source!);
    if (mail.source) ports.log('Queued mail to ' + mail.recipient + ' with ' + mail.quantity + ' × ' + mail.source.item.name, 'info');
    ports.persist();
    ports.dispatch();
    return job;
  }
  function collect(mail: { id: string; item?: Item | null }): void {
    if (!state.merchantCharacter) throw new Error('Configure a merchant first');
    ports.enqueue({ reason: 'collect mail', target: state.merchantCharacter, fields: { manual: true, mail: { id: mail.id, item: mail.item } } });
    ports.persist();
    ports.dispatch();
  }
  return { entry, send, collect };
}

// A send names a character and stays inside the game's subject and message lengths. An
// attachment names a cell of its pack (the bag's reported size, or the bank's 42 cells) that still
// holds the chosen copy, and a count that copy holds.
export interface MailSendInput { recipient: unknown; subject: unknown; message: unknown; source: unknown; quantity: unknown }
function envelope(input: MailSendInput): OutgoingMail | string {
  const recipient = typeof input.recipient === 'string' ? input.recipient.trim() : '';
  const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
  const message = typeof input.message === 'string' ? input.message : '';
  if (!/^[A-Za-z0-9_]{1,40}$/.test(recipient)) return 'enter a valid character name';
  if (!subject || subject.length > MAIL_SUBJECT_MAX) return `subject must be 1-${MAIL_SUBJECT_MAX} characters`;
  if (message.length > MAIL_MESSAGE_MAX) return `message must be at most ${MAIL_MESSAGE_MAX.toLocaleString('en-US')} characters`;
  return { recipient, subject, message };
}
export function createMailSend(state: MailJobState, ports: MailJobPorts & { identity(item: unknown): string }) {
  const jobs = createMailJobs(state, ports);
  function cells(pack: string): number {
    if (pack === 'merchant') return bagSize(state.statuses[String(state.merchantCharacter)]);
    if (isBankboiPack(pack)) return bagSize(state.bankbois[bankboiName(pack)!]);
    return BANK_PACK_CELLS;
  }
  function attachment(input: MailSendInput, mail: OutgoingMail): ItemsAnswer | null {
    const source = requestObject(input.source), pack = typeof source.pack === 'string' ? source.pack : '', slot = Number(source.slot);
    if (!Number.isInteger(slot) || slot < 0 || slot >= cells(pack)) return { status: 400, body: { error: 'select an item to attach' } };
    const entry = jobs.entry(pack, slot);
    if (!entry?.item || ports.identity(entry.item) !== ports.identity(source.item))
      return { status: 409, body: { error: 'the selected item is no longer in that slot' } };
    const quantity = Number(input.quantity), available = Math.max(1, Number(entry.item.q) || 1);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > available)
      return { status: 400, body: { error: 'enter an available whole-number quantity' } };
    mail.quantity = quantity;
    mail.source = { pack, slot, item: entry.item };
    return null;
  }
  function decide(input: MailSendInput): ItemsAnswer {
    if (!state.merchantCharacter) return { status: 409, body: { error: 'configure a merchant first' } };
    const mail = envelope(input);
    if (typeof mail === 'string') return { status: 400, body: { error: mail } };
    if (input.source && typeof input.source === 'object') {
      const refused = attachment(input, mail);
      if (refused) return refused;
    }
    return { body: { ok: true, jobId: jobs.send(mail).id } };
  }
  return decide;
}
