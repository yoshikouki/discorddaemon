import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DATA_DIR, LOG_PATH } from "../paths";
import { isProcessRunning, readPid, removePid } from "../pid";
import { inspectRuntimeState } from "../runtime";
import {
  createLaunchdServiceManager as createLaunchdServiceManagerImpl,
  isLaunchdContext as isLaunchdContextImpl,
} from "./adapters/launchd";
import {
  createLegacyServiceManager as createLegacyServiceManagerImpl,
  isLegacyContext as isLegacyContextImpl,
} from "./adapters/legacy";
import {
  createSystemdUserServiceManager as createSystemdUserServiceManagerImpl,
  isSystemdUserContext as isSystemdUserContextImpl,
} from "./adapters/systemd-user";
import { getDefaultServiceManagerContext } from "./context";
import {
  detectServiceManager as detectServiceManagerImpl,
  listServiceManagers as listServiceManagersImpl,
} from "./detect";
import {
  healthFromRuntime as healthFromRuntimeImpl,
  socketStateFromRuntime as socketStateFromRuntimeImpl,
  toServiceStatus as toServiceStatusImpl,
} from "./status";
import type {
  ServiceHealth as ServiceHealthImpl,
  ServiceManagerContext as ServiceManagerContextImpl,
  ServiceManagerKind as ServiceManagerKindImpl,
  ServiceSocketState as ServiceSocketStateImpl,
  ServiceStatus as ServiceStatusImpl,
} from "./types";

export interface ServiceManagerStatus {
  installed?: boolean;
  kind?: ServiceStatusImpl["kind"];
  message?: string;
  pid?: number;
  running: boolean;
  socketState?: ServiceSocketStateImpl;
  state?: ServiceHealthImpl;
}

export interface ServiceManager {
  install: () => Promise<void>;
  isInstalled: () => Promise<boolean>;
  start: () => Promise<void>;
  status: () => Promise<ServiceManagerStatus>;
  stop: () => Promise<void>;
  uninstall: () => Promise<void>;
}

interface CommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

interface CommandDeps {
  runCommand?: (args: string[]) => Promise<CommandResult>;
}

interface ServiceFileLayout {
  installPath: string;
  label: string;
}

const SYSTEMD_UNIT_NAME = "ddd.service";
const LAUNCHD_LABEL = "com.yoshikouki.ddd";
const SYSTEMD_USER_DIR = resolve(homedir(), ".config", "systemd", "user");
const LAUNCH_AGENTS_DIR = resolve(homedir(), "Library", "LaunchAgents");
const ENTRYPOINT_PATH = resolve(import.meta.dir, "..", "index.ts");
const PACKAGE_ROOT = resolve(import.meta.dir, "..", "..");
const BUN_PATH = process.execPath;

function log(msg: string): void {
  console.error(`[ddd] ${msg}`);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultRunCommand(args: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(args, {
    stderr: "pipe",
    stdout: "pipe",
  });
  const stdoutPromise = proc.stdout
    ? new Response(proc.stdout).text()
    : Promise.resolve("");
  const stderrPromise = proc.stderr
    ? new Response(proc.stderr).text()
    : Promise.resolve("");
  const [stdout, stderr, exitCode] = await Promise.all([
    stdoutPromise,
    stderrPromise,
    proc.exited,
  ]);
  return { exitCode, stderr, stdout };
}

function commandFailure(args: string[], result: CommandResult): Error {
  const output = result.stderr.trim() || result.stdout.trim() || "no output";
  return new Error(`${args.join(" ")} failed (${result.exitCode}): ${output}`);
}

async function runCheckedCommand(
  args: string[],
  deps: CommandDeps
): Promise<CommandResult> {
  const result = await (deps.runCommand ?? defaultRunCommand)(args);
  if (result.exitCode !== 0) {
    throw commandFailure(args, result);
  }
  return result;
}

function getServiceFileLayout(kind: ServiceManagerKindImpl): ServiceFileLayout {
  switch (kind) {
    case "systemd-user":
      return {
        installPath: join(SYSTEMD_USER_DIR, SYSTEMD_UNIT_NAME),
        label: SYSTEMD_UNIT_NAME,
      };
    case "launchd":
      return {
        installPath: join(LAUNCH_AGENTS_DIR, `${LAUNCHD_LABEL}.plist`),
        label: LAUNCHD_LABEL,
      };
    default:
      throw new Error(`service files are not supported for ${kind}`);
  }
}

export function renderSystemdUserUnit(): string {
  const lines = [
    "[Unit]",
    "Description=ddd Discord daemon",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `WorkingDirectory=${PACKAGE_ROOT}`,
    `ExecStart=${BUN_PATH} run ${ENTRYPOINT_PATH} start --foreground`,
    "Restart=on-failure",
    "RestartSec=5",
    `Environment=HOME=${process.env.HOME ?? homedir()}`,
  ];

  if (process.env.XDG_CONFIG_HOME?.trim()) {
    lines.push(`Environment=XDG_CONFIG_HOME=${process.env.XDG_CONFIG_HOME}`);
  }
  if (process.env.XDG_DATA_HOME?.trim()) {
    lines.push(`Environment=XDG_DATA_HOME=${process.env.XDG_DATA_HOME}`);
  }

  lines.push("", "[Install]", "WantedBy=default.target", "");
  return lines.join("\n");
}

export function renderLaunchdPlist(): string {
  const programArguments = [
    BUN_PATH,
    "run",
    ENTRYPOINT_PATH,
    "start",
    "--foreground",
  ]
    .map((arg) => `    <string>${xmlEscape(arg)}</string>`)
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${LAUNCHD_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    programArguments,
    "  </array>",
    "  <key>WorkingDirectory</key>",
    `  <string>${xmlEscape(PACKAGE_ROOT)}</string>`,
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>RunAtLoad</key>",
    "  <false/>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(LOG_PATH)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(LOG_PATH)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function runtimeMessageFromStatus(
  status: ReturnType<typeof toServiceStatusImpl>
) {
  if (status.health === "stale") {
    if (status.socketState === "stale") {
      return status.pid === null
        ? "stale socket file present"
        : "stale PID and socket files present";
    }

    return "stale PID file present";
  }
  return undefined;
}

async function startManagedForeground(): Promise<void> {
  const { startCommand } = await import("../commands/start");
  await startCommand({ foreground: true });
}

async function stopManagedRuntime(): Promise<void> {
  const pid = await readPid();
  if (pid === null) {
    throw new Error("No PID file found. Daemon may not be running.");
  }

  if (!isProcessRunning(pid)) {
    await removePid();
    throw new Error(
      `Daemon is not running (stale PID file cleaned up, was PID ${pid})`
    );
  }

  process.kill(pid, "SIGTERM");
  log(`Sent SIGTERM to PID ${pid}`);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await Bun.sleep(500);
    if (!isProcessRunning(pid)) {
      await removePid();
      log(`Daemon stopped (PID: ${pid})`);
      return;
    }
  }

  process.kill(pid, "SIGKILL");
  log(`Sent SIGKILL to PID ${pid} (did not exit within 10s)`);
  await Bun.sleep(1000);
  await removePid();
  log(`Daemon stopped (PID: ${pid})`);
}

function createManagedServiceManager(
  kind: ServiceManagerKindImpl,
  deps: CommandDeps = {}
): ServiceManager {
  const fileLayout = getServiceFileLayout(kind);

  async function isInstalled(): Promise<boolean> {
    return await fileExists(fileLayout.installPath);
  }

  async function ensureInstalled(): Promise<void> {
    if (!(await isInstalled())) {
      throw new Error(
        `Service is not installed for ${kind}. Run 'ddd install-service' first.`
      );
    }
  }

  async function systemdActive(): Promise<boolean> {
    const result = await (deps.runCommand ?? defaultRunCommand)([
      "systemctl",
      "--user",
      "is-active",
      "--quiet",
      SYSTEMD_UNIT_NAME,
    ]);
    return result.exitCode === 0;
  }

  async function launchdLoaded(): Promise<boolean> {
    const result = await (deps.runCommand ?? defaultRunCommand)([
      "launchctl",
      "print",
      `gui/${process.getuid()}/${LAUNCHD_LABEL}`,
    ]);
    return result.exitCode === 0;
  }

  return {
    kind,
    async install() {
      if (kind === "systemd-user") {
        await mkdir(SYSTEMD_USER_DIR, { recursive: true });
        await writeFile(
          fileLayout.installPath,
          renderSystemdUserUnit(),
          "utf8"
        );
        await runCheckedCommand(["systemctl", "--user", "daemon-reload"], deps);
        await runCheckedCommand(
          ["systemctl", "--user", "enable", SYSTEMD_UNIT_NAME],
          deps
        );
        return;
      }

      if (kind === "launchd") {
        await mkdir(LAUNCH_AGENTS_DIR, { recursive: true });
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(fileLayout.installPath, renderLaunchdPlist(), "utf8");
        return;
      }

      throw new Error(`service install is not supported for ${kind}`);
    },
    isInstalled,
    async start() {
      await ensureInstalled();

      if (kind === "systemd-user") {
        await runCheckedCommand(
          ["systemctl", "--user", "start", SYSTEMD_UNIT_NAME],
          deps
        );
        return;
      }

      if (kind === "launchd") {
        if (!(await launchdLoaded())) {
          await runCheckedCommand(
            [
              "launchctl",
              "bootstrap",
              `gui/${process.getuid()}`,
              fileLayout.installPath,
            ],
            deps
          );
        }
        await runCheckedCommand(
          [
            "launchctl",
            "kickstart",
            "-k",
            `gui/${process.getuid()}/${LAUNCHD_LABEL}`,
          ],
          deps
        );
        return;
      }

      await startManagedForeground();
    },
    async status() {
      const installed = await isInstalled();
      if (!installed) {
        return {
          installed: false,
          kind,
          message: "service not installed",
          running: false,
        };
      }

      const runtime = await inspectRuntimeState();
      const status = toServiceStatusImpl(kind, runtime);
      let active = status.health === "running" || status.health === "degraded";
      if (kind === "systemd-user") {
        active = await systemdActive();
      } else if (kind === "launchd") {
        active = await launchdLoaded();
      }

      return {
        kind,
        installed,
        pid: status.pid ?? undefined,
        running:
          active &&
          (status.health === "running" || status.health === "degraded"),
        socketState: status.socketState,
        state: status.health,
        message:
          active || status.health === "running" || status.health === "degraded"
            ? undefined
            : runtimeMessageFromStatus(status),
      };
    },
    async stop() {
      await ensureInstalled();

      if (kind === "systemd-user") {
        await runCheckedCommand(
          ["systemctl", "--user", "stop", SYSTEMD_UNIT_NAME],
          deps
        );
        return;
      }

      if (kind === "launchd") {
        const loaded = await launchdLoaded();
        if (!loaded) {
          return;
        }
        await runCheckedCommand(
          ["launchctl", "bootout", `gui/${process.getuid()}/${LAUNCHD_LABEL}`],
          deps
        );
        return;
      }

      await stopManagedRuntime();
    },
    async uninstall() {
      if (!(await isInstalled())) {
        return;
      }

      if (kind === "systemd-user") {
        const active = await systemdActive();
        if (active) {
          await runCheckedCommand(
            ["systemctl", "--user", "stop", SYSTEMD_UNIT_NAME],
            deps
          );
        }
        await runCheckedCommand(
          ["systemctl", "--user", "disable", SYSTEMD_UNIT_NAME],
          deps
        );
        await rm(fileLayout.installPath, { force: true });
        await runCheckedCommand(["systemctl", "--user", "daemon-reload"], deps);
        return;
      }

      if (kind === "launchd") {
        if (await launchdLoaded()) {
          await runCheckedCommand(
            [
              "launchctl",
              "bootout",
              `gui/${process.getuid()}/${LAUNCHD_LABEL}`,
            ],
            deps
          );
        }
        await rm(fileLayout.installPath, { force: true });
        return;
      }
    },
  };
}

export function resolveSupportedServiceManager(
  context: ServiceManagerContextImpl = getDefaultServiceManagerContext()
): Promise<ServiceManager | null> {
  const detected = detectServiceManagerImpl(context);
  if (detected.kind === "legacy") {
    return Promise.resolve(null);
  }

  return Promise.resolve(createManagedServiceManager(detected.kind));
}

export async function resolveServiceManager(
  context: ServiceManagerContextImpl = getDefaultServiceManagerContext()
): Promise<ServiceManager | null> {
  const manager = await resolveSupportedServiceManager(context);
  if (!manager) {
    return null;
  }
  return (await manager.isInstalled()) ? manager : null;
}

export function createLaunchdServiceManager() {
  return createLaunchdServiceManagerImpl();
}

export function createLegacyServiceManager() {
  return createLegacyServiceManagerImpl();
}

export function createSystemdUserServiceManager() {
  return createSystemdUserServiceManagerImpl();
}

export function detectServiceManager(
  context: ServiceManagerContextImpl
): ReturnType<typeof detectServiceManagerImpl> {
  return detectServiceManagerImpl(context);
}

export function listServiceManagers() {
  return listServiceManagersImpl();
}

export function isLaunchdContext(context: {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}) {
  return isLaunchdContextImpl(context);
}

export function isLegacyContext(context: ServiceManagerContextImpl) {
  return isLegacyContextImpl(context);
}

export function isSystemdUserContext(context: {
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}) {
  return isSystemdUserContextImpl(context);
}

export function healthFromRuntime(
  runtime: Parameters<typeof healthFromRuntimeImpl>[0]
): ReturnType<typeof healthFromRuntimeImpl> {
  return healthFromRuntimeImpl(runtime);
}

export function socketStateFromRuntime(
  runtime: Parameters<typeof socketStateFromRuntimeImpl>[0]
): ReturnType<typeof socketStateFromRuntimeImpl> {
  return socketStateFromRuntimeImpl(runtime);
}

export function toServiceStatus(
  kind: ServiceManagerKindImpl,
  runtime: Parameters<typeof toServiceStatusImpl>[1]
): ReturnType<typeof toServiceStatusImpl> {
  return toServiceStatusImpl(kind, runtime);
}

export type ServiceHealth = ServiceHealthImpl;
export type ServiceManagerContext = ServiceManagerContextImpl;
export type ServiceManagerKind = ServiceManagerKindImpl;
export type ServiceSocketState = ServiceSocketStateImpl;
export type ServiceStatus = ServiceStatusImpl;
