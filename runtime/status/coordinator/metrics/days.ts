// The metrics history's day files: each closed day's buckets, one JSON line each, gzip-compressed in
// one file beside the journal (`<journal>.days/<date>.<width>.jsonl.gz`). service.ts decides when a
// day closes, rolls or expires; this file writes, reads and sums a day, and parses its journal record.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';
import { requestObject } from '../../../lifecycle/api.ts';
import { metricNumber, metricText, type MetricDeathTotal } from '../../api.ts';
import { mergeDeaths, storedBucket, type StoredBucket } from './history.ts';
import { createMeasurementIndex, type IndexedDamage, type IndexedLoot } from './measurement-index.ts';

const gzip = promisify(zlib.gzip), gunzip = promisify(zlib.gunzip);

/**
 * A closed day in the journal (`day:<start>`): its file, the widths its buckets hold, and its sums,
 * so the lifetime kill total, the retained damage and loot totals and the name lists come from the
 * records without reading the files.
 */
export interface DayRecord {
  day: number; file: string; width: number; widths: number[];
  characters: string[]; servers: string[];
  kills: MetricDeathTotal[]; damage: IndexedDamage[]; loot: IndexedLoot[];
}

export const dayFile = (day: number, width: number) => new Date(day).toISOString().slice(0, 10) + '.' + width + '.jsonl.gz';

/** The record of a day's buckets, written as `file` at `width`. */
export function dayRecord(day: number, file: string, width: number, buckets: StoredBucket[]): DayRecord {
  const index = createMeasurementIndex(), kills: MetricDeathTotal[] = [], characters = new Set<string>(), servers = new Set<string>();
  for (const bucket of buckets) {
    mergeDeaths(kills, bucket.kills);
    index.add(bucket.values);
    for (const row of bucket.values) { characters.add(row.character); servers.add(row.server); }
  }
  return { day, file, width, widths: [...new Set(buckets.map(bucket => bucket.width))].sort((a, b) => a - b),
    characters: [...characters].sort(), servers: [...servers].sort(), kills, damage: [...index.damage()], loot: [...index.loot()] };
}

const texts = (list: unknown) => Array.isArray(list) && list.every(entry => metricText(entry));
const rows = (list: unknown, fields: string[], numbers: string[]) => Array.isArray(list) && list.every(entry => {
  const item = requestObject(entry);
  return fields.every(field => metricText(item[field])) && numbers.every(field => metricNumber(item[field]));
});
const sums = (row: Record<string, unknown>) => rows(row.kills, ['server', 'monster', 'actor'], ['count']) &&
  rows(row.damage, ['character', 'server', 'monster', 'skill'], ['amount', 'hits']) && rows(row.loot, ['character', 'server', 'item', 'variant'], ['quantity']);
/** A saved day record, refused whole when a field is malformed. */
export function storedDayRecord(value: unknown): DayRecord {
  const row = requestObject(value);
  if (!metricNumber(row.day) || !metricText(row.file) || !metricNumber(row.width) || !Array.isArray(row.widths) || !row.widths.every(width => metricNumber(width)) ||
      !texts(row.characters) || !texts(row.servers) || !sums(row))
    throw Error('Invalid metrics day record');
  return row as unknown as DayRecord;
}

/** Writes the day's buckets beside the journal; the rename makes the whole file appear at once. */
export async function writeDay(folder: string, file: string, buckets: StoredBucket[]) {
  await fs.promises.mkdir(folder, { recursive: true });
  const temporary = path.join(folder, file + '.tmp');
  const data = await gzip(buckets.map(bucket => JSON.stringify(bucket) + '\n').join(''));
  const handle = await fs.promises.open(temporary, 'w');
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
  await fs.promises.rename(temporary, path.join(folder, file));
}

/** A day's buckets. A malformed line costs that bucket, reported through `warn`. */
export async function readDay(folder: string, file: string, warn: (error: unknown) => void): Promise<StoredBucket[]> {
  const text = (await gunzip(await fs.promises.readFile(path.join(folder, file)))).toString('utf8');
  const buckets: StoredBucket[] = [];
  for (const line of text.split('\n')) if (line) {
    try { buckets.push(storedBucket(JSON.parse(line))); } catch (error) { warn(Error(`Skipped a saved metrics bucket in ${file}: ${(error as Error).message}`)); }
  }
  return buckets;
}

export async function removeDay(folder: string, file: string) {
  await fs.promises.rm(path.join(folder, file), { force: true });
}

/** Removes every file no record names: a write or a roll that a crash cut short. */
export function removeUnnamed(folder: string, named: Set<string>) {
  if (!fs.existsSync(folder)) return;
  for (const file of fs.readdirSync(folder)) if (!named.has(file)) fs.rmSync(path.join(folder, file), { force: true });
}
