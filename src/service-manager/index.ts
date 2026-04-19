import { isProcessRunning, readPid, removePid } from "../pid";
import { inspectRuntimeState } from "../runtime";
import {
  createLaunchdServiceManager as createLaunchdServiceManagerImpl,
  isLaunchdContext as isLaunchdContextImpl,
} from "./adapters/launchd";
import {
  createLegacyServiceManager as createLegacyServiceManagerImpl,
  isLegacyContext as isLegacyContextImpl,
} from "./adapters/legacy";
import {
  createSystemdUserServiceManager as createSystemdUserServiceManagerImpl,
  isSystemdUserContext as isSystemdUserContextImpl,
} from "./adapters/systemd-user";
import { getDefaultServiceManagerContext } from "./context";
import {
  detectServiceManager as detectServiceManagerImpl,
  listServiceManagers as listServiceManagersImpl,
} from "./detect";
import {
  healthFromRuntime as healthFromRuntimeImpl,
  socketStateFromRuntime as socketStateFromRuntimeImpl,
  toServiceStatus as toServiceStatusImpl,
} from "./status";
import type {
  ServiceHealth as ServiceHealthImpl,
  ServiceManagerContext as ServiceManagerContextImpl,
  ServiceManagerKind as ServiceManagerKindImpl,
  ServiceSocketState as ServiceSocketStateImpl,
  ServiceStatus as ServiceStatusImpl,
} from "./types";

export interface ServiceManagerStatus {
  kind?: ServiceStatusImpl["kind"];
  message?: string;
  pid?: number;
  running: boolean;
  socketState?: ServiceSocketStateImpl;
  state?: ServiceHealthImpl;
}

export interface ServiceManager {
  start: () => Promise<void>;
  status: () => Promise<ServiceManagerStatus>;
  stop: () => Promise<void>;
}

function log(msg: string): void {
  console.error(`[ddd] ${msg}`);
}

function runtimeMessageFromStatus(
  status: ReturnType<typeof toServiceStatusImpl>
) {
  if (status.health === "stale") {
    if (status.socketState === "stale") {
      return status.pid === null
        ? "stale socket file present"
        : "stale PID and socket files present";
    }

    return "stale PID file present";
  }
  return undefined;
}

async function startManagedForeground(): Promise<void> {
  const { startCommand } = await import("../commands/start");
  await startCommand({ foreground: true });
}

async function stopManagedRuntime(): Promise<void> {
  const pid = await readPid();
  if (pid === null) {
    throw new Error("No PID file found. Daemon may not be running.");
  }

  if (!isProcessRunning(pid)) {
    await removePid();
    throw new Error(
      `Daemon is not running (stale PID file cleaned up, was PID ${pid})`
    );
  }

  process.kill(pid, "SIGTERM");
  log(`Sent SIGTERM to PID ${pid}`);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await Bun.sleep(500);
    if (!isProcessRunning(pid)) {
      await removePid();
      log(`Daemon stopped (PID: ${pid})`);
      return;
    }
  }

  process.kill(pid, "SIGKILL");
  log(`Sent SIGKILL to PID ${pid} (did not exit within 10s)`);
  await Bun.sleep(1000);
  await removePid();
  log(`Daemon stopped (PID: ${pid})`);
}

function createManagedServiceManager(
  kind: ServiceManagerKindImpl
): ServiceManager {
  return {
    kind,
    start: startManagedForeground,
    async status() {
      const runtime = await inspectRuntimeState();
      const status = toServiceStatusImpl(kind, runtime);

      return {
        kind,
        pid: status.pid ?? undefined,
        running: status.health === "running" || status.health === "degraded",
        socketState: status.socketState,
        state: status.health,
        message: runtimeMessageFromStatus(status),
      };
    },
    stop: stopManagedRuntime,
  };
}

export function resolveServiceManager(
  context: ServiceManagerContextImpl = getDefaultServiceManagerContext()
): Promise<ServiceManager | null> {
  const detected = detectServiceManagerImpl(context);
  if (detected.kind === "legacy") {
    return Promise.resolve(null);
  }

  return Promise.resolve(createManagedServiceManager(detected.kind));
}

export function createLaunchdServiceManager() {
  return createLaunchdServiceManagerImpl();
}

export function createLegacyServiceManager() {
  return createLegacyServiceManagerImpl();
}

export function createSystemdUserServiceManager() {
  return createSystemdUserServiceManagerImpl();
}

export function detectServiceManager(
  context: ServiceManagerContextImpl
): ReturnType<typeof detectServiceManagerImpl> {
  return detectServiceManagerImpl(context);
}

export function listServiceManagers() {
  return listServiceManagersImpl();
}

export function isLaunchdContext(context: {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}) {
  return isLaunchdContextImpl(context);
}

export function isLegacyContext(context: ServiceManagerContextImpl) {
  return isLegacyContextImpl(context);
}

export function isSystemdUserContext(context: {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}) {
  return isSystemdUserContextImpl(context);
}

export function healthFromRuntime(
  runtime: Parameters<typeof healthFromRuntimeImpl>[0]
): ReturnType<typeof healthFromRuntimeImpl> {
  return healthFromRuntimeImpl(runtime);
}

export function socketStateFromRuntime(
  runtime: Parameters<typeof socketStateFromRuntimeImpl>[0]
): ReturnType<typeof socketStateFromRuntimeImpl> {
  return socketStateFromRuntimeImpl(runtime);
}

export function toServiceStatus(
  kind: ServiceManagerKindImpl,
  runtime: Parameters<typeof toServiceStatusImpl>[1]
): ReturnType<typeof toServiceStatusImpl> {
  return toServiceStatusImpl(kind, runtime);
}

export type ServiceHealth = ServiceHealthImpl;
export type ServiceManagerContext = ServiceManagerContextImpl;
export type ServiceManagerKind = ServiceManagerKindImpl;
export type ServiceSocketState = ServiceSocketStateImpl;
export type ServiceStatus = ServiceStatusImpl;
