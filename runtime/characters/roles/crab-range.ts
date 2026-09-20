export interface RangeSample {
  targetId: string; map: string; mtype: string; at: number; range: number;
  actor: { x: number; y: number; width: number; height: number };
  target: { x: number; y: number; width: number; height: number };
  expected: { width: number; height: number };
  nativeDistance: number; correctedDistance: number;
}
export interface RangeDiagnostic {
  active: boolean; expiresAt: number; reason: string;
  sample: RangeSample; rejection: unknown;
}
function mismatch(s: RangeSample): boolean {
  return s.mtype === "crab" &&
    [s.target.width, s.target.height, s.expected.width, s.expected.height,
      s.nativeDistance, s.correctedDistance].every(Number.isFinite) &&
    (s.target.width > s.expected.width + 1 || s.target.height > s.expected.height + 1);
}
export function createCrabRangeRecovery() {
  let diagnostic: RangeDiagnostic | null = null;
  let retryAt = 0;
  function reset(reason = "target changed"): void {
    retryAt = 0;
    if (diagnostic) { diagnostic.active = false; diagnostic.reason = reason; }
  }
  function distance(sample: RangeSample | null, now: number): number | null {
    if (!sample) return null;
    if (!diagnostic?.active) return null;
    if (sample.targetId !== diagnostic.sample.targetId || sample.map !== diagnostic.sample.map) return null;
    else if (now >= diagnostic.expiresAt) reset("expired; probing native behavior");
    else if (!mismatch(sample)) reset("native geometry agrees");
    return diagnostic.active ? sample.correctedDistance : null;
  }
  return {
    reset, distance,
    select(sample: RangeSample | null, now: number): void {
      if (diagnostic && (sample?.targetId !== diagnostic.sample.targetId || sample?.map !== diagnostic.sample.map)) reset();
      distance(sample, now);
    },
    diagnostic: () => diagnostic,
    blocked(sample: RangeSample | null, now: number): boolean {
      const corrected = distance(sample, now);
      return corrected !== null && (now < retryAt || corrected > sample!.range);
    },
    reject(sample: RangeSample, rejection: unknown, now: number): void {
      if (!mismatch(sample) || sample.nativeDistance > sample.range || sample.correctedDistance <= sample.range) return;
      if (!diagnostic?.active || now >= diagnostic.expiresAt) {
        diagnostic = { active: true, expiresAt: now + 30000, reason: "crab geometry mismatch", sample, rejection };
      } else { diagnostic.sample = sample; diagnostic.rejection = rejection; }
      retryAt = now + 500;
    },
  };
}
