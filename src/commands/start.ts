import { mkdirSync, openSync } from "node:fs";
import { createAuditWriter } from "../audit";
import { loadConfig } from "../config";
import { Daemon } from "../daemon";
import { createLogger } from "../logger";
import { DATA_DIR, LOG_PATH } from "../paths";
import { isProcessRunning, readPid, removePid, writePid } from "../pid";
import { StatsTracker } from "../stats";

function log(msg: string): void {
  console.error(`[ddd] ${msg}`);
}

export async function runForegroundLoop(
  daemon: { start: () => Promise<void> },
  waitForShutdown: () => Promise<void>
): Promise<void> {
  const keepAliveIntervalMs = 1_073_741_824;
  const keepAlive = setInterval(() => {
    // Intentionally empty: keeps the Bun event loop alive while the daemon runs.
  }, keepAliveIntervalMs);
  try {
    await daemon.start();
    await waitForShutdown();
  } finally {
    clearInterval(keepAlive);
  }
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
  const logger = createLogger({
    mode: process.stderr.isTTY ? "human" : "json",
  });
  const audit = createAuditWriter();
  const stats = new StatsTracker(config.channels.size);
  const daemon = new Daemon(config, undefined, { logger, audit, stats });

  mkdirSync(DATA_DIR, { recursive: true });
  await writePid(process.pid);

  const waitForShutdown = () =>
    new Promise<void>((resolve) => {
      const shutdown = () => {
        daemon.stop();
        removePid().catch(() => {
          // best-effort cleanup
        });
        resolve();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  await runForegroundLoop(daemon, waitForShutdown);
}

async function startDaemon(args: { config?: string }): Promise<void> {
  // Check for already running daemon
  const existingPid = await readPid();
  if (existingPid !== null && isProcessRunning(existingPid)) {
    throw new Error(`Daemon already running (PID: ${existingPid})`);
  }

  // Validate config before spawning (fail fast)
  await loadConfig(args.config);

  // Ensure data directory exists and open log file
  mkdirSync(DATA_DIR, { recursive: true });
  const logFd = openSync(LOG_PATH, "a");

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
    throw new Error(`Daemon failed to start. Check log: ${LOG_PATH}`);
  }

  log(`Daemon started (PID: ${child.pid})`);
  log(`Log: ${LOG_PATH}`);
  process.exit(0);
}
