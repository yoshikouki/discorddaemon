import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "discord.js";
import type { AuditEntry, AuditEvent } from "./audit";
import { buildHookInput, Daemon } from "./daemon";
import type { IpcServer } from "./ipc/server";
import type { LogEntry } from "./logger";
import { StatsTracker } from "./stats";
import type { ChannelConfig, Config, HookResult } from "./types";

function fakeMessage(
  overrides: Partial<Record<string, unknown>> = {}
): Message {
  return {
    id: "msg-1",
    content: "hello",
    author: { id: "user-1", username: "alice", bot: false },
    channelId: "ch-1",
    channel: { name: "general" },
    guild: { id: "guild-1", name: "Test Guild" },
    createdAt: new Date("2025-01-01T00:00:00Z"),
    reply: mock(() => Promise.resolve()),
    ...overrides,
  } as unknown as Message;
}

function makeConfig(
  channels: Map<string, ChannelConfig> = new Map(),
  overrides: Partial<Config> = {}
): Config {
  return {
    token: "fake-token",
    channels,
    configDir: "/tmp/ddd-test",
    configPath: "/tmp/ddd-test/ddd.toml",
    ...overrides,
  };
}

function makeChannelMap(
  ...entries: ChannelConfig[]
): Map<string, ChannelConfig> {
  const map = new Map<string, ChannelConfig>();
  for (const entry of entries) {
    map.set(entry.id, entry);
  }
  return map;
}

const defaultChannel: ChannelConfig = {
  id: "ch-1",
  name: "general",
  on_message: "./hooks/test.sh",
};

function successResult(output = "reply text"): HookResult {
  return { success: true, output, error: "", exitCode: 0, timedOut: false };
}

function failResult(): HookResult {
  return {
    success: false,
    output: "",
    error: "something failed",
    exitCode: 1,
    timedOut: false,
  };
}

function timeoutResult(): HookResult {
  return { success: false, output: "", error: "", exitCode: 1, timedOut: true };
}

function mockLogger(): {
  entries: LogEntry[];
  writer: (entry: LogEntry) => void;
} {
  const entries: LogEntry[] = [];
  return { entries, writer: (entry: LogEntry) => entries.push(entry) };
}

function mockAudit(): {
  events: AuditEntry[];
  writer: ReturnType<typeof import("./audit").createAuditWriter>;
} {
  const events: AuditEntry[] = [];
  return {
    events,
    writer: {
      write(event: AuditEvent, fields?: Record<string, unknown>) {
        events.push({
          ts: new Date().toISOString(),
          event,
          ...fields,
        });
      },
    },
  };
}

function createTestLogger() {
  const { entries, writer } = mockLogger();
  const { createLogger } = require("./logger");
  return { entries, logger: createLogger({ writer }) };
}

describe("buildHookInput", () => {
  test("maps message fields to HookInput", () => {
    const input = buildHookInput(fakeMessage());
    expect(input).toEqual({
      message: {
        id: "msg-1",
        content: "hello",
        author: { id: "user-1", username: "alice", bot: false },
        channel: { id: "ch-1", name: "general" },
        guild: { id: "guild-1", name: "Test Guild" },
        timestamp: "2025-01-01T00:00:00.000Z",
      },
    });
  });

  test("handles DM (no guild)", () => {
    const input = buildHookInput(fakeMessage({ guild: null }));
    expect(input.message.guild).toBeNull();
  });

  test("handles channel without name", () => {
    const input = buildHookInput(fakeMessage({ channel: { id: "ch-1" } }));
    expect(input.message.channel.name).toBeNull();
  });
});

describe("Daemon.handleMessage", () => {
  test("skips bot messages", () => {
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage({
      author: { id: "bot-1", username: "bot", bot: true },
    });
    (daemon as any).handleMessage(msg);
    expect(executor).not.toHaveBeenCalled();
  });
});

describe("Daemon.resolveAndRunHook", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-daemon-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true });
  });

  async function writeConfig(content: string): Promise<string> {
    const path = join(dir, "ddd.toml");
    await Bun.write(path, content);
    return path;
  }

  test("ignores messages from unconfigured channels without default_hook", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"

[channels.general]
id = "ch-1"
on_message = "./hooks/test.sh"
`);
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(makeChannelMap(defaultChannel), {
      configPath: path,
    });
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage({ channelId: "unknown-channel" });
    await (daemon as any).resolveAndRunHook(msg);
    expect(executor).not.toHaveBeenCalled();
  });

  test("records stats and audit on message received", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"

[channels.general]
id = "ch-1"
on_message = "./hooks/test.sh"
`);
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(makeChannelMap(defaultChannel), {
      configPath: path,
    });
    const stats = new StatsTracker(1);
    const { events, writer: audit } = mockAudit();
    const daemon = new Daemon(config, executor, { stats, audit });

    await (daemon as any).resolveAndRunHook(fakeMessage());

    expect(stats.getStats().messagesReceived).toBe(1);
    expect(events.some((e) => e.event === "message_received")).toBe(true);
  });

  test("uses default_hook for unconfigured channels", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"
default_hook = "./hooks/default.sh"
`);
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(new Map(), { configPath: path });
    const stats = new StatsTracker(0);
    const daemon = new Daemon(config, executor, { stats });

    await (daemon as any).resolveAndRunHook(
      fakeMessage({ channelId: "any-channel" })
    );

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0]).toBe("./hooks/default.sh");
    expect(stats.getStats().messagesReceived).toBe(1);
  });

  test("channel-specific hook overrides default_hook", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"
default_hook = "./hooks/default.sh"

[channels.general]
id = "ch-1"
on_message = "./hooks/specific.sh"
`);
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(makeChannelMap(defaultChannel), {
      configPath: path,
    });
    const daemon = new Daemon(config, executor);

    await (daemon as any).resolveAndRunHook(fakeMessage());

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor.mock.calls[0][0]).toBe("./hooks/specific.sh");
  });

  test("picks up config changes without restart", async () => {
    const path = await writeConfig(`
[bot]
token = "tok"
default_hook = "./hooks/old.sh"
`);
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(new Map(), { configPath: path });
    const daemon = new Daemon(config, executor);

    await (daemon as any).resolveAndRunHook(fakeMessage());
    expect(executor.mock.calls[0][0]).toBe("./hooks/old.sh");

    // Change config on disk
    await writeConfig(`
[bot]
token = "tok"
default_hook = "./hooks/new.sh"
`);

    await (daemon as any).resolveAndRunHook(fakeMessage());
    expect(executor.mock.calls[1][0]).toBe("./hooks/new.sh");
  });
});

describe("Daemon.runHook", () => {
  test("calls message.reply when hook succeeds with output", async () => {
    const executor = mock(() => Promise.resolve(successResult("hello back")));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage();
    await (daemon as any).runHook(msg, "./hooks/test.sh");

    expect(executor).toHaveBeenCalledTimes(1);
    expect(msg.reply).toHaveBeenCalledWith("hello back");
  });

  test("does NOT reply when hook output is empty", async () => {
    const executor = mock(() => Promise.resolve(successResult("")));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage();
    await (daemon as any).runHook(msg, "./hooks/test.sh");

    expect(msg.reply).not.toHaveBeenCalled();
  });

  test("does NOT reply when hook fails", async () => {
    const executor = mock(() => Promise.resolve(failResult()));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage();
    await (daemon as any).runHook(msg, "./hooks/test.sh");

    expect(msg.reply).not.toHaveBeenCalled();
  });

  test("does NOT reply when hook times out", async () => {
    const executor = mock(() => Promise.resolve(timeoutResult()));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage();
    await (daemon as any).runHook(msg, "./hooks/test.sh");

    expect(msg.reply).not.toHaveBeenCalled();
  });

  test("catches message.reply errors and logs them", async () => {
    const executor = mock(() => Promise.resolve(successResult("reply")));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const { entries, logger } = createTestLogger();
    const daemon = new Daemon(config, executor, { logger });

    const msg = fakeMessage({
      reply: mock(() => Promise.reject(new Error("Missing Permissions"))),
    });

    await (daemon as any).runHook(msg, "./hooks/test.sh");

    expect(msg.reply).toHaveBeenCalled();
    expect(entries.some((e) => e.msg === "Failed to send reply")).toBe(true);
  });

  test("records audit events for hook execution", async () => {
    const executor = mock(() => Promise.resolve(successResult("reply")));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const { events, writer: audit } = mockAudit();
    const stats = new StatsTracker(1);
    const daemon = new Daemon(config, executor, { audit, stats });

    await (daemon as any).runHook(fakeMessage(), "./hooks/test.sh");

    const hookEvent = events.find((e) => e.event === "hook_executed");
    expect(hookEvent).toBeDefined();
    expect(hookEvent?.success).toBe(true);
    expect(typeof hookEvent?.durationMs).toBe("number");

    const replyEvent = events.find((e) => e.event === "reply_sent");
    expect(replyEvent).toBeDefined();

    expect(stats.getStats().hooksExecuted).toBe(1);
    expect(stats.getStats().repliesSent).toBe(1);
  });

  test("records audit for hook timeout", async () => {
    const executor = mock(() => Promise.resolve(timeoutResult()));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const { events, writer: audit } = mockAudit();
    const stats = new StatsTracker(1);
    const daemon = new Daemon(config, executor, { audit, stats });

    await (daemon as any).runHook(fakeMessage(), "./hooks/test.sh");

    const hookEvent = events.find((e) => e.event === "hook_executed");
    expect(hookEvent?.success).toBe(false);
    expect(hookEvent?.timedOut).toBe(true);
    expect(stats.getStats().hookErrors).toBe(1);
  });

  test("records audit for hook failure", async () => {
    const executor = mock(() => Promise.resolve(failResult()));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const { events, writer: audit } = mockAudit();
    const stats = new StatsTracker(1);
    const daemon = new Daemon(config, executor, { audit, stats });

    await (daemon as any).runHook(fakeMessage(), "./hooks/test.sh");

    const hookEvent = events.find((e) => e.event === "hook_executed");
    expect(hookEvent?.success).toBe(false);
    expect(hookEvent?.exitCode).toBe(1);
    expect(stats.getStats().hookErrors).toBe(1);
  });

  test("records reply_failed audit on reply error", async () => {
    const executor = mock(() => Promise.resolve(successResult("reply")));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const { events, writer: audit } = mockAudit();
    const daemon = new Daemon(config, executor, { audit });

    const msg = fakeMessage({
      reply: mock(() => Promise.reject(new Error("Missing Permissions"))),
    });

    await (daemon as any).runHook(msg, "./hooks/test.sh");

    const failEvent = events.find((e) => e.event === "reply_failed");
    expect(failEvent).toBeDefined();
    expect(failEvent?.error).toBe("Missing Permissions");
  });
});

describe("Daemon.getStats", () => {
  test("returns null when no stats tracker", () => {
    const daemon = new Daemon(makeConfig());
    expect(daemon.getStats()).toBeNull();
  });

  test("returns stats when tracker is provided", () => {
    const stats = new StatsTracker(2);
    const daemon = new Daemon(makeConfig(), undefined, { stats });
    const result = daemon.getStats();

    expect(result).not.toBeNull();
    expect(result?.channelsWatched).toBe(2);
  });
});

describe("Daemon IPC integration", () => {
  test("stop() calls ipcServer.stop() before destroying client", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);

    // Simulate that an IPC server was started
    const stopFn = mock(() => undefined);
    const fakeIpcServer = { stop: stopFn } as unknown as IpcServer;
    (daemon as any).ipcServer = fakeIpcServer;

    daemon.stop();

    expect(stopFn).toHaveBeenCalledTimes(1);
  });

  test("stop() works safely when ipcServer is null", () => {
    const config = makeConfig();
    const daemon = new Daemon(config);

    expect((daemon as any).ipcServer).toBeNull();
    daemon.stop();
  });

  test("stop() writes audit event", () => {
    const config = makeConfig();
    const { events, writer: audit } = mockAudit();
    const daemon = new Daemon(config, undefined, { audit });

    daemon.stop();

    expect(events.some((e) => e.event === "daemon_stopped")).toBe(true);
  });
});
