import type { ServiceManager } from "../types";
import { createRuntimeBackedServiceManager } from "./shared";

export function isLaunchdContext({
  platform,
  env,
}: {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}): boolean {
  if (platform === "darwin") {
    return true;
  }

  return Boolean(env.LAUNCHD_JOB_COUNT?.trim());
}

export function createLaunchdServiceManager(): ServiceManager {
  return createRuntimeBackedServiceManager({
    kind: "launchd",
    supports(context) {
      return isLaunchdContext(context);
    },
  });
}
