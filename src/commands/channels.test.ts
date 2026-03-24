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
      parent_name: "Text Channels",
      position: 0,
    },
    {
      guild_id: "guild-1",
      guild_name: "Test Guild",
      channel_id: "ch-2",
      channel_name: "announcements",
      type: "GuildAnnouncement",
      parent_name: null,
      position: 1,
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

  test("prints each channel as NDJSON line", async () => {
    const fetcher = mock(() => Promise.resolve(fakeChannels()));
    await channelsCommand({ config: configPath }, fetcher);

    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.channel_id).toBe("ch-1");
    expect(first.channel_name).toBe("general");
    expect(first.guild_name).toBe("Test Guild");

    const second = JSON.parse(lines[1]);
    expect(second.channel_id).toBe("ch-2");
    expect(second.type).toBe("GuildAnnouncement");
  });

  test("prints nothing when no channels found", async () => {
    const fetcher = mock(() => Promise.resolve([]));
    await channelsCommand({ config: configPath }, fetcher);

    expect(lines).toHaveLength(0);
  });
});
