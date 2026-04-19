import { existsSync, unlinkSync } from "node:fs";
import { PID_PATH, SOCKET_PATH } from "./paths";
import { isProcessRunning, readPid, removePid } from "./pid";

const SOCKET_PROBE_TIMEOUT_MS = 500;

export interface RuntimeCleanupResult {
  pidRemoved: boolean;
  socketRemoved: boolean;
}

export interface RuntimeState {
  pid: number | null;
  pidAlive: boolean;
  socketConnectable: boolean | null;
  socketExists: boolean;
}

export async function inspectRuntimeState(opts?: {
  pidPath?: string;
  socketPath?: string;
}): Promise<RuntimeState> {
  const pidPath = opts?.pidPath ?? PID_PATH;
  const socketPath = opts?.socketPath ?? SOCKET_PATH;

  const pid = await readPid(pidPath);
  const pidAlive = pid !== null && isProcessRunning(pid);
  const socketExists = existsSync(socketPath);
  const socketConnectable = socketExists
    ? await isSocketConnectable(socketPath)
    : null;

  return {
    pid,
    pidAlive,
    socketConnectable,
    socketExists,
  };
}

export async function cleanupStaleRuntimeState(opts?: {
  pidPath?: string;
  socketPath?: string;
}): Promise<RuntimeCleanupResult> {
  const pidPath = opts?.pidPath ?? PID_PATH;
  const socketPath = opts?.socketPath ?? SOCKET_PATH;

  const pid = await readPid(pidPath);
  if (pid === null) {
    let socketRemoved = false;
    if (existsSync(socketPath) && !(await isSocketConnectable(socketPath))) {
      unlinkSync(socketPath);
      socketRemoved = true;
    }
    return { pidRemoved: false, socketRemoved };
  }

  if (isProcessRunning(pid)) {
    return { pidRemoved: false, socketRemoved: false };
  }

  await removePid(pidPath);

  let socketRemoved = false;
  if (existsSync(socketPath) && !(await isSocketConnectable(socketPath))) {
    unlinkSync(socketPath);
    socketRemoved = true;
  }

  return { pidRemoved: true, socketRemoved };
}

function isSocketConnectable(socketPath: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), SOCKET_PROBE_TIMEOUT_MS);

    Bun.connect({
      unix: socketPath,
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
          // intentionally empty — we only need to know whether the socket is live
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
