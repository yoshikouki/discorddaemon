import { describe, expect, mock, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import { ChannelType, Collection } from "discord.js";
import type { MessageInfo } from "../message-info";
import { IpcClient } from "./client";
import { ConnectionRefusedError } from "./protocol";
import { IpcServer } from "./server";

// --- Test helpers ---

function tempSocketPath(): string {
  const dir = join(
    tmpdir(),
    `ddd-exec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, "daemon.sock");
}

function createMockDiscordClient(): Client<true> {
  const fakeMessage = {
    id: "msg-1",
    content: "hello world",
    author: { id: "user-1", username: "alice", bot: false },
    channelId: "ch-1",
    channel: { name: "general" },
    guild: { id: "guild-1", name: "Test Guild" },
    createdAt: new Date("2025-01-01T00:00:00Z"),
    editedTimestamp: null,
    pinned: false,
    type: 0,
  };

  const fakeMessages = new Collection<string, typeof fakeMessage>();
  fakeMessages.set("msg-1", fakeMessage);

  const fakeChannel = {
    id: "ch-1",
    name: "general",
    type: ChannelType.GuildText,
    parentId: null,
    parent: null,
    guildId: "guild-1",
    isTextBased: () => true,
    isSendable: () => true,
    messages: {
      fetch: () => Promise.resolve(fakeMessages),
      edit: (_id: string, opts: { content: string }) =>
        Promise.resolve({ ...fakeMessage, content: opts.content }),
      delete: () => Promise.resolve(undefined),
      react: () => Promise.resolve(undefined),
    },
    send: (opts: { content: string }) =>
      Promise.resolve({
        ...fakeMessage,
        id: "msg-new",
        content: opts.content,
      }),
  };

  const channelCache = new Collection<string, typeof fakeChannel>();
  channelCache.set("ch-1", fakeChannel);

  const fakeGuildChannels = new Collection<string, typeof fakeChannel>();
  fakeGuildChannels.set("ch-1", fakeChannel);

  const fakeGuild = {
    id: "guild-1",
    name: "Test Guild",
    channels: { cache: fakeGuildChannels },
  };

  const guildsCache = new Collection<string, typeof fakeGuild>();
  guildsCache.set("guild-1", fakeGuild);

  return {
    channels: {
      fetch: (id: string) => {
        const ch = channelCache.get(id);
        if (!ch) {
          return Promise.reject(new Error(`Channel ${id} not found`));
        }
        return Promise.resolve(ch);
      },
      cache: channelCache,
    },
    guilds: {
      cache: guildsCache,
      fetch: (id: string) => {
        const g = guildsCache.get(id);
        if (!g) {
          return Promise.reject(new Error(`Guild ${id} not found`));
        }
        return Promise.resolve(g);
      },
    },
  } as unknown as Client<true>;
}

describe("hybrid executor fallback behavior", () => {
  test("IPC executor calls daemon via socket", async () => {
    const socketPath = tempSocketPath();
    const server = new IpcServer(
      createMockDiscordClient(),
      "test-token",
      socketPath
    );
    await server.start();

    try {
      const client = new IpcClient(socketPath);
      const result = await client.call<MessageInfo[]>("messages/list", {
        channelId: "ch-1",
        limit: 10,
      });
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].id).toBe("msg-1");
    } finally {
      server.stop();
    }
  });

  test("ConnectionRefusedError triggers fallback for read commands", async () => {
    // Simulate: IPC executor throws ConnectionRefusedError, oneshot should be called
    const ipcExecutor = mock(() =>
      Promise.reject(new ConnectionRefusedError("socket gone"))
    );
    const oneshotExecutor = mock(() => Promise.resolve(["fallback-result"]));

    // Manually call the hybrid pattern
    try {
      await ipcExecutor();
    } catch (err) {
      if (err instanceof ConnectionRefusedError) {
        const result = await oneshotExecutor();
        expect(result).toEqual(["fallback-result"]);
      }
    }
    expect(oneshotExecutor).toHaveBeenCalledTimes(1);
  });

  test("ConnectionRefusedError triggers fallback for write commands", async () => {
    const ipcExecutor = mock(() =>
      Promise.reject(new ConnectionRefusedError("socket gone"))
    );
    const oneshotExecutor = mock(() =>
      Promise.resolve({ id: "msg-1" } as MessageInfo)
    );

    // Even for write commands, ConnectionRefusedError means request was never sent
    try {
      await ipcExecutor();
    } catch (err) {
      if (err instanceof ConnectionRefusedError) {
        const result = await oneshotExecutor();
        expect(result.id).toBe("msg-1");
      }
    }
    expect(oneshotExecutor).toHaveBeenCalledTimes(1);
  });

  test("non-ConnectionRefused error does NOT fallback for write commands (safeToRetry=false)", async () => {
    // Simulate a generic error after request was potentially sent
    const error = new Error("broken pipe during response");
    const ipcExecutor = mock(() => Promise.reject(error));
    const oneshotExecutor = mock(() =>
      Promise.resolve({ id: "msg-1" } as MessageInfo)
    );

    // safeToRetry=false: should NOT fallback, should re-throw
    try {
      await ipcExecutor();
      expect(true).toBe(false); // should not reach
    } catch (err) {
      // Not a ConnectionRefusedError, and safeToRetry=false
      expect(err).toBe(error);
      // Do NOT call oneshot executor
    }
    expect(oneshotExecutor).not.toHaveBeenCalled();
  });

  test("non-ConnectionRefused error DOES fallback for read commands (safeToRetry=true)", async () => {
    const error = new Error("timeout after request sent");
    const ipcExecutor = mock(() => Promise.reject(error));
    const oneshotExecutor = mock(() => Promise.resolve(["fallback"]));

    // safeToRetry=true: should fallback even for non-connection errors
    try {
      await ipcExecutor();
    } catch {
      // Read-only, safeToRetry=true => fallback
      const result = await oneshotExecutor();
      expect(result).toEqual(["fallback"]);
    }
    expect(oneshotExecutor).toHaveBeenCalledTimes(1);
  });
});
