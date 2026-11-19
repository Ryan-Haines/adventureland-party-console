// The character's production (3.1 `character/production.ts`): the production journal and its
// recovery, the confirmed upgrade and compound, Mass Production, the lucky slot, a fighter's
// marked upgrades, the upgrade preview and the merchant's commerce orders. shared.js builds it
// once at load over `ProductionPorts` and binds its names.
import { copyKey, fingerprint, inventoryPack, isVaultPack, ruleKey, sameItem, sameItemState, type ItemCopy } from '../identity.ts';
import { aggregateSlotTracking, availableCraftStock, COMPOUND_INPUTS, emptyRolls, failureClass, freeSlots, itemFailure, luckySlotOf, luckySlotSearch, mergeSlotStream,
  normalizeSlotTracking, previewOptions, resolveUpgradeOffering, statScrollsNeeded, unavailablePreview, UPGRADE_LEVEL_MAX, LUCKY_HIGH_ROLL, LUCKY_ROLL_DIGITS,
  type ItemFailure, type LuckySlotStreams, type LuckySlotTracking, type PreviewOption, type PreviewResult, type UpgradePreviewRequest,
  TRACKER_ITEMS, type UpgradePreviewResult, type UpgradeServerPreview } from '../rules.ts';
import type { ServerToClient_q_data } from 'typed-adventureland';
import { itemQuantity, settles, type BagAnswers, type BagPorts } from './bag.ts';
import type { BankAnswers, LeftoverPorts } from './bank.ts';
import type { createBag } from './owner.ts';
import { scope } from '../../lifecycle/api.ts';
import { COMMERCE_PROGRESS_VERSION } from '../../merchant-jobs/api.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the game's character, G and replies are read as the client gives them */
// The merchant job owner's running job, read only (merchant-jobs/character/runner.ts
// `JobHolder`). A commerce order marks it through the merchant job owner's `commerce` port:
// `commerceCycle`, which the events owner's merchant reads (events/character/merchant.ts), and
// the journal key and sequence.
type Job = Readonly<{ jobId?: unknown; commandId?: unknown; commerceJournalKey?: string; commerceSequence?: number; commerceCycle?: boolean }> | null;
type CommerceMarks = { commerceCycle?: boolean; commerceJournalKey?: string; commerceSequence?: number };
// A commerce order's services to its buy lines: the checkpoint, the walk, the funding and the
// live activity line.
interface CommerceServices {
  checkpoint(state: any, cycleBoundary: boolean): Promise<void>;
  move(destination: unknown): Promise<void>;
  fund(amount: number): Promise<void>;
  activity(entry: { level: string; message: string; details?: unknown }): Promise<void>;
}
export interface ProductionPorts extends Pick<BagPorts, 'character' | 'G' | 'bankPacks' | 'margin' | 'sleep' | 'now'> {
  reads: BagAnswers;
  bank: Pick<BankAnswers, 'findBankItem' | 'waitForBankPack' | 'bankRetrieveConfirmed' | 'bankStageConfirmed' | 'withdrawMerchantCash' |
    'merchantVisitBank' | 'accessibleFloors' | 'packsOnFloor' | 'retrieveFromBankUntil' | 'sortCurrentBankFloor' | 'bankStoreFully' | 'bagStill'>;
  equip(slot: number, slotName: string): Promise<unknown>;
  // The player's protected free slots from the coordinator's last reply.
  protectedSlots(): number;
  // The merchant job owner's visit to a party member and the handoff send
  // (2.6's market).
  rendezvous(jobId: unknown, target: string): Promise<unknown>;
  sendItem(target: string, slot: number, quantity: number): Promise<unknown>;
  // A fighter's way back after its stat scrolls: the leader's place while it follows one, else null.
  leaderLocation(): unknown;
  // The equipment a delivery brought, equipped on its arrival (shared.js `equipDeliveredItems`).
  equipDelivered(items: unknown[]): Promise<any[]>;
  // The compound leftovers' store (bank.ts `storeCompoundLeftovers`).
  storeCompoundLeftovers(ports: LeftoverPorts): Promise<unknown>;
  // The merchant job owner's runner: a job's stage.
  operationStage(command: any, stage: string): Promise<unknown>;
  // The NPC purchase confirmed by the bag's count (shared.js `buyConfirmed`, 2.6's market).
  buyConfirmed(name: string, quantity: number): Promise<unknown>;
  // The merchant job owner's handoff request for a commerce order's source (visits.ts
  // `requestMerchantHandoff`).
  handoff(path: string, options: { method: string; body: unknown }): Promise<unknown>;
  bag: ReturnType<typeof createBag>;
  // The game's calls.
  upgrade(item: number, scroll: number, offering?: number | null, calculate?: boolean): Promise<any>;
  compound(a: number, b: number, c: number, scroll: number, offering?: number | null, calculate?: boolean): Promise<any>;
  swap(a: number, b: number): Promise<unknown>;
  buy(name: string, quantity: number): Promise<unknown>;
  bankRetrieve(pack: string, slot: number, inventorySlot?: number): Promise<unknown>;
  split(slot: number, quantity: number): Promise<unknown>;
  craft(name: string): Promise<unknown>;
  unequip(slot: string): Promise<unknown>;
  // Mass Production's cast; `bound` starts the reply's bound once the call is sent.
  useSkill(name: string, bound: () => Promise<unknown>): Promise<unknown>;
  skillReady(name: string): boolean;
  findNpc(name: string): any;
  grade(item: ItemCopy): number;
  // The game's upgrade replies still pending (calls.ts `upgradeSettling`).
  upgradeSettling(): boolean;
  // calls.ts `replyLost`: a queue wait that gives up reports itemReplyBound.
  replyLost(call: 'upgrade' | 'compound', ms: number): void;
  // Movement's walk with this character's errand request.
  move(destination: unknown): Promise<unknown>;
  // The lifecycle owner's console Pause boundary: a production attempt runs
  // whole.
  atomic<T>(run: () => Promise<T>): Promise<T>;
  request(path: string, options: { method: string; body: unknown }): Promise<any>;
  log(message: string, color: string): void;
  // The merchant job owner's runner: the current job, and the event pause that a
  // production attempt yields to.
  job(): Job;
  commerce(commandId: number, marks: CommerceMarks): void;
  // The merchant job owner's runner: whether it holds the merchant, and its report of
  // a command's outcome.
  runnerHolds(): boolean;
  reportCommand(command: unknown, outcome: string, reason?: string): void;
  yieldJob(): Promise<unknown>;
  // The events owner's merchant reservation and the merchant jobs owner's stand return, which hold the tidy
  // after a reply.
  eventReserved(): boolean;
  standReturning(): boolean;
  // Whether the runner holds the merchant at all: a job, a command, gathering, an itinerary or the
  // idle stand.
  runnerRecord(): boolean;
  current(): boolean;
  // This character's journals (key and character name), and a raw stored key; storing null removes it.
  saved(key: string): any;
  save(key: string, value: unknown): void;
  stored(key: string): any;
  store(key: string, value: unknown): void;
  partyLocation(): unknown;
  clockOffset(): number;
}

const PRODUCTION_JOURNAL = 'party-production', LUCKY_JOURNAL = 'party-lucky-upgrade';
const PREVIEW_SUPPLIES = 'party-preview-supplies', PREVIEW_REVISION = 'party-upgrade-preview-revision';
const copy = <T>(value: T): T => value && JSON.parse(JSON.stringify(value));
const message = (error: any) => String(error?.reason || error?.message || error);
// Game timing: the Mass Production cast waits 750 ms for the server's answer
// before the operation's packet goes, and the operation goes on without the buff past it.
const SKILL_REPLY_MS = 750;
// One look at the coordinator's handoff record per 750 ms while the source still holds the
// handoff.
const HANDOFF_LOOK_MS = 750;

export function createProduction(p: ProductionPorts) {
  const me = () => p.character();
  const G = () => p.G();
  const bag = () => p.bag;
  // The dashboard's activity line is a copy of the log line written before it, so a failed post is logged.
  const activityFailed = (error: unknown) => p.log('Merchant activity report failed: ' + message(error), 'red');
  // A refused failure report is logged; the merchant job owner's runner posts the job's end
  // again on the rethrow (merchant-jobs/character/runner.ts:210).
  const reportFailed = (error: unknown) => p.log('Merchant job failure report failed: ' + message(error), 'red');
  let journalCache: any, journalLoaded = false, recovering: Promise<unknown> | null = null;
  let recoveringJournal: Promise<unknown> | null = null, recoveringLucky = false;
  let luckySlot: number | null = null, luckyService: ReturnType<typeof createLuckyUpgrade> | null = null;
  let tracker: ReturnType<typeof createLuckySlotTracker> | null = null, trackerId: string | null = null;
  let activeUpgrade: { slot: number; item: ItemCopy | null; targetLevel: number } | null = null;
  const previewSession = p.now() + ':' + Math.random();
  const placeholder = () => (me().items || []).some((item: ItemCopy | null) => item?.name === 'placeholder');
  const queued = (): boolean => !!(me().q && (me().q.upgrade || me().q.compound));

  // For an upgrade or compound, the server holds the operation for its queue time,
  // `character.q[kind].ms`, which Mass Production already cut to a tenth (G server.js:7209, 6998).
  // The wait reads that entry while it is open; before it shows and after it closes, the reply or
  // the bag change comes within two measured round trips. False, reported as itemReplyBound, when
  // `ended` never answered.
  async function queueSettles(kinds: readonly ('upgrade' | 'compound')[], ended: () => boolean): Promise<boolean> {
    const started = p.now();
    let deadline = started + 2 * p.margin();
    for (;;) {
      const entry = kinds.map(kind => me().q?.[kind]).find(Boolean);
      if (entry) deadline = Math.max(deadline, p.now() + (Number(entry.ms) || 0) + 2 * p.margin());
      else if (ended()) return true;
      if (p.now() >= deadline) {
        p.replyLost(kinds[0]!, p.now() - started);
        return false;
      }
      await p.sleep(p.margin());
    }
  }
  // The call's reply, read beside the game's change.
  function reply<T>(call: () => Promise<T>) {
    const state: { settled: boolean; result?: T; failure: any } = { settled: false, failure: null };
    Promise.resolve(call()).then(value => { state.settled = true; state.result = value; },
      error => { state.settled = true; state.failure = error; });
    return state;
  }

  // The production journal. The coordinator's protection checkpoint runs before each attempt so
  // the craft reservations are current. Its reply carries the craft claims (`craftProtection`)
  // and the compound rules a compound pass reads.
  const protectionCheckpoint = (jobId: unknown, commandId: unknown) =>
    p.request('/merchant/checkpoint', { method: 'POST', body: { jobId, commandId, protectionOnly: true } });
  async function verifyMerchantItemMarks() {
    const active = p.job();
    if (me().ctype !== 'merchant' || !active?.jobId) return;
    await protectionCheckpoint(active.jobId, active.commandId);
  }
  function readJournal() {
    if (!journalLoaded) { journalCache = p.saved(PRODUCTION_JOURNAL); journalLoaded = true; }
    return copy(journalCache);
  }
  function writeJournal(value: any) {
    journalLoaded = true;
    journalCache = copy(value);
    p.save(PRODUCTION_JOURNAL, value || null);
  }
  function rememberCommerce(journal: any) {
    if (!journal.commerce) return;
    const progress = p.stored(journal.commerce.key) || journal.commerce.state;
    if (!progress || progress.sequence !== journal.commerce.sequence || !progress.pendingUpgrade) return;
    progress.pendingUpgrade.outcome = { item: journal.outcomeItem || null, destroyed: journal.destroyed === true };
    progress.sequence += 1;
    p.store(journal.commerce.key, progress);
  }
  function replayCompletedCommerce(attempt: any) {
    const journal = attempt?.journal;
    if (!attempt?.completed || !journal || journal.phase !== 'complete' || !journal.commerce ||
        attempt.success !== journal.success || !p.stored(journal.commerce.key)) return;
    const progress = p.stored(journal.commerce.key);
    if (!progress || progress.sequence !== journal.commerce.sequence || !progress.pendingUpgrade ||
        !sameItemState(progress.activeItem, journal.item) ||
        Number(progress.pendingUpgrade.level) !== Number(journal.item.level || 0) + 1) return;
    if (attempt.success === true) {
      if (!journal.outcomeItem || journal.outcomeItem.name !== journal.item.name ||
          Number(journal.outcomeItem.level || 0) !== Number(journal.item.level || 0) + 1) return;
    } else if (attempt.success !== false || journal.destroyed !== true) return;
    rememberCommerce(journal);
  }
  function rememberReviewedCommerce(journal: any, attempt: any, reviewed: any): boolean {
    if (!journal.commerce || attempt.resolution?.outcome !== 'unknown' || !attempt.resolution.resumeMissing) return false;
    const progress = p.stored(journal.commerce.key) || journal.commerce.state;
    if (reviewed?.key === journal.commerce.key && reviewed.state) {
      if (!progress || Number(progress.sequence) <= Number(reviewed.state.sequence)) p.store(journal.commerce.key, reviewed.state);
      return true;
    }
    // A later cycle already applied this review: only the old receipt retires.
    if (progress && Number(progress.sequence) > Number(journal.commerce.sequence)) return true;
    if (queued() || placeholder()) throw Error('Reviewed production is still settling');
    const upgraded = { ...journal.item, level: (journal.item.level || 0) + 1 };
    if (me().items.some((item: ItemCopy | null) => sameItemState(item, journal.item) || sameItemState(item, upgraded)))
      throw Error('Reviewed production still has a possible inventory survivor');
    const outcome = progress?.pendingUpgrade?.outcome;
    if (outcome?.reviewedMissing === true && outcome.resolution?.at === attempt.resolution.at) return true;
    if (!progress || progress.sequence !== journal.commerce.sequence || !progress.pendingUpgrade ||
        !sameItemState(progress.activeItem, journal.item)) return true;
    progress.pendingUpgrade.outcome = { reviewedMissing: true, resolution: attempt.resolution };
    progress.sequence += 1;
    p.store(journal.commerce.key, progress);
    return true;
  }
  async function finishJournal(journal: any) {
    const receipt = await p.request('/merchant/production', { method: 'POST', body: { character: me().name,
      action: journal.request?.requestId && !journal.issued ? 'abort-manual' : 'complete', id: journal.id, success: journal.success } });
    const attempt = receipt?.attempt || {};
    if (attempt.resolution?.outcome === 'unknown') rememberReviewedCommerce(journal, attempt, receipt.reviewedCommerce);
    else rememberCommerce(journal);
    if (readJournal()?.id === journal.id) writeJournal(null);
  }
  async function saveJournal(journal: any) {
    writeJournal(journal);
    await p.request('/merchant/production', { method: 'POST', body: { character: me().name, action: 'checkpoint', id: journal.id, journal } });
  }
  async function recoverJournal(): Promise<unknown> {
    let journal = readJournal();
    if (!journal) {
      const pending = await p.request('/merchant/production', { method: 'POST', body: { character: me().name, action: 'pending' } });
      if (!pending || !Array.isArray(pending.pending)) throw Error('Production recovery inspection unavailable');
      (pending.completedCommerce || []).forEach(replayCompletedCommerce);
      if (!pending.pending.length) {
        if (me().ctype === 'merchant' && (luckyService?.pending() || p.saved(LUCKY_JOURNAL))) lucky().retireSettled();
        return;
      }
      const orphaned = pending.pending[0];
      if (!orphaned.journal) throw Error('Production recovery needs review: ' + orphaned.id + ' (' + orphaned.kind + ' ' + orphaned.name + ' +' + orphaned.level + '); no local journal');
      journal = orphaned.journal;
      writeJournal(journal);
      if (journal.phase !== 'complete' && journal.lucky && !p.saved(LUCKY_JOURNAL)) {
        p.save(LUCKY_JOURNAL, journal.lucky);
        luckyService = null;
      }
    }
    if (journal.phase === 'complete') return finishJournal(journal);
    if (queued()) throw Error('Production recovery waiting for game operation');
    const inspection = await p.request('/merchant/production', { method: 'POST', body: { ...journal.request, character: me().name, action: 'inspect' } });
    if (!inspection || !Array.isArray(inspection.pending)) throw Error('Production recovery inspection unavailable');
    // A replayed older journal whose receipt already completed retires before the newer one recovers;
    // its old lucky layout is never restored.
    if (inspection.attempt?.completed) {
      replayCompletedCommerce(inspection.attempt);
      rememberReviewedCommerce(journal, inspection.attempt, inspection.reviewedCommerce);
      writeJournal(null);
      return recoverJournal();
    }
    const orphan = inspection.pending.find((attempt: any) => attempt.id !== journal.id);
    if (orphan) throw Error('Production recovery needs review: ' + orphan.id + ' (' + orphan.name + ' +' + orphan.level + '); local journal ' + journal.id);
    if (!inspection.attempt) {
      if (journal.phase !== 'prepared') throw Error('Production recovery missing admitted attempt: ' + journal.id);
      writeJournal(null);
      return;
    }
    if (journal.request?.requestId && !journal.issued) return finishJournal(journal);
    if (journal.phase === 'prepared') journal.success = false;
    else {
      if (queued()) throw Error('Production recovery waiting for game operation');
      // The interrupted layout is read before the lucky recovery clears it: an empty old source
      // alone cannot tell a burned item from a moved survivor.
      const evidence = p.saved(LUCKY_JOURNAL) || journal.lucky;
      const emptyLuckyResult = evidence && evidence.phase !== 'preparing' && evidence.from === journal.slots[0] &&
        sameItemState(evidence.item, journal.item) && !me().items[evidence.to];
      await settleLucky();
      let live = me().items[journal.slots[0]];
      const levels = [journal.item.level || 0, (journal.item.level || 0) + 1];
      if ((journal.commerce || journal.request?.kind === 'upgrade') && (!live || live.name !== journal.item.name || !levels.includes(live.level || 0))) {
        const previous = JSON.stringify(fingerprint(journal.item));
        const upgraded = JSON.stringify(fingerprint({ ...journal.item, level: (journal.item.level || 0) + 1 }));
        const candidates = me().items.map((item: ItemCopy | null, slot: number) => {
          const state = JSON.stringify(fingerprint(item));
          return state === previous || state === upgraded ? slot : -1;
        }).filter((slot: number) => slot >= 0);
        const survivor = me().items.some((item: ItemCopy | null) => !!item && item.name === journal.item.name && levels.includes(item.level || 0));
        if (!candidates.length && emptyLuckyResult && !live && !survivor) journal.destroyed = true;
        else {
          if (candidates.length !== 1) throw Error('Production outcome needs review before another attempt: ' + journal.item.name);
          journal.slots[0] = candidates[0]; live = me().items[candidates[0]];
        }
      }
      if (live && live.name === journal.item.name && (live.level || 0) === (journal.item.level || 0) + 1) journal.success = true;
      else if (journal.destroyed || (!live && !journal.commerce) || JSON.stringify(fingerprint(live)) === JSON.stringify(fingerprint(journal.item))) journal.success = false;
      else throw Error('Production outcome needs review before another attempt: ' + journal.item.name);
    }
    if (journal.request?.kind === 'upgrade' || journal.commerce) journal.outcomeItem = journal.destroyed ? null : fingerprint(me().items[journal.slots[0]]);
    journal.phase = 'complete';
    await saveJournal(journal);
    await finishJournal(journal);
  }
  // The journal's recovery and a half-done lucky swap settle under the bag holder's take, so no
  // production, bank visit or tidy runs beside them; a second ask joins the running one. A stand
  // return asks with lucky false and settles only the journal, as the previous release's shared.js did
  // (characters/shared.js:10456-10470); it joins a running recovery at its journal step. A lucky ask
  // that finds a journal-only run starts its own recovery once that run releases the bag.
  function recover(lucky = true): Promise<unknown> {
    if (recovering) return !lucky ? recoveringJournal! : recoveringLucky ? recovering : recovering.then(() => recover(true));
    const took = bag().take('producing');
    if (took !== 'taken') return Promise.reject(Error('Production recovery waiting for ' + took));
    const journal = recoverJournal();
    recoveringJournal = journal; recoveringLucky = lucky;
    recovering = (async () => {
      await journal;
      if (lucky && luckyService?.pending()) await luckyService.recover();
    })().finally(() => { recovering = null; recoveringJournal = null; bag().release('producing'); });
    return recovering;
  }
  // Table A's recovery row: on each reply a merchant settles a half-done lucky swap while no job,
  // production attempt or tidy holds it, since dispatching a job cannot run while the bag reports
  // busy. A failure logs once per change of its text.
  let recoveryFailure: string | null = null;
  async function recoverOnReply(jobRunning: boolean): Promise<void> {
    if (me().ctype !== 'merchant' || !luckyService?.pending() || jobRunning || bag().facts().holder === 'producing' || bag().facts().tidying) return;
    try {
      await recover();
      recoveryFailure = null;
    } catch (error) {
      const text = message(error);
      if (recoveryFailure === text) return;
      recoveryFailure = text;
      p.log('Inventory recovery retry: ' + text, 'red');
    }
  }
  async function verifyProductionProtection(slots: number[]) {
    const active = p.job();
    if (!active?.jobId) return;
    const result = await protectionCheckpoint(active.jobId, active.commandId);
    if (!result?.craftProtection || result.craftProtection.error) throw Error('Craft reservations unavailable; automatic production deferred');
    const entries = me().items.map((item: ItemCopy | null, slot: number) => item ? { item, slot, craftLocation: inventoryPack(me().name) } : null);
    const available = availableCraftStock(entries, result.craftProtection) as any[];
    if (!slots.every(slot => available[slot] && !available[slot].item.l)) throw Error('Item reserved for crafting; automatic production deferred');
  }
  // A merchant's production attempt is the bag holder's: it takes the bag, or runs inside the
  // operation that holds it (a marked upgrade run); a held recovery or attempt answers waiting.
  async function trackedProduction(kind: 'upgrade' | 'compound', slots: number[], automatic: any, operation: () => Promise<any>, offeringAttempt?: any) {
    if (me().ctype !== 'merchant') return operation();
    if (recovering || bag().facts().holder === 'producing') throw Error('Production recovery waiting for game operation');
    const took = bag().take('producing') === 'taken';
    try { return await trackedWork(kind, slots, automatic, operation, offeringAttempt); }
    finally { if (took) bag().release('producing'); }
  }
  async function trackedWork(kind: 'upgrade' | 'compound', slots: number[], automatic: any, operation: () => Promise<any>, offeringAttempt?: any) {
    await recoverJournal();
    await p.yieldJob();
    if (automatic) await verifyProductionProtection(slots);
    const item = fingerprint(me().items[slots[0]]);
    const id = offeringAttempt?.requestId ? 'manual-offering:' + offeringAttempt.requestId : me().name + ':' + p.now() + ':' + Math.random().toString(36).slice(2);
    const body = { character: me().name, id, kind, item, automatic, ...(offeringAttempt || {}) };
    let journal: any = { id, item, slots, phase: 'prepared', request: body };
    const commerceJob = p.job();
    if (kind === 'upgrade' && commerceJob?.commerceJournalKey)
      journal.commerce = { key: commerceJob.commerceJournalKey, sequence: commerceJob.commerceSequence, state: p.stored(commerceJob.commerceJournalKey) };
    writeJournal(journal);
    try {
      const admission = await p.request('/merchant/production', { method: 'POST', body: { ...body, journal } });
      if (admission?.attempt?.completed) { writeJournal(null); return { success: false, alreadyAttempted: true }; }
    } catch (error: any) {
      // A 409 can follow an admission whose save failed: only a confirmed absent admission lets
      // the unstarted journal go.
      if (error?.partyRequest?.status === 409) {
        try {
          const rejected = await p.request('/merchant/production', { method: 'POST', body: { ...body, action: 'inspect' } });
          if (rejected?.attempt === null && Array.isArray(rejected.pending)) writeJournal(null);
        } catch { /* the journal stays as evidence until the admission is known */ }
      }
      throw error;
    }
    journal.phase = 'running';
    await saveJournal(journal);
    let result: any, failure: any;
    try { result = await operation(); } catch (error) { failure = error; }
    const owned = readJournal();
    if (owned?.id === journal.id) journal = Object.assign(journal, owned);
    if (offeringAttempt?.requestId) journal.issued = !!(readJournal() || {}).issued;
    // A confirmed upgrade may stay at its upgrade slot; the receipt follows the result.
    if (kind === 'upgrade' && result?.item && Number.isInteger(result.slot) && sameItemState(me().items[result.slot], result.item)) journal.slots[0] = result.slot;
    const live = kind === 'upgrade' && result?.item || me().items[journal.slots[0]];
    const destroyed = failure?.reason === 'upgrade_destroyed' && failure.confirmedDestroyed === true;
    if (journal.commerce && !live && !destroyed)
      throw itemFailure('upgrade_uncertain', 'Upgrade outcome uncertain; production receipt requires inventory review');
    if (journal.commerce && failure && !destroyed) throw failure;
    // The journal stays for recovery when the failure's code leaves the outcome open (class
    // uncertain, interrupted or ambiguous, or not_confirmed), or while a lucky swap waits for its own
    // recovery; any other failure closes it on the bag as it stands.
    const open = ['uncertain', 'interrupted', 'ambiguous'].includes(failureClass(failure?.code) as string);
    if (failure && (open || failure.code === 'not_confirmed' || luckyService?.pending())) throw failure;
    journal.destroyed = destroyed;
    journal.success = !!live && live.name === item!.name && (live.level || 0) === (item!.level || 0) + 1;
    if (kind === 'upgrade') journal.outcomeItem = journal.destroyed ? null : fingerprint(live);
    journal.phase = 'complete';
    await saveJournal(journal);
    await finishJournal(journal);
    if (failure) throw failure;
    return result;
  }

  // The confirmed operations.
  function compoundConfirmed(first: number, second: number, third: number, scrollSlot: number, automatic?: any) {
    return p.atomic(() => trackedProduction('compound', [first, second, third], automatic, () => observedCompound(first, second, third, scrollSlot)));
  }
  function upgradeConfirmed(itemSlot: number, scrollSlot: number, expectedName?: string, expectedLevel?: number, automatic?: any, offeringAttempt?: any) {
    return p.atomic(() => {
      if (me().items[scrollSlot] && !/^scroll[0-9]+$/.test(me().items[scrollSlot].name))
        return observedUpgrade(itemSlot, scrollSlot, expectedName, expectedLevel);
      return trackedProduction('upgrade', [itemSlot], automatic, () => observedUpgrade(itemSlot, scrollSlot, expectedName, expectedLevel, offeringAttempt), offeringAttempt);
    });
  }
  // A compound counts once every input slot changed, none holds the game's placeholder and the
  // `q.compound` entry ended (the queue time).
  async function observedCompound(first: number, second: number, third: number, scrollSlot: number) {
    await verifyMerchantItemMarks();
    // The compound is confirmed once all four slots changed, the scroll's consumption included,
    // so the journal closes on a bag that shows the whole attempt.
    const inputs = [first, second, third, scrollSlot];
    const before = inputs.map(slot => JSON.stringify(fingerprint(me().items[slot])));
    await massBuff('massproduction');
    const call = reply(() => p.compound(first, second, third, scrollSlot));
    const finished = () => inputs.every((slot, index) => JSON.stringify(fingerprint(me().items[slot])) !== before[index] &&
      me().items[slot]?.name !== 'placeholder');
    const confirmed = await queueSettles(['compound'], () => !!call.failure || finished());
    if (call.failure) throw call.failure;
    if (!confirmed) throw itemFailure('not_confirmed', 'Compound was not confirmed by the game');
    return call.result;
  }
  async function observedUpgrade(itemSlot: number, scrollSlot: number, expectedName?: string, expectedLevel?: number, offeringAttempt?: any) {
    const intendedScroll = me().items[scrollSlot]?.name;
    const intendedItem = JSON.stringify(me().items[itemSlot]);
    if (!me().items[itemSlot]) throw Error('Owned upgrade item missing before preparation');
    await verifyMerchantItemMarks();
    if (JSON.stringify(me().items[itemSlot]) !== intendedItem) {
      const matches = me().items.map((item: ItemCopy | null, slot: number) => JSON.stringify(item) === intendedItem ? slot : -1).filter((slot: number) => slot >= 0);
      if (matches.length !== 1) throw itemFailure('upgrade_uncertain', 'Owned upgrade item uncertain after checkpoint; inventory review required');
      itemSlot = matches[0];
    }
    if (me().ctype !== 'merchant') return upgradeAtSlot(itemSlot, scrollSlot, expectedName, expectedLevel);
    let offeringSlot: number | undefined;
    if (offeringAttempt?.offering) {
      const job = p.job();
      if (!job?.jobId) throw Error('Offering upgrade requires an active merchant job');
      offeringSlot = carriedOffering(await upgradeOfferingCheckpoint(job), offeringAttempt.offering);
    }
    if (offeringSlot !== undefined && offeringSlot < 0) throw Error('Required upgrade offering missing');
    // The checkpoint yields to inventory updates: the scroll is found again by name.
    if (intendedScroll) scrollSlot = p.reads.findInventoryItemByName(intendedScroll);
    const production = readJournal();
    if (production && sameItemState(production.item, me().items[itemSlot]) && production.slots[0] !== itemSlot) {
      production.slots[0] = itemSlot;
      await saveJournal(production);
    }
    const selected = Number.isInteger(luckySlot) && luckySlot! >= 0 && luckySlot! < me().items.length ? luckySlot! : tracking().select();
    const outcome: any = await lucky().run(itemSlot, scrollSlot, selected, (slot: number, scroll: number, offering?: number) => {
      tracking().begin();
      return upgradeAtSlot(slot, scroll, expectedName, expectedLevel, offering);
    }, offeringSlot);
    if (!outcome?.item) return outcome;
    const actual = sameItemState(me().items[itemSlot], outcome.item) ? itemSlot :
      sameItemState(me().items[outcome.slot], outcome.item) ? outcome.slot :
        me().items.findIndex((item: ItemCopy | null) => sameItemState(item, outcome.item));
    if (actual < 0) throw itemFailure('upgrade_uncertain', 'Upgrade outcome uncertain; confirmed result moved before receipt reconciliation');
    return { ...outcome, slot: actual };
  }
  // Mass Production (or its higher tier) for the next operation, when the merchant can cast it. The
  // higher tier leaves the MP of the Merchant's Luck cast the console keeps up (G skills `mluck.mp`;
  // ", Mass Production's MP floor").
  async function massBuff(base: string): Promise<boolean> {
    if (me().ctype !== 'merchant' || me().rip) return false;
    const higher = base + 'pp', tiers = [higher, base];
    if (tiers.some(skill => me().s?.[skill])) return true;
    const skill = tiers.find(name => {
      const definition = G().skills[name];
      return definition && me().level >= Number(definition.level || 0) &&
        (name !== higher || me().mp - Number(definition.mp || 0) >= Number(G().skills.mluck?.mp || 0)) && p.skillReady(name);
    });
    if (!skill) return false;
    try {
      // A buff's promise may stay pending after the condition arrives; production goes on without it.
      await p.useSkill(skill, () => p.sleep(SKILL_REPLY_MS));
      const applied = !!me().s?.[skill];
      const text = (applied ? 'Applied ' : 'Requested ') + G().skills[skill].name + ' for the next operation';
      p.log(text, '#facc15');
      const job = p.job();
      if (job) p.request('/merchant/activity', { method: 'POST', body: { character: me().name, jobId: job.jobId,
        message: text, level: 'info', details: { skill, mp: me().mp, maxMp: me().max_mp } } }).catch(activityFailed);
      return applied;
    } catch (error) {
      p.log('Could not apply ' + skill + '; continuing without it: ' + message(error), '#facc15');
      return false;
    }
  }
  // An upgrade at one slot, confirmed by the game's change after its queue time. A stat
  // scroll (G items `pscroll`) is confirmed by the item's `stat_type` becoming the scroll's `stat`
  // at the same level, the server's change for it.
  async function upgradeAtSlot(itemSlot: number, scrollSlot: number, expectedName?: string, expectedLevel?: number, offeringSlot?: number) {
    const beforeItem = fingerprint(me().items[itemSlot]);
    const scroll = G().items[me().items[scrollSlot]?.name];
    const stat = scroll?.type === 'pscroll' ? scroll.stat : null;
    expectedName = expectedName || beforeItem?.name;
    const fromLevel = Number(beforeItem?.level) || 0;
    const targetLevel = Number.isFinite(Number(expectedLevel)) && expectedLevel !== undefined ? Number(expectedLevel) : stat ? fromLevel : fromLevel + 1;
    activeUpgrade = { slot: itemSlot, item: beforeItem, targetLevel };
    try {
      if (offeringSlot !== undefined) {
        const pending = readJournal();
        if (pending) {
          pending.issued = true;
          pending.offeringBefore = { slot: offeringSlot, item: fingerprint(me().items[offeringSlot]) };
          writeJournal(pending);
        }
      }
      // Mass Production cuts an upgrade's queue time; a stat scroll has none.
      if (!stat) await massBuff('massproduction');
      const call = reply(() => p.upgrade(itemSlot, scrollSlot, offeringSlot));
      const live = () => me().items[itemSlot];
      const reached = () => live()?.name === expectedName && (Number(live()?.level) || 0) === targetLevel &&
        (!stat || live()?.stat_type === stat);
      const failedReply = () => call.settled && call.result?.failed === true && call.result.success === false && Number(call.result.num) === itemSlot;
      const confirmed = await queueSettles(['upgrade'], () => live()?.name !== 'placeholder' && (reached() || failedReply() || !!call.failure));
      if (confirmed && reached()) return { result: call.result, slot: itemSlot, item: fingerprint(live()), fromLevel, toLevel: targetLevel };
      if (confirmed && failedReply()) {
        if (live()?.name === expectedName) return { success: false, slot: itemSlot, item: fingerprint(live()) };
        if (!live()) throw Object.assign(Error(expectedName + ' was destroyed'), { reason: 'upgrade_destroyed', confirmedDestroyed: true });
      }
      if (call.failure) throw call.failure;
      if (!live()) throw itemFailure('upgrade_uncertain', 'Upgrade outcome uncertain: item missing without a confirmed destruction result');
      throw Object.assign(itemFailure('not_confirmed', 'Upgrade result was not confirmed in slot ' + itemSlot + ': expected ' + expectedName +
        ' +' + targetLevel + ', found ' + live().name + ' +' + (Number(live().level) || 0)), { reason: 'upgrade_result_not_confirmed' });
    } finally {
      activeUpgrade = null;
    }
  }

  // An upgrade mark's copy and its offering. The requested level is anchored to the original
  // mark; a durable pass follows a unique survivor to another slot after a recovery.
  function findUpgradeMarkSlot(mark: any, used: Record<number, boolean>): number {
    if (!mark?.item) return -1;
    const start = Number(mark.item.level) || 0;
    const target = Math.min(p.reads.maximumItemLevel(G().items[mark.item.name]), start + (Number(mark.tiers) || 1));
    const slot = Number.isInteger(mark.liveSlot) ? mark.liveSlot : mark.slot, item = Number.isInteger(slot) && me().items[slot];
    const asMarked = (candidate: ItemCopy) => sameItem({ ...candidate, level: mark.item.level }, mark.item);
    const level = (candidate: ItemCopy) => Number(candidate.level) || 0;
    if (item && !used[slot] && level(item) >= start && level(item) <= target && asMarked(item)) return slot;
    if (mark.auto && mark.passId || !mark.auto && mark.requestId) {
      const survivors: number[] = [];
      me().items.forEach((candidate: ItemCopy | null, index: number) => {
        if (!used[index] && candidate && level(candidate) >= start && level(candidate) < target && asMarked(candidate)) survivors.push(index);
      });
      if (survivors.length > 1) throw itemFailure('upgrade_ambiguous', 'Upgrade inventory recovery ambiguous: ' + mark.item.name + ' +' + start + ' to +' + target +
        '; original slot ' + slot + '; unfinished candidates ' + survivors.map(index => index + ' (+' + level(me().items[index]) + ')').join(', '));
      if (survivors.length === 1) return survivors[0];
    }
    return me().items.findIndex((candidate: ItemCopy | null, index: number) => !used[index] && sameItem(candidate, mark.item));
  }
  // An admitted automatic pass is durable intent: with its copy gone the run blocks for review at the
  // mark's own turn, as the ambiguous case does, and its target stays (the previous release
  // shared.js:6286-6288). The offering demand and the scroll plan read every mark of the job, and a
  // copy that went poof earlier in the run leaves them to the next mark.
  function upgradeMarkSlotOrBlock(mark: any, used: Record<number, boolean>): number {
    const slot = findUpgradeMarkSlot(mark, used);
    if (slot < 0 && mark?.auto && mark.passId)
      throw itemFailure('upgrade_ambiguous', 'Automatic upgrade survivor is ambiguous or missing: ' + mark.item.name + '; preserved target +' +
        Math.min(p.reads.maximumItemLevel(G().items[mark.item.name]), (Number(mark.item.level) || 0) + (Number(mark.tiers) || 1)));
    return slot;
  }
  async function upgradeOfferingCheckpoint(command: any) {
    const result = await protectionCheckpoint(command.jobId, command.id || command.commandId);
    if (!result?.craftProtection || result.craftProtection.error) throw Error('Offering reservations unavailable; upgrade deferred');
    return result;
  }
  // The bag's and bank's unreserved, unlocked and unbound copies (the craft claims).
  function availableOfferingEntries(checkpoint: any): any[] {
    const entries: any[] = me().items.map((item: ItemCopy | null, slot: number) => item ? { item, slot, craftLocation: inventoryPack(me().name) } : null);
    for (const pack of Object.keys(me().bank || {})) {
      if (Array.isArray(me().bank[pack])) me().bank[pack].forEach((item: ItemCopy | null, slot: number) => { if (item) entries.push({ item, slot, pack, craftLocation: pack }); });
    }
    return (availableCraftStock(entries, checkpoint.craftProtection) as any[]).filter(entry => entry?.item && !entry.item.l && !entry.item.b);
  }
  function carriedOffering(checkpoint: any, name: string): number {
    const found = availableOfferingEntries(checkpoint).find(entry => !entry.pack && entry.item.name === name);
    return found ? found.slot : -1;
  }
  const carriedOfferingQuantity = (checkpoint: any, name: string) => availableOfferingEntries(checkpoint)
    .filter(entry => !entry.pack && entry.item.name === name).reduce((sum, entry) => sum + (Number(entry.item.q) || 1), 0);
  // The offerings the job's upgrades still ask, one at least.
  function upgradeOfferingDemand(command: any, checkpoint: any, name: string): number {
    const used: Record<number, boolean> = {};
    let demand = 0;
    for (const mark of command.upgrades || []) {
      const slot = findUpgradeMarkSlot(mark, used);
      if (slot < 0) continue;
      used[slot] = true;
      const item = me().items[slot], target = (Number(mark.item.level) || 0) + (Number(mark.tiers) || 1);
      for (let level = Number(item.level) || 0; level < target; level++) {
        if (resolveUpgradeOffering(checkpoint.upgradeOfferingRules || [], item.name, level, mark.offering)?.offering === name) demand++;
        if (mark.offering) break;
      }
    }
    return Math.max(1, demand);
  }
  async function retrieveUpgradeOffering(command: any, name: string, mark: any, item: ItemCopy, activity: any[]) {
    // The supply is asked before a bank checkpoint can hand the merchant's slot to storage; only a
    // later carried observation lets the roll go.
    if (await requestUpgradeOfferingSupply(command, name, mark, item, activity)) return;
    await p.bank.merchantVisitBank(command, activity);
    for (const floor of p.bank.accessibleFloors()) {
      if (me().map !== floor) await p.move(floor);
      let checkpoint = await upgradeOfferingCheckpoint(command);
      if (carriedOfferingQuantity(checkpoint, name) >= upgradeOfferingDemand(command, checkpoint, name)) return;
      const packs = p.bank.packsOnFloor();
      let found;
      while ((found = availableOfferingEntries(checkpoint).find(entry => entry.pack && packs.includes(entry.pack) && entry.item.name === name))) {
        if (p.reads.freeInventorySlots() < 1) throw itemFailure('inventory_full', 'Merchant needs a free slot for upgrade offering');
        await p.bank.bankRetrieveConfirmed(found.pack, found.slot);
        checkpoint = await upgradeOfferingCheckpoint(command);
        if (carriedOfferingQuantity(checkpoint, name) >= upgradeOfferingDemand(command, checkpoint, name)) return;
      }
    }
    // A BankBoi takes another login slot: the job yields before storage takes it, and its upgrade
    // intent survives the handoff.
    await requestUpgradeOfferingSupply(command, name, mark, item, activity);
  }
  async function requestUpgradeOfferingSupply(command: any, name: string, mark: any, item: ItemCopy, activity: any[]) {
    const supply = await p.request('/merchant/offering-supply', { method: 'POST', body: {
      jobId: command.jobId, commandId: command.id || command.commandId, offering: name, item: fingerprint(item), mark } });
    if (supply?.pending) {
      activity.push({ level: 'info', message: 'Waiting for upgrade offering delivery', details: supply });
      throw itemFailure('bankboi_pending');
    }
    return supply?.state === 'delivered';
  }
  // An offering is fetched while the job asks more than the bag carries and the bank holds more.
  const fetchOffering = (checkpoint: any, command: any, name: string) => {
    const carried = carriedOfferingQuantity(checkpoint, name);
    return carried < upgradeOfferingDemand(command, checkpoint, name) && Number((checkpoint.upgradeOfferingStock || {})[name]) > carried;
  };
  async function preloadUpgradeOfferings(command: any, activity: any[]) {
    if (!(command.upgrades || []).length || command.target && command.target !== me().name) return;
    const checkpoint = await upgradeOfferingCheckpoint(command), used: Record<number, boolean> = {}, seen: Record<string, boolean> = {};
    for (const mark of command.upgrades) {
      const slot = findUpgradeMarkSlot(mark, used);
      if (slot < 0) continue;
      used[slot] = true;
      const item = me().items[slot], rule = resolveUpgradeOffering(checkpoint.upgradeOfferingRules || [], item.name, Number(item.level) || 0, mark.offering);
      if (!rule || seen[rule.offering]) continue;
      seen[rule.offering] = true;
      if (fetchOffering(checkpoint, command, rule.offering)) await retrieveUpgradeOffering(command, rule.offering, mark, item, activity);
    }
  }
  async function prepareUpgradeOffering(command: any, mark: any, slot: number, activity: any[]) {
    let checkpoint = await upgradeOfferingCheckpoint(command);
    const item = me().items[slot], level = Number(item.level) || 0;
    const rule = resolveUpgradeOffering(checkpoint.upgradeOfferingRules || [], item.name, level, mark.offering);
    if (!rule) return undefined;
    const wait = (reason?: string) => p.request('/merchant/production', { method: 'POST', body: { character: me().name, action: 'wait-offering',
      owner: command.target || me().name, mark, liveSlot: p.reads.findItem(item), level, offering: rule.offering, ...(reason ? { reason } : {}) } });
    if (fetchOffering(checkpoint, command, rule.offering)) {
      try { await retrieveUpgradeOffering(command, rule.offering, mark, item, activity); }
      catch (error: any) {
        if (error?.code === 'bankboi_pending') throw error;
        await wait(message(error));
        (command._offeringWaits ||= []).push(mark);
        activity.push({ level: 'error', message: 'Upgrade offering retrieval blocked', details: message(error) });
        throw error;
      }
      checkpoint = await upgradeOfferingCheckpoint(command);
    }
    const offeringSlot = carriedOffering(checkpoint, rule.offering);
    if (offeringSlot < 0 && rule.required) {
      await wait();
      (command._offeringWaits ||= []).push(mark);
      activity.push({ level: 'info', message: 'Waiting for ' + (G().items[rule.offering].name || rule.offering) + ' to upgrade ' + item.name + ' from +' + level + ' to +' + (level + 1) });
      return { waiting: true };
    }
    return offeringSlot < 0 ? undefined : { offering: rule.offering, ...(mark.offering ? { requestId: mark.requestId } : {}) };
  }

  // The merchant's improve run: purchases, upgrade marks, compound groups, then the automatic
  // compounds, highest available triple first.
  async function merchantImprove(command: any, activity: any[]) {
    await p.operationStage(command, 'processing');
    const returns: number[] = [], used: Record<number, boolean> = {};
    command._upgradeReturns = [];
    for (const purchase of command.purchases || []) {
      const seller = purchase && p.reads.itemSeller(purchase.name);
      if (!seller || !G().items[purchase.name]) { activity.push({ level: 'error', message: 'No seller for ' + purchase?.name }); continue; }
      const price = G().items[purchase.name].g || 0;
      if (me().gold < price) {
        await p.bank.merchantVisitBank(command, activity);
        await p.bank.withdrawMerchantCash(Math.min(price - me().gold, Number(me().bank?.gold) || 0), command);
      }
      await p.move(p.findNpc(seller));
      await p.buyConfirmed(purchase.name, 1);
      const bought = me().items.findIndex((item: ItemCopy | null, index: number) => !used[index] && !!item && item.name === purchase.name && (item.level || 0) === 0);
      if (bought >= 0) { used[bought] = true; returns.push(bought); }
    }
    for (let i = 0; i < (command.upgrades || []).length; i += 1) {
      const mark = command.upgrades[i];
      let slot = upgradeMarkSlotOrBlock(mark, used);
      if (slot < 0) continue;
      used[slot] = true;
      const targetLevel = Math.min(p.reads.maximumItemLevel(G().items[mark.item.name]), (Number(mark.item.level) || 0) + (Number(mark.tiers) || 1));
      if (mark.auto && !mark.passId) mark.passId = me().name + ':upgrade:' + p.now() + ':' + Math.random().toString(36).slice(2);
      while (me().items[slot] && (Number(me().items[slot].level) || 0) < targetLevel) {
        const liveBefore = fingerprint(me().items[slot]);
        let offeringAttempt: any = await prepareUpgradeOffering(command, mark, slot, activity);
        if (offeringAttempt?.waiting) break;
        if (!sameItem(me().items[slot], liveBefore)) slot = p.reads.findItem(liveBefore as ItemCopy);
        if (slot < 0) throw Error('Upgrade item changed while preparing offering');
        used[slot] = true;
        const scrollName = 'scroll' + p.grade(me().items[slot]);
        let scrollSlot = p.reads.findInventoryItemByName(scrollName);
        if (scrollSlot < 0) {
          // Only the unfinished work is planned again from the item's live level; no one-scroll trips.
          const remaining = command.upgrades.slice(i);
          remaining[0] = { ...mark, item: fingerprint(me().items[slot]), tiers: targetLevel - (Number(me().items[slot].level) || 0) };
          const refill = manualImprovementScrollNeeds({ upgrades: remaining });
          await ensureOwnedItemQuantity(scrollName, refill[scrollName] || 1, command, activity);
          scrollSlot = p.reads.findInventoryItemByName(scrollName);
        }
        await p.move(p.findNpc('newupgrade'));
        // Scroll buying and travel can outlive a rule edit.
        offeringAttempt = await prepareUpgradeOffering(command, mark, slot, activity);
        if (offeringAttempt?.waiting) break;
        try {
          const before = me().items[slot].level || 0;
          const outcome: any = await upgradeConfirmed(slot, scrollSlot, undefined, undefined, { family: mark.auto ? 'upgrade' : 'manual-upgrade',
            key: mark.auto ? ruleKey(mark.item) : undefined, mark: { ...mark, slot, equipped: false } }, offeringAttempt);
          if (outcome?.item) {
            const resultSlot = Number.isInteger(outcome.slot) && sameItem(me().items[outcome.slot], outcome.item) ? outcome.slot : p.reads.findItem(outcome.item);
            if (resultSlot >= 0) { slot = resultSlot; mark.liveSlot = slot; used[slot] = true; }
          }
          if (mark.offering) {
            activity.push({ level: outcome?.success === false ? 'info' : 'success', message: 'Completed one upgrade attempt with ' + mark.offering });
            break;
          }
          if (outcome?.success === false) {
            activity.push({ level: 'info', message: mark.item.name + ' survived a failed upgrade; retrying the same item',
              details: { slot, level: me().items[slot].level, targetLevel } });
            continue;
          }
          activity.push({ level: 'success', message: mark.item.name + ' upgraded from +' + before + ' to +' + (me().items[slot]?.level || before + 1) });
        } catch (error: any) {
          activity.push({ level: 'error', message: mark.item.name + ' upgrade failed', details: String(error?.message || error?.reason || error) });
          if (error?.reason === 'upgrade_destroyed') break;
          // A refused or uncertain operation stops the job for recovery; another copy is never taken.
          throw error;
        }
      }
      if (me().items[slot]) {
        returns.push(slot);
        if (mark.equipped && typeof mark.slot === 'string') command._upgradeReturns.push({ slot: mark.slot, item: fingerprint(me().items[slot]) });
      }
    }
    for (const group of command.compounds || []) {
      if (!group.items || group.items.length !== COMPOUND_INPUTS) continue;
      const localUsed: Record<number, boolean> = {};
      const slots: number[] = group.items.map((mark: any) => {
        const slot = mark.storage ? (Number.isInteger(mark.slot) && !localUsed[mark.slot] && sameItemState(me().items[mark.slot], mark.item) ? mark.slot : -1)
          : me().items.findIndex((item: ItemCopy | null, index: number) => !localUsed[index] && sameItem(item, mark.item));
        if (slot >= 0) localUsed[slot] = true;
        return slot;
      });
      if (slots.some(slot => slot < 0)) {
        if (group.items.some((mark: any) => mark.storage)) throw Error('Reserved bank compound input moved before production');
        continue;
      }
      const cscroll = 'cscroll' + p.grade(me().items[slots[0]]);
      let cscrollSlot = p.reads.findInventoryItemByName(cscroll);
      if (cscrollSlot < 0) {
        await ensureOwnedItemQuantity(cscroll, 1, command, activity);
        cscrollSlot = p.reads.findInventoryItemByName(cscroll);
      }
      await p.move(p.findNpc('newupgrade'));
      try {
        await compoundConfirmed(slots[0], slots[1], slots[2], cscrollSlot);
        const first = group.items[0].item, next = (first.level || 0) + 1;
        const resultSlot = sameItem(me().items[slots[0]], { name: first.name, level: next }) ? slots[0] :
          me().items.findIndex((item: ItemCopy | null, index: number) => !returns.includes(index) && !!item && item.name === first.name && (item.level || 0) === next);
        if (resultSlot >= 0) returns.push(resultSlot);
        activity.push({ level: 'success', message: group.name + ' compounded' });
      } catch (error) {
        activity.push({ level: 'error', message: group.name + ' compound failed', details: message(error) });
        for (const slot of slots) if (slot >= 0 && me().items[slot]) returns.push(slot);
      }
    }
    command._autoCompoundsResolved = [];
    if ((command.autoCompounds || []).length) await refreshCompoundProtection(command);
    for (let autoIndex = 0; autoIndex < (command.autoCompounds || []).length; autoIndex += 1) {
      const autoMark = command.autoCompounds[autoIndex], targetTier = Math.max(1, Number(autoMark.targetTier) || 1);
      if (command.type === 'merchant-self-improve' && !command._autoCompoundBankItems) {
        await p.bank.merchantVisitBank(command, activity);
        command._autoCompoundBankItems = [];
        for (const pack of Object.keys(me().bank || {})) {
          if (Array.isArray(me().bank[pack])) me().bank[pack].forEach((item: ItemCopy | null) => { if (item) command._autoCompoundBankItems.push({ ...item, craftLocation: pack }); });
        }
      }
      const desired = Number.isSafeInteger(Number(autoMark.quantity)) ? Number(autoMark.quantity) : -1;
      let produced = 0, progress = true;
      const outputs = (level: number) => me().items.filter((item: ItemCopy | null) => !!item && item.name === autoMark.name && (item.level || 0) === level + 1).length;
      while (progress) {
        await refreshCompoundProtection(command);
        progress = false;
        const live = (command.autoCompounds || []).find((rule: any) => rule.name === autoMark.name && Number(rule.targetTier || 1) === targetTier && Number(rule.quantity) !== 0);
        if (!live) break;
        if (desired !== -1 && produced >= desired) break;
        // The highest available triple goes first, freeing room before more low copies come in;
        // the bank is never emptied.
        for (let level = targetTier - 1; level >= 0; level -= 1) {
          let candidates = compoundInventorySlots(command, autoMark.name, level);
          if (candidates.length < COMPOUND_INPUTS && command.type === 'merchant-self-improve') {
            const banked = compoundAvailableStock(command).slice(me().items.length)
              .filter(entry => entry && !entry.item.l && entry.item.name === autoMark.name && (entry.item.level || 0) === level).length;
            if (banked + candidates.length < COMPOUND_INPUTS) continue;
            await p.bank.merchantVisitBank(command, activity);
            await retrieveAutoCompoundBatch(autoMark.name, level, command);
            candidates = compoundInventorySlots(command, autoMark.name, level);
          }
          if (candidates.length < COMPOUND_INPUTS) continue;
          const scrollName = 'cscroll' + p.grade(me().items[candidates[0]]);
          if (p.reads.findInventoryItemByName(scrollName) < 0) await ensureOwnedItemQuantity(scrollName, 1, command, activity);
          await p.operationStage(command, 'processing');
          await p.move(p.findNpc('newupgrade'));
          await refreshCompoundProtection(command);
          candidates = compoundInventorySlots(command, autoMark.name, level);
          if (candidates.length < COMPOUND_INPUTS) continue;
          const scrollSlot = p.reads.findInventoryItemByName(scrollName);
          if (scrollSlot < 0) continue;
          const before = JSON.stringify(candidates.map(slot => me().items[slot]));
          const outputsBefore = outputs(level);
          try {
            await compoundConfirmed(candidates[0], candidates[1], candidates[2], scrollSlot, { family: 'compound', key: autoMark.name });
            if (outputs(level) > outputsBefore) {
              if (level + 1 === targetTier) produced++;
              activity.push({ level: 'success', message: 'Auto compounded ' + autoMark.name + ' to +' + (level + 1) });
            } else activity.push({ level: 'error', message: 'Auto compound failed for ' + autoMark.name });
          } catch (error) {
            activity.push({ level: 'error', message: 'Auto compound failed for ' + autoMark.name, details: message(error) });
          }
          progress = before !== JSON.stringify(candidates.map(slot => me().items[slot]));
          if (!progress) throw Error('Auto compound made no inventory progress');
          break;
        }
      }
      me().items.forEach((item: ItemCopy | null, slot: number) => {
        if (item && item.name === autoMark.name && (item.level || 0) >= targetTier && !returns.includes(slot)) returns.push(slot);
      });
    }
    return returns.map(slot => fingerprint(me().items[slot])).filter(Boolean);
  }
  // The bank copies an automatic compound still needs for its triple, each withdrawal confirmed.
  async function retrieveAutoCompoundBatch(name: string, level: number, command: any) {
    await refreshCompoundProtection(command);
    if (!autoCompoundLevelAllowed(command, name, level)) return;
    const needed = COMPOUND_INPUTS - compoundInventorySlots(command, name, level).length;
    if (needed <= 0) return;
    let stock: any[] = [];
    for (const pack of Object.keys(me().bank || {})) {
      if (Array.isArray(me().bank[pack])) me().bank[pack].forEach((item: ItemCopy | null, slot: number) => {
        if (item) stock.push({ pack, slot, craftLocation: pack, item: { ...item, craftLocation: pack } });
      });
    }
    // Each visit's bank view replaces the stale estimates.
    command._autoCompoundBankItems = stock.map(entry => entry.item);
    const matches = compoundAvailableStock(command, stock).slice(me().items.length)
      .filter(entry => entry && !entry.item.l && entry.item.name === name && (entry.item.level || 0) === level);
    if (matches.length < needed) return;
    const reserve = p.reads.findInventoryItemByName('cscroll' + p.grade({ name, level })) < 0 ? 1 : 0;
    if (freeSlots(me().items, luckySlot, p.protectedSlots()) < needed + reserve) throw itemFailure('inventory_full');
    for (let index = 0; index < needed; index += 1) {
      await refreshCompoundProtection(command);
      if (!autoCompoundLevelAllowed(command, name, level)) return;
      const available = compoundAvailableStock(command, stock).slice(me().items.length);
      if (!available.some(entry => entry?.pack === matches[index].pack && entry.slot === matches[index].slot)) return;
      await p.bank.bankRetrieveConfirmed(matches[index].pack, matches[index].slot);
      stock = stock.filter(entry => entry !== matches[index]);
      const saved = command._autoCompoundBankItems.findIndex((item: any) => !item.l && item.name === name && (item.level || 0) === level && item.craftLocation === matches[index].pack);
      if (saved >= 0) command._autoCompoundBankItems.splice(saved, 1);
    }
  }
  async function refreshCompoundProtection(command: any) {
    const result = await protectionCheckpoint(command.jobId, command.id || command.commandId);
    if (!result?.craftProtection) throw Error('Craft reservations unavailable; auto compound deferred');
    command.craftProtection = result.craftProtection;
    if (Array.isArray(result.compoundRules)) {
      command._compoundRulesChecked = true;
      command.autoCompounds = result.compoundRules.filter((rule: any) => (command.autoCompounds || [])
        .some((original: any) => original.name === rule.name && Number(original.targetTier || 1) === Number(rule.targetTier || 1)));
    }
    command._compoundBlocked = result.compoundBlocked || [];
    if (command.craftProtection.error) throw Error(command.craftProtection.error);
  }
  // The bag's copies, then the bank's, that no claim holds and no blocked compound names.
  function compoundAvailableStock(command: any, bankEntries?: any[]): any[] {
    const inventory = me().items.map((item: ItemCopy | null, slot: number) => item ? { item, slot, craftLocation: inventoryPack(me().name) } : null);
    const bank = bankEntries || (command._autoCompoundBankItems || []).map((item: any) => ({ item, craftLocation: item.craftLocation }));
    return (availableCraftStock(inventory.concat(bank), command.craftProtection || { requirements: [] }) as any[])
      .map(entry => entry && (command._compoundBlocked || []).some((item: ItemCopy) => sameItem(entry.item, item)) ? null : entry);
  }
  const autoCompoundLevelAllowed = (command: any, name: string, level: number) => !command._compoundRulesChecked ||
    (command.autoCompounds || []).some((rule: any) => rule.name === name && Number(rule.quantity) !== 0 && level < Number(rule.targetTier || 1));
  function compoundInventorySlots(command: any, name: string, level: number): number[] {
    if (!autoCompoundLevelAllowed(command, name, level)) return [];
    return compoundAvailableStock(command).slice(0, me().items.length)
      .filter(entry => entry && !entry.item.l && entry.item.name === name && (entry.item.level || 0) === level).map(entry => entry.slot);
  }

  // The scrolls a manual improve needs. Steps within an item's starting grade are bought together
  // across the queued items; later grades and compound groups stage one at a time, since the supply
  // is checked again after each operation.
  function manualImprovementScrollNeeds(command: any): Record<string, number> {
    const needs: Record<string, number> = {}, staged: Record<string, number> = {}, used: Record<number, boolean> = {};
    for (const mark of command.upgrades || []) {
      if (!mark?.item) continue;
      const slot = findUpgradeMarkSlot(mark, used);
      if (slot < 0) continue;
      used[slot] = true;
      const live = me().items[slot], start = Number(live.level) || 0;
      const target = Math.min(p.reads.maximumItemLevel(G().items[live.name]), (Number(mark.item.level) || 0) + Math.max(1, Number(mark.tiers) || 1));
      const starting = 'scroll' + p.grade(live);
      for (let tier = 0; tier < Math.max(0, target - start); tier += 1) {
        const scroll = 'scroll' + p.grade({ name: live.name, level: start + tier });
        if (scroll === starting) needs[scroll] = (needs[scroll] || 0) + 1;
        else staged[scroll] = 1;
      }
    }
    for (const scroll of Object.keys(staged)) needs[scroll] = Math.max(needs[scroll] || 0, staged[scroll]);
    for (const group of command.compounds || []) {
      if (group?.items?.length !== COMPOUND_INPUTS || !group.items[0].item) continue;
      const groupUsed: Record<number, boolean> = {};
      const slots = group.items.map((mark: any) => {
        const slot = me().items.findIndex((item: ItemCopy | null, index: number) => !used[index] && !groupUsed[index] && sameItem(item, mark.item));
        if (slot >= 0) groupUsed[slot] = true;
        return slot;
      });
      if (slots.some((slot: number) => slot < 0)) continue;
      for (const slot of slots) used[slot] = true;
      const scroll = 'cscroll' + p.grade(me().items[slots[0]]);
      needs[scroll] = Math.max(needs[scroll] || 0, 1);
    }
    return needs;
  }
  // A count on the bag: the bank's copies first, then the scroll seller, with the gold from the bank.
  async function ensureOwnedItemQuantity(name: string, requiredOnPlayer: number, command: any, activity: any[]) {
    let availability = p.reads.itemAvailability(name);
    if (availability.onPlayer >= requiredOnPlayer) return availability;
    await p.bank.merchantVisitBank(command, activity);
    availability = await p.bank.retrieveFromBankUntil(name, requiredOnPlayer);
    const missing = Math.max(0, requiredOnPlayer - availability.onPlayer);
    if (!missing) return availability;
    const cost = missing * Number(G().items[name]?.g || 0);
    if (me().gold < cost) {
      const shortfall = cost - me().gold;
      if ((Number(me().bank?.gold) || 0) < shortfall) throw itemFailure('short_gold', 'Insufficient bank gold for ' + missing + ' × ' + name);
      await p.bank.withdrawMerchantCash(shortfall, command);
    }
    await p.move(p.findNpc('scrolls'));
    await p.buyConfirmed(name, missing);
    return p.reads.itemAvailability(name);
  }
  async function prepareManualImprovementScrolls(command: any, activity: any[]) {
    const needs = manualImprovementScrollNeeds(command), names = Object.keys(needs);
    if (!names.length) return needs;
    if (names.some(name => p.reads.itemAvailability(name).onPlayer < needs[name])) await p.bank.merchantVisitBank(command, activity);
    for (const name of names) await p.bank.retrieveFromBankUntil(name, needs[name]);
    const missing: Record<string, number> = {};
    let totalCost = 0;
    for (const name of names) {
      const availability = p.reads.itemAvailability(name);
      missing[name] = Math.max(0, needs[name] - availability.onPlayer);
      totalCost += missing[name] * Number(G().items[name]?.g || 0);
      activity.push({ level: 'info', message: 'Scroll supply checked: ' + name,
        details: { required: needs[name], inventory: availability.onPlayer, bank: availability.inBank, buying: missing[name] } });
    }
    if (me().gold < totalCost) {
      if (!me().bank) await p.bank.merchantVisitBank(command, activity);
      const neededGold = totalCost - me().gold;
      if ((Number(me().bank?.gold) || 0) < neededGold) throw itemFailure('short_gold', 'Insufficient bank gold for requested upgrade and compound scrolls');
      await p.bank.withdrawMerchantCash(neededGold, command);
    }
    if (names.some(name => missing[name] > 0)) {
      await p.move(p.findNpc('scrolls'));
      for (const name of names) if (missing[name] > 0) await p.buyConfirmed(name, missing[name]);
    }
    return needs;
  }

  // Stat scrolls: a stat scroll needs the game's count for the item's grade.
  const statScrollQuantity = (item: ItemCopy) => statScrollsNeeded(G().items[String(item.name)] || {}, Number(item.level) || 0);
  const statusQuantity = (entries: any[], name: string) =>
    (entries || []).reduce((total, entry) => total + (entry?.item?.name === name ? (entry.item.q || 1) : 0), 0);
  // The scrolls this visit's deliveries ask, less what the target already carries.
  function statScrollNeeds(command: any): Record<string, number> {
    const needs: Record<string, number> = {};
    for (const mark of command.statScrolls || []) {
      if (mark?.scroll && mark.item) needs[mark.scroll] = (needs[mark.scroll] || 0) + statScrollQuantity(mark.item);
    }
    for (const name of Object.keys(needs)) needs[name] = Math.max(0, needs[name] - statusQuantity(command.targetInventory || [], name));
    return needs;
  }
  // Only this visit's deliveries are prepared, so a later leg never buys an earlier recipient's
  // scrolls again. A scroll an NPC sells (G npcs) is bought; any other comes from the bank only.
  async function preloadStatScrolls(command: any, activity: any[]) {
    const needs = statScrollNeeds(command), names = Object.keys(needs).filter(name => needs[name] > 0);
    if (!names.length) return;
    const short = (name: string) => p.reads.itemAvailability(name).onPlayer < needs[name];
    const needsBank = names.some(short);
    if (needsBank) await p.bank.merchantVisitBank(command, activity);
    for (const name of names) await p.bank.retrieveFromBankUntil(name, needs[name]);
    for (const name of names) {
      if (!p.reads.itemSeller(name) && short(name)) throw itemFailure('marked_missing', 'Missing ' + needs[name] + ' × ' + name + ' in merchant or bank inventory');
    }
    const toBuy = (name: string) => p.reads.itemSeller(name) ? Math.max(0, needs[name] - p.reads.itemAvailability(name).onPlayer) : 0;
    const totalCost = names.reduce((total, name) => total + toBuy(name) * Number(G().items[name]?.g || 0), 0);
    if (me().gold < totalCost) {
      if ((Number(me().bank?.gold) || 0) < totalCost - me().gold) throw itemFailure('short_gold', 'Insufficient bank gold for requested stat scrolls');
      await p.bank.withdrawMerchantCash(totalCost - me().gold, command);
    }
    if (needsBank && me().bank) {
      try { await p.bank.sortCurrentBankFloor(activity); }
      catch (error) { activity.push({ level: 'error', message: 'Bank sorting failed after stat-scroll withdrawal', details: message(error) }); }
    }
    for (const name of names) {
      const count = toBuy(name);
      if (!count) continue;
      await p.move(p.findNpc(p.reads.itemSeller(name)!));
      await p.buyConfirmed(name, count);
    }
    activity.push({ level: 'info', message: 'Prepared stat scrolls before the party visit' });
  }
  // The merchant's own stat scrolls. The exact clicked copy must still be there, so an identical
  // copy that already has a stat never takes an expensive scroll stack.
  async function applyStatScrolls(command: any, activity: any[]) {
    const returns: unknown[] = [], resolved: any[] = [];
    command._statReturns = [];
    command._statScrollsApplied = [];
    for (const mark of command.statScrolls || []) {
      const itemSlot = p.reads.findMarkedInventoryItem(mark), scrollSlot = p.reads.findInventoryItemByName(mark.scroll);
      if (itemSlot < 0) {
        activity.push({ level: 'error', message: 'Skipped stale stat-scroll request for ' + mark.item.name,
          details: 'The exact clicked item is no longer present in its expected state; no scroll was consumed.' });
        continue;
      }
      if (scrollSlot < 0 || p.reads.inventoryQuantity(mark.scroll) < statScrollQuantity(me().items[itemSlot])) {
        activity.push({ level: 'error', message: 'Missing required ' + mark.scroll + ' copies' });
        returns.push(fingerprint(me().items[itemSlot]));
        continue;
      }
      try {
        await p.move(p.findNpc('newupgrade'));
        await upgradeAtSlot(itemSlot, scrollSlot);
        const completed = fingerprint(me().items[itemSlot]);
        command._statScrollsApplied.push({ mark, slot: itemSlot, item: completed });
        returns.push(completed);
        if (mark.equipped && typeof mark.slot === 'string') command._statReturns.push({ slot: mark.slot, item: completed });
        resolved.push(mark);
        activity.push({ level: 'success', message: 'Applied ' + mark.statType.toUpperCase() + ' to ' + mark.item.name + ' for ' + command.target });
      } catch (error) {
        if (me().items[itemSlot]) returns.push(fingerprint(me().items[itemSlot]));
        activity.push({ level: 'error', message: 'Stat scroll failed for ' + mark.item.name, details: message(error) });
      }
    }
    command._statScrollsResolved = resolved;
    return returns;
  }
  async function deliverStatScrolls(command: any, activity: any[]) {
    const needs = statScrollNeeds(command), names = Object.keys(needs);
    if (!names.length) return false;
    await p.rendezvous(command.jobId, command.target);
    for (const name of names) {
      if (!needs[name]) continue;
      const slot = p.reads.findInventoryItemByName(name);
      if (slot < 0 || p.reads.inventoryQuantity(name) < needs[name]) throw itemFailure('marked_missing', 'Missing prepared ' + name + ' copies for ' + command.target);
      await p.sendItem(command.target, slot, needs[name]);
      activity.push({ level: 'success', message: 'Delivered ' + needs[name] + ' × ' + name + ' to ' + command.target + ' for equipped armor' });
    }
    return true;
  }
  // A fighter's stat scrolls on its delivered scrolls: one piece off at a time at the upgrade NPC,
  // put straight back on, then the return to the leader or to where it farmed.
  async function applyOwnedStatScrolls(command: any) {
    const activity: any[] = [], resolved: any[] = [];
    let failure: unknown = null;
    const origin = { map: me().map, x: me().x, y: me().y };
    try {
      await p.move(p.findNpc('newupgrade'));
      for (const mark of command.items || []) {
        if (!mark || typeof mark.slot !== 'string' || !sameItemState(me().slots[mark.slot], mark.item)) {
          activity.push({ level: 'error', message: 'Skipped stale stat-scroll request for ' + (mark?.item?.name || 'equipment') });
          continue;
        }
        await p.unequip(mark.slot);
        const itemSlot = p.reads.findItem(mark.item), scrollSlot = p.reads.findInventoryItemByName(mark.scroll);
        try {
          if (itemSlot < 0 || scrollSlot < 0 || p.reads.inventoryQuantity(mark.scroll) < statScrollQuantity(mark.item))
            throw itemFailure('marked_missing', 'Missing item or required ' + mark.scroll + ' copies');
          await upgradeConfirmed(itemSlot, scrollSlot);
          if (!me().items[itemSlot]) throw Error(mark.item.name + ' was destroyed while applying its stat scroll');
          await p.equip(itemSlot, mark.slot);
          resolved.push(mark);
          activity.push({ level: 'success', message: 'Applied ' + mark.statType.toUpperCase() + ' to ' + (G().items[mark.item.name]?.name || mark.item.name) });
        } catch (error) {
          // The piece goes back on whatever failed; the scroll's stat changed its state, so the
          // known cell comes first.
          const restore = me().items[itemSlot]?.name === mark.item.name ? itemSlot : p.reads.findItem(mark.item);
          if (restore >= 0) await p.equip(restore, mark.slot);
          throw error;
        }
      }
    } catch (error) {
      activity.push({ level: 'error', message: 'Stat-scroll application failed', details: message(error) });
      failure = error;
    }
    try {
      // The leader may have moved while the scrolls applied, so the return reads it now.
      const leader = p.leaderLocation();
      await p.move(leader || origin);
      activity.push({ level: 'success', message: leader ? 'Returned ' + me().name + ' to the party leader after stat scrolling'
        : 'Returned ' + me().name + ' to its farming location after stat scrolling' });
    } catch (error) {
      activity.push({ level: 'error', message: 'Could not return after stat scrolling', details: message(error) });
    }
    const equipResults = await p.equipDelivered(command.equipItems || []);
    equipResults.forEach((result: any, index: number) => { if (command.deliveryIds) result.deliveryId = command.deliveryIds[index]; });
    await p.request('/stat-scroll-complete', { method: 'POST', body: { character: me().name, resolved, activity, equipResults } });
    if (failure) throw failure;
  }

  // The merchant's own improvements. Each bank copy comes out confirmed.
  async function prepareBankCompounds(command: any, activity: any[]) {
    const groups = (command.compounds || []).filter((group: any) => (group.items || []).some((mark: any) => mark.storage));
    if (!groups.length) return;
    await p.bank.merchantVisitBank(command, activity);
    for (const group of groups) for (const mark of group.items) {
      const source = mark.storage;
      if (!source || mark.storageReceived) continue;
      const bankItem = me().bank?.[source.pack]?.[source.slot];
      // The visit's own withdrawals may have taken the reserved cell (the coordinator queues the
      // group's cells as withdrawals too); the copy in the cell it landed in is the mark's.
      const landed = (command._merchantWithdrawalsLanded || []).find((entry: any) => entry.pack === source.pack && entry.slot === source.slot);
      if (!bankItem && landed && sameItemState(me().items[landed.inventorySlot], mark.item)) {
        mark.slot = landed.inventorySlot;
        mark.storageReceived = true;
        // The visit's receipt for that cell names the bag cell, which the coordinator's compound
        // receipt reads (endings.ts `deconstructionReceipts`).
        const receipts = command._merchantWithdrawalsCompleted || [];
        const index = receipts.findIndex((receipt: any) => receipt?.pack === source.pack && receipt?.slot === source.slot && receipt.inventorySlot === undefined);
        if (index >= 0) receipts[index] = { ...(receipts[index] as object), inventorySlot: landed.inventorySlot };
        continue;
      }
      if (!bankItem || bankItem.l || !sameItemState(bankItem, mark.item)) throw Error('Reserved bank compound item changed');
      const before = me().items.map((item: ItemCopy | null) => item ? JSON.stringify(fingerprint(item)) : null);
      await p.bank.bankRetrieveConfirmed(source.pack, source.slot);
      const received = me().items.findIndex((item: ItemCopy | null, index: number) => !before[index] && sameItemState(item, mark.item));
      if (received < 0) throw itemFailure('not_confirmed', 'Bank compound destination was not uniquely observed');
      mark.slot = received;
      mark.storageReceived = true;
      (command._merchantWithdrawalsCompleted ||= []).push({ pack: source.pack, slot: source.slot, item: mark.item, inventorySlot: received });
    }
    activity.push({ level: 'info', message: 'Withdrew reserved bank compound triplets' });
  }
  // A pass marks every bag copy a rule still has room for, and withdraws bank copies while the bag
  // keeps a free cell past the player's protected free slots; quantity -1 takes every copy
  // those cells hold.
  async function prepareBankUpgrades(command: any, activity: any[]) {
    if (!(command.bankUpgradeRules || []).length) return;
    await p.bank.merchantVisitBank(command, activity);
    command.upgrades = command.upgrades || [];
    for (const rule of command.bankUpgradeRules) {
      if (!G().items[rule.name]?.upgrade) continue;
      const target = rule.level + rule.tiers;
      const planned = command.upgrades.filter((mark: any) => mark.item.name === rule.name && (mark.item.level || 0) + mark.tiers >= target).length;
      let needed = rule.quantity === -1 ? Infinity : Math.max(0, rule.quantity - planned);
      const available = (item: ItemCopy | null) => !!item && !item.l && item.name === rule.name && (item.level || 0) === rule.level;
      const unmarked = () => me().items.findIndex((item: ItemCopy | null, index: number) => available(item) && !command.upgrades.some((mark: any) => mark.slot === index));
      while (needed > 0) {
        let slot = unmarked();
        if (slot < 0) {
          if (freeSlots(me().items, luckySlot, p.protectedSlots()) <= 0) break;
          let found: { pack: string; slot: number } | null = null;
          for (const pack of Object.keys(me().bank || {})) {
            const index = Array.isArray(me().bank[pack]) ? me().bank[pack].findIndex(available) : -1;
            if (index >= 0) { found = { pack, slot: index }; break; }
          }
          if (!found) break;
          await p.bank.bankRetrieveConfirmed(found.pack, found.slot);
          slot = unmarked();
          if (slot < 0) throw itemFailure('not_confirmed', 'Bank upgrade withdrawal was not confirmed');
        }
        command.upgrades.push({ slot, item: fingerprint(me().items[slot]), tiers: rule.tiers, auto: true });
        activity.push({ level: 'info', message: 'Reserved ' + rule.name + ' for upgrading to +' + target });
        needed--;
      }
    }
  }
  // The merchant's self improve: every copy the run takes off is recorded, and the end of
  // the run, failed or not, puts each back in its empty slot: the upgraded or scrolled copy first,
  // then the marked one, then the highest copy of its name.
  async function merchantSelfImprove(command: any) {
    const activity: any[] = [], staleStatScrolls: any[] = [], unequipped: { slot: string; item: ItemCopy }[] = [];
    async function takeOff(slot: string, item: ItemCopy) {
      await p.unequip(slot);
      unequipped.push({ slot, item });
    }
    async function restoreUnequipped() {
      for (const entry of unequipped) {
        if (me().slots[entry.slot]) continue;
        const changed = [...(command._upgradeReturns || []), ...(command._statReturns || [])].find((done: any) => done.slot === entry.slot);
        let slot = changed ? p.reads.findItem(changed.item) : -1;
        if (slot < 0) slot = p.reads.findItem(entry.item);
        if (slot < 0) {
          const candidates = me().items.map((item: ItemCopy | null, index: number) => ({ item, index }))
            .filter(({ item }: { item: ItemCopy | null }) => item?.name === entry.item.name)
            .sort((a: any, b: any) => (Number(b.item.level) || 0) - (Number(a.item.level) || 0));
          if (candidates.length) slot = candidates[0].index;
        }
        if (slot < 0) continue;
        await p.equip(slot, entry.slot);
        // The previous release logged an upgrade's return only (shared.js:7349-7360); a stat return
        // equips silently.
        if ((command._upgradeReturns || []).includes(changed)) activity.push({ level: 'success', message: 'Re-equipped upgraded ' + entry.item.name });
      }
    }
    try {
      // The stat-scroll targets are checked before any gold or scroll moves: an inventory mark holds
      // its clicked cell, an equipped one the exact marked state.
      command.statScrolls = (command.statScrolls || []).filter((mark: any) => {
        const valid = mark && (Number.isInteger(mark.slot) ? p.reads.findMarkedInventoryItem(mark) >= 0
          : typeof mark.slot === 'string' && sameItemState(me().slots[mark.slot], mark.item));
        if (!valid) {
          staleStatScrolls.push(mark);
          activity.push({ level: 'error', message: 'Removed stale stat-scroll request for ' + (mark?.item?.name || 'equipment'),
            details: 'The exact clicked item changed or moved; the request was removed and no stat scroll was purchased.' });
        }
        return valid;
      });
      for (const mark of command.upgrades || []) {
        if (mark.equipped && typeof mark.slot === 'string' && sameItem(me().slots[mark.slot], mark.item)) {
          await takeOff(mark.slot, mark.item);
          activity.push({ level: 'info', message: 'Unequipped ' + mark.item.name + ' for upgrading' });
        }
      }
      for (const mark of command.statScrolls) {
        if (typeof mark.slot === 'string' && sameItemState(me().slots[mark.slot], mark.item)) await takeOff(mark.slot, mark.item);
      }
      await prepareBankCompounds(command, activity);
      await prepareBankUpgrades(command, activity);
      await preloadUpgradeOfferings(command, activity);
      await preloadStatScrolls(command, activity);
      await prepareManualImprovementScrolls(command, activity);
      await applyStatScrolls(command, activity);
      command._statScrollsResolved = (command._statScrollsResolved || []).concat(staleStatScrolls);
      await merchantImprove(command, activity);
      if ((command.autoCompounds || []).length) await p.storeCompoundLeftovers({
        refresh: () => refreshCompoundProtection(command),
        rules: () => command.autoCompounds || [],
        inventorySize: () => me().items.length,
        stock: () => {
          const bank: any[] = [];
          for (const pack of Object.keys(me().bank || {})) {
            if (Array.isArray(me().bank[pack])) me().bank[pack].forEach((item: ItemCopy | null) => { if (item) bank.push({ item, craftLocation: pack }); });
          }
          return compoundAvailableStock(command, bank);
        },
        visitBank: async () => { await p.operationStage(command, 'storing'); return p.bank.merchantVisitBank(command, activity); },
        deposit: (slot: number) => p.bank.bankStoreFully(slot),
        log: (text: string) => { activity.push({ level: 'info', message: text }); },
      });
      await restoreUnequipped();
      if ((command._capacityDeferredWithdrawals || []).some((withdrawal: unknown) => !(command._merchantWithdrawalsCompleted || []).includes(withdrawal)))
        throw itemFailure('inventory_full');
      activity.push({ level: 'success', message: 'Finished merchant-owned upgrades and compounds' });
      await p.request('/merchant/complete', { method: 'POST', body: {
        jobId: command.jobId, success: true, banked: [], bankedByCharacter: {}, kept: [],
        upgradesResolved: (command.upgrades || []).length > 0,
        upgradeMarksResolved: (command.upgrades || []).filter((mark: any) => !(command._offeringWaits || []).includes(mark)),
        statScrollsResolved: command._statScrollsResolved || [],
        statScrollsApplied: command._statScrollsApplied || [],
        compoundsResolved: (command.compounds || []).length > 0,
        autoCompoundsResolved: command.sharedBankImprovements ? [] : command._autoCompoundsResolved || [],
        purchasesResolved: (command.purchases || []).length > 0,
        withdrawalsDelivered: false,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
        merchantBanked: command._merchantBankedCompleted || [], activity,
      } });
    } catch (error: any) {
      try { await restoreUnequipped(); }
      catch (restoreError) { activity.push({ level: 'error', message: 'Could not restore merchant equipment', details: message(restoreError) }); }
      const storagePause = error?.code === 'bankboi_pending';
      activity.push({ level: storagePause ? 'info' : 'error',
        message: storagePause ? 'Merchant-owned improvement paused for Bankboi' : 'Merchant-owned improvement failed', details: message(error) });
      try {
        await p.request('/merchant/complete', { method: 'POST', body: {
          jobId: command.jobId, success: false, error: message(error), code: error?.code,
          statScrollsApplied: command._statScrollsApplied || [],
          merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
          merchantBanked: command._merchantBankedCompleted || [], activity,
        } });
      } catch (report) { reportFailed(report); }
      throw error;
    }
  }

  // A commerce order's owned copies: its results, its bought bases and the item in work. The
  // order holds the bag (3.4), so no lucky swap, sort buffer or Tracktrix pin moves them, and each
  // copy is read at its recorded cell. A result that is not at its cell
  // ends the order for inventory review.
  function verifyCommerceResults(results: any[] | undefined) {
    const used = new Set<number>();
    for (const result of results || []) {
      if (used.has(result.slot) || !sameItem(me().items[result.slot], result.item))
        throw Error('Owned upgrade result missing; order requires inventory review');
      used.add(result.slot);
    }
  }
  // One buy-and-level line, in batches of bought bases. Each purchase and each attempt is saved
  // before its call, so a resumed line never buys or charges twice.
  async function merchantBuyUpgradeLine(command: any, purchase: any, buyIndex: number, services: CommerceServices) {
    const definition = G().items[purchase.id], target = Number(purchase.level), saved = command._commerceState || {};
    const progress = saved.phase === 'leveling' && Number(saved.buyIndex) === buyIndex ? { ...saved } :
      { phase: 'leveling', buyIndex, attempts: 0, spent: 0, completedResults: 0, results: saved.results || [], activeItem: null };
    progress.results = progress.results || [];
    progress.batchItems = progress.batchItems || [];
    progress.attempts = Number(progress.attempts) || 0;
    progress.spent = Number(progress.spent) || 0;
    progress.completedResults = Number(progress.completedResults) || 0;
    verifyCommerceResults(progress.results);
    const save = (boundary: boolean) => services.checkpoint(progress, boundary);
    const stock = (name: string) => p.reads.inventoryQuantity(name);
    const ownedSlot = () => progress.activeItem && sameItem(me().items[progress.activeSlot], progress.activeItem) ? progress.activeSlot : -1;
    const exhausted = () => (purchase.estimateUnavailable ? 'Gold cap for unavailable estimate exhausted' : '90% estimated budget exhausted') +
      ' for ' + purchase.id + ' (spent ' + progress.spent + ' of ' + purchase.budget + ' gold)';
    async function settlePurchase() {
      const pending = progress.pendingPurchase;
      if (!pending) return;
      if (stock(pending.name) < pending.before + pending.quantity) {
        await services.fund(pending.cost);
        await services.move(p.reads.itemSeller(pending.name));
        await p.buyConfirmed(pending.name, pending.quantity);
      }
      if (pending.base) {
        const slot = me().items.findIndex((item: ItemCopy | null, index: number) => !!item && item.name === purchase.id && !(Number(item.level) || 0) &&
          pending.beforeSlots[index] !== JSON.stringify(fingerprint(item)));
        if (slot < 0) throw Error('Purchased upgrade item could not be identified');
        if (pending.batch) {
          progress.batchItems.push({ slot, item: fingerprint(me().items[slot]) });
          progress.batchRemaining -= 1;
        } else {
          progress.activeSlot = slot;
          progress.activeItem = fingerprint(me().items[slot]);
        }
      }
      delete progress.pendingPurchase;
      await save(false);
    }
    async function purchaseStock(name: string, quantity: number, base: boolean) {
      const cost = Number(G().items[name].g) * quantity;
      if (Number.isFinite(Number(purchase.budget)) && progress.spent + cost > Number(purchase.budget)) throw Error(exhausted());
      // The walk and the funding come first, so a failed walk spends none of the order's allowance.
      await services.fund(cost);
      await services.move(p.reads.itemSeller(name));
      progress.spent += cost;
      if (base && progress.batchRemaining) progress.attempts += 1;
      progress.pendingPurchase = { name, quantity, cost, before: stock(name), base, batch: base && progress.batchRemaining > 0,
        beforeSlots: base ? me().items.map((item: ItemCopy | null) => JSON.stringify(fingerprint(item))) : [] };
      await save(false);
      await settlePurchase();
    }
    // The attempt's receipt names the cell its outcome landed in; an older saved outcome without
    // one reads the item's own cell.
    async function settleUpgrade() {
      const pending = progress.pendingUpgrade;
      if (!pending) return;
      // The merchant job owner's runner settles the production and lucky journals
      // before the job starts.
      if (queued() || placeholder()) throw Error('Commerce production is still settling');
      const outcome = pending.outcome, destroyed = outcome?.destroyed === true;
      const reviewedMissing = outcome?.reviewedMissing === true && outcome.resolution?.outcome === 'unknown';
      const next = { ...progress.activeItem, level: pending.level };
      if (reviewedMissing && me().items.some((item: ItemCopy | null) => sameItemState(item, progress.activeItem) || sameItemState(item, next)))
        throw Error('Reviewed missing production now has a possible survivor; inventory review required');
      const at = Number.isInteger(outcome?.slot) ? outcome.slot : progress.activeSlot;
      const expected = outcome?.item || next;
      const live = destroyed || reviewedMissing ? null :
        sameItem(me().items[at], expected) || sameItem(me().items[at], progress.activeItem) ? me().items[at] : null;
      if (!destroyed && !reviewedMissing && !live) {
        const occupant = me().items[progress.activeSlot];
        throw itemFailure('upgrade_uncertain', 'Upgrade outcome uncertain; ' + purchase.id + ' from +' + Number(progress.activeItem?.level || 0) +
          ' to +' + pending.level + ' at inventory slot ' + progress.activeSlot + '; actual occupant ' +
          (occupant ? occupant.name + ' +' + Number(occupant.level || 0) : 'absent') + '; owned item missing without confirmed destruction');
      }
      if (destroyed || reviewedMissing) {
        progress.activeItem = null;
        await services.activity({ level: 'info', message: reviewedMissing
          ? 'Operator reviewed missing ' + (definition.name || purchase.id) + '; retaining paid spending and remaining allowance'
          : (definition.name || purchase.id) + ' went poof upgrading to +' + pending.level });
      } else {
        progress.activeSlot = at;
        if (live.name === purchase.id && (Number(live.level) || 0) === pending.level) progress.activeItem = fingerprint(live);
        else if (!sameItem(live, progress.activeItem)) throw Error('Upgrade outcome needs review before resuming ' + purchase.id);
      }
      delete progress.pendingUpgrade;
      await save(false);
    }
    async function finishItem() {
      const slot = ownedSlot(), item = me().items[slot];
      if (!item || (Number(item.level) || 0) !== target) return;
      progress.results.push({ slot, item: fingerprint(item), buyIndex });
      progress.completedResults += 1;
      progress.activeItem = null;
      delete progress.activeSlot;
      await save(true);
    }
    await settlePurchase();
    await settleUpgrade();
    await finishItem();
    while (progress.completedResults < purchase.quantity || progress.activeItem || progress.batchItems.length || progress.batchRemaining) {
      if (!progress.activeItem && !progress.batchItems.length && !progress.batchRemaining) {
        await save(true);
        // The estimate's attempts bound the line, and an unavailable estimate's gold cap bounds
        // its base purchases, after a restart too. A line with neither goes on while its budget, or
        // else the bank's gold (`fund`'s `short_gold`), covers the next purchase.
        const limit = purchase.estimateUnavailable
          ? progress.attempts + Math.floor(Math.max(0, purchase.goldCap - progress.spent) / Number(definition.g))
          : Number(purchase.attempts || purchase.maxAttempts) || Infinity;
        let count = Math.min(Math.max(1, Math.floor(Number(command.buyUpgradeBatchSize) || 1)), limit - progress.attempts);
        if (count <= 0) throw Error((purchase.estimateUnavailable ? 'Gold cap' : '90% attempt allowance') + ' exhausted for ' + purchase.id +
          ' after spending ' + progress.spent + ' of ' + purchase.budget + ' gold');
        const basicScroll = 'scroll' + p.grade({ name: purchase.id, level: 0 } as ItemCopy);
        let basicSteps = 0;
        while (basicSteps < target && 'scroll' + p.grade({ name: purchase.id, level: basicSteps } as ItemCopy) === basicScroll) basicSteps += 1;
        // The batch leaves the protected free slots, the lucky slot's hold and a cell for the
        // basic scrolls when none are carried.
        count = Math.min(count, freeSlots(me().items, luckySlot, p.protectedSlots()) - (stock(basicScroll) ? 0 : 1));
        if (count <= 0) throw Error('Merchant inventory has no room for an upgrade batch');
        const batchCost = (n: number) => n * Number(definition.g) + Math.max(0, basicSteps * n - stock(basicScroll)) * Number(G().items[basicScroll].g);
        while (count > 0 && Number.isFinite(Number(purchase.budget)) && progress.spent + batchCost(count) > Number(purchase.budget)) count -= 1;
        if (!count) throw Error(exhausted());
        await services.fund(batchCost(count));
        progress.batchRemaining = count;
        progress.batchScroll = { name: basicScroll, quantity: basicSteps * count };
        await save(false);
      }
      if (progress.batchScroll) {
        const missing = Math.max(0, progress.batchScroll.quantity - stock(progress.batchScroll.name));
        if (missing) await purchaseStock(progress.batchScroll.name, missing, false);
        delete progress.batchScroll;
        await save(false);
      }
      while (progress.batchRemaining > 0) await purchaseStock(purchase.id, 1, true);
      if (!progress.activeItem) {
        const owned = progress.batchItems.shift();
        progress.activeSlot = owned.slot;
        progress.activeItem = owned.item;
        await save(false);
      }
      while (progress.activeItem && (Number(progress.activeItem.level) || 0) < target) {
        const nextLevel = (Number(progress.activeItem.level) || 0) + 1, scroll = 'scroll' + p.grade(progress.activeItem);
        if (!stock(scroll)) await purchaseStock(scroll, 1, false);
        await services.move('newupgrade');
        const slot = ownedSlot();
        if (slot < 0) throw Error('Owned upgrade item missing; order requires inventory review');
        progress.pendingUpgrade = { level: nextLevel };
        await save(false);
        try {
          const receipt = await upgradeConfirmed(slot, p.reads.findInventoryItemByName(scroll), purchase.id, nextLevel);
          if (receipt?.item) progress.pendingUpgrade.outcome = { item: receipt.item, slot: receipt.slot, destroyed: false };
        } catch (error: any) {
          if (error?.reason !== 'upgrade_destroyed' || error.confirmedDestroyed !== true) throw error;
          progress.pendingUpgrade.outcome = { item: null, destroyed: true };
        }
        await settleUpgrade();
        if (!progress.activeItem) { await save(true); break; }
      }
      await finishItem();
    }
    await services.activity({ level: 'success', message: 'Completed ' + progress.completedResults + ' × ' + purchase.id + ' at +' + target +
      ' for ' + progress.spent + ' / ' + Number(purchase.budget || progress.spent) + ' estimated gold' });
    await services.checkpoint({ phase: 'leveling', buyIndex: buyIndex + 1, attempts: 0, spent: 0,
      results: progress.results, activeItem: null, completedResults: 0 }, true);
  }

  // A commerce order: the sources' handoffs, the bank's materials and saved scrolls, the plain buys, each
  // leveled buy line and the crafts. An order stamped with the merchant job owner's
  // COMMERCE_PROGRESS_VERSION keeps a local journal beside the coordinator's checkpoint, and the newer one
  // resumes. Every leveled line is an upgrade line: the catalog offers only upgradeable items at a level,
  // and dispatch stamps every leveled order, so no legacy leveling branch remains.
  async function merchantCommerce(command: any) {
    const activity: any[] = [], order = command.order || {}, buys: any[] = order.buys || [], crafts: any[] = order.crafts || [];
    const journalKey = 'party-commerce:' + (command.commerceOrderId || command.jobId), versioned = command.commerceProgressVersion === COMMERCE_PROGRESS_VERSION;
    let resumeState = command.resumeState || {};
    if (versioned) {
      const local = p.stored(journalKey);
      if (local && Number(local.sequence) > Number(resumeState.sequence || 0)) resumeState = local;
    }
    command._commerceState = resumeState;
    p.commerce(command.id, { commerceCycle: versioned });
    const prepared = resumeState.phase === 'leveling' || resumeState.phase === 'crafting';
    async function commerceMove(destination: unknown) {
      if (versioned && p.job()?.commandId !== command.id) throw itemFailure('interrupted');
      try { await p.move(destination); }
      catch (error: any) { error.commerceMovement = true; throw error; }
      command._commerceMovementSucceeded = true;
    }
    async function checkpoint(state: any, cycleBoundary: boolean) {
      const active = p.job();
      if (versioned && active?.commandId !== command.id) throw itemFailure('interrupted');
      if (versioned && active) {
        if (!state.results) state.results = command._commerceState.results || [];
        state.sequence = Math.max(Number(command._commerceState.sequence) || 0, Number(state.sequence) || 0) + 1;
        command._commerceState = copy(state);
        p.store(journalKey, command._commerceState);
        p.commerce(command.id, { commerceJournalKey: journalKey, commerceSequence: state.sequence });
      }
      const result = await p.request('/merchant/checkpoint', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, state,
        cycleBoundary, movementSucceeded: command._commerceMovementSucceeded === true } });
      command._commerceMovementSucceeded = false;
      if (result?.yield) throw Object.assign(Error('merchant_yield'), { reason: 'merchant_yield', code: 'merchant_yield' });
    }
    async function liveMerchantActivity(entry: any) {
      activity.push(entry);
      try {
        await p.request('/merchant/activity', { method: 'POST', body: { character: me().name, jobId: command.jobId,
          message: entry.message, level: entry.level || 'info', details: entry.details } });
        activity.splice(activity.indexOf(entry), 1);
      } catch { /* the job's completion still carries the buffered entry */ }
    }
    const held = await bag().acquire('purchasing');
    try {
      if (versioned) await checkpoint(resumeState, false);
      for (const source of prepared ? [] : Object.keys(order.sources || {})) {
        await p.rendezvous(command.jobId, source);
        await p.handoff('/merchant/order-handoff', { method: 'POST', body: { jobId: command.jobId, target: source } });
        // The merchant waits while the source still holds the handoff command and reports; its
        // walk to the merchant ends on movement's own ladder.
        let handoffJob: any;
        do {
          await p.sleep(HANDOFF_LOOK_MS);
          handoffJob = await p.request('/merchant/job/' + command.jobId + '?target=' + encodeURIComponent(source), { method: 'GET', body: undefined });
        } while (handoffJob.orderHandoff?.character !== source && handoffJob.handoffPending);
        if (handoffJob.orderHandoff?.character !== source) throw Error('Material handoff ended without delivery from ' + source);
        await lucky().tidy(luckySlot);
      }

      const catalog = p.reads.merchantCatalog(), prices: Record<string, number> = {};
      catalog.buyable.forEach((item: any) => { prices[item.id] = item.cost; });
      catalog.craftable.forEach((item: any) => { prices['craft:' + item.id] = item.cost; });
      const initialScrollNeeds: Record<string, number> = {}, cappedScrollStockNeeds: Record<string, number> = {};
      for (const line of buys) {
        const targetLevel = Number(line.level) || 0;
        if (!G().items[line.id]?.upgrade || !targetLevel) continue;
        // An unavailable estimate reuses carried and banked scrolls without pricing or funding the
        // whole chain: its stock counts the levels up to the upgrade cap per copy.
        const counted = line.estimateUnavailable ? cappedScrollStockNeeds : initialScrollNeeds;
        const levels = line.estimateUnavailable ? Math.min(UPGRADE_LEVEL_MAX, targetLevel) : targetLevel;
        for (let level = 0; level < levels; level += 1) {
          const name = 'scroll' + p.grade({ name: line.id, level } as ItemCopy);
          counted[name] = (counted[name] || 0) + (Number(line.quantity) || 1);
        }
      }
      let requiredGold = buys.reduce((sum: number, line: any, index: number) => {
        if (!line.estimateUnavailable) return sum + (prices[line.id] || 0) * line.quantity;
        if (!Number.isSafeInteger(line.goldCap) || line.goldCap <= 0) throw Error('Unavailable upgrade estimate requires a positive gold cap');
        // A capped line funds only its unspent cap; its purchases keep their own spending checks.
        const spent = resumeState.phase === 'leveling' && Number(resumeState.buyIndex) === index ? Number(resumeState.spent) || 0 : 0;
        return sum + Math.max(0, line.goldCap - spent);
      }, 0) + crafts.reduce((sum: number, line: any) => sum + (prices['craft:' + line.id] || 0) * line.quantity, 0);

      const exactInventoryQuantity = (id: string, level?: number) => me().items.reduce((total: number, item: ItemCopy | null) =>
        total + (item && item.name === id && (item.level || 0) === (level || 0) ? itemQuantity(item) : 0), 0);
      async function retrieveBankQuantity(allocation: any) {
        if (!isVaultPack(allocation.pack)) throw Error('Crafting storage is not ready');
        const found = p.bank.findBankItem(allocation.item, allocation.pack, allocation.slot);
        if (!found) return; // the live requirements pass resolves moved or exhausted allocations
        const available = itemQuantity(me().bank[found.pack][found.slot]);
        const wanted = Math.min(available, Math.max(1, Number(allocation.quantity) || 1));
        const emptySlot = me().items.findIndex((item: ItemCopy | null) => !item);
        if (emptySlot < 0) throw Error('Merchant inventory has no room for crafting material');
        await p.bankRetrieve(found.pack, found.slot, emptySlot);
        if (available <= wanted) return;
        if (p.reads.freeInventorySlots() < 1) throw Error('Merchant needs two free slots to split a bank material stack');
        const beforeSplit = me().items.map((item: ItemCopy | null) => JSON.stringify(fingerprint(item)));
        const splitSlot = () => me().items.findIndex((item: ItemCopy | null, index: number) => index !== emptySlot &&
          beforeSplit[index] !== JSON.stringify(fingerprint(item)) && sameItem(item, allocation.item) && itemQuantity(item) === wanted);
        await p.split(emptySlot, wanted);
        // The split's new cell shows within two measured round trips.
        if (!await settles(p, () => splitSlot() >= 0)) throw Error('Could not split exact crafting quantity for ' + allocation.item.name);
        // The split leaves the excess in the original cell; only the excess goes back to the bank.
        await p.bank.bankStoreFully(emptySlot);
      }
      async function retrieveMissingCraftMaterials(requirements: any[]) {
        for (const need of requirements) {
          let remaining = Math.max(0, need.quantity - exactInventoryQuantity(need.id, need.level));
          while (remaining > 0) {
            // Scroll stacks carry no level; recipes name them at level zero.
            const found = p.bank.findBankItem({ name: need.id, level: need.level || 0 }, undefined, undefined, true);
            if (!found) break;
            const before = exactInventoryQuantity(need.id, need.level);
            await retrieveBankQuantity({ pack: found.pack, slot: found.slot, item: fingerprint(me().bank[found.pack][found.slot]), quantity: remaining });
            const after = exactInventoryQuantity(need.id, need.level);
            if (after <= before) throw Error('Crafting withdrawal made no progress: ' + need.id);
            remaining = Math.max(0, need.quantity - after);
          }
        }
      }

      if (!prepared) {
        await p.bank.merchantVisitBank(command, activity);
        for (const allocation of order.bank || []) {
          const requirement = (order.requirements || []).find((entry: any) => entry.id === allocation.item.name && (entry.level || 0) === (allocation.item.level || 0));
          const remaining = requirement ? Math.max(0, requirement.quantity - exactInventoryQuantity(requirement.id, requirement.level)) : allocation.quantity;
          if (!remaining) continue;
          await retrieveBankQuantity({ ...allocation, quantity: Math.min(allocation.quantity, remaining) });
          activity.push({ level: 'success', message: 'Withdrew ' + (allocation.quantity || 1) + ' × ' +
            (G().items[allocation.item.name]?.name || allocation.item.name) + ' for crafting' });
        }
        // Stock counted at queue time may have banked while other jobs ran: the outstanding
        // quantity reads the current bag.
        await retrieveMissingCraftMaterials(order.requirements || []);
        // Scrolls already carried or banked are reused; whole stacks come out and the extras stay
        // for later jobs. One confirmed withdrawal per stack, counted from the bag after
        // each.
        for (const name of new Set([...Object.keys(initialScrollNeeds), ...Object.keys(cappedScrollStockNeeds)])) {
          const wanted = (initialScrollNeeds[name] || 0) + (cappedScrollStockNeeds[name] || 0);
          while (p.reads.inventoryQuantity(name) < wanted) {
            const found = p.bank.findBankItem({ name, level: 0 });
            if (!found) break;
            await p.bank.bankRetrieveConfirmed(found.pack, found.slot);
          }
          initialScrollNeeds[name] = Math.max(0, (initialScrollNeeds[name] || 0) - p.reads.inventoryQuantity(name));
          requiredGold += initialScrollNeeds[name] * (G().items[name]?.g || 0);
        }
        // The withdrawals above ran after the visit's own errands: the floor's gaps close before
        // the merchant leaves the teller.
        try { await p.bank.sortCurrentBankFloor(activity); }
        catch (error) { activity.push({ level: 'error', message: 'Bank sorting failed after crafting withdrawals', details: message(error) }); }
      }
      const materialBuys: { id: string; quantity: number }[] = [];
      for (const requirement of prepared ? [] : order.requirements || []) {
        const missing = Math.max(0, Number(requirement.quantity) - exactInventoryQuantity(requirement.id, requirement.level));
        if (!missing) continue;
        if ((requirement.level || 0) !== 0 || !p.reads.itemSeller(requirement.id))
          throw Error('Crafting material is unavailable: ' + requirement.id + ' +' + (requirement.level || 0));
        materialBuys.push({ id: requirement.id, quantity: missing });
        requiredGold += missing * (G().items[requirement.id]?.g || 0);
      }
      if (!prepared && me().gold < requiredGold) {
        const shortage = requiredGold - me().gold;
        if ((Number(me().bank?.gold) || 0) < shortage) throw itemFailure('short_gold', 'Insufficient bank gold for order');
        await p.bank.withdrawMerchantCash(shortage, command);
      }
      for (const material of materialBuys) {
        await commerceMove(p.reads.itemSeller(material.id));
        await p.buyConfirmed(material.id, material.quantity);
        activity.push({ level: 'success', message: 'Bought ' + material.quantity + ' × ' + material.id + ' for crafting' });
      }

      async function ensureCommerceGold(amount: number) {
        if (me().gold >= amount) return;
        try { await p.bank.merchantVisitBank(command, activity); }
        catch (error: any) {
          if (error.partyRequest && /movement-plan/.test(error.partyRequest.path || error.message) || /ALClient found no route/.test(error.message || '')) error.commerceMovement = true;
          throw error;
        }
        const shortage = amount - me().gold;
        if ((Number(me().bank?.gold) || 0) < shortage) throw itemFailure('short_gold', 'Insufficient bank gold to finish automated item leveling');
        await p.bank.withdrawMerchantCash(shortage, command);
      }
      const services: CommerceServices = { checkpoint, move: commerceMove, fund: ensureCommerceGold, activity: liveMerchantActivity };
      const firstBuy = resumeState.phase === 'crafting' ? buys.length : resumeState.phase === 'leveling' ? Number(resumeState.buyIndex) || 0 : 0;
      for (let buyIndex = firstBuy; buyIndex < buys.length; buyIndex += 1) {
        const purchase = buys[buyIndex];
        if (purchase.estimateUnavailable) {
          if (!Number.isSafeInteger(purchase.goldCap) || purchase.goldCap <= 0) throw Error('Unavailable upgrade estimate requires a positive gold cap');
          purchase.budget = purchase.goldCap;
        }
        if (Number(purchase.level)) {
          await merchantBuyUpgradeLine(command, purchase, buyIndex, services);
          continue;
        }
        const cost = (G().items[purchase.id]?.g || 0) * purchase.quantity;
        if (Number.isFinite(Number(purchase.budget)) && cost > Number(purchase.budget))
          throw Error((purchase.estimateUnavailable ? 'Gold cap for unavailable estimate exhausted' : '90% estimated budget exhausted') + ' for ' + purchase.id +
            ' (spent 0 of ' + Number(purchase.budget).toLocaleString() + ' gold)');
        await commerceMove(p.reads.itemSeller(purchase.id));
        await p.buyConfirmed(purchase.id, purchase.quantity);
        activity.push({ level: 'success', message: 'Bought ' + purchase.quantity + ' × ' + purchase.id });
        await checkpoint({ phase: 'leveling', buyIndex: buyIndex + 1, attempts: 0, spent: 0 }, true);
      }
      for (let craftIndex = resumeState.phase === 'crafting' ? Number(resumeState.craftIndex) || 0 : 0; craftIndex < crafts.length; craftIndex += 1) {
        const line = crafts[craftIndex], recipe = G().craft[line.id] || {};
        // `recipe.quest` names the NPC that serves the recipe, not a quest flag: Cole serves the
        // Material Collector's recipes.
        const provider = recipe.quest || 'craftsman', npc = p.findNpc(provider);
        if (!npc) throw Error('Could not find required recipe provider: ' + provider);
        const startingCraft = resumeState.phase === 'crafting' && craftIndex === Number(resumeState.craftIndex) ? Number(resumeState.crafted) || 0 : 0;
        const materials = (recipe.items || []).map((material: any[]) => ({ id: material[1], level: material[2] || 0,
          quantity: material[0] * (line.quantity - startingCraft) }));
        if (prepared && materials.some((need: any) => exactInventoryQuantity(need.id, need.level) < need.quantity)) {
          await p.bank.merchantVisitBank(command, activity);
          await retrieveMissingCraftMaterials(materials);
        }
        for (const need of materials)
          if (exactInventoryQuantity(need.id, need.level) < need.quantity) throw Error('Crafting material is unavailable: ' + need.id + ' +' + need.level);
        await checkpoint({ phase: 'crafting', craftIndex, crafted: startingCraft }, true);
        await commerceMove(npc);
        if (recipe.quest) activity.push({ level: 'info', message: 'Visited ' + (G().npcs[provider]?.name || provider) + ' for required recipe ' + line.id });
        for (let count = startingCraft; count < line.quantity; count += 1) {
          await p.craft(line.id);
          await checkpoint({ phase: 'crafting', craftIndex, crafted: count + 1 }, true);
        }
        activity.push({ level: 'success', message: 'Crafted ' + line.quantity + ' × ' + line.id });
      }
      if (versioned) verifyCommerceResults(command._commerceState.results);
      await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, success: true,
        merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [], merchantBanked: command._merchantBankedCompleted || [], activity } });
      if (versioned) p.store(journalKey, null);
    } catch (error: any) {
      if (error?.code === 'merchant_yield') return;
      if (versioned && error.partyRequest?.path === '/movement-plan') error.commerceMovement = true;
      const recoverable = error.reason === 'hunt_movement_owned' || error.commerceMovement || versioned || error.code === 'interrupted' ||
        error.code === 'bankboi_pending' || error.code === 'merchant_anniversary_reserved';
      activity.push({ level: error.code === 'upgrade_uncertain' ? 'error' : recoverable ? 'info' : 'error',
        message: recoverable ? 'Merchant order paused; progress preserved' : 'Merchant order failed', details: message(error) });
      try {
        await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, success: false,
          failureKind: error.reason === 'hunt_movement_owned' ? 'hunt_movement_owned' : error.commerceMovement ? 'commerce_movement' : versioned ? 'commerce_recovery' : undefined,
          error: message(error), code: error?.code, merchantWithdrawalsDelivered: command._merchantWithdrawalsCompleted || [],
          merchantBanked: command._merchantBankedCompleted || [], activity } });
      } catch (report) { reportFailed(report); }
      if (error.reason === 'hunt_movement_owned') return;
      throw error;
    } finally {
      if (held) bag().release('purchasing');
    }
  }

  // The lucky slot. The tracker learns each upgrade roll per account character id, and the lucky
  // service swaps the item into the chosen slot and back under its own journal.
  function bindLuckySlotCharacterId(id: unknown) {
    if (typeof id !== 'string' || !id || id === trackerId) return;
    trackerId = id;
    tracker = null;
  }
  function tracking() {
    if (!tracker) {
      const key = trackerId && 'party-lucky-slot-tracking:' + me().owner + ':' + trackerId;
      tracker = createLuckySlotTracker({
        read: () => key ? p.stored(key) : null,
        write: value => { if (key) p.store(key, value); },
        now: p.now, size: () => me().items.length,
        isUpgradeScroll: name => G().items[name]?.type === 'uscroll',
      });
    }
    return tracker;
  }
  function luckySlotRollListener(event: any) {
    if (!p.current()) return;
    if (event?.q?.upgrade) p.save(PREVIEW_REVISION, p.now());
    tracking().observe(event);
  }
  function lucky() {
    if (luckyService) return luckyService;
    // caracAL can echo an older stored value after a newer write: the journal loads once and this
    // runtime owns its later writes.
    let journal = p.saved(LUCKY_JOURNAL);
    luckyService = createLuckyUpgrade({
      item: slot => fingerprint(me().items[slot]),
      busy: () => queued() || placeholder(),
      swap: (a, b) => p.swap(a, b),
      read: () => copy(journal),
      write: value => { journal = copy(value); p.save(LUCKY_JOURNAL, value || null); },
      checkpoint: async value => {
        const production = readJournal();
        if (!production) return;
        // A delayed layout checkpoint never attaches another attempt's item.
        if (value.from !== production.slots[0] || !sameItemState(value.item, production.item))
          throw Error('Lucky checkpoint does not belong to the active production attempt');
        production.lucky = value;
        await saveJournal(production);
      },
      settles: check => queueSettles(['upgrade', 'compound'], check), size: () => me().items.length, current: p.current,
      warn: (reason, layout) => {
        const text = 'Lucky slot restoration skipped; leaving items in their current positions';
        p.log(text + ': ' + reason, '#facc15');
        p.request('/merchant/activity', { method: 'POST', body: { character: me().name, jobId: p.job()?.jobId,
          message: text, level: 'info', details: { reason, layout } } }).catch(activityFailed);
      },
      log: slot => {
        const text = 'Using upgrade slot ' + slot + ' (' + (slot === luckySlot ? 'verified' : 'lucky-slot search') + ', inventory position ' + (slot + 1) + ')';
        p.log(text, '#facc15');
        const job = p.job();
        if (job) p.request('/merchant/activity', { method: 'POST', body: { character: me().name, jobId: job.jobId,
          message: text, level: 'info', details: { executor: me().name, luckySlot: slot, actualUpgradeSlot: slot } } }).catch(activityFailed);
      },
    });
    return luckyService;
  }
  // A lucky upgrade left half done finishes before other inventory work: the service's pending one,
  // else the merchant's saved one. A production attempt settles it inside the operation that holds
  // the bag.
  const luckyLeft = () => !!luckyService?.pending() || me().ctype === 'merchant' && !!p.saved(LUCKY_JOURNAL);
  async function settleLucky() {
    if (luckyLeft()) await lucky().recover();
  }
  // Outside production it settles under the bag holder's `producing` take, so it waits for a
  // tidy, a merge or a bank visit that holds the bag.
  async function recoverLucky() {
    if (!luckyLeft()) return;
    const own = await bag().acquire('producing');
    try { await lucky().recover(); } finally { if (own) bag().release('producing'); }
  }
  // Table A's `tidy` row: a merchant with no command in the reply tidies unless an event reserves it,
  // its stand return runs, the runner holds it, it is dead or its bag waits on the game. A held
  // merchant tidies inside its own work, as the previous release's reply skipped the tidy while a job,
  // gathering or the idle stand ran.
  function tidyReply(state: { command?: unknown }): void {
    if (me().ctype === 'merchant' && !state.command && !p.eventReserved() && !p.standReturning() && !p.runnerRecord() &&
        !me().rip && !p.bank.bagStill())
      tidy(luckySlot).catch(error => p.log(String((error as Error)?.message || error), 'red'));
  }
  // The merchant's tidy (3.4), the bag holder's `tidying` operation; a tidy already running answers
  // at once.
  async function tidy(slot: unknown) {
    if (!await bag().acquire('tidying')) return;
    try { await lucky().tidy(slot); } finally { bag().release('tidying'); }
  }

  // A character's marked upgrades and compounds at the upgrade NPC, under the bag holder.
  async function upgradeMarked(marks: any[], compoundGroups: any[], purchases: any[], returnLocation: unknown) {
    const held = bag().facts();
    if (held.upgrading || held.banking || !await bag().acquire('upgrading')) return;
    const origin = { map: me().map, x: me().x, y: me().y };
    const completed: any[] = [], purchased: any[] = [], compounded: unknown[] = [];
    const r = p.reads;
    // A group's three copies: the named cell first, then the first unused match.
    const groupSlots = (group: any) => {
      const used: Record<number, boolean> = {};
      return group.items.map((mark: any) => {
        const slot = Number.isInteger(mark.slot) && !used[mark.slot] && sameItem(me().items[mark.slot], mark.item)
          ? mark.slot : me().items.findIndex((item: ItemCopy | null, index: number) => !used[index] && sameItem(item, mark.item));
        if (slot >= 0) used[slot] = true;
        return slot;
      });
    };
    try {
      const work: { mark: any; tiers: number }[] = [];
      for (const mark of marks) {
        if (mark.equipped && typeof mark.slot === 'string' && sameItem(me().slots[mark.slot], mark.item)) await p.unequip(mark.slot);
        const slot = await r.waitForMarkedItem(mark);
        const definition = slot >= 0 && G().items[me().items[slot].name];
        if (slot < 0 || !definition?.upgrade) { completed.push(mark); continue; }
        const remaining = r.maximumItemLevel(definition) - (me().items[slot].level || 0);
        if (remaining <= 0) { completed.push(mark); continue; }
        work.push({ mark, tiers: Math.max(1, Math.min(Number(mark.tiers) || 1, remaining)) });
      }
      const required: Record<string, number> = {};
      for (const entry of work) {
        const item = me().items[r.findMarkedItem(entry.mark)];
        for (let tier = 0; tier < entry.tiers; tier += 1) {
          const scroll = 'scroll' + p.grade({ name: item.name, level: (item.level || 0) + tier });
          required[scroll] = (required[scroll] || 0) + 1;
        }
      }
      const compoundWork: { group: any; scroll: string }[] = [];
      for (const group of compoundGroups || []) {
        if (!Array.isArray(group?.items) || group.items.length !== COMPOUND_INPUTS) continue;
        const slots = groupSlots(group);
        if (slots.some((slot: number) => slot < 0)) continue;
        const items = slots.map((slot: number) => me().items[slot]);
        const definition = G().items[items[0].name];
        if (!definition?.compound || items.some((item: ItemCopy) => item.name !== items[0].name || (item.level || 0) !== (items[0].level || 0))) continue;
        const scroll = 'cscroll' + p.grade(items[0]);
        required[scroll] = (required[scroll] || 0) + 1;
        compoundWork.push({ group, scroll });
      }
      for (const scroll of Object.keys(required)) {
        const owned = Math.min(required[scroll], r.inventoryQuantity(scroll));
        if (owned) p.log('Using ' + owned + ' existing ' + G().items[scroll].name + ' from inventory slot ' + r.findInventoryItemByName(scroll), '#51D2E1');
      }
      let goldNeeded = Object.keys(required).reduce((total, scroll) =>
        total + Math.max(0, required[scroll] - r.inventoryQuantity(scroll)) * G().items[scroll].g, 0);
      for (const purchase of purchases || []) if (G().items[purchase.name] && r.itemSeller(purchase.name)) goldNeeded += G().items[purchase.name].g;
      if (me().gold < goldNeeded) {
        await p.move('bank');
        const shortfall = goldNeeded - me().gold;
        if (!me().bank || me().bank.gold < shortfall) throw itemFailure('short_gold', 'not enough gold in character and bank for upgrade scrolls');
        await p.bank.withdrawMerchantCash(shortfall);
      }
      for (const purchase of purchases || []) {
        const seller = purchase && r.itemSeller(purchase.name);
        if (!seller || !G().items[purchase.name]) {
          p.log('Cannot buy another ' + (purchase?.name || 'item') + ': no merchant found', 'red');
          purchased.push(purchase);
          continue;
        }
        await p.move(p.findNpc(seller));
        await p.buy(purchase.name, 1);
        purchased.push(purchase);
      }
      if (goldNeeded) {
        await p.move(p.findNpc('scrolls'));
        for (const scroll of Object.keys(required)) {
          const missing = Math.max(0, required[scroll] - r.inventoryQuantity(scroll));
          if (missing) await p.buy(scroll, missing);
        }
      }
      await p.move(p.findNpc('newupgrade'));
      for (const entry of work) {
        const itemSlot = r.findMarkedItem(entry.mark);
        for (let step = 0; step < entry.tiers; step += 1) {
          if (itemSlot < 0 || me().items[itemSlot]?.name !== entry.mark.item.name) break;
          const scrollSlot = r.findInventoryItemByName('scroll' + p.grade(me().items[itemSlot]));
          if (scrollSlot < 0) break;
          try {
            const preview = await p.upgrade(itemSlot, scrollSlot, null, true);
            p.log(G().items[me().items[itemSlot].name].name + ' upgrade chance: ' + (preview.chance * 100).toFixed(2) + '%', '#51D2E1');
            await upgradeConfirmed(itemSlot, scrollSlot);
          } catch (error: any) {
            // A lucky slot failure ends the run, as the previous release's lucky_slot_unavailable did
            // (shared.js:3951).
            if (luckyFailures.has(error)) throw error;
            p.log('Upgrade failed: ' + message(error), 'red');
            break;
          }
        }
        completed.push(entry.mark);
      }
      for (const entry of compoundWork) {
        const itemSlots = groupSlots(entry.group);
        const scrollSlot = r.findInventoryItemByName(entry.scroll);
        if (itemSlots.some((slot: number) => slot < 0) || scrollSlot < 0) continue;
        try {
          const preview = await p.compound(itemSlots[0], itemSlots[1], itemSlots[2], scrollSlot, null, true);
          p.log(G().items[me().items[itemSlots[0]].name].name + ' compound chance: ' + (preview.chance * 100).toFixed(2) + '%', '#51D2E1');
          await compoundConfirmed(itemSlots[0], itemSlots[1], itemSlots[2], scrollSlot);
          compounded.push(entry.group.id);
        } catch (error) {
          p.log('Compound failed: ' + message(error), 'red');
        }
      }
    } catch (error) {
      p.log('Upgrade run failed: ' + message(error), 'red');
    } finally {
      try { await p.move(returnLocation || p.partyLocation() || origin); }
      catch (error) { p.log('Return from upgrades failed: ' + message(error), 'red'); }
      bag().release('upgrading');
      try {
        await p.request('/bank-complete', { method: 'POST', body: { character: me().name, upgraded: completed, purchased, compounded } });
      } catch (error: any) {
        p.log('Upgrade queue release failed: ' + (error?.message || error), 'red');
      }
    }
  }

  // The upgrade preview. Missing scrolls and offerings are borrowed from the bank under a journal
  // and returned after; the preview holds the bag until the game's chance replies settle. Movement's
  // walk ends at once where the character already stands, so only another map asks it.
  async function previewTravel(destination: string) {
    if (me().map !== destination) await p.move(destination);
  }
  async function restoreUpgradePreviewSupplies() {
    const borrowed: any[] = p.saved(PREVIEW_SUPPLIES) || [];
    while (borrowed.length) {
      const entry = borrowed[0];
      await previewTravel(entry.map);
      await p.bank.waitForBankPack(entry.pack);
      const slots = me().items.map((item: ItemCopy | null, slot: number) => JSON.stringify(item) === JSON.stringify(entry.item) ? slot : -1).filter((slot: number) => slot >= 0);
      const stored = me().bank?.[entry.pack]?.[entry.slot];
      if (!slots.length && JSON.stringify(stored) === JSON.stringify(entry.item)) { borrowed.shift(); p.save(PREVIEW_SUPPLIES, borrowed); continue; }
      if (slots.length !== 1) throw Error('Preview supply recovery needs inventory review: ' + entry.item.name);
      if (stored) {
        const empty = me().bank[entry.pack].findIndex((item: ItemCopy | null) => !item);
        if (empty < 0) throw Error('No room to return preview supplies to ' + entry.pack);
        entry.slot = empty;
        p.save(PREVIEW_SUPPLIES, borrowed);
      }
      await p.bank.bankStageConfirmed(slots[0], entry.pack, entry.slot);
      borrowed.shift();
      p.save(PREVIEW_SUPPLIES, borrowed);
    }
    p.save(PREVIEW_SUPPLIES, null);
  }
  async function borrowUpgradePreviewSupplies(previewRequest: any) {
    const names = ['scroll' + p.grade(previewRequest.item), 'offeringp', 'offering', 'offeringx'];
    const missing = names.filter(name => !me().items.some((item: ItemCopy | null) => item?.name === name));
    if (!missing.length) return;
    await previewTravel('bank');
    await p.bank.waitForBankPack('items0');
    const definitions: Record<string, any> = p.bankPacks();
    for (const name of missing) {
      const found = p.bank.findBankItem({ name });
      if (!found) continue;
      if (p.reads.freeInventorySlots() < 1) throw Error('No inventory space for preview supplies');
      const map = definitions[found.pack]?.[0] || 'bank';
      await previewTravel(map);
      await p.bank.waitForBankPack(found.pack);
      const item = me().bank?.[found.pack]?.[found.slot];
      if (!item || item.name !== name || item.l) continue;
      const borrowed = p.saved(PREVIEW_SUPPLIES) || [];
      borrowed.push({ pack: found.pack, slot: found.slot, map, item: copy(item) });
      p.save(PREVIEW_SUPPLIES, borrowed);
      await p.bank.bankRetrieveConfirmed(found.pack, found.slot);
    }
  }
  // The roll a preview answers for: the last upgrade queue this character saw.
  const previewRevision = () => String(p.saved(PREVIEW_REVISION) || '0');
  // The preview runs while its command is current; each option is the game's own chance reply.
  async function merchantUpgradePreview(command: any) {
    const previewRequest = { ...command.upgradePreview, id: command.jobId, executor: me().name, session: previewSession };
    let result: any;
    try {
      // The job settled old production journals before entry.
      if (me().rip || me().q && Object.keys(me().q).length || p.upgradeSettling())
        throw Error('Upgrade operation still settling; refresh again');
      if (!sameItem(me().items[previewRequest.slot], previewRequest.item)) throw Error('Item changed; reopen the menu');
      await borrowUpgradePreviewSupplies(previewRequest);
      await previewTravel('newupgrade');
      if (!await bag().acquire('previewing')) throw Error('Upgrade preview already running');
      // The bag stays held until the game's shared upgrade promise settles, so a real upgrade never
      // receives a late preview.
      result = await previewUpgrade(previewRequest, {
        items: () => me().items, grade: item => p.grade(item),
        current: () => p.current() && p.job()?.commandId === command.id,
        preview: (slot, scroll, offering, calculate) => p.upgrade(slot, scroll, offering, calculate),
        now: () => p.now() + p.clockOffset(), searched: 'merchant inventory or accessible bank',
      }).finally(() => bag().release('previewing'));
    } catch (error) {
      result = { executor: me().name, item: previewRequest.item, options: {} };
      for (const option of ['none', 'offeringp', 'offering', 'offeringx']) result.options[option] = { reason: message(error) };
    }
    await restoreUpgradePreviewSupplies();
    await p.request('/upgrade-preview/result', { method: 'POST', body: { character: me().name, id: command.jobId,
      commandId: command.id, session: previewSession, revision: previewRevision(), result } });
    await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, commandId: command.id, success: true,
      activity: [{ level: 'info', message: 'Upgrade chances refreshed for ' + previewRequest.item.name }] } });
  }

  // The lifecycle owner's intake asks this before a command (table I `prepare`): the merchant's bag
  // settles first. A stand return travels before the inventory recovery, whose own guard runs before any
  // listing, consolidation or tidy. The production journal and a half-done lucky swap settle under the
  // bag holder's take (`recover`) before the command; a stand return settles only the journal. Home
  // visits do not change the bag, so a visitor with no journal of its own skips it: an offline secondary
  // merchant cannot read the designated merchant's receipts.
  async function prepareCommand(command: { type?: string; inPlace?: boolean; luckyUpgradeSlot?: number }): Promise<boolean> {
    const merchant = p.character().ctype === 'merchant', returningToStand = command.type === 'merchant-idle' && !command.inPlace;
    if (!returningToStand && merchant) await p.bag.after('tidying');
    const pending = !returningToStand && merchant && !!luckyService?.pending();
    if (pending && p.runnerHolds()) { p.reportCommand(command, 'deferred', 'lucky slot inventory operation'); return false; }
    const preflight = pending || command.type !== 'bankboi-service' && (command.type !== 'realm-set-home' || readJournal());
    if (merchant && preflight && !p.runnerHolds()) {
      try { await recover(!returningToStand); }
      catch (error) { p.reportCommand(command, 'deferred', (error as Error).message || String(error)); return false; }
    }
    if (command.luckyUpgradeSlot !== undefined) luckySlot = command.luckyUpgradeSlot;
    return true;
  }
  // The `merchant-production-recover` command: the journal's recovery spends the command once it settles.
  async function recoverCommand(command: unknown, accept: () => void): Promise<void> {
    if (p.runnerHolds()) return;
    try { await recover(); }
    catch (error) { p.reportCommand(command, 'deferred', (error as Error).message || String(error)); return; }
    accept();
    p.reportCommand(command, 'accepted');
  }

  // The lucky slot's roll record hears each `q_data` on the items owner's `observe`
  // handle.
  function listen(socket: unknown): void {
    const observe10 = scope('10', 'observe');
    observe10.on(socket as Parameters<typeof observe10.on>[0], 'q_data', luckySlotRollListener);
  }
  return {
    // upgradeConfirmed and compoundConfirmed are the confirmed calls the item-operations test runs.
    listen, verifyMerchantItemMarks, recover, verifyProductionProtection, compoundConfirmed, upgradeConfirmed, massBuff,
    tracking, lucky, recoverLucky, tidy, tidyReply, upgradeMarked,
    restoreUpgradePreviewSupplies, merchantUpgradePreview, previewSession, previewRevision,
    upgradeOfferingCheckpoint, availableOfferingEntries, merchantImprove,
    prepareManualImprovementScrolls, refreshCompoundProtection, compoundAvailableStock,
    statusQuantity, preloadStatScrolls, deliverStatScrolls, applyOwnedStatScrolls,
    merchantSelfImprove, merchantCommerce, prepareCommand, recoverCommand,
    // The lucky slot the coordinator verified, the pending lucky swap and the upgrade in flight.
    luckySlot: () => luckySlot, setLuckySlot(slot: number | null) { luckySlot = slot; },
    /** Table A's `lucky-settings` row: this character's lucky slot (a lock, else the slot a resume
     *  holds, else the coordinator's pick), its tracker's character id and the tracker's saved state. */
    luckyReply(state: Record<string, any>): void {
      const name = me().name;
      luckySlot = luckySlotOf(state, name);
      bindLuckySlotCharacterId(state.luckySlotCharacterIds && state.luckySlotCharacterIds[name]);
      tracking().sync(state.luckySlotTracking && state.luckySlotTracking[name]);
    },
    luckyPending: () => !!luckyService?.pending(), activeUpgrade: () => activeUpgrade,
    // A lucky swap is held while the service has one pending, or before it loads, while one is saved.
    luckyHeld: () => luckyService ? luckyService.pending() : !!p.saved(LUCKY_JOURNAL),
    trackingId: () => trackerId, previewSaved: () => !!p.saved(PREVIEW_SUPPLIES),
    recovering: () => !!recovering, recoverOnReply,
  };
}

// The lucky slot service (from runtime/characters/lucky-upgrade.ts). It swaps the item into the
// lucky slot and back under its own journal. The bag confirms each swap within the settle window,
// which waits out the game's upgrade or compound queue time while one is open; a layout compares
// copies by identity.ts's fingerprint.
type LuckyItem = ItemCopy;
interface LuckyJournal { from: number; to: number; item: LuckyItem; displaced: LuckyItem | null; scrollDisplaced?: boolean; offeringDisplaced?: boolean;
  phase: 'preparing' | 'running' | 'restoring'; result?: LuckyItem | null }
export interface LuckyPorts {
  item(slot: number): LuckyItem | null;
  busy(): boolean;
  swap(a: number, b: number): Promise<unknown>;
  read(): LuckyJournal | null;
  write(value: LuckyJournal | null): void;
  checkpoint?(value: LuckyJournal): Promise<void>;
  // True once `check` holds, false when the bag never showed it.
  settles(check: () => boolean): Promise<boolean>;
  // The bag's cell count; its last cell keeps the Tracktrix pin.
  size(): number;
  current(): boolean;
  log(slot: number): void;
  warn?(reason: string, journal: LuckyJournal): void;
}
const luckyCopy = (item: LuckyItem | null): LuckyItem | null => item && JSON.parse(JSON.stringify(item));
const sameLayout = (a: LuckyItem | null, b: LuckyItem | null) => JSON.stringify(fingerprint(a)) === JSON.stringify(fingerprint(b));
const luckyLevel = (item: LuckyItem) => Number(item.level || 0);
const describe = (error: unknown): string => error instanceof Error ? error.message : JSON.stringify(error);
function reconcileScroll(j: LuckyJournal, current: LuckyItem | null): void {
  if (!(j.scrollDisplaced || j.offeringDisplaced) || j.phase !== 'running') return;
  const consumed = luckyCopy(j.displaced), quantity = Number(j.displaced?.q || 1);
  if (consumed && quantity > 1) consumed.q = quantity - 1;
  if (sameLayout(current, quantity > 1 ? consumed : null)) j.displaced = luckyCopy(current);
}
// Potion use and an incoming stack transfer change a stack's count while production runs: the
// stack keeps its identity (copyKey), and the return never recreates consumed units.
function sameStack(previous: LuckyItem | null, current: LuckyItem | null): boolean {
  if (!previous || !current || previous.q === undefined && current.q === undefined) return false;
  const counts = [Number(previous.q ?? 1), Number(current.q ?? 1)];
  return counts.every(quantity => Number.isSafeInteger(quantity) && quantity > 0) && copyKey(previous) === copyKey(current);
}
function reconcileStack(j: LuckyJournal, current: LuckyItem | null): void {
  if (sameStack(j.displaced, current)) j.displaced = luckyCopy(current);
}
// A nonempty result back in its source cell is a confirmed return, even when loot or a transfer
// has since filled an originally empty lucky slot.
function returnedResult(j: LuckyJournal, from: LuckyItem | null, to: LuckyItem | null): boolean {
  if (j.phase !== 'restoring' || !sameLayout(from, j.result ?? null)) return false;
  return j.displaced === null && !!j.result || sameStack(j.displaced, to);
}
function originalLayout(j: LuckyJournal, from: LuckyItem | null, to: LuckyItem | null): boolean {
  if (returnedResult(j, from, to)) return true;
  // Preparation has issued no upgrade: a delivery into an empty destination leaves the source valid.
  if (j.phase === 'preparing' && sameLayout(from, j.item))
    return j.displaced === null || sameLayout(to, j.displaced) || sameStack(j.displaced, to);
  if (!sameLayout(to, j.displaced)) return false;
  return j.phase === 'restoring' && sameLayout(from, j.result ?? null);
}
function validResult(j: LuckyJournal, result: LuckyItem | null): boolean {
  return !result || result.name === j.item.name && [luckyLevel(j.item), luckyLevel(j.item) + 1].includes(luckyLevel(result));
}
// A lucky slot failure carries its failure code beside the text the activity shows. luckyFailures
// holds each one it throws, so a caller that stops on any lucky failure knows it by identity.
const luckyFailures = new WeakSet<object>();
function luckyFailure(code: ItemFailure, reason: string): Error & { reason: string; code: ItemFailure } {
  const failure = itemFailure(code, "Couldn't use lucky slot: " + reason);
  luckyFailures.add(failure);
  return failure;
}
export function createLuckyUpgrade(ports: LuckyPorts) {
  let active = false;
  const cells = () => Array.from({ length: ports.size() }, (_, i) => i);
  const validSlot = (slot: unknown) => Number.isInteger(slot) && Number(slot) >= 0 && Number(slot) < ports.size();
  async function save(journal: LuckyJournal): Promise<void> {
    ports.write(journal);
    await ports.checkpoint?.(journal);
  }
  async function wait(check: () => boolean, reason: string): Promise<void> {
    if (!ports.current()) throw luckyFailure('lucky_interrupted', 'runtime interrupted');
    const confirmed = await ports.settles(() => !ports.current() || check());
    if (!ports.current() || !confirmed) throw luckyFailure('lucky_swap_unconfirmed', reason);
  }
  // The bag's change, not the call's reply, admits the next step.
  async function swapConfirmed(a: number, b: number, check: () => boolean): Promise<void> {
    let rejected: unknown;
    try { void Promise.resolve(ports.swap(a, b)).catch(error => { rejected = error; }); }
    catch (error) { throw luckyFailure('lucky_swap_unconfirmed', describe(error)); }
    await wait(() => {
      if (rejected) throw luckyFailure('lucky_swap_unconfirmed', 'swap rejected: ' + describe(rejected));
      return check();
    }, 'swap was not confirmed');
  }
  async function restore(j: LuckyJournal): Promise<void> {
    await wait(() => !ports.busy(), 'upgrade still pending; inventory recovery required');
    if (originalLayout(j, ports.item(j.from), ports.item(j.to))) {
      ports.write(null); return;
    }
    reconcileScroll(j, ports.item(j.from));
    reconcileStack(j, ports.item(j.from));
    // A send or loot can fill the source cell while the upgrade runs: that item becomes the
    // displaced contents before the return swap, so both stay accounted for across a restart.
    if (j.displaced === null && ports.item(j.from) && arrivalResult(j, ports.item(j.to))) {
      j.displaced = luckyCopy(ports.item(j.from)); await save(j);
    }
    if (!sameLayout(ports.item(j.from), j.displaced)) throw inventoryFailure(j);
    const result = ports.item(j.to);
    if (!validResult(j, result) || j.phase === 'restoring' && !sameLayout(result, j.result ?? null))
      throw luckyFailure('lucky_source_changed', 'upgrade slot changed; inventory recovery required');
    j.result = luckyCopy(result); j.phase = 'restoring'; await save(j);
    // The checkpoint's transport yields to deliveries and manual moves: a layout that changed
    // meanwhile is never swapped.
    if (!sameLayout(ports.item(j.from), j.displaced) || !sameLayout(ports.item(j.to), j.result ?? null))
      throw luckyFailure('lucky_source_changed', 'inventory changed while saving restoration; leaving current positions unchanged');
    await swapConfirmed(j.from, j.to, () => originalLayout(j, ports.item(j.from), ports.item(j.to)));
    ports.write(null);
  }
  function inventoryFailure(j: LuckyJournal): Error {
    return luckyFailure('lucky_source_changed', 'displaced item changed; inventory recovery required ' + JSON.stringify({
      phase: j.phase, from: j.from, to: j.to, expected: j.displaced, actual: ports.item(j.from), upgrade: ports.item(j.to),
    }));
  }
  // Layout bookkeeping only: the production receipt answers for the roll, and the bag stays as it is.
  function abandonRestoration(journal: LuckyJournal, reason: string): void {
    ports.write(null);
    try { ports.warn?.(reason, journal); } catch { /* the warning holds no inventory */ }
  }
  async function restoreBestEffort(journal: LuckyJournal, recovering = false): Promise<void> {
    try { await restore(journal); }
    catch (error) {
      // Preparation and unsettled operations still own their inventory, and a retired runtime
      // leaves its successor's bookkeeping alone.
      if (journal.phase === 'preparing' && !recovering || !ports.current() || ports.busy()
        || !(error instanceof Error) || failureClass((error as { code?: unknown }).code) === null) throw error;
      abandonRestoration(journal, describe(error));
    }
  }
  function arrivalResult(j: LuckyJournal, item: LuckyItem | null): boolean {
    if (j.phase === 'preparing') return sameLayout(item, j.item);
    if (j.phase === 'restoring') return sameLayout(item, j.result ?? null);
    return validResult(j, item);
  }
  async function refreshPreparation(j: LuckyJournal): Promise<void> {
    if (!sameLayout(ports.item(j.from), j.item)) throw luckyFailure('lucky_source_changed', 'source item changed during preparation');
    const current = ports.item(j.to);
    if (sameLayout(current, j.displaced)) return;
    if (j.displaced !== null && !sameStack(j.displaced, current)) throw inventoryFailure(j);
    j.displaced = luckyCopy(current);
    await save(j);
  }
  function preparedSwap(j: LuckyJournal): boolean {
    if (!sameLayout(ports.item(j.to), j.item)) return false;
    const from = ports.item(j.from);
    return sameLayout(from, j.displaced) || sameStack(j.displaced, from) || j.displaced === null;
  }
  async function recover(): Promise<void> {
    if (active) throw luckyFailure('lucky_busy', 'another upgrade owns the inventory');
    await wait(() => !ports.busy(), 'upgrade still pending; inventory recovery required');
    const journal = ports.read();
    if (journal) await restoreBestEffort(journal, true);
  }
  // Only the caller's answer that no production receipt is pending admits this: a settled journal
  // whose return layout later moved no longer blocks production.
  function retireSettled(): boolean {
    if (active || ports.busy() || !ports.current()) return false;
    const journal = ports.read();
    if (!journal) return false;
    const destination = ports.item(journal.to);
    if (!sameLayout(destination, journal.displaced) && !sameStack(journal.displaced, destination)) {
      abandonRestoration(journal, 'Settled production no longer has its original return layout; leaving native inventory unchanged');
      return true;
    }
    ports.write(null);
    return true;
  }
  function runInput(from: number, scroll: number, lucky: unknown, offering?: number) {
    if (active) throw luckyFailure('lucky_busy', 'another upgrade owns the inventory');
    const to = validSlot(lucky) ? Number(lucky) : from;
    const item = luckyCopy(ports.item(from)), scrollItem = luckyCopy(ports.item(scroll));
    if (!item || !scrollItem || from === scroll) throw luckyFailure('lucky_unavailable', 'item or scroll unavailable');
    return { to, item, scrollItem, offeringItem: offeringInput(from, scroll, offering) };
  }
  function offeringInput(from: number, scroll: number, offering?: number) {
    if (offering === undefined) return null;
    const item = luckyCopy(ports.item(offering));
    if (!item || offering === from || offering === scroll) throw luckyFailure('lucky_source_changed', 'offering unavailable');
    return item;
  }
  async function run<T>(from: number, scroll: number, lucky: unknown, action: (slot: number, scroll: number, offering?: number) => Promise<T>, offering?: number): Promise<T> {
    await recover();
    const { to, item, scrollItem, offeringItem } = runInput(from, scroll, lucky, offering);
    active = true;
    try {
      if (from === to) { if (validSlot(lucky)) ports.log(to); return await action(from, scroll, offering); }
      const journal: LuckyJournal = { from, to, item, displaced: luckyCopy(ports.item(to)), scrollDisplaced: scroll === to, offeringDisplaced: offering === to, phase: 'preparing' };
      await save(journal);
      await refreshPreparation(journal);
      await swapConfirmed(from, to, () => preparedSwap(journal));
      // A delivery can race the swap after the checkpoint: the displaced contents are read again
      // before the game operation.
      journal.displaced = luckyCopy(ports.item(from));
      const nextScroll = scroll === to ? from : scroll;
      const nextOffering = offering === to ? from : offering;
      if (nextOffering !== undefined && !sameLayout(ports.item(nextOffering), offeringItem)) throw luckyFailure('lucky_scroll_changed', 'offering changed during preparation');
      if (!sameLayout(ports.item(nextScroll), scrollItem)) throw luckyFailure('lucky_scroll_changed', 'scroll changed during preparation');
      // The operation consumes a scroll displaced from the lucky slot.
      journal.phase = 'running'; await save(journal); ports.log(to);
      try { return await action(to, nextScroll, nextOffering); }
      finally { await restoreBestEffort(journal); }
    } finally { active = false; }
  }
  // The tidy packs the bag toward its first cells and keeps the lucky slot empty; a Tracktrix or
  // supercomputer in the last cell stays pinned there.
  async function tidy(lucky: unknown): Promise<void> {
    await recover();
    if (active || !validSlot(lucky)) return;
    const pin = ports.size() - 1, tracker = ports.item(pin);
    const pinned = TRACKER_ITEMS.includes(String(tracker?.name));
    const targets = cells().filter(i => i !== lucky && !(pinned && i === pin));
    const ordered = cells().map(i => pinned && i === pin ? null : luckyCopy(ports.item(i))).filter((item): item is LuckyItem => !!item);
    if (ordered.length > targets.length) throw luckyFailure('inventory_full', 'no room to keep lucky slot empty');
    active = true;
    try {
      for (let index = 0; index < ordered.length; index++) {
        const target = targets[index]!, wanted = ordered[index]!;
        if (sameLayout(ports.item(target), wanted)) continue;
        const from = cells().find(i => (i >= target || i === lucky) && sameLayout(ports.item(i), wanted));
        if (from === undefined) throw luckyFailure('lucky_busy', 'inventory changed while tidying');
        await emptyTarget(target, lucky);
        await swapConfirmed(from, target, () => sameLayout(ports.item(target), wanted) && !ports.item(from));
      }
    } finally { active = false; }
  }
  // The game's move merges compatible stacks, so a packing move goes through an empty cell and
  // never swaps two occupied cells.
  async function emptyTarget(target: number, lucky: unknown): Promise<void> {
    const displaced = luckyCopy(ports.item(target));
    if (!displaced) return;
    const empty = cells().find(i => i !== lucky && !ports.item(i));
    if (empty === undefined) throw luckyFailure('inventory_full', 'no spare slot for inventory tidying');
    await swapConfirmed(target, empty, () => !ports.item(target) && sameLayout(ports.item(empty), displaced));
  }
  return { run, recover, retireSettled, tidy, pending: () => active || !!ports.read() };
}

// The lucky slot tracker (from runtime/characters/lucky-slot-tracker.ts). It learns each upgrade
// roll per bag cell from the game's `q_data` packets; the server reveals the roll's four decimal
// digits one by one and can repeat the finished roll with its outcome.
interface TrackerPorts { read(): unknown; write(value: unknown): void; now(): number; isUpgradeScroll(name: string): boolean; size(): number }
type RollPacket = Pick<ServerToClient_q_data, 'num' | 'q'> & {
  p: Omit<ServerToClient_q_data['p'], 'nums'> & { nums: (number | string)[] };
};
interface Receipt { slot: number; roll: number; remaining: number; at: number }
function rollPacket(raw: unknown, size: number): RollPacket | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as RollPacket, queue = value.q?.upgrade;
  const queued = !!queue && !value.q.compound && Number(queue.num) === value.num && Number.isFinite(queue.ms) && Number.isFinite(queue.len);
  if (!Number.isInteger(value.num) || value.num < 0 || value.num >= size || !queued || !Array.isArray(value.p?.nums)) return null;
  return value;
}
const repeatedRoll = (last: Receipt | null, next: Receipt): boolean =>
  !!last && last.slot === next.slot && last.roll === next.roll && next.remaining <= last.remaining;
export function createLuckySlotTracker(ports: TrackerPorts) {
  let stored: unknown;
  try { stored = ports.read(); } catch { /* a storage failure never blocks an upgrade */ }
  const state = normalizeSlotTracking(stored);
  state.streamId ??= ports.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let streams: LuckySlotStreams = {};
  let last: Receipt | null = null;
  if (stored && typeof stored === 'object' && 'last' in stored) {
    const saved = stored.last as Receipt | null;
    if (saved && [saved.slot, saved.roll, saved.remaining, saved.at].every(Number.isFinite)) last = saved;
  }
  function save() { try { ports.write({ ...state, last }); } catch { /* collecting goes on in memory */ } }
  save();
  function observe(raw: unknown): boolean {
    const event = rollPacket(raw, ports.size());
    if (!event || !ports.isUpgradeScroll(event.p.scroll)) return false;
    const digits = event.p.nums;
    if (digits.length < LUCKY_ROLL_DIGITS) { last = null; save(); return false; }
    if (digits.length !== LUCKY_ROLL_DIGITS || !digits.every(n => /^[0-9]$/.test(String(n)))) return false;
    const roll = Number('0.' + [...digits].reverse().join(''));
    const remaining = event.q.upgrade!.ms, at = ports.now();
    const next = { slot: event.num, roll, remaining, at };
    if (repeatedRoll(last, next)) return false;
    last = next;
    const stats = state.slots[event.num] ??= emptyRolls();
    stats.totalRolls++;
    stats.sumRolls += roll;
    if (roll > LUCKY_HIGH_ROLL) stats.rollsAbove96_3++;
    if (roll === 0) stats.perfectRolls++;
    state.cursor = { slot: (event.num + 1) % ports.size(), at,
      rolls: Object.values(state.slots).reduce((sum, entry) => sum + entry.totalRolls, 0) };
    save();
    return true;
  }
  return { observe, begin: () => { last = null; save(); }, report: (): LuckySlotTracking => JSON.parse(JSON.stringify(state)),
    sync: (history: LuckySlotStreams = {}) => {
      streams = history;
      const own = history[state.streamId!];
      if (own && mergeSlotStream(state, own)) save();
    },
    select: () => {
      try { return luckySlotSearch(aggregateSlotTracking(streams, state)).nextSlot; }
      catch { return null; } // missing or corrupt discovery data never blocks an ordinary upgrade
    } };
}

// The upgrade preview's chance replies (from runtime/characters/upgrade-preview.ts). The caller
// holds the bag as `previewing` until the game's upgrade promise settles; the item is the request's
// while `sameItem` holds (identity.ts).
interface PreviewPorts {
  items(): (ItemCopy | null)[];
  grade(item: ItemCopy): number;
  current(): boolean;
  now(): number;
  preview(slot: number, scroll: number, offering: number | null, calculate: true): Promise<UpgradeServerPreview>;
  // Where the preview looked for the scroll and offering, which a missing one's reason names: the
  // merchant's preview borrows from the bank first, so it names the bank too.
  searched: string;
}
export async function previewUpgrade(request: UpgradePreviewRequest, ports: PreviewPorts): Promise<UpgradePreviewResult> {
  const live = ports.items()[request.slot];
  if (!sameItem(live, request.item)) return unavailablePreview(request.executor, request.item, 'Item changed; reopen the menu');
  // The whole slot item, as the previous release's preview compared it
  // (runtime/characters/upgrade-preview.ts:19-26).
  const original = JSON.stringify(live), unchanged = () => JSON.stringify(ports.items()[request.slot]) === original;
  const result = unavailablePreview(request.executor, request.item, 'Preview expired; refresh');
  for (const option of previewOptions) {
    if (!ports.current()) break;
    if (!unchanged()) return unavailablePreview(request.executor, request.item, 'Item changed; reopen the menu');
    result.options[option] = await previewOption(request, ports, live!, option);
    if (!ports.current() || !unchanged()) return unavailablePreview(request.executor, request.item, 'Item or session changed; reopen the menu');
  }
  return result;
}
async function previewOption(request: UpgradePreviewRequest, ports: PreviewPorts, live: ItemCopy, option: PreviewOption): Promise<PreviewResult> {
  const scrollName = 'scroll' + ports.grade(live);
  const scroll = ports.items().findIndex(item => item?.name === scrollName);
  const offering = option === 'none' ? null : ports.items().findIndex(item => item?.name === option && !item.l);
  if (scroll < 0) return { reason: 'Missing ' + scrollName + ' in ' + ports.searched };
  if (offering === -1) return { reason: 'Offering not in ' + ports.searched };
  try {
    const preview = await ports.preview(request.slot, scroll, offering, true);
    const valid = preview.calculate === true && Number.isFinite(preview.chance) && preview.chance >= 0 && preview.scroll === scrollName &&
      (preview.offering || undefined) === (option === 'none' ? undefined : option) && sameItem(preview.item, request.item);
    if (!valid) throw Error('Mismatched server preview');
    return { preview, observedAt: ports.now() };
  } catch (error) { return { reason: previewError(error) }; }
}
function previewError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const data = error as { reason?: string; response?: string } | null;
  const reason = data?.reason || data?.response || 'Server preview unavailable';
  return ({ cant_in_bank: 'Merchant is in the bank', distance: 'Merchant must be near the upgrader or have a computer', upgrade_in_progress: 'Merchant busy', item_locked: 'Item is locked' } as Record<string, string>)[reason] || reason;
}

