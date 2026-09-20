const farmZones = require('../characters/farming-zones.cjs');
const defense = require('./convoy-defense.cjs');
// Coordinator-side barriers. Routes stay in their owning character runtime.
const FRESH_MS = 3000;
function commandFor(party, convoy, phase, name) {
  const command = { id: party.nextCommandId++, type: 'party-monster-travel', phase,
    navigationRevision: Number(party.navigationIntents?.[name]?.revision) || 0,
    returnRouting: !!convoy.returnRouting, disableTown: !!convoy.disableTown,
    returnLeg: !!convoy.returnLegs, leg: convoy.returnLegs?.[convoy.legIndex] || null,
    convoyId: convoy.id, epoch: convoy.epoch, location: convoy.location,
    rally: convoy.rally, label: convoy.label, leader: convoy.leader,
    participants: convoy.participants, slowestSpeed: convoy.slowestSpeed,
    purpose: convoy.purpose || null, navigationExempt: !!convoy.navigationExempt,
    combatHandoffAllowed: convoy.combatHandoffAllowed !== false, nonPreemptible: !!convoy.nonPreemptible,
    townFirst: !!convoy.townFirst,
    reason: convoy.failure || null };
  if (name) (convoy.expected ||= {})[name] = { commandId: command.id,
    revision: command.navigationRevision, phase, runtimeId: party.statuses[name]?.convoyNavigation?.runtimeId || null };
  return command;
}
function hold(party, reason, code = 'route-failed') {
  const c = party.activeConvoy;
  if (!c || c.phase === 'failed') return false;
  c.phase = 'failed'; c.failure = reason; c.failureCode = code; c.failedAt = Date.now(); c.departAt = null;
  for (const name of c.participants) {
    const command = party.commands[name];
    if (!command || command.convoyId === c.id) party.commands[name] = commandFor(party, c, 'hold', name);
  }
  return true;
}
function identity(c, command, navigation) {
  const expected = command && c.expected && Object.values(c.expected).find(e=>e.commandId === command.id);
  return !!(command && navigation && command.type === 'party-monster-travel' &&
    (!c.expected || expected && expected.revision === command.navigationRevision &&
      (!expected.runtimeId || navigation.runtimeId === expected.runtimeId)) &&
    (navigation.navigationRevision === undefined || navigation.navigationRevision === command.navigationRevision) &&
    command.convoyId === c.id && command.epoch === c.epoch &&
    navigation.id === c.id && Number(navigation.epoch) === c.epoch &&
    Number(navigation.commandId) === command.id && navigation.runtimeId);
}
function validReport(party, body) {
  const c = party.activeConvoy, command = party.commands[body.character];
  return !!(c && c.phase !== 'failed' && c.participants.includes(body.character) &&
    command && command.convoyId === c.id && command.epoch === c.epoch &&
    c.id === body.convoyId && c.epoch === Number(body.epoch) && command.id === Number(body.commandId) &&
    (!c.runtimes || c.runtimes[body.character] === body.runtimeId));
}
function step(party, now = Date.now()) {
  const c = party.activeConvoy;
  if (!c) return false;
  if (defense.step(party, now, commandFor)) return true;
  if(c.purpose==='death-recovery' && c.phase!=='failed') {
    for(const name of c.participants) {
      if(!party.commands[name] && c.expected?.[name]?.revision===(Number(party.navigationIntents?.[name]?.revision)||0) &&
          !party.navigationIntents?.[name]?.cancelled && ['assemble','town','plan-return'].includes(c.phase)) {
        party.commands[name]=commandFor(party,c,c.phase,name);
      }
    }
  }
  if (c.phase === 'failed') {
    let changed = false;
    for (const name of c.participants) {
      if (!party.commands[name]) {
        party.commands[name] = commandFor(party, c, 'hold', name); changed = true;
      }
    }
    return changed;
  }
  const names = c.participants.filter(name => !(c.completed || []).includes(name));
  if (c.observedPhase !== c.phase) {
    c.observedPhase = c.phase; c.phaseStartedAt = now; c.lastProgressAt = now;
    c.progress = {}; c.blockers = {};
  }
  let diagnosticsChanged = false;
  if (['assemble', 'town', 'plan-return'].includes(c.phase)) {
    const blockers = {};
    for (const name of names) {
      const s = party.statuses[name], n = s?.convoyNavigation, command = party.commands[name];
      const expectedPhase = c.phase === 'assemble' ? 'assembled' : c.phase === 'town' ? 'towned' :
        name === c.leader ? 'return-route-ready' : 'assembled';
      const distance = s?.map === c.rally.map ? Math.hypot(Number(s.x)-c.rally.x, Number(s.y)-c.rally.y) : Infinity;
      const reason = !s || s.seenAt < now-FRESH_MS ? 'status-stale' : s.rip ? 'dead' :
        !command || command.convoyId !== c.id ? 'command-lost' : !identity(c,command,n) ? 'acknowledgement-missing' :
        n.phase === 'failed' ? 'runtime-failed' : n.phase !== expectedPhase ? 'phase-pending' :
        s.moving ? 'moving' : c.phase === 'assemble' && distance > 55 ? 'outside-rally' :
        c.phase === 'assemble' && !(Number(s.speed)>0 && Number(s.speed)<=c.slowestSpeed+.1) ? 'speed-pending' : null;
      if (reason) blockers[name] = { reason, expectedCommandId: c.expected?.[name]?.commandId || command?.id || null,
        reportedCommandId: n?.commandId || null, expectedPhase, reportedPhase: n?.phase || null,
        expectedRevision: command?.navigationRevision ?? null, reportedRevision: n?.navigationRevision ?? null,
        runtimeId: n?.runtimeId || null, map:s?.map, x:s?.x, y:s?.y, speed:s?.speed, moving:s?.moving };
      const previous = c.progress[name];
      const ack = identity(c,command,n) ? command.id + ':' + n.phase : null;
      if (s && s.seenAt >= now-FRESH_MS && (!previous || ack && ack !== previous.ack ||
          c.phase === 'assemble' && distance < previous.distance-5)) {
        c.lastProgressAt = now; c.progress[name] = { ack, distance };
      }
    }
    diagnosticsChanged = JSON.stringify(c.blockers) !== JSON.stringify(blockers);
    c.blockers = blockers;
    const summary = Object.entries(blockers).map(([name,b])=>name+': '+b.reason+' ('+b.reportedPhase+' → '+b.expectedPhase+')').join(', ');
    if (summary && summary !== c.blockerSummary) {
      c.blockerSummary = summary;
      if (party.combatLogs) {
        const entries = party.combatLogs[c.leader || names[0]] ||= [];
        entries.push({at:now,type:'navigation',message:'Convoy '+c.phase+': '+summary});
        if (entries.length>200) entries.splice(0,entries.length-200);
      }
    }
    if (c.phase === 'assemble' && (now-c.lastProgressAt >= 30000 || now-c.phaseStartedAt >= 120000))
      return hold(party, 'Assembly timed out: '+Object.entries(blockers).map(([n,b])=>n+': '+b.reason).join(', '), 'assembly-timeout');
  }
  if (c.phase === 'assemble') {
    const assembled = names.length && names.every(name => {
      const s = party.statuses[name], n = s && s.convoyNavigation;
      return s && s.seenAt >= now - FRESH_MS && !s.rip && !s.moving &&
        identity(c, party.commands[name], n) && n.phase === 'assembled' &&
        Number(s.speed) > 0 && Number(s.speed) <= c.slowestSpeed + 0.1 && s.map === c.rally.map &&
        Math.hypot(Number(s.x) - c.rally.x, Number(s.y) - c.rally.y) <= 55;
    });
    if (!assembled) { if (c.assembledSince) { c.assembledSince = 0; return true; } return diagnosticsChanged; }
    if (!c.assembledSince) { c.assembledSince = now; return true; }
    if (now - c.assembledSince < 500) return false;
    if (c.returnRouting && !c.returnLegs) {
      c.phase = 'plan-return'; c.planStartedAt = now;
      c.runtimes = Object.fromEntries(names.map(name=>[name,party.statuses[name].convoyNavigation.runtimeId]));
      party.commands[c.leader] = commandFor(party,c,'plan-return',c.leader);
      return true;
    }
    if (c.townFirst && !c.townCompleted) {
      c.phase = 'town'; c.townStartedAt = now; c.runtimes = {};
      for (const name of names) {
        const s = party.statuses[name];
        c.runtimes[name] = s.convoyNavigation.runtimeId;
        party.commands[name] = commandFor(party, c, 'town', name);
      }
      return true;
    }
    c.phase = 'prepare'; c.prepareStartedAt = now; c.runtimes = {}; c.origins = {};
    for (const name of names) {
      const s = party.statuses[name];
      c.runtimes[name] = s.convoyNavigation.runtimeId;
      c.origins[name] = { map: s.map, x: Number(s.x), y: Number(s.y) };
      party.commands[name] = commandFor(party, c, 'prepare', name);
    }
    return true;
  }
  if (c.phase === 'plan-return') {
    const n = party.statuses[c.leader]?.convoyNavigation;
    if (now-c.planStartedAt >= 65000) return hold(party,'Return route planning timed out','planning-timeout');
    if (!identity(c,party.commands[c.leader],n) || n.phase !== 'return-route-ready') return diagnosticsChanged;
    const legs = n.returnPlan;
    if (!Array.isArray(legs) || !legs.length || legs.length > 100 || legs.some(l=>
      !['walk','town'].includes(l.type) || !l.location || typeof l.location.map !== 'string' ||
      !Number.isFinite(l.location.x) || !Number.isFinite(l.location.y))) return hold(party,'Invalid return itinerary','route-failed');
    const last = legs.at(-1).location;
    if (last.map !== c.location.map || Math.hypot(last.x-c.location.x,last.y-c.location.y)>1)
      return hold(party,'Return itinerary does not end at Daisy','route-failed');
    c.returnLegs = legs; c.finalLocation = c.location; c.legIndex = 0;
    return beginLeg(party,c,now);
  }
  if (c.phase === 'town') {
    if (now - c.townStartedAt >= 20000) return hold(party, 'Town shortcut timed out after 20 seconds', 'town-unavailable');
    const towned = names.length && names.every(name => {
      const s = party.statuses[name], n = s && s.convoyNavigation;
      return s && s.seenAt >= now - FRESH_MS && !s.rip && !s.moving &&
        identity(c, party.commands[name], n) && n.phase === 'towned';
    });
    if (!towned) return diagnosticsChanged;
    if (c.returnLegs) { c.legIndex++; return beginLeg(party,c,now); }
    // Regroup after the teleport before preparing routes from a shared origin.
    c.townCompleted = true; c.phase = 'assemble'; c.assembledSince = 0;
    const leader = party.statuses[c.leader || names[0]];
    c.rally = { map: leader.map, x: Number(leader.x), y: Number(leader.y) };
    for (const name of names) {
      party.commands[name] = commandFor(party, c, 'assemble', name);
    }
    return true;
  }
  if (!['prepare', 'scheduled', 'travel'].includes(c.phase)) return hold(party, 'Unsupported convoy phase');
  let ready = true;
  for (const name of names) {
    const s = party.statuses[name], n = s && s.convoyNavigation, command = party.commands[name];
    if (!s || s.seenAt < now - FRESH_MS || s.rip) return hold(party, name + ': unavailable or dead', 'unavailable');
    if (!command || command.convoyId !== c.id) return hold(party, name + ': convoy command lost', 'command-lost');
    if (!n || n.runtimeId !== c.runtimes[name]) return hold(party, name + ': character runtime or route lost', 'runtime-lost');
    if (n.phase === 'failed') return hold(party, name + ': ' + (n.failure || 'route failed'));
    const matching = identity(c, command, n);
    // Old assembly heartbeats can arrive while the prepare command is in flight.
    if (!matching) {
      if (c.phase === 'prepare' && n.phase === 'assembled') { ready = false; continue; }
      return hold(party, name + ': stale route owner', 'owner-lost');
    }
    const beforeDeparture = c.phase === 'prepare' || now < c.departAt;
    if (beforeDeparture) {
      const origin = c.origins[name];
      if (s.moving || s.map !== origin.map || Math.hypot(Number(s.x) - origin.x, Number(s.y) - origin.y) > 1 ||
          !(Number(s.speed) > 0 && Number(s.speed) <= c.slowestSpeed + 0.1))
        return hold(party, name + ': formation or cruise speed changed');
      if (!n.routeReady || !['route-ready', 'waiting-for-departure'].includes(n.phase)) {
        if (c.phase === 'scheduled') return hold(party, name + ': prepared route lost');
        ready = false;
      }
    }
  }
  if (c.phase === 'travel' && c.returnLegs && names.every(name=>party.statuses[name].convoyNavigation.phase === 'leg-arrived')) {
    if (names.some(name=>party.statuses[name].map !== c.location.map ||
      Math.hypot(party.statuses[name].x-c.location.x,party.statuses[name].y-c.location.y)>100))
      return hold(party,'Return leg finished outside its destination','route-failed');
    c.legIndex++; return beginLeg(party,c,now);
  }
  if (c.phase === 'travel' && c.returnRouting) {
    let progressed=false;
    for (const name of names) {
      const s=party.statuses[name], prior=c.progress[name];
      if (!prior || prior.map!==s.map || Math.hypot(prior.x-s.x,prior.y-s.y)>5 ||
          prior.phase!==s.convoyNavigation.phase) {
        c.progress[name]={map:s.map,x:s.x,y:s.y,phase:s.convoyNavigation.phase}; progressed=true;
      }
    }
    if (progressed) c.lastProgressAt=now;
    if (now-c.lastProgressAt>=60000) return hold(party,'Return leg made no progress for 60 seconds','route-failed');
  }
  if (c.phase === 'prepare') {
    if (now - c.prepareStartedAt >= 60000) return hold(party, 'Route preparation timed out after 60 seconds');
    if (ready) { c.phase = 'scheduled'; c.departAt = now + 4000; return true; }
  } else if (c.phase === 'scheduled' && now >= c.departAt) { c.phase = 'travel'; return true; }
  return false;
}
function beginLeg(party,c,now) {
  const leg = c.returnLegs[c.legIndex];
  if (!leg) {
    for (const name of c.participants) if (party.commands[name]?.convoyId === c.id) delete party.commands[name];
    party.activeConvoy = null;
    return true;
  }
  c.location = leg.location; c.townFirst = leg.type === 'town'; c.townCompleted = false;
  const leader = party.statuses[c.leader];
  c.rally = {map:leader.map,x:Number(leader.x),y:Number(leader.y)};
  c.phase = 'assemble'; c.assembledSince = 0; c.observedPhase = null;
  for (const name of c.participants) party.commands[name] = commandFor(party,c,'assemble',name);
  return true;
}
function signal(party, name, now = Date.now()) {
  const c = party.activeConvoy, command = party.commands[name];
  if (!c || !c.participants.includes(name) || !command) return null;
  return { id: c.id, epoch: c.epoch, commandId: command.id, phase: c.phase,
    ...(c.loot?{loot:c.loot}:{}),
    runtimeId: c.runtimes && c.runtimes[name], departAt: c.departAt || null,
    validUntil: now + FRESH_MS, reason: c.defenseReason || c.failure || null };
}
// A combat handoff ends the shared barrier without claiming waypoint arrival.
// Remaining members get individual, revision-bound recovery commands.
function engage(party, body, options = {}) {
  const c = party.activeConvoy, target = body.target, now = options.now ?? Date.now();
  if (!validReport(party, body) || c.combatHandoffAllowed === false || !['scheduled', 'travel'].includes(c.phase) || now < c.departAt ||
      Number(body.navigationRevision) !== options.revisions[body.character] ||
      !target || !target.id || target.map !== c.location.map ||
      !Number.isFinite(target.x) || !Number.isFinite(target.y) ||
      !farmZones.contains(c.location,target,0,options.radius) ||
      !(options.focus.includes('all') || options.focus.includes(target.mtype))) return false;
  c.engagement = { character: body.character, target: { ...target }, at: now,
    convoyId: c.id, epoch: c.epoch,
    reports: Object.fromEntries(c.participants.map(name => [name, {
      commandId: party.commands[name]?.id, runtimeId: c.runtimes?.[name],
    }])) };
  for (const name of c.participants) {
    if ((c.completed || []).includes(name)) continue;
    if (name === body.character) delete party.commands[name];
    else party.commands[name] = { id: party.nextCommandId++, type: 'event-resume-travel',
      convoyHandoff: c.id, location: { ...c.location }, navigationRevision: options.revisions[name],
      label: 'the selected farming waypoint' };
  }
  for (const owner of [party.anniversary && party.anniversary.eventCycle, party.eventReturn,
    ...Object.values(party.eventSessions || {})]) {
    if (!owner || !owner.returnRoutes) continue;
    for (const name of c.participants) {
      const route = owner.returnRoutes[name];
      if (!route || route.convoyId !== c.id || route.revision !== options.revisions[name]) continue;
      delete route.convoyId;
      if (name === body.character) route.engagedAt = now;
      else if (party.commands[name] && party.commands[name].convoyHandoff === c.id)
        route.commandId = party.commands[name].id;
    }
  }
  party.lastConvoyEngagement = c.engagement;
  party.activeConvoy = null;
  return true;
}
module.exports = { step, hold, signal, validReport, engage };
