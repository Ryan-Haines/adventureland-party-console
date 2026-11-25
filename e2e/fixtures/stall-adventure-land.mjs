// The dashboard server's every fetch of adventure.land never answers, as in final-gate-closing12's
// stall (REVIEW-QUEUE TW-D1); its abort, if the caller passes one, ends it. Every other fetch goes
// through.
const fetchThrough = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://adventure.land') return fetchThrough(input, init);
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  return new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
};
