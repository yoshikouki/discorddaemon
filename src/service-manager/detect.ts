import { createLaunchdServiceManager } from "./adapters/launchd";
import { createLegacyServiceManager } from "./adapters/legacy";
import { createSystemdUserServiceManager } from "./adapters/systemd-user";
import { getDefaultServiceManagerContext } from "./context";
import type { ServiceManager, ServiceManagerContext } from "./types";

const CANDIDATES: ServiceManager[] = [
  createLaunchdServiceManager(),
  createSystemdUserServiceManager(),
  createLegacyServiceManager(),
];

export function detectServiceManager(
  context: ServiceManagerContext = getDefaultServiceManagerContext()
): ServiceManager {
  return (
    CANDIDATES.find((candidate) => candidate.supports(context)) ??
    createLegacyServiceManager()
  );
}

export function listServiceManagers(): ServiceManager[] {
  return [
    createLaunchdServiceManager(),
    createSystemdUserServiceManager(),
    createLegacyServiceManager(),
  ];
}
