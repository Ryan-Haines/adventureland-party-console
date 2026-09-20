/** Only fresh casting observations reserve the merchant; old clients remain compatible. */
export function gatheringCastActive(status: {
  seenAt: number;
  gatheringPhase?: string;
} | null | undefined, now: number): boolean {
  return !!status && status.seenAt >= now - 10_000 && status.gatheringPhase === "casting";
}
