// The survival owner's `survival.verdict` answers as the live realms install them, for unit tests
// whose code asks the hook. The askers read no model of
// their own since survival's step 4, so a test that runs a walk or a tank hold installs these.
const { partyHooks } = require('../../../runtime/hooks/index.ts');
const { installCoordinatorSurvival } = require('../../../runtime/coordinator/survival/install.ts');
const { groupId, groupKey } = require('../../../runtime/tasks/coordinator/groups.ts');
const { survivalRegistrations } = require('../../../runtime/characters/survival/registrations.ts');

// The coordinator survival owner over the test's party, as application.ts installs it, so
// `core:survival` carries every hook and a group's fight reads the members' fresh reports and the foes
// they report. The party's members are its reports; each member's navigation revision is the one its
// last command carries, 0 before its first.
function installCoordinatorAnswers(party) {
  const p = party();
  p.combatLogs ??= {};
  return installCoordinatorSurvival({ hooks: partyHooks(), party: p, now: () => Date.now(), persist() {},
    group: () => groupKey(groupId('party', p.leader)), members: () => Object.keys(p.statuses),
    intent: name => ({ revision: p.commands[name]?.navigationRevision ?? 0 }),
    convoy() {}, inCave: () => false, online: () => true });
}
// The character's answers (the tank's hold, its own fight) in `registry`, which becomes the realm's
// registry the add-on asks through `globalThis.__partyHooks`.
function installCharacterAnswers(registry) {
  for (const registration of survivalRegistrations) registry.register(registration);
  globalThis.__partyHooks = registry;
  return registry;
}
module.exports = { installCoordinatorAnswers, installCharacterAnswers };
