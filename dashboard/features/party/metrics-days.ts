import { HISTORY_KEPT_MS, METRIC_BUCKET_MS } from '../../../runtime/status/api.ts';

// The kills, damage, items and loot views count calendar days from this browser's midnight,
// daylight saving included, and say so in `METRIC_DAY_NOTE`.
export const METRIC_DAY_NOTE = "Days start at this browser's midnight.";
const DAY_MS = 86_400_000;
/** True when a view may ask for `from` to `to`: both finite, in order, within the history the
 *  coordinator keeps (`HISTORY_KEPT_MS`, the one range rule the metrics routes read too). */
export function validMetricRange(from: number, to: number) {
  return Number.isFinite(from) && Number.isFinite(to) && from < to && to - from <= HISTORY_KEPT_MS;
}
// The help texts' words for the status owner's bucket and history, so they follow `metricBucketMs` and
// `metricHistory`.
export const METRIC_BUCKET_WORDS = `every ${METRIC_BUCKET_MS / 1000} seconds`;
export const METRIC_KEPT_WORDS = `${Math.round(HISTORY_KEPT_MS / DAY_MS)} days`;

const pad = (value: number) => String(value).padStart(2, '0');
/** The browser's calendar day of `at`, as YYYY-MM-DD. */
export function metricDay(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function localDate(day: string, offset = 0) {
  const [year, month, date] = day.split('-').map(Number);
  return year && month && date ? new Date(year, month - 1, date + offset) : null;
}
export function shiftMetricDay(day: string, days: number) {
  const date = localDate(day, days);
  return date ? metricDay(date.getTime()) : '';
}
/** The browser's midnight that starts `day`. */
export function metricDayStart(day: string) {
  return localDate(day)?.getTime() ?? NaN;
}
