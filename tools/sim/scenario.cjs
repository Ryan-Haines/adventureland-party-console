"use strict";
const classes = new Set(["warrior", "priest", "merchant", "mage", "ranger", "rogue", "paladin"]);
function positive(value, label) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`Invalid ${label}: expected a positive finite number`);
}
function characterNames(characters) {
  if (!Array.isArray(characters) || !characters.length)
    throw new Error("Scenario needs characters");
  const names = new Set();
  for (const c of characters) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(c.name) || names.has(c.name))
      throw new Error("Invalid or duplicate character name");
    if (!classes.has(c.type)) throw new Error("Invalid character type");
    names.add(c.name);
  }
  return names;
}
const knownParticipants = (step, names) =>
  names.has(step.leader) && (step.followers || []).every((n) => names.has(n));
function validateStep(step, names, duration) {
  if (!Number.isFinite(step.atSeconds) || step.atSeconds < 0 || step.atSeconds >= duration)
    throw new Error("Step outside scenario duration");
  if (!step.action) {
    if (!step.route?.startsWith("/")) throw new Error("Scenario request needs a route");
    return;
  }
  if (!["farm", "hunt"].includes(step.action)) throw new Error("Unknown scenario action");
  if (!knownParticipants(step, names)) throw new Error("Unknown step participant");
}
function validateScenario(s) {
  positive(s.minutes, "minutes");
  positive(s.sampleSeconds ?? 60, "sampleSeconds");
  const names = characterNames(s.characters);
  for (const step of s.steps || []) validateStep(step, names, s.minutes * 60);
  validateExpectations(s);
}
function validateExpectations(s) {
  for (const [type, count] of Object.entries(s.expect?.minKills || {})) {
    if (!s.track?.includes(type) || !Number.isInteger(count) || count < 0)
      throw new Error("minKills requires tracked monsters and nonnegative integer counts");
  }
  validateLimits(s.expect);
}
function validateLimits(expect) {
  for (const key of ["maxDeaths", "maxErrors", "maxCycleMinutes"]) {
    const value = expect?.[key];
    if (value != null && (!Number.isFinite(value) || value < 0)) throw new Error(`Invalid ${key}`);
  }
}
function checkKills(expect, kills, failures) {
  for (const [type, min] of Object.entries(expect.minKills || {})) {
    const n = kills.filter((k) => k.type === type).length;
    if (n < min) failures.push(`${type} kills ${n} < ${min}`);
  }
  for (const k of kills)
    if (expect.maxCycleMinutes != null && k.cycleMinutes > expect.maxCycleMinutes)
      failures.push(
        `${k.type} ${k.id} took ${k.cycleMinutes} min from spawn to death > ${expect.maxCycleMinutes}`,
      );
}
function check(expect, report) {
  const failures = [];
  const deaths = Object.values(report.characters).reduce((n, c) => n + (c.deaths || 0), 0);
  checkKills(expect, report.kills || [], failures);
  if (expect.maxDeaths != null && deaths > expect.maxDeaths)
    failures.push(`character deaths ${deaths} > ${expect.maxDeaths}`);
  if (expect.maxErrors != null && report.log.error > expect.maxErrors)
    failures.push(`coordinator errors ${report.log.error} > ${expect.maxErrors}`);
  if (report.halted || report.failed)
    failures.push(`simulation stopped: ${report.failed || report.halted}`);
  return { pass: !failures.length, failures };
}
module.exports = { validateScenario, check };
