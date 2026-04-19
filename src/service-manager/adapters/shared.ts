import { cleanupStaleRuntimeState, inspectRuntimeState } from "../../runtime";
import { toServiceStatus } from "../status";
import type { ServiceManager, ServiceManagerContext } from "../types";

export interface RuntimeBackedManagerOptions {
  kind: ServiceManager["kind"];
  supports(context: ServiceManagerContext): boolean;
}

export function createRuntimeBackedServiceManager(
  options: RuntimeBackedManagerOptions
): ServiceManager {
  return {
    kind: options.kind,
    supports: options.supports,
    async cleanupStaleState() {
      return await cleanupStaleRuntimeState();
    },
    async inspectStatus() {
      const runtime = await inspectRuntimeState();
      return toServiceStatus(options.kind, runtime);
    },
  };
}
