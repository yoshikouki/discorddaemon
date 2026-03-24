import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ChannelInfo, channelsCommand } from "./channels";

function fakeChannels(): ChannelInfo[] {
  return [
    {
      guild_id: "guild-1",
      guild_name: "Test Guild",
      channel_id: "ch-1",
      channel_name: "general",
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
      type: "GuildForum",
      parent_id: "cat-1",
      parent_name: "Text Channels",
      position: 2,
    },
  ];
}

describe("channelsCommand", () => {
  let dir: string;
  let configPath: string;
  const originalLog = console.log;
  let lines: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-channels-"));
    configPath = join(dir, "ddd.toml");
    await Bun.write(configPath, '[bot]\ntoken = "fake-token"\n');
    lines = [];
    console.log = mock((...args: unknown[]) => {
      lines.push(String(args[0]));
    });
  });

  afterEach(async () => {
    console.log = originalLog;
    await rm(dir, { recursive: true });
  });

  test("prints each channel as NDJSON line with parent_id", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    await channelsCommand({ config: configPath }, fetcher);

    expect(lines).toHaveLength(4);

    const first = JSON.parse(lines[0]);
    expect(first.channel_id).toBe("ch-1");
    expect(first.channel_name).toBe("general");
    expect(first.guild_name).toBe("Test Guild");
    expect(first.parent_id).toBe("cat-1");

    const second = JSON.parse(lines[1]);
    expect(second.channel_id).toBe("ch-2");
    expect(second.type).toBe("GuildAnnouncement");
    expect(second.parent_id).toBeNull();

    const third = JSON.parse(lines[2]);
    expect(third.channel_id).toBe("ch-3");
    expect(third.type).toBe("PublicThread");
    expect(third.parent_id).toBe("ch-1");
    expect(third.position).toBeNull();

    const fourth = JSON.parse(lines[3]);
    expect(fourth.channel_id).toBe("ch-4");
    expect(fourth.type).toBe("GuildForum");
    expect(fourth.parent_id).toBe("cat-1");
  });

  test("prints nothing when no channels found", async () => {
    const fetcher = mock(() => Promise.resolve([]));
    await channelsCommand({ config: configPath }, fetcher);

    expect(lines).toHaveLength(0);
  });

  test("works with token arg and no toml file", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "";
    try {
      await channelsCommand(
        { token: "direct-token", config: join(dir, "nonexistent.toml") },
        fetcher
      );
      expect(fetcher).toHaveBeenCalledWith("direct-token");
      expect(lines.length).toBeGreaterThan(0);
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });

  test("works with DDD_TOKEN env and no toml file", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    const original = process.env.DDD_TOKEN;
    process.env.DDD_TOKEN = "env-token";
    try {
      await channelsCommand({ config: join(dir, "nonexistent.toml") }, fetcher);
      expect(fetcher).toHaveBeenCalledWith("env-token");
    } finally {
      process.env.DDD_TOKEN = original;
    }
  });
});

describe("ChannelInfo sorting", () => {
  const sortChannels = (channels: ChannelInfo[]) =>
    [...channels].sort(
      (a, b) =>
        a.guild_name.localeCompare(b.guild_name) ||
        (a.position ?? Number.MAX_SAFE_INTEGER) -
          (b.position ?? Number.MAX_SAFE_INTEGER) ||
        a.channel_name.localeCompare(b.channel_name)
    );

  test("null-position threads sort after positioned channels, then by name", () => {
    const channels: ChannelInfo[] = [
      {
        guild_id: "g1",
        guild_name: "Guild",
        channel_id: "thread-b",
        channel_name: "beta-thread",
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
        type: "GuildForum",
        parent_id: null,
        parent_name: null,
        position: 1,
      },
    ];

    const sorted = sortChannels(channels);

    expect(sorted.map((c) => c.channel_id)).toEqual([
      "ch-1",
      "forum-1",
      "thread-a",
      "thread-b",
    ]);
  });
});
