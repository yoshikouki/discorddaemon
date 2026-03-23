import type { HookInput, HookResult } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

export async function executeHook(
  hookPath: string,
  input: HookInput,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<HookResult> {
  const proc = Bun.spawn([hookPath], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Write JSON to stdin
  const payload = JSON.stringify(input);
  proc.stdin.write(payload);
  proc.stdin.end();

  // Race between process completion and timeout
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => {
      proc.kill();
      reject(new Error(`Hook timed out after ${timeoutMs}ms: ${hookPath}`));
    }, timeoutMs)
  );

  try {
    const exitCode = await Promise.race([proc.exited, timeout]);
    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      console.error(
        `[hook] ${hookPath} exited with code ${exitCode}: ${stderr}`
      );
    }

    return {
      success: exitCode === 0,
      output: output.trim(),
      exitCode: exitCode as number,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[hook] ${hookPath}: ${message}`);
    return {
      success: false,
      output: "",
      exitCode: 1,
    };
  }
}
