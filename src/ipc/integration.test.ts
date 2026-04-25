import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Client } from "discord.js";
import { ChannelType, Collection } from "discord.js";
import type { ChannelInfo } from "../commands/channels";
import type { MessageInfo } from "../message-info";
import { IpcClient, ipcCall } from "./client";
import type {
  DaemonInfoResult,
  DaemonPingResult,
  GuildResolveResult,
} from "./protocol";
import { IpcServer } from "./server";

function createMockClient(): Client<true> {
  return {} as Client<true>;
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
    position: 0,
    isTextBased: () => true,
    isSendable: () => true,
    messages: {
      fetch: () => Promise.resolve(fakeMessages),
      edit: (_id: string, opts: { content: string }) =>
        Promise.resolve({ ...fakeMessage, content: opts.content }),
      delete: () => Promise.resolve(undefined),
      react: () => Promise.resolve(undefined),
    },
    delete: () => Promise.resolve(undefined),
    send: (opts: { content: string }) =>
      Promise.resolve({
        ...fakeMessage,
        id: "msg-new",
        content: opts.content,
      }),
  };

  const fakeAnnouncement = {
    id: "ch-2",
    name: "announcements",
    type: ChannelType.GuildAnnouncement,
    parentId: null,
    parent: null,
    guildId: "guild-1",
    position: 1,
    isTextBased: () => true,
    isSendable: () => true,
    messages: {
      fetch: () => Promise.resolve(fakeMessages),
      edit: (_id: string, opts: { content: string }) =>
        Promise.resolve({ ...fakeMessage, content: opts.content }),
      delete: () => Promise.resolve(undefined),
      react: () => Promise.resolve(undefined),
    },
    delete: () => Promise.resolve(undefined),
    send: (opts: { content: string }) =>
      Promise.resolve({
        ...fakeMessage,
        id: "msg-new-2",
        content: opts.content,
      }),
  };

  const fakeForum = {
    id: "ch-3",
    name: "ideas",
    type: ChannelType.GuildForum,
    parentId: null,
    parent: null,
    guildId: "guild-1",
    position: 2,
  };

  const fakeThread = {
    id: "ch-4",
    name: "help-thread",
    type: ChannelType.PublicThread,
    parentId: "ch-1",
    parent: { name: "general" },
    guildId: "guild-1",
    position: null,
  };

  const channelCache = new Collection<string, any>();
  channelCache.set("ch-1", fakeChannel);
  channelCache.set("ch-2", fakeAnnouncement);
  channelCache.set("ch-3", fakeForum);
  channelCache.set("ch-4", fakeThread);

  const fakeGuildChannels = new Collection<string, any>();
  fakeGuildChannels.set("ch-1", fakeChannel);
  fakeGuildChannels.set("ch-2", fakeAnnouncement);
  fakeGuildChannels.set("ch-3", fakeForum);

  const fakeGuild = {
    id: "guild-1",
    name: "Test Guild",
    channels: {
      cache: fakeGuildChannels,
      fetchActiveThreads: () =>
        Promise.resolve({
          threads: new Collection<string, any>([[fakeThread.id, fakeThread]]),
        }),
      create: (opts: {
        name: string;
        type: ChannelType;
        parent?: string;
        topic?: string;
        position?: number;
        nsfw?: boolean;
        reason?: string;
      }) => {
        const created = {
          id: "ch-new",
          name: opts.name,
          type: opts.type,
          parentId: opts.parent ?? null,
          parent: opts.parent ? { name: "Category" } : null,
          guildId: "guild-1",
          guild: fakeGuild,
          position: opts.position ?? 2,
          topic: opts.topic,
          nsfw: opts.nsfw,
          delete: () => Promise.resolve(undefined),
        };
        channelCache.set(created.id, created);
        fakeGuildChannels.set(created.id, created);
        return Promise.resolve(created);
      },
      edit: (
        channelId: string,
        opts: {
          name?: string;
          topic?: string;
          parent?: string | null;
          position?: number;
          nsfw?: boolean;
          reason?: string;
        }
      ) => {
        const current = channelCache.get(channelId);
        let parent = current.parent;
        if (opts.parent === null) {
          parent = null;
        } else if (opts.parent !== undefined) {
          parent = { name: "Category" };
        }
        const updated = {
          ...current,
          name: opts.name ?? current.name,
          parentId:
            opts.parent === undefined
              ? current.parentId
              : (opts.parent ?? null),
          parent,
          position: opts.position ?? current.position ?? null,
          topic: opts.topic ?? current.topic,
          nsfw: opts.nsfw ?? current.nsfw,
        };
        channelCache.set(channelId, updated);
        fakeGuildChannels.set(channelId, updated);
        return Promise.resolve(updated);
      },
    },
  };

  fakeChannel.guild = fakeGuild;
  fakeAnnouncement.guild = fakeGuild;
  fakeThread.guild = fakeGuild;

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

function tempSocketPath(): string {
  const dir = join(
    tmpdir(),
    `ddd-ipc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  mkdirSync(dir, { recursive: true });
  return join(dir, "daemon.sock");
}

describe("IPC integration", () => {
  let server: IpcServer;
  let socketPath: string;
  const testToken = "test-bot-token-12345";

  beforeEach(async () => {
    socketPath = tempSocketPath();
    server = new IpcServer(createMockClient(), testToken, socketPath);
    await server.start();
  });

  afterEach(() => {
    server.stop();
  });

  test("server starts and accepts connections", async () => {
    const connected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 1000);
      Bun.connect({
        unix: socketPath,
        socket: {
          open(socket) {
            clearTimeout(timeout);
            socket.end();
            resolve(true);
          },
          error() {
            clearTimeout(timeout);
            resolve(false);
          },
          data() {
            // intentionally empty
          },
          close() {
            // intentionally empty
          },
        },
      }).catch(() => {
        clearTimeout(timeout);
        resolve(false);
      });
    });

    expect(connected).toBe(true);
  });

  test("client can send daemon/ping and get response", async () => {
    const client = new IpcClient(socketPath);
    const result = await client.call<DaemonPingResult>("daemon/ping", {});

    expect(result).toHaveProperty("uptime");
    expect(result).toHaveProperty("pid");
    expect(typeof result.uptime).toBe("number");
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(result.pid).toBe(process.pid);
  });

  test("client can send daemon/info and get token fingerprint", async () => {
    const client = new IpcClient(socketPath);
    const result = await client.call<DaemonInfoResult>("daemon/info", {});

    expect(result).toHaveProperty("uptime");
    expect(result).toHaveProperty("pid");
    expect(result).toHaveProperty("tokenFingerprint");
    expect(result.tokenFingerprint).toHaveLength(8);

    const expectedFingerprint = new Bun.CryptoHasher("sha256")
      .update(testToken)
      .digest("hex")
      .slice(0, 8);
    expect(result.tokenFingerprint).toBe(expectedFingerprint);
  });

  test("unknown method returns error", async () => {
    const client = new IpcClient(socketPath);

    try {
      await client.call("nonexistent/method", {});
      expect(true).toBe(false);
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("Unknown method");
    }
  });

  test("invalid JSON returns error", async () => {
    const result = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timeout")), 2000);
      let buffer = "";

      Bun.connect({
        unix: socketPath,
        socket: {
          open(socket) {
            socket.write("this is not json\n");
          },
          data(_socket, data) {
            buffer += data.toString();
            const parts = buffer.split("\n");
            for (const line of parts) {
              if (!line.trim()) {
                continue;
              }
              clearTimeout(timeout);
              _socket.end();
              resolve(line);
              return;
            }
          },
          error(_socket, err) {
            clearTimeout(timeout);
            reject(err);
          },
          close() {
            // intentionally empty
          },
        },
      }).catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    const parsed = JSON.parse(result);
    expect(parsed.error).toContain("Invalid JSON");
  });

  test("ipcCall convenience wrapper works", async () => {
    const result = await ipcCall<DaemonPingResult>(socketPath, {
      id: crypto.randomUUID(),
      method: "daemon/ping",
      params: {},
    });
    expect(result.pid).toBe(process.pid);
  });

  test("server cleanup on stop removes socket file", async () => {
    const tempPath = tempSocketPath();
    const tempServer = new IpcServer(createMockClient(), "token", tempPath);
    await tempServer.start();

    expect(existsSync(tempPath)).toBe(true);

    tempServer.stop();

    expect(existsSync(tempPath)).toBe(false);
  });
});

describe("IPC method handlers", () => {
  let server: IpcServer;
  let client: IpcClient;
  let socketPath: string;

  beforeEach(async () => {
    socketPath = tempSocketPath();
    server = new IpcServer(createMockDiscordClient(), "test-token", socketPath);
    await server.start();
    client = new IpcClient(socketPath);
  });

  afterEach(() => {
    server.stop();
  });

  test("messages/list returns message array", async () => {
    const result = await client.call<MessageInfo[]>("messages/list", {
      channelId: "ch-1",
      limit: 10,
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].id).toBe("msg-1");
    expect(result[0].content).toBe("hello world");
  });

  test("messages/list validates limit range", async () => {
    try {
      await client.call("messages/list", { channelId: "ch-1", limit: 200 });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("Limit must be 1-100");
    }
  });

  test("messages/list validates mutually exclusive options", async () => {
    try {
      await client.call("messages/list", {
        channelId: "ch-1",
        limit: 10,
        before: "123",
        after: "456",
      });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("mutually exclusive");
    }
  });

  test("messages/list validates channelId required", async () => {
    try {
      await client.call("messages/list", { limit: 10 });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("channelId is required");
    }
  });

  test("messages/send creates and returns a message", async () => {
    const result = await client.call<MessageInfo>("messages/send", {
      channelId: "ch-1",
      content: "test message",
    });
    expect(result.id).toBe("msg-new");
    expect(result.content).toBe("test message");
  });

  test("messages/send validates empty content", async () => {
    try {
      await client.call("messages/send", {
        channelId: "ch-1",
        content: "   ",
      });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("Content must not be empty");
    }
  });

  test("messages/send validates missing content", async () => {
    try {
      await client.call("messages/send", { channelId: "ch-1" });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("content is required");
    }
  });

  test("messages/edit returns updated message", async () => {
    const result = await client.call<MessageInfo>("messages/edit", {
      channelId: "ch-1",
      messageId: "msg-1",
      content: "edited",
    });
    expect(result.content).toBe("edited");
  });

  test("messages/delete succeeds", async () => {
    const result = await client.call("messages/delete", {
      channelId: "ch-1",
      messageId: "msg-1",
    });
    expect(result).toBeUndefined();
  });

  test("messages/react succeeds", async () => {
    const result = await client.call("messages/react", {
      channelId: "ch-1",
      messageId: "msg-1",
      emoji: "thumbsup",
    });
    expect(result).toBeUndefined();
  });

  test("messages/react validates missing emoji", async () => {
    try {
      await client.call("messages/react", {
        channelId: "ch-1",
        messageId: "msg-1",
      });
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain("emoji is required");
    }
  });

  test("guild/resolve returns guildId from cache", async () => {
    const result = await client.call<GuildResolveResult>("guild/resolve", {});
    expect(result.guildId).toBe("guild-1");
  });

  test("guild/resolve with channelId", async () => {
    const result = await client.call<GuildResolveResult>("guild/resolve", {
      channelId: "ch-1",
    });
    expect(result.guildId).toBe("guild-1");
  });

  test("channels/list returns listable text-based channels with manageable flag", async () => {
    const result = await client.call<ChannelInfo[]>("channels/list", {});
    expect(Array.isArray(result)).toBe(true);
    expect(result.map((channel) => channel.channel_id)).toEqual([
      "ch-1",
      "ch-2",
      "ch-3",
      "ch-4",
    ]);
    expect(result.map((channel) => channel.manageable)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  test("channels/create returns created channel", async () => {
    const result = await client.call<ChannelInfo>("channels/create", {
      guildId: "guild-1",
      name: "support",
      type: "text",
      topic: "help desk",
      position: 3,
      nsfw: false,
    });

    expect(result.channel_id).toBe("ch-new");
    expect(result.channel_name).toBe("support");
    expect(result.type).toBe("GuildText");
    expect(result.position).toBe(3);
  });

  test("channels/create validates type", async () => {
    await expect(
      client.call("channels/create", {
        guildId: "guild-1",
        name: "support",
        type: "forum",
      })
    ).rejects.toThrow('type must be "text" or "announcement"');
  });

  test("channels/create validates integer position", async () => {
    await expect(
      client.call("channels/create", {
        guildId: "guild-1",
        name: "support",
        type: "text",
        position: 1.5,
      })
    ).rejects.toThrow("--position must be a non-negative integer");
  });

  test("channels/edit returns updated channel", async () => {
    const result = await client.call<ChannelInfo>("channels/edit", {
      channelId: "ch-2",
      name: "news",
      clearParent: true,
      position: 4,
    });

    expect(result.channel_id).toBe("ch-2");
    expect(result.channel_name).toBe("news");
    expect(result.position).toBe(4);
    expect(result.parent_id).toBeNull();
  });

  test("channels/edit validates integer position", async () => {
    await expect(
      client.call("channels/edit", {
        channelId: "ch-2",
        position: 4.5,
      })
    ).rejects.toThrow("--position must be a non-negative integer");
  });

  test("channels/edit rejects listable but non-manageable channel types", async () => {
    await expect(
      client.call("channels/edit", {
        channelId: "ch-4",
        name: "renamed-thread",
      })
    ).rejects.toThrow("Channel ch-4 must be a text or announcement channel");
  });

  test("channels/delete succeeds", async () => {
    const result = await client.call("channels/delete", {
      channelId: "ch-1",
    });
    expect(result).toBeUndefined();
  });
});
