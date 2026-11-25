// The character's owner modules, one list for both entries: common.ts (the class bundles) and
// legacy-entry.ts (caracAL's party-member.js). Each module registers its owner on the frame once per
// window, and shared.js reads them at its install.
// The call budget first: shared.js installs it before any other module acts in the game.
import "./call-budget.ts";
import "./geometry.ts";
import "../hunting/character/install.ts";
import "./survival/shared-entry.ts";
// The turns owner's "Heal first below" as the reply delivers it (`installHealFirstBelow`), which shared.js installs before survival.
import "./turns/delivered.ts";
// The items owner's character half: `partyItems`, which shared.js reads at its install.
import "../items/character/owner.ts";
import "../movement/character/owner.ts";
import "../tasks/character/membership.ts";
import "../tasks/character/assignment.ts";
import "../tasks/character/holds.ts";
import "../events/character/combat.ts";
import "../events/character/clock.ts";
import "../events/character/reply.ts";
import "../events/character/attend.ts";
import "../events/character/exit.ts";
import "../events/character/anniversary.ts";
import "../events/character/merchant.ts";
import "../events/character/install.ts";
import "../events/october/ports.ts";
import "./targeting/install.ts";
import "../movement/character/install.ts";
import "../merchant-jobs/character/visits.ts";
import "../merchant-jobs/character/runner.ts";
import "../merchant-jobs/character/gathering.ts";
import "../merchant-jobs/character/luck.ts";
import "../merchant-realm/character/hop.ts";
import "../merchant-hands/character/owner.ts";
// The lifecycle owner's run scope, drain and command intake (`partyLifecycle`), which shared.js reaches at its install.
import "../lifecycle/character/drain.ts";
// The status owner's reply apply, table A (`partyStatus.apply`), which shared.js builds at its install.
import "../status/character/apply.ts";
import "../status/character/report.ts";
// The status owner's leased rings and handoff timing (`partyStatus.rings`), which shared.js builds at its install.
import "../status/character/rings.ts";
// The status owner's telemetry (`partyStatus.telemetry`) and the headless rendering guards it installs at load.
import "../status/character/telemetry.ts";
