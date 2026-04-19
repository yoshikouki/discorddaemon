import type { ServiceManager, ServiceManagerContext } from "../types";
import { createRuntimeBackedServiceManager } from "./shared";

export function isLegacyContext(_context: ServiceManagerContext): boolean {
  return true;
}

export function createLegacyServiceManager(): ServiceManager {
  return createRuntimeBackedServiceManager({
    kind: "legacy",
    supports(context) {
      return isLegacyContext(context);
    },
  });
}
