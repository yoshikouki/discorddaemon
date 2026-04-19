import {
  resolveSupportedServiceManager,
  type ServiceManager,
} from "../service-manager";

export interface InstallServiceDeps {
  resolveServiceManager?: typeof resolveSupportedServiceManager;
  serviceManager?: ServiceManager | null;
}

export async function installServiceCommand(
  deps: InstallServiceDeps = {}
): Promise<void> {
  const resolveServiceManager =
    deps.resolveServiceManager ?? resolveSupportedServiceManager;
  const manager = deps.serviceManager ?? (await resolveServiceManager());
  if (!manager) {
    throw new Error("No supported service manager found on this platform.");
  }

  await manager.install();
  console.error(
    `[ddd] Installed ${manager.kind} service. Run 'ddd start' to launch it.`
  );
}
