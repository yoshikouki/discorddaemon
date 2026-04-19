import { IpcClient } from "../ipc/client";
import type { DaemonInfoResult } from "../ipc/protocol";
import { ConnectionRefusedError } from "../ipc/protocol";
import { inspectRuntimeState } from "../runtime";
import {
  resolveServiceManager as resolveServiceManagerImpl,
  type ServiceManager,
} from "../service-manager";

export interface StatusDeps {
  exit?: (code: number) => void;
  fetchInfo?: () => Promise<DaemonInfoResult | null>;
  inspectRuntimeState?: typeof inspectRuntimeState;
  resolveServiceManager?: typeof resolveServiceManagerImpl;
  serviceManager?: ServiceManager | null;
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) {
    parts.push(`${h}h`);
  }
  if (m > 0) {
    parts.push(`${m}m`);
  }
  parts.push(`${s}s`);
  return parts.join(" ");
}

async function defaultFetchInfo(): Promise<DaemonInfoResult | null> {
  try {
    const client = new IpcClient();
    return await client.call<DaemonInfoResult>("daemon/info", {});
  } catch (err: unknown) {
    if (err instanceof ConnectionRefusedError) {
      return null;
    }
    return null;
  }
}

function printDaemonInfo(info: DaemonInfoResult): void {
  console.error(`[ddd]   Uptime: ${formatUptime(info.uptime)}`);
  if (info.channelsWatched != null) {
    console.error(`[ddd]   Channels: ${info.channelsWatched}`);
  }
  if (info.messagesReceived != null) {
    console.error(`[ddd]   Messages: ${info.messagesReceived}`);
  }
  if (info.hooksExecuted != null) {
    console.error(`[ddd]   Hooks executed: ${info.hooksExecuted}`);
  }
  if (info.hookErrors != null) {
    console.error(`[ddd]   Errors: ${info.hookErrors}`);
  }
  if (info.repliesSent != null) {
    console.error(`[ddd]   Replies sent: ${info.repliesSent}`);
  }
  if (info.lastEventTime) {
    console.error(`[ddd]   Last event: ${info.lastEventTime}`);
  }
}

function printManagedServiceState(state: {
  message?: string;
  pid?: number;
  running: boolean;
}): void {
  if (!state.running) {
    console.error(
      state.message
        ? `[ddd] Daemon is not running (${state.message})`
        : "[ddd] Daemon is not running"
    );
    return;
  }

  if (state.pid == null) {
    console.error("[ddd] Daemon is running");
    return;
  }

  console.error(`[ddd] Daemon is running (PID: ${state.pid})`);
}

function printLegacyRuntimeState(
  state: Awaited<ReturnType<typeof inspectRuntimeState>>
): boolean {
  if (state.pid === null) {
    if (state.socketExists && state.socketConnectable === false) {
      console.error("[ddd] Daemon is not running (stale socket file present)");
    } else {
      console.error("[ddd] Daemon is not running");
    }
    return false;
  }

  if (!state.pidAlive) {
    if (state.socketExists && state.socketConnectable === false) {
      console.error(
        "[ddd] Daemon is not running (stale PID and socket files present)"
      );
    } else {
      console.error("[ddd] Daemon is not running (stale PID file present)");
    }
    return false;
  }

  console.error(`[ddd] Daemon is running (PID: ${state.pid})`);
  return true;
}

async function printCurrentStatus(
  fetchInfo: () => Promise<DaemonInfoResult | null>,
  exit: (code: number) => void,
  isRunning: boolean
): Promise<void> {
  if (!isRunning) {
    exit(1);
    return;
  }

  const info = await fetchInfo();
  if (info) {
    printDaemonInfo(info);
  }

  exit(0);
}

export async function statusCommand(deps: StatusDeps = {}): Promise<void> {
  const exit = deps.exit ?? process.exit;
  const fetchInfo = deps.fetchInfo ?? defaultFetchInfo;
  const resolveServiceManager =
    deps.resolveServiceManager ?? resolveServiceManagerImpl;
  const serviceManager = deps.serviceManager ?? (await resolveServiceManager());

  if (serviceManager) {
    const state = await serviceManager.status();
    printManagedServiceState(state);
    await printCurrentStatus(fetchInfo, exit, state.running);
    return;
  }

  const inspect = deps.inspectRuntimeState ?? inspectRuntimeState;
  const state = await inspect();
  await printCurrentStatus(fetchInfo, exit, printLegacyRuntimeState(state));
}
