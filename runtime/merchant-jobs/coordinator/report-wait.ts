// The job owner's waits for a member's report on the coordinator. Each report (the status owner's
// `status.received`, which the job source answers) runs every watch with the reporting member's
// name, so a retry or a recheck that waits for new word from a member runs when that word arrives.
// A watch answers true once it is done, and the wake drops it then.
type Watch = (character: string) => boolean;

const watches = new Set<Watch>();

/** A member's report arrived: every watch reads its state again. */
export function wakeJobWaits(character: string): void {
  for (const watch of [...watches]) if (watch(character)) watches.delete(watch);
}

/** Runs `watch` at each member report until it answers true. */
export function watchReports(watch: Watch): void { watches.add(watch); }
