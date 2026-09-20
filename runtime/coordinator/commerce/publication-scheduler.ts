/** Batch nearby listing changes into one publish without delaying the first scheduled attempt. */
export function createPublicationScheduler<T>(
  state: { publishTimer: T | null },
  ports: {
    later(callback: () => void, delay: number): T;
    publish(): unknown;
  },
) {
  function schedule(): void {
    if (state.publishTimer) return;
    state.publishTimer = ports.later(() => {
      state.publishTimer = null;
      ports.publish();
    }, 5000);
  }
  return { schedule };
}
