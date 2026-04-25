import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProbeResult } from "../ipc/probe";
import {
  type ChannelInfo,
  channelsCommand,
  createChannel,
  deleteChannel,
  editChannel,
  listChannels,
  sortChannels,
} from "./channels";

function unavailableProbe(): Promise<ProbeResult> {
  return Promise.resolve({ available: false, socketPath: "test-socket" });
}

function fakeChannels(): ChannelInfo[] {
  return [
    {
      guild_id: "guild-1",
      guild_name: "Test Guild",
      channel_id: "ch-1",
      channel_name: "general",
      manageable: true,
      type: "GuildText",
      parent_id: "cat-1",
      parent_name: "Text Channels",
      position: 0,
    },
    {
      guild_id: "guild-1",
      guild_name: "Test Guild",
      channel_id: "ch-2",
      channel_name: "announcements",
      manageable: true,
      type: "GuildAnnouncement",
      parent_id: null,
      parent_name: null,
      position: 1,
    },
    {
      guild_id: "guild-1",
      guild_name: "Test Guild",
      channel_id: "ch-3",
      channel_name: "help-thread",
      manageable: false,
      type: "PublicThread",
      parent_id: "ch-1",
      parent_name: "general",
      position: null,
    },
    {
      guild_id: "guild-1",
      guild_name: "Test Guild",
      channel_id: "ch-4",
      channel_name: "ideas",
      manageable: false,
      type: "GuildForum",
      parent_id: "cat-1",
      parent_name: "Text Channels",
      position: 2,
    },
  ];
}

function fakeChannel(index: number): ChannelInfo {
  const channel = fakeChannels()[index];
  if (!channel) {
    throw new Error(`Missing fake channel ${index}`);
  }
  return channel;
}

describe("channelsCommand", () => {
  let dir: string;
  let configPath: string;
  let originalTokenEnv: string | undefined;
  const originalLog = console.log;
  let lines: string[];

  beforeEach(async () => {
    originalTokenEnv = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = undefined;
    dir = await mkdtemp(join(tmpdir(), "ddd-channels-"));
    configPath = join(dir, "ddd.toml");
    await Bun.write(configPath, '[bot]\ntoken = "fake-token"\n');
    lines = [];
    console.log = mock((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  });

  afterEach(async () => {
    if (originalTokenEnv === undefined) {
      process.env.DDD_TOKEN = undefined;
    } else {
      process.env.DDD_TOKEN = originalTokenEnv;
    }
    console.log = originalLog;
    await rm(dir, { recursive: true });
  });

  test("prints each channel as NDJSON line with parent_id", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    await channelsCommand(
      [],
      { config: configPath },
      {
        list: fetcher,
        probe: unavailableProbe,
      }
    );

    expect(lines).toHaveLength(4);

    const first = JSON.parse(lines[0]);
    expect(first.channel_id).toBe("ch-1");
    expect(first.channel_name).toBe("general");
    expect(first.guild_name).toBe("Test Guild");
    expect(first.parent_id).toBe("cat-1");
    expect(first.manageable).toBe(true);

    const second = JSON.parse(lines[1]);
    expect(second.channel_id).toBe("ch-2");
    expect(second.type).toBe("GuildAnnouncement");
    expect(second.parent_id).toBeNull();
    expect(second.manageable).toBe(true);

    const third = JSON.parse(lines[2]);
    expect(third.channel_id).toBe("ch-3");
    expect(third.type).toBe("PublicThread");
    expect(third.position).toBeNull();
    expect(third.manageable).toBe(false);

    const fourth = JSON.parse(lines[3]);
    expect(fourth.channel_id).toBe("ch-4");
    expect(fourth.type).toBe("GuildForum");
    expect(fourth.manageable).toBe(false);
  });

  test("prints nothing when no channels found", async () => {
    const fetcher = mock(() => Promise.resolve([]));
    await channelsCommand(
      [],
      { config: configPath },
      {
        list: fetcher,
        probe: unavailableProbe,
      }
    );

    expect(lines).toHaveLength(0);
  });

  test("works with token arg and no toml file", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    await channelsCommand(
      [],
      { token: "direct-token", config: join(dir, "nonexistent.toml") },
      { list: fetcher, probe: unavailableProbe }
    );
    expect(fetcher).toHaveBeenCalledWith("direct-token");
    expect(lines.length).toBeGreaterThan(0);
  });

  test("works with DDD_TOKEN env and no toml file", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    process.env.DDD_TOKEN = "env-token";
    await channelsCommand(
      [],
      { config: join(dir, "nonexistent.toml") },
      { list: fetcher, probe: unavailableProbe }
    );
    expect(fetcher).toHaveBeenCalledWith("env-token");
  });

  test("create prints created channel as JSON", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(0)));

    await channelsCommand(
      ["create", "general"],
      {
        config: configPath,
        "guild-id": "guild-1",
        type: "text",
        topic: "hello",
        position: "2",
        nsfw: true,
        reason: "setup",
      },
      { create: executor, probe: unavailableProbe }
    );

    expect(executor).toHaveBeenCalledWith("fake-token", {
      guildId: "guild-1",
      name: "general",
      nsfw: true,
      parentId: undefined,
      position: 2,
      reason: "setup",
      topic: "hello",
      type: "text",
    });
    expect(JSON.parse(lines[0]).channel_id).toBe("ch-1");
  });

  test("edit supports clear-parent and prints updated channel", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(1)));

    await channelsCommand(
      ["edit", "ch-2"],
      {
        config: configPath,
        name: "announcements-2",
        "clear-parent": true,
        "no-nsfw": true,
      },
      { edit: executor, probe: unavailableProbe }
    );

    expect(executor).toHaveBeenCalledWith("fake-token", {
      channelId: "ch-2",
      clearParent: true,
      name: "announcements-2",
      nsfw: false,
      parentId: undefined,
      position: undefined,
      reason: undefined,
      topic: undefined,
    });
    expect(JSON.parse(lines[0]).channel_id).toBe("ch-2");
  });

  test("edit leaves nsfw unchanged when flag is omitted", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(1)));

    await channelsCommand(
      ["edit", "ch-2"],
      {
        config: configPath,
        name: "announcements-2",
      },
      { edit: executor, probe: unavailableProbe }
    );

    expect(executor).toHaveBeenCalledWith("fake-token", {
      channelId: "ch-2",
      clearParent: undefined,
      name: "announcements-2",
      nsfw: undefined,
      parentId: undefined,
      position: undefined,
      reason: undefined,
      topic: undefined,
    });
  });

  test("delete calls executor and prints nothing", async () => {
    const executor = mock(() => Promise.resolve());

    await channelsCommand(
      ["delete", "ch-1"],
      { config: configPath, reason: "cleanup" },
      { delete: executor, probe: unavailableProbe }
    );

    expect(executor).toHaveBeenCalledWith("fake-token", {
      channelId: "ch-1",
      reason: "cleanup",
    });
    expect(lines).toHaveLength(0);
  });

  test("create requires guild id", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(0)));

    await expect(
      channelsCommand(
        ["create", "general"],
        { config: configPath },
        { create: executor, probe: unavailableProbe }
      )
    ).rejects.toThrow(
      "Usage: ddd channels create <name> --guild-id <guild_id>"
    );
  });

  test("create rejects invalid channel type", async () => {
    await expect(
      channelsCommand(["create", "general"], {
        config: configPath,
        "guild-id": "guild-1",
        type: "forum",
      })
    ).rejects.toThrow('type must be "text" or "announcement"');
  });

  test("edit rejects non-integer position", async () => {
    await expect(
      channelsCommand(["edit", "ch-2"], {
        config: configPath,
        position: "1.5",
      })
    ).rejects.toThrow("--position must be a non-negative integer");
  });

  test("edit rejects negative position", async () => {
    await expect(
      channelsCommand(["edit", "ch-2"], {
        config: configPath,
        position: "-1",
      })
    ).rejects.toThrow("--position must be a non-negative integer");
  });

  test("edit rejects mutually exclusive nsfw flags", async () => {
    await expect(
      channelsCommand(["edit", "ch-2"], {
        config: configPath,
        name: "news",
        nsfw: true,
        "no-nsfw": true,
      })
    ).rejects.toThrow("--nsfw and --no-nsfw are mutually exclusive");
  });

  test("rejects unknown subcommands", async () => {
    await expect(
      channelsCommand(["archive"], { config: configPath })
    ).rejects.toThrow("Usage: ddd channels <list|create|edit|delete> ...");
  });
});

describe("channel CRUD helpers", () => {
  const originalLog = console.log;
  let lines: string[];

  beforeEach(() => {
    lines = [];
    console.log = mock((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  });

  afterEach(() => {
    console.log = originalLog;
  });

  test("createChannel prints created channel as JSON", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(0)));

    await createChannel(
      {
        token: "direct-token",
        guildId: "guild-1",
        name: "general",
        type: "text",
      },
      executor
    );

    expect(executor).toHaveBeenCalledWith("direct-token", {
      guildId: "guild-1",
      name: "general",
      nsfw: undefined,
      parentId: undefined,
      position: undefined,
      reason: undefined,
      topic: undefined,
      type: "text",
    });
    expect(JSON.parse(lines[0]).channel_id).toBe("ch-1");
  });

  test("listChannels uses IPC path without loading config when daemon is available", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    const probe = mock(() =>
      Promise.resolve({ available: true, socketPath: "socket" })
    );

    await listChannels(
      { config: join("/tmp", "missing-ddd.toml") },
      fetcher,
      probe
    );

    expect(fetcher).toHaveBeenCalledWith("");
    expect(lines).toHaveLength(4);
  });

  test("createChannel uses IPC path without loading config when daemon is available", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(0)));
    const probe = mock(() =>
      Promise.resolve({ available: true, socketPath: "socket" })
    );

    await createChannel(
      {
        config: join("/tmp", "missing-ddd.toml"),
        guildId: "guild-1",
        name: "general",
        type: "text",
      },
      executor,
      probe
    );

    expect(executor).toHaveBeenCalledWith("", {
      guildId: "guild-1",
      name: "general",
      nsfw: undefined,
      parentId: undefined,
      position: undefined,
      reason: undefined,
      topic: undefined,
      type: "text",
    });
  });

  test("editChannel requires at least one change", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(0)));

    await expect(
      editChannel({ token: "direct-token", channelId: "ch-1" }, executor)
    ).rejects.toThrow("At least one field to edit is required");
  });

  test("editChannel uses IPC path without loading config when daemon is available", async () => {
    const executor = mock(() => Promise.resolve(fakeChannel(1)));
    const probe = mock(() =>
      Promise.resolve({ available: true, socketPath: "socket" })
    );

    await editChannel(
      {
        config: join("/tmp", "missing-ddd.toml"),
        channelId: "ch-2",
        name: "news",
      },
      executor,
      probe
    );

    expect(executor).toHaveBeenCalledWith("", {
      channelId: "ch-2",
      clearParent: undefined,
      name: "news",
      nsfw: undefined,
      parentId: undefined,
      position: undefined,
      reason: undefined,
      topic: undefined,
    });
  });

  test("deleteChannel delegates without printing", async () => {
    const executor = mock(() => Promise.resolve());

    await deleteChannel(
      { token: "direct-token", channelId: "ch-1", reason: "cleanup" },
      executor
    );

    expect(executor).toHaveBeenCalledWith("direct-token", {
      channelId: "ch-1",
      reason: "cleanup",
    });
    expect(lines).toHaveLength(0);
  });

  test("deleteChannel uses IPC path without loading config when daemon is available", async () => {
    const executor = mock(() => Promise.resolve());
    const probe = mock(() =>
      Promise.resolve({ available: true, socketPath: "socket" })
    );

    await deleteChannel(
      {
        config: join("/tmp", "missing-ddd.toml"),
        channelId: "ch-1",
      },
      executor,
      probe
    );

    expect(executor).toHaveBeenCalledWith("", {
      channelId: "ch-1",
      reason: undefined,
    });
  });
});

describe("ChannelInfo sorting", () => {
  test("supported channel types sort by position, then name", () => {
    const channels: ChannelInfo[] = [
      {
        guild_id: "g1",
        guild_name: "Guild",
        channel_id: "thread-b",
        channel_name: "beta-thread",
        manageable: false,
        type: "PublicThread",
        parent_id: "ch-1",
        parent_name: "general",
        position: null,
      },
      {
        guild_id: "g1",
        guild_name: "Guild",
        channel_id: "ch-1",
        channel_name: "general",
        manageable: true,
        type: "GuildText",
        parent_id: null,
        parent_name: null,
        position: 0,
      },
      {
        guild_id: "g1",
        guild_name: "Guild",
        channel_id: "thread-a",
        channel_name: "alpha-thread",
        manageable: false,
        type: "PrivateThread",
        parent_id: "ch-1",
        parent_name: "general",
        position: null,
      },
      {
        guild_id: "g1",
        guild_name: "Guild",
        channel_id: "forum-1",
        channel_name: "ideas",
        manageable: false,
        type: "GuildForum",
        parent_id: null,
        parent_name: null,
        position: 1,
      },
      {
        guild_id: "g1",
        guild_name: "Guild",
        channel_id: "ch-2",
        channel_name: "announcements",
        manageable: true,
        type: "GuildAnnouncement",
        parent_id: null,
        parent_name: null,
        position: 1,
      },
    ];

    const sorted = sortChannels([...channels]);

    expect(sorted.map((c) => c.channel_id)).toEqual([
      "ch-1",
      "ch-2",
      "forum-1",
      "thread-a",
      "thread-b",
    ]);
  });
});
