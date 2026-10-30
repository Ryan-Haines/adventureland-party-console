import * as october from '../events/october.ts';
import {createOctoberRuntime} from '../events/october-runtime.ts';
Object.assign(globalThis, {partyOctoberEvents: {...october,createOctoberRuntime}});
