import { spawn, type ChildProcess } from "node:child_process";
import { gatewayHeaders } from './gateway-access.ts';

export function launch(
  script: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  return spawn(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
}

export function completed(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Process exited with code ${code}`)),
    );
  });
}

export async function stop(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => resolve());
      killer.once("exit", () => resolve());
    });
  } else {
    child.kill("SIGTERM");
  }
}

export async function waitForHealthy(
  child: ChildProcess,
  port: number,
  deadlineMs = 120_000,
): Promise<void> {
  let startupError: Error | undefined;
  const onError = (error: Error) => {
    startupError = error;
  };
  child.on("error", onError);
  const deadline = Date.now() + deadlineMs;
  try {
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (child.exitCode !== null) throw new Error("Dashboard exited before it became healthy");
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, {
          headers: gatewayHeaders(),
          signal: AbortSignal.timeout(15_000),
        });
        await response.body?.cancel();
        if (response.ok) return;
      } catch {
        /* Startup compilation may still be in progress. */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Dashboard did not become healthy within two minutes");
  } finally {
    child.off("error", onError);
  }
}
