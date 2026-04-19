import type { ServiceManagerContext } from "./types";

export function getDefaultServiceManagerContext(): ServiceManagerContext {
  return {
    env: process.env,
    platform: process.platform,
  };
}
