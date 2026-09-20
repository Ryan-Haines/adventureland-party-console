import { createContext, runInContext } from 'node:vm';
import type { GameData } from '../../navigation/contracts.ts';

/** Match the game's initialization before hashing or preparing collision geometry. */
export function loadPlannerGeometry(dataSource: string, commonSource: string): GameData {
  const context = createContext({ Place: 'client' }, { codeGeneration: { strings: false, wasm: false } });
  for (const [filename, source] of [
    ['data.js', dataSource],
    ['old_common_functions.js', commonSource],
    ['prepare-movement.js', 'process_game_data();'],
  ]) runInContext(source, context, { filename, timeout: 10000 });
  if (!context.G?.maps || !context.G?.geometry) throw Error('Missing processed movement geometry');
  return context.G as GameData;
}
