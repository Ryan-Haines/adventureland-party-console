// The character's read doors: every door file a character or both-sides `READS` row names, as
// the character bundles it, so the character's install publishes every read (read-answers.ts). A file
// added to a row of that side goes here, and scripts/tests/addon-reads.test.cjs fails until it does.
import { readAnswers, type DoorModules } from './read-answers.ts';
import * as m0 from '../characters/survival/api.ts';
import * as m1 from '../characters/survival/escape.ts';
import * as m2 from '../characters/survival/needs.ts';
import * as m3 from '../characters/targeting/api.ts';
import * as m4 from '../characters/targeting/rules.ts';
import * as m5 from '../characters/turns/api.ts';
import * as m6 from '../characters/turns/rules.ts';
import * as m7 from '../events/api.ts';
import * as m8 from '../hunting/api.ts';
import * as m9 from '../items/api.ts';
import * as m10 from '../lifecycle/api.ts';
import * as m11 from '../lifecycle/rules.ts';
import * as m12 from '../merchant-hands/api.ts';
import * as m13 from '../merchant-hands/rules.ts';
import * as m14 from '../merchant-jobs/api.ts';
import * as m15 from '../merchant-jobs/rules.ts';
import * as m16 from '../merchant-realm/rules.ts';
import * as m17 from '../movement/api/character.ts';
import * as m18 from '../movement/rules.ts';
import * as m19 from '../protocol/reports.ts';
import * as m20 from '../settings/api.ts';
import * as m21 from '../settings/rules.ts';
import * as m22 from '../status/api.ts';
import * as m23 from '../status/rules.ts';
import * as m24 from '../tasks/api.ts';
import * as m25 from '../tasks/rules.ts';

const MODULES: DoorModules = {
  'runtime/characters/survival/api.ts': m0,
  'runtime/characters/survival/escape.ts': m1,
  'runtime/characters/survival/needs.ts': m2,
  'runtime/characters/targeting/api.ts': m3,
  'runtime/characters/targeting/rules.ts': m4,
  'runtime/characters/turns/api.ts': m5,
  'runtime/characters/turns/rules.ts': m6,
  'runtime/events/api.ts': m7,
  'runtime/hunting/api.ts': m8,
  'runtime/items/api.ts': m9,
  'runtime/lifecycle/api.ts': m10,
  'runtime/lifecycle/rules.ts': m11,
  'runtime/merchant-hands/api.ts': m12,
  'runtime/merchant-hands/rules.ts': m13,
  'runtime/merchant-jobs/api.ts': m14,
  'runtime/merchant-jobs/rules.ts': m15,
  'runtime/merchant-realm/rules.ts': m16,
  'runtime/movement/api/character.ts': m17,
  'runtime/movement/rules.ts': m18,
  'runtime/protocol/reports.ts': m19,
  'runtime/settings/api.ts': m20,
  'runtime/settings/rules.ts': m21,
  'runtime/status/api.ts': m22,
  'runtime/status/rules.ts': m23,
  'runtime/tasks/api.ts': m24,
  'runtime/tasks/rules.ts': m25,
};
// Two both-sides rows name a coordinator door, which a character does not bundle; the owner's rules
// file the door re-exports carries the same export.
const VIA = { 'runtime/coordinator/targeting/api.ts': 'runtime/characters/targeting/rules.ts',
  'runtime/merchant-realm/api.ts': 'runtime/merchant-realm/rules.ts' };
export const characterReads = () => readAnswers('character', MODULES, VIA);
