import { dirname, resolve } from "node:path";
import type { HookInput, HookResult } from "./types";

const DEFAULT_TIMEOUT = 30_000;

export async function executeHook(
  scriptPath: string,
  input: HookInput,
  options?: { timeout?: number; signal?: AbortSignal; cwd?: string }
): Promise<HookResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const resolvedPath = options?.cwd
    ? resolve(options.cwd, scriptPath)
    : resolve(scriptPath);

  const proc = Bun.spawn([resolvedPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout,
    cwd: dirname(resolvedPath),
  });

  const signal = options?.signal;
  const onAbort = () => proc.kill();
  signal?.addEventListener("abort", onAbort);

  const json = JSON.stringify(input);
  proc.stdin.write(json);
  proc.stdin.end();

  const exitCode = await proc.exited;
  signal?.removeEventListener("abort", onAbort);
  // Both timeout and AbortSignal kill set signalCode; we check signal.aborted
  // to distinguish them. If both fire simultaneously, timedOut may be false,
  // which is acceptable since this only affects logging.
  const timedOut = proc.signalCode !== null && !signal?.aborted;
  const killed = proc.signalCode !== null;

  const output = killed ? "" : await new Response(proc.stdout).text();
  const error = killed ? "" : await new Response(proc.stderr).text();

  return {
    success: exitCode === 0,
    output: output.trimEnd(),
    error: error.trimEnd(),
    exitCode: exitCode ?? 1,
    timedOut,
  };
}
