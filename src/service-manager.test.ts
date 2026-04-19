import { describe, expect, test } from "bun:test";
import {
  detectServiceManager,
  listServiceManagers,
  renderLaunchdPlist,
  renderSystemdUserUnit,
  resolveServiceManager,
  resolveSupportedServiceManager,
} from "./service-manager";
import {
  createLaunchdServiceManager,
  isLaunchdContext,
} from "./service-manager/adapters/launchd";
import {
  createLegacyServiceManager,
  isLegacyContext,
} from "./service-manager/adapters/legacy";
import {
  createSystemdUserServiceManager,
  isSystemdUserContext,
} from "./service-manager/adapters/systemd-user";
import {
  healthFromRuntime,
  socketStateFromRuntime,
  toServiceStatus,
} from "./service-manager/status";

describe("service-manager detection", () => {
  test("resolveServiceManager returns a managed backend when context matches", async () => {
    const manager = await resolveSupportedServiceManager({
      platform: "linux",
      env: { INVOCATION_ID: "abc" },
    });

    expect(manager?.kind).toBe("systemd-user");
  });

  test("resolveServiceManager returns null until a managed service is installed", async () => {
    const manager = await resolveServiceManager({
      platform: "linux",
      env: { INVOCATION_ID: "abc" },
    });

    expect(manager).toBeNull();
  });

  test("prefers launchd on macOS", () => {
    const manager = detectServiceManager({ platform: "darwin", env: {} });
    expect(manager.kind).toBe("launchd");
  });

  test("prefers systemd user on linux user sessions", () => {
    const manager = detectServiceManager({
      platform: "linux",
      env: { INVOCATION_ID: "abc" },
    });
    expect(manager.kind).toBe("systemd-user");
  });

  test("falls back to legacy when no service manager is detected", () => {
    const manager = detectServiceManager({ platform: "linux", env: {} });
    expect(manager.kind).toBe("legacy");
  });

  test("exposes all managers in priority order", () => {
    expect(listServiceManagers().map((manager) => manager.kind)).toEqual([
      "launchd",
      "systemd-user",
      "legacy",
    ]);
  });
});

describe("service-manager adapters", () => {
  test("systemd detection is linux-only", () => {
    expect(
      isSystemdUserContext({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: "/run/user/1000" },
      })
    ).toBe(true);
    expect(
      isSystemdUserContext({
        platform: "darwin",
        env: { INVOCATION_ID: "abc" },
      })
    ).toBe(false);
  });

  test("launchd detection is darwin-first", () => {
    expect(
      isLaunchdContext({
        platform: "darwin",
        env: {},
      })
    ).toBe(true);
    expect(
      isLaunchdContext({
        platform: "linux",
        env: { LAUNCHD_JOB_COUNT: "1" },
      })
    ).toBe(true);
  });

  test("legacy always matches", () => {
    expect(isLegacyContext({ platform: "linux", env: {} })).toBe(true);
    expect(isLegacyContext({ platform: "darwin", env: {} })).toBe(true);
  });

  test("adapters expose kinds", () => {
    expect(createLaunchdServiceManager().kind).toBe("launchd");
    expect(createSystemdUserServiceManager().kind).toBe("systemd-user");
    expect(createLegacyServiceManager().kind).toBe("legacy");
  });
});

describe("service-manager status normalization", () => {
  test("maps live runtime to running", () => {
    expect(
      socketStateFromRuntime({ socketExists: true, socketConnectable: true })
    ).toBe("live");
    expect(
      healthFromRuntime({
        pid: 1234,
        pidAlive: true,
        socketExists: true,
        socketConnectable: true,
      })
    ).toBe("running");
  });

  test("maps dead runtime with stale socket to stale", () => {
    expect(
      socketStateFromRuntime({ socketExists: true, socketConnectable: false })
    ).toBe("stale");
    expect(
      healthFromRuntime({
        pid: 1234,
        pidAlive: false,
        socketExists: true,
        socketConnectable: false,
      })
    ).toBe("stale");
  });

  test("maps pid alive but socket missing to degraded", () => {
    expect(
      toServiceStatus("legacy", {
        pid: 1234,
        pidAlive: true,
        socketExists: false,
        socketConnectable: null,
      })
    ).toEqual({
      kind: "legacy",
      health: "degraded",
      pid: 1234,
      socketState: "missing",
    });
  });

  test("renders a systemd user unit for foreground ddd", () => {
    const unit = renderSystemdUserUnit();

    expect(unit).toContain("[Service]");
    expect(unit).toContain("ExecStart=");
    expect(unit).toContain("start --foreground");
    expect(unit).toContain("WantedBy=default.target");
  });

  test("renders a launchd plist for foreground ddd", () => {
    const plist = renderLaunchdPlist();

    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("com.yoshikouki.ddd");
    expect(plist).toContain("<key>ProgramArguments</key>");
    expect(plist).toContain("start");
    expect(plist).toContain("--foreground");
  });
});
