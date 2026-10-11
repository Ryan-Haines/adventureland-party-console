function recoveryMembershipOwned(party, recovery, escape) {
  return recovery && ['escaping', 'recovering'].includes(recovery.phase) &&
    recovery.leader === party.leader && recovery.policy === party.farmingPolicy &&
    recovery.focus === JSON.stringify(party.monsterFocus) &&
    escape.participants.every(name => recovery.names.includes(name)) &&
    recovery.names.every(name => {
      const intent = party.navigationIntents?.[name];
      return intent && !intent.cancelled && intent.revision === recovery.revisions[name];
    });
}
function reopenOmittedHold(party) {
  const held = party.escape, recovery = party.combatRecovery;
  if (held?.stage === 'failed-hold' && recoveryMembershipOwned(party, recovery, held) &&
      recovery.names.some(name => !held.participants.includes(name))) held.stage = 'recovering';
}
module.exports = function createEscape(party, hooks) {
  const now = hooks.now || Date.now;
  const owns = name => !!(party.escape && party.escape.stage !== 'released' && party.escape.participants.includes(name));
  function fail(reason) {
    const e = party.escape;
    if (!e || ['recovering', 'recovery-convoy', 'failed-hold', 'released'].includes(e.stage)) return;
    e.error = reason; e.stage = 'recovering'; e.recoveryAt = now(); e.destination = null;
    hooks.cancel(); hooks.persist();
  }
  function start(names) {
    if (party.escape && !['released', 'complete', 'failed-hold'].includes(party.escape.stage)) return party.escape;
    const roles = {};
    for (const name of names) {
      const role = party.statuses[name]?.ctype;
      if (['warrior', 'mage', 'priest'].includes(role) && !roles[role]) roles[role] = name;
    }
    // Every requested member must evacuate, including members whose class has
    // not arrived yet and additional characters sharing a skill leader's role.
    // Roles select the coordinated skill sequence; they do not define recovery.
    const participants = [...new Set(names)];
    party.escape = { id: 'escape-' + now(), roles, participants,
      stage: 'blink', startedAt: now(), deadline: now() + 30000, progress: {}, error: null,
      deaths: Object.fromEntries(participants.map(name => [name, party.statuses[name]?.lastDeath])) };
    hooks.cancel();
    if (Object.keys(roles).length !== 3) fail('Missing warrior, mage, or priest');
    else if (participants.length !== Object.keys(roles).length)
      fail('Requested members need independent escape recovery');
    step(); hooks.persist(); return party.escape;
  }
  function release() {
    if (!party.escape || party.escape.stage === 'released') return;
    hooks.cancel(); party.escape.stage = 'released'; hooks.persist();
  }
  function at(status, destination) {
    return !!(status && destination && !status.rip && status.hp > 0 && now() - status.seenAt < 10000 &&
      status.map === destination.map && status.in === destination.in && status.server === destination.server &&
      Math.hypot(status.x - destination.x, status.y - destination.y) <= 65);
  }
  function step() {
    const e = party.escape;
    if (!e || ['released', 'complete', 'failed-hold'].includes(e.stage)) return;
    for (const name of e.participants) {
      const s = party.statuses[name], report = s?.escape;
      if (report?.id === e.id) e.progress[name] = report;
      if (!['recovering', 'recovery-convoy'].includes(e.stage)) {
        if (!s || now() - s.seenAt > 10000) { fail(name + ' disconnected'); break; }
        if (s.rip || s.hp <= 0 || JSON.stringify(s.lastDeath) !== JSON.stringify(e.deaths[name])) { fail(name + ' died'); break; }
      }
    }
    if (!['recovering', 'recovery-convoy'].includes(e.stage) && now() >= e.deadline)
      fail('Timed out during ' + e.stage + ': ' + (Object.values(e.progress).map(p => p.error).filter(Boolean).join('; ') || 'arrival was not confirmed'));
    if (e.stage === 'recovering') {
      const ready = e.participants.every(name => {
        const s = party.statuses[name]; return s && !s.rip && s.hp > 0 && s.map === 'main' && Math.hypot(s.x, s.y) <= 65 && now() - s.seenAt < 10000;
      });
      if (ready && hooks.convoy(e.participants)) { e.stage = 'recovery-convoy'; e.convoyId = party.activeConvoy?.id; hooks.persist(); }
      return;
    }
    if (e.stage === 'recovery-convoy') {
      const casualty = e.participants.find(name => party.statuses[name]?.rip);
      if (casualty) { hooks.cancel(); e.stage = 'recovering'; hooks.persist(); return; }
      if (party.activeConvoy?.phase === 'failed') {
        e.progress.recovery = { error: party.activeConvoy.failure || 'Recovery convoy is blocked' };
      }
      if (e.participants.every(name => {
        const s = party.statuses[name]; return s && !s.rip && s.map === 'main' && now() - s.seenAt < 10000 && Math.hypot(s.x, s.y) <= 65;
      })) { e.stage = 'failed-hold'; hooks.cancel(); hooks.persist(); }
      else if (!party.activeConvoy) { e.stage = 'recovering'; hooks.persist(); }
      return;
    }
    const mage = party.statuses[e.roles.mage];
    if (e.stage === 'blink' && mage?.escape?.id === e.id && mage.escape.landed && mage.escape.destination && at(mage, mage.escape.destination)) {
      e.destination = mage.escape.destination; e.stage = 'warrior'; hooks.persist();
    }
    if (e.stage === 'warrior' && at(party.statuses[e.roles.warrior], e.destination)) { e.stage = 'priest'; hooks.persist(); }
    if (e.stage === 'priest' && at(party.statuses[e.roles.priest], e.destination)) { e.stage = 'complete'; hooks.persist(); }
  }
  reopenOmittedHold(party);
  if (party.escape && !['released', 'complete', 'failed-hold'].includes(party.escape.stage)) {
    const recovery = party.combatRecovery, e = party.escape;
    // Repair only the still-owned death recovery after a restart. An unrelated
    // manual escape or superseded navigation must not acquire extra members.
    if (recoveryMembershipOwned(party, recovery, e)) {
      e.participants = [...new Set(recovery.names)];
      e.deaths ||= {};
      for (const name of e.participants) if (!(name in e.deaths)) e.deaths[name] = party.statuses[name]?.lastDeath;
    }
    party.escape.stage = 'blink'; fail('Coordinator restarted during escape');
  }
  return { start, release, step, owns, fail };
};
