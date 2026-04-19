import {
  resolveSupportedServiceManager,
  type ServiceManager,
} from "../service-manager";

export interface UninstallServiceDeps {
  resolveServiceManager?: typeof resolveSupportedServiceManager;
  serviceManager?: ServiceManager | null;
}

export async function uninstallServiceCommand(
  deps: UninstallServiceDeps = {}
): Promise<void> {
  const resolveServiceManager =
    deps.resolveServiceManager ?? resolveSupportedServiceManager;
  const manager = deps.serviceManager ?? (await resolveServiceManager());
  if (!manager) {
    throw new Error("No supported service manager found on this platform.");
  }

  await manager.uninstall();
  console.error(`[ddd] Uninstalled ${manager.kind} service.`);
}
