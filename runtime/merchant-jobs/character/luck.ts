// The merchant job owner's Merchant's Luck on the character: the luck job, the cast on one player,
// and the scan of the players in range. Our own luck comes first and is refreshed under the items owner min;
// another merchant's strong luck is left alone; every cast asks the call budget's job band (3.13).
// shared.js builds it at load over one-line reads of other owners (`luckPorts()`); the moved code is
// shared.js's own JavaScript, so those reads are untyped here.
//
// One scan runs at a time: the module holds the scan in flight, and an ask while it runs gets that
// scan's recipients.
import { partyHooks } from '../../hooks/index.ts';
import { jobEnded, MERCHANT_LUCK } from '../rules.ts';
import { boundFired } from '../../status/api.ts';
import { OWN_UPDATE, untilGame } from './game-wait.ts';

export type LuckPorts = Record<string, any>;

// v1.5.0's picks: a player is refreshed when under the items owner min of luck is left;
// the job's scan casts on at most 12 passers-by and the scan while walking on 4. The cast's reach
// and level are rules.ts's MERCHANT_LUCK. A cast waits for the server's cooldown end
// (`next_skill.mluck`), which a party trip can reach before it clears; READY_WAIT_MS bounds that
// wait against a cooldown the game never ends, and the next cast goes out once the game answers
// the last one (`use_skill`'s promise).
const REFRESH_BELOW_MS = 600_000, READY_WAIT_MS = 5_000, PUBLIC_LIMIT = 12, WALKING_LIMIT = 4;
const { range: RANGE, level: LUCK_LEVEL } = MERCHANT_LUCK;
// The game's answers that mean "not this player now", which are no failure.
const QUIET_REFUSALS = ['cooldown', 'too_far', 'not_found', 'already'];

export function createMerchantLuck(p: LuckPorts) {
  let scanning: Promise<string[]> | null = null, scanFailure = '';

  function luckRemaining(player: any): number {
    const buff = player && player.s && player.s.mluck;
    if (!buff || String(buff.f || buff.source || '') !== String(p.character().name)) return 0;
    return typeof buff.ms === 'number' ? Math.max(0, buff.ms) : 0;
  }

  // `strong` keeps another merchant from overwriting the luck its own account cast; it never stops
  // our merchant refreshing its own.
  function hasStrongMerchantLuck(player: any): boolean {
    const buff = player && player.s && player.s.mluck;
    return !!(buff && buff.strong && String(buff.f || buff.source || '') !== String(p.character().name));
  }

  async function castMerchantLuck(player: any): Promise<boolean> {
    const c = p.character();
    if (!player || (player.ctype === 'merchant' && player.name !== c.name) || player.rip) return false;
    if (hasStrongMerchantLuck(player)) return false;
    if (luckRemaining(player) > REFRESH_BELOW_MS) return false;
    if (Math.hypot(Number(player.x) - Number(c.x), Number(player.y) - Number(c.y)) > RANGE) return false;
    const ready = () => !p.onCooldown('mluck') && !!p.canUse('mluck');
    if (!await untilGame(p.act, OWN_UPDATE, ready, READY_WAIT_MS, () => Number(p.nextSkill('mluck')) || 0)) {
      // READY_WAIT_MS is a kept bound against the game's cooldown; its firing goes to the status owner's record.
      boundFired({ bound: 'READY_WAIT_MS', owner: '08', state: { player: player.name, onCooldown: !!p.onCooldown('mluck') } });
      return false;
    }
    const hooks = partyHooks();
    while (hooks.calls.band({ band: 'job', method: 'mluck' }) !== 'send') await p.sleep(hooks.calls.window());
    await use_skill('mluck', player);
    return true;
  }

  async function scanPlayers(limit: number): Promise<string[]> {
    const c = p.character(), recipients: string[] = [], partyNames: Record<string, boolean> = {};
    p.partyPositions().forEach((member: any) => { if (member && member.name) partyNames[member.name] = true; });
    const entities = p.entities() || {};
    const nearby = Object.keys(entities).map(id => entities[id]).filter((entity: any) => entity && entity.type === 'character' &&
      entity.name !== c.name && entity.ctype !== 'merchant' && !entity.rip &&
      Math.hypot(Number(entity.x) - Number(c.x), Number(entity.y) - Number(c.y)) <= RANGE)
      .sort((a: any, b: any) => ((partyNames[a.name] ? 0 : 1) - (partyNames[b.name] ? 0 : 1)) || luckRemaining(a) - luckRemaining(b));
    for (let i = 0; i < nearby.length && recipients.length < limit; i += 1) {
      try {
        if (await castMerchantLuck(nearby[i])) {
          recipients.push(nearby[i].name);
        }
      } catch (error: any) {
        const reason = error && (error.reason || error.message || error);
        if (QUIET_REFUSALS.indexOf(reason) < 0) p.log("Merchant's Luck failed for " + nearby[i].name + ': ' + reason, 'red');
      }
    }
    return recipients;
  }
  function castLuckOnVisiblePlayers(limit: number): Promise<string[]> {
    if (!castsLuck()) return Promise.resolve([]);
    if (!scanning) scanning = scanPlayers(limit).finally(() => { scanning = null; });
    return scanning;
  }
  function castsLuck(): boolean { return p.character().ctype === 'merchant' && p.character().level >= LUCK_LEVEL; }
  // The scan while the merchant walks, every 750 ms, for a merchant that casts luck.
  function startLuckScan(): void {
    if (!castsLuck()) return;
    // A failing scan logs its reason once, until the reason changes. p.act is the
    // merchant job owner's run scope, which disposes the timer with the generation.
    const scope = p.act;
    scope.setInterval(() => {
      if (p.character().moving) castLuckOnVisiblePlayers(WALKING_LIMIT).then(() => { scanFailure = ''; }, (error: any) => {
        const reason = String(error?.reason || error?.message || error);
        if (reason !== scanFailure) p.log("Merchant's Luck scan failed: " + reason, 'red');
        scanFailure = reason;
      });
    }, 750);
  }

  async function merchantLuck(command: any): Promise<void> {
    const activity: Array<Record<string, unknown>> = [], recipients: string[] = [], c = p.character();
    try {
      await p.rendezvous(command.jobId, command.target);
      if (command.target === c.name && await castMerchantLuck(c)) recipients.push(c.name);
      const cluster = await p.request('/merchant/luck-cluster', { method: 'POST', body: { jobId: command.jobId } });
      for (const name of cluster.recipients || []) {
        const player = p.player(name);
        if (!player) continue;
        try {
          if (await castMerchantLuck(player)) recipients.push(player.name);
        } catch (error: any) {
          activity.push({ level: 'error', message: "Merchant's Luck failed for " + player.name, details: String(error.reason || error.message || error) });
        }
      }
      // The adventurers passing within range get it too.
      (await castLuckOnVisiblePlayers(PUBLIC_LIMIT)).forEach(name => { if (recipients.indexOf(name) < 0) recipients.push(name); });
      recipients.forEach(name => activity.push({ level: 'success', message: "Cast Merchant's Luck on " + name }));
      if (!recipients.length) activity.push({ level: 'info', message: "Merchant's Luck was already active on eligible players near " + command.target });
      await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, success: true, mluckRecipients: recipients, activity } });
    } catch (error: any) {
      activity.push({ level: 'error', message: "Merchant's Luck trip to " + command.target + ' failed', details: String(error.reason || error.message || error) });
      try {
        await p.request('/merchant/complete', { method: 'POST', body: { jobId: command.jobId, success: false,
          error: String(error.reason || error.message || error), code: error?.code, mluckRecipients: recipients, activity } });
      } catch (completeError: any) {
        // A cleared job is already ended; any other failure of the report is logged.
        if (!jobEnded(completeError)) p.log("Merchant's Luck failure report failed: " + String(completeError?.message || completeError), 'red');
      }
      throw error;
    }
  }

  return { luckRemaining, hasStrongMerchantLuck, castMerchantLuck, castLuckOnVisiblePlayers, castsLuck, startLuckScan, merchantLuck };
}

const merchant = ((globalThis as any).partyMerchant ||= {});
merchant.jobs = Object.assign(merchant.jobs || {}, { luck: createMerchantLuck });
