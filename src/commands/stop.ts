import { isProcessRunning, readPid, removePid } from "../pid";

function log(msg: string): void {
  console.error(`[ddd] ${msg}`);
}

export interface StopDeps {
  isProcessRunning?: typeof isProcessRunning;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  readPid?: typeof readPid;
  removePid?: typeof removePid;
  sleep?: (ms: number) => Promise<void>;
}

export async function stopCommand(deps: StopDeps = {}): Promise<void> {
  const kill = deps.kill ?? ((pid, sig) => process.kill(pid, sig));
  const read = deps.readPid ?? readPid;
  const remove = deps.removePid ?? removePid;
  const alive = deps.isProcessRunning ?? isProcessRunning;
  const sleep = deps.sleep ?? ((ms: number) => Bun.sleep(ms));

  const pid = await read();
  if (pid === null) {
    throw new Error("No PID file found. Daemon may not be running.");
  }

  if (!alive(pid)) {
    await remove();
    throw new Error(
      `Daemon is not running (stale PID file cleaned up, was PID ${pid})`
    );
  }

  kill(pid, "SIGTERM");
  log(`Sent SIGTERM to PID ${pid}`);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await sleep(500);
    if (!alive(pid)) {
      await remove();
      log(`Daemon stopped (PID: ${pid})`);
      return;
    }
  }

  kill(pid, "SIGKILL");
  log(`Sent SIGKILL to PID ${pid} (did not exit within 10s)`);
  await sleep(1000);
  await remove();
  log(`Daemon stopped (PID: ${pid})`);
}
