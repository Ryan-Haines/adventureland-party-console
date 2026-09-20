import { randomUUID } from "node:crypto";
import type { ChildProcess } from "node:child_process";

export type ReloadResult = {
  status: "ready" | "busy" | "failed";
  error?: string;
  restartRequired?: boolean;
};

/** A worker exit, IPC error, stale acknowledgement, and timeout are distinct outcomes. */
export function requestReload(
  worker: ChildProcess,
  generation: string,
  timeoutMs = 15000,
  script?: string,
): Promise<ReloadResult> {
  const id = randomUUID();
  return new Promise((resolve) => {
    const finish = (result: ReloadResult) => {
      clearTimeout(timer);
      worker.off("message", onMessage);
      worker.off("exit", onExit);
      resolve(result);
    };
    const onMessage = (message: unknown) => {
      if (!message || typeof message !== "object") return;
      const value = message as Record<string, unknown>;
      if (value.type !== "code_reload_result" || value.id !== id || value.generation !== generation)
        return;
      if (value.status === "ready" || value.status === "busy" || value.status === "failed")
        finish({
          status: value.status,
          error: typeof value.error === "string" ? value.error : undefined,
          restartRequired: value.restartRequired === true,
        });
    };
    const onExit = () =>
      finish({
        status: "failed",
        restartRequired: true,
        error: "worker exited during CODE reload",
      });
    const timer = setTimeout(
      () =>
        finish({
          status: "failed",
          restartRequired: true,
          error: "CODE reload acknowledgement timed out",
        }),
      timeoutMs,
    );
    worker.on("message", onMessage);
    worker.once("exit", onExit);
    try {
      worker.send({ type: "reload_code", id, generation, script }, (error: Error | null) => {
        if (error) finish({ status: "failed", restartRequired: true, error: error.message });
      });
    } catch (error) {
      finish({ status: "failed", restartRequired: true, error: String(error) });
    }
  });
}
