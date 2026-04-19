import { describe, expect, mock, test } from "bun:test";
import { installServiceCommand } from "./install-service";
import { uninstallServiceCommand } from "./uninstall-service";

describe("service install commands", () => {
  test("install-service delegates to supported service manager", async () => {
    const serviceManager = {
      install: mock(() => Promise.resolve()),
      isInstalled: mock(() => Promise.resolve(false)),
      kind: "systemd-user",
      start: mock(() => Promise.resolve()),
      status: mock(() => Promise.resolve({ installed: false, running: false })),
      stop: mock(() => Promise.resolve()),
      uninstall: mock(() => Promise.resolve()),
    };

    await installServiceCommand({ serviceManager: serviceManager as never });

    expect(serviceManager.install).toHaveBeenCalledTimes(1);
  });

  test("install-service errors on unsupported platforms", async () => {
    await expect(
      installServiceCommand({ resolveServiceManager: async () => null })
    ).rejects.toThrow("No supported service manager found");
  });

  test("uninstall-service delegates to supported service manager", async () => {
    const serviceManager = {
      install: mock(() => Promise.resolve()),
      isInstalled: mock(() => Promise.resolve(true)),
      kind: "launchd",
      start: mock(() => Promise.resolve()),
      status: mock(() => Promise.resolve({ installed: true, running: false })),
      stop: mock(() => Promise.resolve()),
      uninstall: mock(() => Promise.resolve()),
    };

    await uninstallServiceCommand({ serviceManager: serviceManager as never });

    expect(serviceManager.uninstall).toHaveBeenCalledTimes(1);
  });
});
