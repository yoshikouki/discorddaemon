import { IpcClient } from "../ipc/client";
import type { DaemonInfoResult } from "../ipc/protocol";
import { ConnectionRefusedError } from "../ipc/protocol";
import { inspectRuntimeState } from "../runtime";

export interface StatusDeps {
  exit?: (code: number) => void;
  fetchInfo?: () => Promise<DaemonInfoResult | null>;
  inspectRuntimeState?: typeof inspectRuntimeState;
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

export async function statusCommand(deps: StatusDeps = {}): Promise<void> {
  const exit = deps.exit ?? process.exit;
  const fetchInfo = deps.fetchInfo ?? defaultFetchInfo;
  const inspect = deps.inspectRuntimeState ?? inspectRuntimeState;

  const state = await inspect();

  if (state.pid === null) {
    if (state.socketExists && state.socketConnectable === false) {
      console.error("[ddd] Daemon is not running (stale socket file present)");
    } else {
      console.error("[ddd] Daemon is not running");
    }
    exit(1);
    return;
  }

  if (!state.pidAlive) {
    if (state.socketExists && state.socketConnectable === false) {
      console.error(
        "[ddd] Daemon is not running (stale PID and socket files present)"
      );
    } else {
      console.error("[ddd] Daemon is not running (stale PID file present)");
    }
    exit(1);
    return;
  }

  console.error(`[ddd] Daemon is running (PID: ${state.pid})`);

  const info = await fetchInfo();
  if (info) {
    printDaemonInfo(info);
  }

  exit(0);
}
