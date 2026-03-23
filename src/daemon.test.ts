import { describe, expect, mock, test } from "bun:test";
import type { Message } from "discord.js";
import { buildHookInput, Daemon } from "./daemon";
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

function makeConfig(channels: Map<string, ChannelConfig> = new Map()): Config {
  return { token: "fake-token", channels };
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
  test("skips bot messages", async () => {
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage({
      author: { id: "bot-1", username: "bot", bot: true },
    });
    // handleMessage is private, so we trigger it via the internal method
    // Access private method for testing
    (daemon as any).handleMessage(msg);

    // Give microtasks a chance to run
    await new Promise((r) => setTimeout(r, 10));
    expect(executor).not.toHaveBeenCalled();
  });

  test("ignores messages from unconfigured channels", async () => {
    const executor = mock(() => Promise.resolve(successResult()));
    const config = makeConfig(makeChannelMap(defaultChannel));
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage({ channelId: "unknown-channel" });
    (daemon as any).handleMessage(msg);

    await new Promise((r) => setTimeout(r, 10));
    expect(executor).not.toHaveBeenCalled();
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
    const daemon = new Daemon(config, executor);

    const msg = fakeMessage({
      reply: mock(() => Promise.reject(new Error("Missing Permissions"))),
    });

    // Should not throw
    await (daemon as any).runHook(msg, "./hooks/test.sh");

    expect(msg.reply).toHaveBeenCalled();
  });
});
