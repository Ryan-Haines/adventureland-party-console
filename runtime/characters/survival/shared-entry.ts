// The survival owner's character half for shared.js: shared.js builds it at load, before the role
// runner installs the rest, so the class bundle imports this file before shared.js
// (runtime/characters/common.ts), as it does movement's and targeting's.
import { installSurvivalCharacter } from './install.ts';

Object.assign(globalThis, { installSurvivalCharacter });
