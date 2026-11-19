// The character's death recovery (runtime/characters/survival/recovery-member.ts) on planted ports
// (a shared setup lives in the harness). The respawn is
// survival's one respawn: `flight` settles it, and an ask while one is in
// flight answers `not-now`, as `survival.respawn` does; a lost reply rejects only while the client
// still reads the character dead (death.ts).
const { createDeathRecovery } = require('../../../runtime/characters/survival/recovery-member.ts');
const { createOwnerLadder, rejoinRound } = require('../../../runtime/protocol/ladder.ts');
function ports(overrides = {}) {
  let now = 10000;
  const state = { dead: true, attempts: 0, farms: 0, holds: 0, done: 0, task: { kind: 'farming', owner: 'farm' }, flight: null };
  const timers = [], published = [], logs = [];
  const original = Date.now; Date.now = () => now;
  const recover = createDeathRecovery({
    name: () => 'Member', isDead: () => state.dead,
    respawn: () => {
      if (state.flight) return Promise.reject({ reason: 'not-now' });
      state.attempts++;
      return new Promise((resolve, reject) => { state.flight = { resolve, reject }; timers.push(error => { state.flight = null; error && state.dead ? reject(error) : resolve(); }); });
    },
    publish: s => published.push(s), log: s => logs.push(s),
    rejoinEvent: async () => ({ status: 'recovered' }),
    task: () => ({ task: state.task, at: now }), returnToFarm: () => { state.farms++; return true; },
    revision: () => 1, position: () => ({ map: 'main', x: 0, y: 0 }),
    climb: (_event, join) => createOwnerLadder(rejoinRound(join), () => now),
    hold: () => { state.holds++; }, done: () => { state.done++; }, joinEvent: () => false, nextReport: () => Promise.resolve(),
    ...overrides,
  });
  return { state, timers, published, logs, recover, advance: ms => { now += ms; }, restore: () => { Date.now = original; } };
}

module.exports = { ports };
