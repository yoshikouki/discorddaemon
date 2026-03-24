import { openSync } from "node:fs";
import { loadConfig } from "../config";
import { Daemon } from "../daemon";
import {
  DEFAULT_LOG_PATH,
  isProcessRunning,
  readPid,
  removePid,
  writePid,
} from "../pid";

function log(msg: string): void {
  console.error(`[ddd] ${msg}`);
}

export function startCommand(args: {
  config?: string;
  foreground?: boolean;
}): Promise<void> {
  if (args.foreground) {
    return startForeground(args);
  }
  return startDaemon(args);
}

async function startForeground(args: { config?: string }): Promise<void> {
  // Ignore SIGHUP so the process survives terminal close
  process.on("SIGHUP", () => {
    // intentionally ignored for daemon resilience
  });

  const config = await loadConfig(args.config);
  const daemon = new Daemon(config);

  await writePid(process.pid);

  const shutdown = () => {
    daemon.stop();
    removePid().catch(() => {
      // best-effort cleanup
    });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await daemon.start();
}

async function startDaemon(args: { config?: string }): Promise<void> {
  // Check for already running daemon
  const existingPid = await readPid();
  if (existingPid !== null && isProcessRunning(existingPid)) {
    throw new Error(`Daemon already running (PID: ${existingPid})`);
  }

  // Validate config before spawning (fail fast)
  await loadConfig(args.config);

  // Open log file in append mode
  const logFd = openSync(DEFAULT_LOG_PATH, "a");

  const configArgs = args.config ? ["-c", args.config] : [];
  const child = Bun.spawn(
    ["bun", "run", process.argv[1], "start", "--foreground", ...configArgs],
    {
      stdin: "ignore",
      stdout: logFd,
      stderr: logFd,
    }
  );

  // Health check: wait briefly and verify child didn't crash immediately
  await Bun.sleep(2000);

  if (!isProcessRunning(child.pid)) {
    await removePid();
    throw new Error(`Daemon failed to start. Check log: ${DEFAULT_LOG_PATH}`);
  }

  log(`Daemon started (PID: ${child.pid})`);
  log(`Log: ${DEFAULT_LOG_PATH}`);
  process.exit(0);
}
