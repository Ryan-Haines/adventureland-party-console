import type { CaveCommand, CaveObservation } from "../dungeons/contracts.ts";

export interface DungeonReceipt {
  id: string;
  status: "dispatched" | "complete" | "uncertain" | "failed";
  error?: string;
  command?: CaveCommand;
}
export interface DungeonJournal {
  entries: DungeonReceipt[];
}

/** Persist before dispatch. Retain unresolved receipts across later commands and reloads. */
export function createDungeonJournal(
  read: () => DungeonJournal | DungeonReceipt | null,
  write: (value: DungeonJournal) => void,
) {
  const saved = read();
  let entries = saved && "entries" in saved ? saved.entries : saved ? [saved] : [];
  const unresolved = (entry: DungeonReceipt) =>
    entry.status === "dispatched" || entry.status === "uncertain";
  function save(command: CaveCommand, status: DungeonReceipt["status"], error?: string) {
    const next = [
      ...entries.filter((entry) => entry.id !== command.id),
      { id: command.id, command, status, error },
    ];
    const retained = next.filter((entry, index) => unresolved(entry) || index >= next.length - 200);
    write({ entries: retained });
    entries = retained;
  }
  function reconcile(cave: CaveObservation["cave"], name: string, resume?: { run?: string }) {
    for (const entry of entries.filter(unresolved)) {
      const command = entry.command;
      if (!command) continue;
      const sameRun = cave?.run === command.run;
      const entered = command.action === "enter" && (!!cave || !!resume?.run);
      const exited = command.action === "exit" && !cave;
      const voted =
        command.action === "vote" &&
        sameRun &&
        cave?.choice?.id === command.choice &&
        cave?.choice?.votes[name] === command.option;
      const bought =
        command.action === "buy" &&
        sameRun &&
        cave?.choice?.id === command.choice &&
        cave?.choice?.shop?.room === command.room &&
        cave?.choice?.shop?.sold;
      const revival =
        command.action === "revival" &&
        sameRun &&
        !!cave?.choice &&
        cave.choice.id !== command.choice;
      if (entered || exited || voted || bought || revival) save(command, "complete");
    }
  }
  return {
    save,
    reconcile,
    get: (id?: string) => entries.find((entry) => entry.id === id),
    latest: () => entries.at(-1),
    blocked: (command?: CaveCommand) =>
      entries.some(
        (entry) =>
          unresolved(entry) &&
          (!command || !entry.command?.run || entry.command.run === command.run),
      ),
  };
}
