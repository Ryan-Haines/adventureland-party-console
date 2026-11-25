// The coordinator's read doors: every door file a coordinator or both-sides `READS` row names, so
// the coordinator's install publishes every read (read-answers.ts). A file added to a row of that
// side goes here, and scripts/tests/addon-reads.test.cjs fails until it does.
import { readAnswers, type DoorModules } from './read-answers.ts';
import * as m0 from '../characters/targeting/api.ts';
import * as m1 from '../characters/targeting/rules.ts';
import * as m2 from '../coordinator/survival/api.ts';
import * as m3 from '../coordinator/survival/install.ts';
import * as m4 from '../coordinator/targeting/api.ts';
import * as m5 from '../events/api.ts';
import * as m6 from '../events/coordinator/api.ts';
import * as m7 from '../hunting/api.ts';
import * as m8 from '../hunting/coordinator/api.ts';
import * as m9 from '../items/api.ts';
import * as m10 from '../items/coordinator/api.ts';
import * as m11 from '../lifecycle/api.ts';
import * as m12 from '../lifecycle/coordinator/api.ts';
import * as m13 from '../lifecycle/rules.ts';
import * as m14 from '../merchant-hands/api.ts';
import * as m15 from '../merchant-jobs/api.ts';
import * as m16 from '../merchant-jobs/coordinator/api.ts';
import * as m17 from '../merchant-jobs/rules.ts';
import * as m18 from '../merchant-realm/api.ts';
import * as m19 from '../movement/api/character.ts';
import * as m20 from '../movement/api/coordinator.ts';
import * as m21 from '../movement/rules.ts';
import * as m22 from '../protocol/reports.ts';
import * as m23 from '../settings/api.ts';
import * as m24 from '../settings/coordinator/api.ts';
import * as m25 from '../settings/rules.ts';
import * as m26 from '../status/api.ts';
import * as m27 from '../status/coordinator/api.ts';
import * as m28 from '../status/rules.ts';
import * as m29 from '../tasks/api.ts';
import * as m30 from '../tasks/coordinator/api.ts';
import * as m31 from '../tasks/rules.ts';

const MODULES: DoorModules = {
  'runtime/characters/targeting/api.ts': m0,
  'runtime/characters/targeting/rules.ts': m1,
  'runtime/coordinator/survival/api.ts': m2,
  'runtime/coordinator/survival/install.ts': m3,
  'runtime/coordinator/targeting/api.ts': m4,
  'runtime/events/api.ts': m5,
  'runtime/events/coordinator/api.ts': m6,
  'runtime/hunting/api.ts': m7,
  'runtime/hunting/coordinator/api.ts': m8,
  'runtime/items/api.ts': m9,
  'runtime/items/coordinator/api.ts': m10,
  'runtime/lifecycle/api.ts': m11,
  'runtime/lifecycle/coordinator/api.ts': m12,
  'runtime/lifecycle/rules.ts': m13,
  'runtime/merchant-hands/api.ts': m14,
  'runtime/merchant-jobs/api.ts': m15,
  'runtime/merchant-jobs/coordinator/api.ts': m16,
  'runtime/merchant-jobs/rules.ts': m17,
  'runtime/merchant-realm/api.ts': m18,
  'runtime/movement/api/character.ts': m19,
  'runtime/movement/api/coordinator.ts': m20,
  'runtime/movement/rules.ts': m21,
  'runtime/protocol/reports.ts': m22,
  'runtime/settings/api.ts': m23,
  'runtime/settings/coordinator/api.ts': m24,
  'runtime/settings/rules.ts': m25,
  'runtime/status/api.ts': m26,
  'runtime/status/coordinator/api.ts': m27,
  'runtime/status/rules.ts': m28,
  'runtime/tasks/api.ts': m29,
  'runtime/tasks/coordinator/api.ts': m30,
  'runtime/tasks/rules.ts': m31,
};

export const coordinatorReads = () => readAnswers('coordinator', MODULES);
