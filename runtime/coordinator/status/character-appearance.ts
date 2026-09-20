interface Sprite { url: string; tileSize: number; columns: number; rows: number; x: number; y: number }

export interface CharacterAppearance {
  skin?: string;
  characterSprite: Sprite | null;
  characterDollHtml: string | null;
  updatedAt: number;
}
export interface AppearanceState { characterAppearances?: Record<string, CharacterAppearance> }
interface Report { name: string; skin?: unknown; characterSprite?: unknown; characterDollHtml?: unknown }

function sprite(value: unknown): Sprite | null {
  if (!value || typeof value !== 'object') return null;
  const v=value as Sprite;
  return typeof v.url === 'string' && ['tileSize','columns','rows','x','y'].every(k=>Number.isFinite(v[k as keyof Sprite]))
    ? {url:v.url,tileSize:v.tileSize,columns:v.columns,rows:v.rows,x:v.x,y:v.y} : null;
}

const emptyAppearance: CharacterAppearance={characterSprite:null,characterDollHtml:null,updatedAt:0};
function mergeAppearance(report: Report, before=emptyAppearance, image: Sprite | null, html: string | null) {
  const skin=typeof report.skin === 'string' ? report.skin : before.skin;
  const previous=skin === before.skin ? before : emptyAppearance;
  return {skin,characterSprite:image || previous.characterSprite,
    characterDollHtml:html || previous.characterDollHtml};
}
function sameAppearance(before: CharacterAppearance, next: Omit<CharacterAppearance,'updatedAt'>): boolean {
  return before.skin===next.skin && before.characterDollHtml===next.characterDollHtml &&
    JSON.stringify(before.characterSprite)===JSON.stringify(next.characterSprite);
}

/** Keep appearance separate from live status: a saved doll never makes a character online. */
export function rememberCharacterAppearance(state: AppearanceState, report: Report, now: number): boolean {
  const image=sprite(report.characterSprite);
  const html=typeof report.characterDollHtml === 'string' && report.characterDollHtml.trim() ? report.characterDollHtml : null;
  if (!image && !html) return false;
  const before=state.characterAppearances?.[report.name];
  const next=mergeAppearance(report,before,image,html);
  if (before && sameAppearance(before,next)) return false;
  state.characterAppearances={...state.characterAppearances,[report.name]:{...next,updatedAt:now}};
  return true;
}
