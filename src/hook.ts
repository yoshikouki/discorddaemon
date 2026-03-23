import { resolve } from "node:path";
import type { HookInput, HookResult } from "./types";

const DEFAULT_TIMEOUT = 30_000;

export async function executeHook(
  scriptPath: string,
  input: HookInput,
  options?: { timeout?: number; signal?: AbortSignal }
): Promise<HookResult> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const resolvedPath = resolve(scriptPath);

  const proc = Bun.spawn([resolvedPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout,
    signal: options?.signal,
  });

  const json = JSON.stringify(input);
  proc.stdin.write(json);
  proc.stdin.end();

  const [output, error, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const timedOut = proc.killed && exitCode === null;

  return {
    success: exitCode === 0,
    output: output.trimEnd(),
    error: error.trimEnd(),
    exitCode: exitCode ?? 1,
    timedOut,
  };
}
