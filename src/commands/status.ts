import { isProcessRunning, readPid, removePid } from "../pid";

export interface StatusDeps {
  exit?: (code: number) => void;
  isProcessRunning?: typeof isProcessRunning;
  readPid?: typeof readPid;
  removePid?: typeof removePid;
}

export async function statusCommand(deps: StatusDeps = {}): Promise<void> {
  const read = deps.readPid ?? readPid;
  const remove = deps.removePid ?? removePid;
  const alive = deps.isProcessRunning ?? isProcessRunning;
  const exit = deps.exit ?? process.exit;

  const pid = await read();
  if (pid === null) {
    console.error("[ddd] Daemon is not running");
    exit(1);
    return;
  }

  if (!alive(pid)) {
    await remove();
    console.error("[ddd] Daemon is not running (stale PID file removed)");
    exit(1);
    return;
  }

  console.error(`[ddd] Daemon is running (PID: ${pid})`);
  exit(0);
}
