import { unlink } from "node:fs/promises";
import { PID_PATH } from "./paths";

export async function writePid(pid: number, pidPath = PID_PATH): Promise<void> {
  await Bun.write(pidPath, String(pid));
}

export async function readPid(pidPath = PID_PATH): Promise<number | null> {
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

export async function removePid(pidPath = PID_PATH): Promise<void> {
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
