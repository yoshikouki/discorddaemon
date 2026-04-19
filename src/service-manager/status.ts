import type { RuntimeState } from "../runtime";
import type {
  ServiceHealth,
  ServiceManagerKind,
  ServiceSocketState,
  ServiceStatus,
} from "./types";

export function socketStateFromRuntime(
  runtime: Pick<RuntimeState, "socketConnectable" | "socketExists">
): ServiceSocketState {
  if (!runtime.socketExists) {
    return "missing";
  }
  return runtime.socketConnectable ? "live" : "stale";
}

export function healthFromRuntime(
  runtime: Pick<
    RuntimeState,
    "pid" | "pidAlive" | "socketConnectable" | "socketExists"
  >
): ServiceHealth {
  const socketState = socketStateFromRuntime(runtime);
  if (runtime.pid === null || !runtime.pidAlive) {
    return socketState === "stale" ? "stale" : "stopped";
  }
  return socketState === "live" ? "running" : "degraded";
}

export function toServiceStatus(
  kind: ServiceManagerKind,
  runtime: Pick<
    RuntimeState,
    "pid" | "pidAlive" | "socketConnectable" | "socketExists"
  >
): ServiceStatus {
  return {
    kind,
    health: healthFromRuntime(runtime),
    pid: runtime.pid,
    socketState: socketStateFromRuntime(runtime),
  };
}
