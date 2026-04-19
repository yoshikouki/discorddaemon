import type { ServiceManager } from "../types";
import { createRuntimeBackedServiceManager } from "./shared";

export function isSystemdUserContext({
  env,
  platform,
}: {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}): boolean {
  if (platform !== "linux") {
    return false;
  }

  const invocationId = env.INVOCATION_ID?.trim();
  if (invocationId) {
    return true;
  }

  const runtimeDir = env.XDG_RUNTIME_DIR?.trim();
  return runtimeDir?.startsWith("/run/user/") ?? false;
}

export function createSystemdUserServiceManager(): ServiceManager {
  return createRuntimeBackedServiceManager({
    kind: "systemd-user",
    supports(context) {
      return isSystemdUserContext(context);
    },
  });
}
