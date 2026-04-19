export type ServiceManagerKind = "systemd-user" | "launchd" | "legacy";

export type ServiceHealth = "running" | "degraded" | "stopped" | "stale";

export type ServiceSocketState = "missing" | "live" | "stale";

export interface ServiceStatus {
  health: ServiceHealth;
  kind: ServiceManagerKind;
  pid: number | null;
  socketState: ServiceSocketState;
}

export interface ServiceManagerContext {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

export interface ServiceManager {
  cleanupStaleState(): Promise<{ pidRemoved: boolean; socketRemoved: boolean }>;
  inspectStatus(): Promise<ServiceStatus>;
  kind: ServiceManagerKind;
  supports(context: ServiceManagerContext): boolean;
}
