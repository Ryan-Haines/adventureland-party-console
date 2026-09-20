/** Recovery credit is earned only from observed MP, never predicted refunds. */
export function createManaBudget() {
  let last: { at: number; mp: number } | null = null;
  let credit = 0;
  const recovery: { at: number; amount: number }[] = [];
  return {
    observe(now: number, mp: number, surplus: number, cap: number) {
      if (!last) credit = cap;
      else {
        // A cast acknowledgement can precede the MP update. Only positive
        // observed deltas earn credit; never infer a refill from an ack.
        const recovered = Math.max(0, mp - last.mp);
        if (recovered) recovery.push({ at: now, amount: recovered });
        while (recovery.length && recovery[0].at < now - 30000) recovery.shift();
        const rate = recovery.reduce((sum, r) => sum + r.amount, 0) / 30 + Math.max(0, surplus) / 30;
        credit += Math.max(0, Math.min(30, (now - last.at) / 1000)) * rate;
      }
      credit = Math.min(Math.max(0, cap), credit);
      last = { at: now, mp };
      return credit;
    },
    debit(amount: number) { credit = Math.max(0, credit - amount); },
    reset() { last = null; credit = 0; recovery.length = 0; },
  };
}
