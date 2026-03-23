import { describe, expect, test } from "bun:test";
import type { Message } from "discord.js";
import { buildHookInput } from "./daemon";

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
    ...overrides,
  } as unknown as Message;
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
