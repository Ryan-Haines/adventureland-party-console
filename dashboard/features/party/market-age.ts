import { formatDuration } from './format-duration';

// The market feeds refresh only while someone needs them, so the market panel shows how old each
// feed's data is: ALData's merchants snapshot and Ponty's listings, in whole seconds. A feed that
// never loaded shows no age.
export function marketAge(now: number, aldataAt: number | undefined, pontyAt: number | undefined): string {
  const age = (at: number | undefined) => at && at > 0 ? formatDuration(Math.max(0, Math.round((now - at) / 1000)) * 1000) + ' old' : null;
  return [['ALData', age(aldataAt)], ['Ponty', age(pontyAt)]].flatMap(([feed, text]) => text ? [feed + ' ' + text] : []).join(' · ');
}
