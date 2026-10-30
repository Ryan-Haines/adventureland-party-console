/** Native 18183 event wire fields are not yet in typed-adventureland 0.0.57.
 * These are partial public packets, not complete game entities. Review on upgrade. */
export const cipherIngredients = ['verdantspore', 'frostscale', 'embercoal', 'gloomfeather'] as const;
export type Ingredient = typeof cipherIngredients[number];
export interface CipherGatheringPlan {
  round:string; realm:string; owner:string; mode:'gathering'|'brewing'|'finished'; ingredient?:Ingredient; monster?:string;
  reason:'initial stock'|'recipe shortage'|'gathering ended';
  stock:Record<string,number>; selectedAt:number;
}
export interface CipherGatheringContext {
  owner:string; round?:string; ready:boolean; stock:Record<string,number>; plan?:CipherGatheringPlan; mixesLeft?:number;
}
export interface CipherClue { mix: string[]; right: number }
export interface CipherBoard {
  live?: boolean; id?: string; start?: number; gather_end?: number; end?: number;
  board?: CipherClue[]; fit?: string; mixes?: number; possible?: number; cracks?: number;
  cracked?: { by: string; recipe: string[] };
}
export interface CipherSettings {
  /** Legacy saved setting, accepted on import but no longer controls gathering. */
  gatherMinutes?: number;
  minClues: number; automatic: boolean;
  gatherMonsters?: string[];
  manual?: { id: string; round: string; cracks: number; mix: string[] };
}
export const defaultCipherSettings: CipherSettings = {
  minClues: 1, automatic: true,
  gatherMonsters: ['goo', 'arcticbee', 'plantoid', 'snake'],
};
export function validMix(mix: unknown): mix is Ingredient[] {
  return Array.isArray(mix) && mix.length === 5 && mix.every(item => cipherIngredients.includes(item));
}
export function cipherScore(a: string[], b: string[]): number {
  return a.reduce((count, name, i) => count + Number(name === b[i]), 0);
}
const recipes = Array.from({length: 1024}, (_, n) => Array.from({length: 5}, (_, i) => cipherIngredients[Math.floor(n / 4 ** i) % 4]));
export function cipherCandidates(board: CipherBoard): string[][] {
  const clues = board.board ?? [];
  if (clues.some(clue => !validMix(clue.mix) || !Number.isInteger(clue.right) || clue.right < 0 || clue.right > 5)) return [];
  const fit = typeof board.fit === 'string' && /^[0-9a-f]{256}$/i.test(board.fit) ? board.fit : null;
  if (!fit && (board.mixes ?? 0) > clues.length) return [];
  return recipes.filter((mix, n) => (!fit || ((parseInt(fit[n >> 2], 16) >> (n & 3)) & 1) !== 0) &&
    clues.every(clue => cipherScore(mix, clue.mix) === clue.right));
}
export function affordableMix(mix: string[], stock: Record<string, number>): boolean {
  return cipherIngredients.every(name => mix.filter(item => item === name).length <= (stock[name] ?? 0));
}
/** Information comes first. Equally informative guesses prefer affordability,
 * then consume abundant stock. An unavoidable shortage returns the best mix so
 * the caller can farm its missing ingredient instead of spending a poor guess. */
export function solveCipher(board: CipherBoard, stock: Record<string, number>): { mix: string[] | null; candidates: number; worst: number } {
  const candidates = cipherCandidates(board);
  const tried = new Set((board.board ?? []).map(clue => clue.mix.join(',')));
  let best: string[] | null = null, worst = Infinity, expected = Infinity, reward = -1, affordable=-1, abundance=-1;
  for (const mix of candidates) {
    if (tried.has(mix.join(','))) continue;
    const buckets = [0, 0, 0, 0, 0, 0];
    for (const secret of candidates) buckets[cipherScore(secret, mix)]++;
    const max = Math.max(...buckets), sum = buckets.reduce((n, count) => n + count * count, 0);
    const pay = buckets.reduce((n, count, score) => n + count * score, 0);
    const canPay=Number(affordableMix(mix,stock));
    const surplus=mix.reduce((n,id)=>n+Math.log1p(Math.max(0,stock[id]??0)),0);
    if (max < worst || max === worst && (sum < expected || sum === expected &&
        (canPay>affordable || canPay===affordable&&(surplus>abundance || surplus===abundance&&pay>reward)))) {
      best = mix; worst = max; expected = sum; reward = pay; affordable=canPay; abundance=surplus;
    }
  }
  return {mix: best?.slice() ?? null, candidates: candidates.length, worst: best ? worst : 0};
}
export interface PublishedOccurrence { event: string; at: number; status: string; id?: string }
export function nextPublishedEvent(schedule: {events?: PublishedOccurrence[]; repeats?: PublishedOccurrence[]}, id: string, now: number) {
  return [...(schedule.events ?? []), ...(schedule.repeats ?? [])]
    .filter(entry => entry.event === id && entry.status === 'scheduled' && Number.isFinite(entry.at) && entry.at > now)
    .sort((a, b) => a.at - b.at)[0];
}
// Minimum of all 5,040 orders from the native forest arrival (0,0), using
// collision-checked walking paths and 300 distance-equivalent per map crossing.
// Reproduce: node tools/game/plan-trick-or-treat.mts 18183 (6,401.008 units).
export const trickOrTreatRoute = [1, 0, 5, 6, 2, 3, 4] as const;
