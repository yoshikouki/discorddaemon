import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG_DIR } from "./config";

export const DEFAULT_PID_PATH = join(DEFAULT_CONFIG_DIR, "ddd.pid");
export const DEFAULT_LOG_PATH = join(DEFAULT_CONFIG_DIR, "ddd.log");

export async function writePid(
  pid: number,
  pidPath = DEFAULT_PID_PATH
): Promise<void> {
  await Bun.write(pidPath, String(pid));
}

export async function readPid(
  pidPath = DEFAULT_PID_PATH
): Promise<number | null> {
  const file = Bun.file(pidPath);
  if (!(await file.exists())) {
    return null;
  }
  const text = await file.text();
  const pid = Number.parseInt(text.trim(), 10);
  if (Number.isNaN(pid)) {
    return null;
  }
  return pid;
}

export async function removePid(pidPath = DEFAULT_PID_PATH): Promise<void> {
  try {
    await unlink(pidPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
