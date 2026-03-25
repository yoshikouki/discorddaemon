import { existsSync } from "node:fs";
import { SOCKET_PATH } from "../paths";
import { isProcessRunning, readPid } from "../pid";
import { IpcClient } from "./client";
import type { DaemonInfoResult } from "./protocol";

const PROBE_TIMEOUT_MS = 500;

export interface ProbeResult {
  available: boolean;
  socketPath: string;
}

export async function probeDaemon(cliToken?: string): Promise<ProbeResult> {
  const unavailable = { available: false, socketPath: SOCKET_PATH };

  // Step 1: PID file exists and process is alive?
  const pid = await readPid();
  if (pid === null || !isProcessRunning(pid)) {
    return unavailable;
  }

  // Step 2: Socket file exists?
  if (!existsSync(SOCKET_PATH)) {
    return unavailable;
  }

  // Step 3: Can we actually connect? (guards against stale socket)
  try {
    const reachable = await probeSocket();
    if (!reachable) {
      return unavailable;
    }
  } catch {
    return unavailable;
  }

  // Step 4: Token verification via daemon/info
  if (cliToken) {
    try {
      const client = new IpcClient();
      const info = await client.call<DaemonInfoResult>("daemon/info", {});
      const hash = new Bun.CryptoHasher("sha256")
        .update(cliToken)
        .digest("hex");
      const cliFingerprint = hash.slice(0, 8);
      if (info.tokenFingerprint !== cliFingerprint) {
        console.error(
          "[ddd] Token mismatch: daemon uses a different bot token — falling back to one-shot"
        );
        return unavailable;
      }
    } catch {
      return unavailable;
    }
  }

  return { available: true, socketPath: SOCKET_PATH };
}

function probeSocket(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);

    Bun.connect({
      unix: SOCKET_PATH,
      socket: {
        open(socket) {
          clearTimeout(timeout);
          socket.end();
          resolve(true);
        },
        error() {
          clearTimeout(timeout);
          resolve(false);
        },
        data() {
          // intentionally empty — we only need to detect connection
        },
        close() {
          // intentionally empty — handled by open/error
        },
      },
    }).catch(() => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}
