import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MessageInfo } from "../message-info";
import {
  buildSearchParams,
  deleteMessage,
  editMessage,
  extractSearchHits,
  listMessages,
  messagesCommand,
  reactMessage,
  recentMessages,
  searchMessages,
  sendMessage,
} from "./messages";

function fakeMessage(overrides: Partial<MessageInfo> = {}): MessageInfo {
  return {
    id: "msg-1",
    content: "hello world",
    author: { id: "user-1", username: "alice", bot: false },
    channel: { id: "ch-1", name: "general" },
    guild: { id: "guild-1", name: "Test Guild" },
    timestamp: "2026-03-24T12:00:00.000Z",
    editedTimestamp: null,
    pinned: false,
    type: 0,
    ...overrides,
  };
}

describe("messages commands", () => {
  let dir: string;
  let configPath: string;
  const originalLog = console.log;
  let lines: string[];

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "ddd-messages-"));
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

  // --- listMessages ---

  describe("listMessages", () => {
    test("prints each message as NDJSON line", async () => {
      const msgs = [
        fakeMessage(),
        fakeMessage({ id: "msg-2", content: "second" }),
      ];
      const executor = mock(() => Promise.resolve(msgs));

      await listMessages(
        { config: configPath, channelId: "ch-1", limit: 50 },
        executor
      );

      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]);
      expect(first.id).toBe("msg-1");
      expect(first.content).toBe("hello world");

      const second = JSON.parse(lines[1]);
      expect(second.id).toBe("msg-2");
    });

    test("passes options to executor", async () => {
      const executor = mock(() => Promise.resolve([]));

      await listMessages(
        {
          config: configPath,
          channelId: "ch-1",
          limit: 10,
          before: "snap-1",
        },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "ch-1", {
        limit: 10,
        before: "snap-1",
        after: undefined,
        around: undefined,
      });
    });

    test("uses default limit of 50 via dispatcher", async () => {
      const executor = mock(() => Promise.resolve([]));

      await listMessages(
        { config: configPath, channelId: "ch-1", limit: 50 },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "ch-1", {
        limit: 50,
        before: undefined,
        after: undefined,
        around: undefined,
      });
    });

    test("rejects limit below 1", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        listMessages(
          { config: configPath, channelId: "ch-1", limit: 0 },
          executor
        )
      ).rejects.toThrow("Limit must be 1-100");
    });

    test("rejects limit above 100", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        listMessages(
          { config: configPath, channelId: "ch-1", limit: 101 },
          executor
        )
      ).rejects.toThrow("Limit must be 1-100");
    });

    test("rejects NaN limit (e.g. --limit abc)", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        listMessages(
          { config: configPath, channelId: "ch-1", limit: Number.NaN },
          executor
        )
      ).rejects.toThrow("Limit must be 1-100");
    });

    test("rejects mutually exclusive flags", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        listMessages(
          {
            config: configPath,
            channelId: "ch-1",
            limit: 50,
            before: "a",
            after: "b",
          },
          executor
        )
      ).rejects.toThrow(
        "--before, --after, and --around are mutually exclusive"
      );
    });

    test("prints nothing when no messages found", async () => {
      const executor = mock(() => Promise.resolve([]));

      await listMessages(
        { config: configPath, channelId: "ch-1", limit: 50 },
        executor
      );

      expect(lines).toHaveLength(0);
    });
  });

  // --- sendMessage ---

  describe("sendMessage", () => {
    test("sends content from --content flag", async () => {
      const msg = fakeMessage();
      const executor = mock(() => Promise.resolve(msg));
      const stdinReader = mock(() => Promise.resolve(undefined));

      await sendMessage(
        { config: configPath, channelId: "ch-1", content: "hello" },
        executor,
        stdinReader
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "ch-1", "hello");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).id).toBe("msg-1");
    });

    test("reads content from stdin when --content not provided", async () => {
      const msg = fakeMessage();
      const executor = mock(() => Promise.resolve(msg));
      const stdinReader = mock(() => Promise.resolve("from stdin"));

      await sendMessage(
        { config: configPath, channelId: "ch-1" },
        executor,
        stdinReader
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "ch-1", "from stdin");
    });

    test("--content takes priority over stdin", async () => {
      const msg = fakeMessage();
      const executor = mock(() => Promise.resolve(msg));
      const stdinReader = mock(() => Promise.resolve("from stdin"));

      await sendMessage(
        { config: configPath, channelId: "ch-1", content: "from flag" },
        executor,
        stdinReader
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "ch-1", "from flag");
      expect(stdinReader).not.toHaveBeenCalled();
    });

    test("rejects when no content provided", async () => {
      const executor = mock(() => Promise.resolve(fakeMessage()));
      const stdinReader = mock(() => Promise.resolve(undefined));

      await expect(
        sendMessage(
          { config: configPath, channelId: "ch-1" },
          executor,
          stdinReader
        )
      ).rejects.toThrow("Content required: use --content or pipe to stdin");
    });

    test("rejects empty content after trim", async () => {
      const executor = mock(() => Promise.resolve(fakeMessage()));
      const stdinReader = mock(() => Promise.resolve(undefined));

      await expect(
        sendMessage(
          { config: configPath, channelId: "ch-1", content: "   " },
          executor,
          stdinReader
        )
      ).rejects.toThrow("Content must not be empty");
    });

    test('rejects --content "" as empty instead of falling to stdin', async () => {
      const executor = mock(() => Promise.resolve(fakeMessage()));
      const stdinReader = mock(() => Promise.resolve("from stdin"));

      await expect(
        sendMessage(
          { config: configPath, channelId: "ch-1", content: "" },
          executor,
          stdinReader
        )
      ).rejects.toThrow("Content must not be empty");
      expect(stdinReader).not.toHaveBeenCalled();
    });
  });

  // --- editMessage ---

  describe("editMessage", () => {
    test("edits with content from --content flag", async () => {
      const msg = fakeMessage({ editedTimestamp: "2026-03-24T13:00:00.000Z" });
      const executor = mock(() => Promise.resolve(msg));
      const stdinReader = mock(() => Promise.resolve(undefined));

      await editMessage(
        {
          config: configPath,
          channelId: "ch-1",
          messageId: "msg-1",
          content: "updated",
        },
        executor,
        stdinReader
      );

      expect(executor).toHaveBeenCalledWith(
        "fake-token",
        "ch-1",
        "msg-1",
        "updated"
      );
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]);
      expect(parsed.editedTimestamp).toBe("2026-03-24T13:00:00.000Z");
    });

    test("reads content from stdin when --content not provided", async () => {
      const msg = fakeMessage();
      const executor = mock(() => Promise.resolve(msg));
      const stdinReader = mock(() => Promise.resolve("stdin edit"));

      await editMessage(
        { config: configPath, channelId: "ch-1", messageId: "msg-1" },
        executor,
        stdinReader
      );

      expect(executor).toHaveBeenCalledWith(
        "fake-token",
        "ch-1",
        "msg-1",
        "stdin edit"
      );
    });

    test("rejects when no content provided", async () => {
      const executor = mock(() => Promise.resolve(fakeMessage()));
      const stdinReader = mock(() => Promise.resolve(undefined));

      await expect(
        editMessage(
          { config: configPath, channelId: "ch-1", messageId: "msg-1" },
          executor,
          stdinReader
        )
      ).rejects.toThrow("Content required: use --content or pipe to stdin");
    });

    test("rejects empty content after trim", async () => {
      const executor = mock(() => Promise.resolve(fakeMessage()));
      const stdinReader = mock(() => Promise.resolve(undefined));

      await expect(
        editMessage(
          {
            config: configPath,
            channelId: "ch-1",
            messageId: "msg-1",
            content: "  \n  ",
          },
          executor,
          stdinReader
        )
      ).rejects.toThrow("Content must not be empty");
    });

    test('rejects --content "" as empty instead of falling to stdin', async () => {
      const executor = mock(() => Promise.resolve(fakeMessage()));
      const stdinReader = mock(() => Promise.resolve("from stdin"));

      await expect(
        editMessage(
          {
            config: configPath,
            channelId: "ch-1",
            messageId: "msg-1",
            content: "",
          },
          executor,
          stdinReader
        )
      ).rejects.toThrow("Content must not be empty");
      expect(stdinReader).not.toHaveBeenCalled();
    });
  });

  // --- deleteMessage ---

  describe("deleteMessage", () => {
    test("calls executor with correct args", async () => {
      const executor = mock(() => Promise.resolve());

      await deleteMessage(
        { config: configPath, channelId: "ch-1", messageId: "msg-1" },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "ch-1", "msg-1");
    });

    test("produces no output on success", async () => {
      const executor = mock(() => Promise.resolve());

      await deleteMessage(
        { config: configPath, channelId: "ch-1", messageId: "msg-1" },
        executor
      );

      expect(lines).toHaveLength(0);
    });
  });

  // --- reactMessage ---

  describe("reactMessage", () => {
    test("calls executor with correct args", async () => {
      const executor = mock(() => Promise.resolve());

      await reactMessage(
        {
          config: configPath,
          channelId: "ch-1",
          messageId: "msg-1",
          emoji: "\u{1F44D}",
        },
        executor
      );

      expect(executor).toHaveBeenCalledWith(
        "fake-token",
        "ch-1",
        "msg-1",
        "\u{1F44D}"
      );
    });

    test("produces no output on success", async () => {
      const executor = mock(() => Promise.resolve());

      await reactMessage(
        {
          config: configPath,
          channelId: "ch-1",
          messageId: "msg-1",
          emoji: "name:123456789",
        },
        executor
      );

      expect(lines).toHaveLength(0);
    });
  });

  // --- searchMessages ---

  describe("searchMessages", () => {
    test("prints each hit as NDJSON line", async () => {
      const msgs = [
        fakeMessage(),
        fakeMessage({ id: "msg-2", content: "second" }),
      ];
      const executor = mock(() => Promise.resolve(msgs));

      await searchMessages(
        {
          config: configPath,
          guildId: "guild-1",
          content: "hello",
          authorIds: [],
          channelIds: [],
          limit: 25,
          offset: 0,
        },
        executor
      );

      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]);
      expect(first.id).toBe("msg-1");
      expect(first.content).toBe("hello world");

      const second = JSON.parse(lines[1]);
      expect(second.id).toBe("msg-2");
    });

    test("passes options to executor", async () => {
      const executor = mock(() => Promise.resolve([]));

      await searchMessages(
        {
          config: configPath,
          guildId: "guild-1",
          content: "test",
          authorIds: ["user-1", "user-2"],
          authorType: "bot",
          channelIds: ["ch-1"],
          has: "link",
          limit: 10,
          offset: 50,
        },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "guild-1", {
        content: "test",
        authorIds: ["user-1", "user-2"],
        authorType: "bot",
        channelIds: ["ch-1"],
        has: "link",
        limit: 10,
        offset: 50,
      });
    });

    test("uses default limit 25 and offset 0 via dispatcher", async () => {
      const executor = mock(() => Promise.resolve([]));

      await searchMessages(
        {
          config: configPath,
          guildId: "guild-1",
          content: "test",
          authorIds: [],
          channelIds: [],
          limit: 25,
          offset: 0,
        },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "guild-1", {
        content: "test",
        authorIds: [],
        authorType: undefined,
        channelIds: [],
        has: undefined,
        limit: 25,
        offset: 0,
      });
    });

    test("rejects limit below 1", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            content: "test",
            authorIds: [],
            channelIds: [],
            limit: 0,
            offset: 0,
          },
          executor
        )
      ).rejects.toThrow("Limit must be 1-25");
    });

    test("rejects limit above 25", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            content: "test",
            authorIds: [],
            channelIds: [],
            limit: 26,
            offset: 0,
          },
          executor
        )
      ).rejects.toThrow("Limit must be 1-25");
    });

    test("rejects NaN limit", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            content: "test",
            authorIds: [],
            channelIds: [],
            limit: Number.NaN,
            offset: 0,
          },
          executor
        )
      ).rejects.toThrow("Limit must be 1-25");
    });

    test("rejects offset below 0", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            content: "test",
            authorIds: [],
            channelIds: [],
            limit: 25,
            offset: -1,
          },
          executor
        )
      ).rejects.toThrow("Offset must be 0-9975");
    });

    test("rejects offset above 9975", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            content: "test",
            authorIds: [],
            channelIds: [],
            limit: 25,
            offset: 9976,
          },
          executor
        )
      ).rejects.toThrow("Offset must be 0-9975");
    });

    test("rejects NaN offset", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            content: "test",
            authorIds: [],
            channelIds: [],
            limit: 25,
            offset: Number.NaN,
          },
          executor
        )
      ).rejects.toThrow("Offset must be 0-9975");
    });

    test("rejects when no filters provided", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            authorIds: [],
            channelIds: [],
            limit: 25,
            offset: 0,
          },
          executor
        )
      ).rejects.toThrow(
        "Search requires at least one filter: use --content, --author-id, --author-type, --channel-id, or --has"
      );
    });

    test("rejects invalid author-type", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            authorType: "webhook",
            authorIds: [],
            channelIds: [],
            limit: 25,
            offset: 0,
          },
          executor
        )
      ).rejects.toThrow('author-type must be "user" or "bot"');
    });

    test("rejects invalid has value", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            has: "sticker",
            authorIds: [],
            channelIds: [],
            limit: 25,
            offset: 0,
          },
          executor
        )
      ).rejects.toThrow(
        "has must be one of: link, embed, file, video, image, sound"
      );
    });

    test("rejects whitespace-only content as no filter", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        searchMessages(
          {
            config: configPath,
            guildId: "guild-1",
            content: "   ",
            authorIds: [],
            channelIds: [],
            limit: 25,
            offset: 0,
          },
          executor
        )
      ).rejects.toThrow(
        "Search requires at least one filter: use --content, --author-id, --author-type, --channel-id, or --has"
      );
    });

    test("trims content before passing to executor", async () => {
      const executor = mock(() => Promise.resolve([]));

      await searchMessages(
        {
          config: configPath,
          guildId: "guild-1",
          content: "  hello  ",
          authorIds: [],
          channelIds: [],
          limit: 25,
          offset: 0,
        },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "guild-1", {
        content: "hello",
        authorIds: [],
        authorType: undefined,
        channelIds: [],
        has: undefined,
        limit: 25,
        offset: 0,
      });
    });

    test("prints nothing when executor returns empty array", async () => {
      const executor = mock(() => Promise.resolve([]));

      await searchMessages(
        {
          config: configPath,
          guildId: "guild-1",
          content: "no-results",
          authorIds: [],
          channelIds: [],
          limit: 25,
          offset: 0,
        },
        executor
      );

      expect(lines).toHaveLength(0);
    });
  });

  // --- recentMessages ---

  describe("recentMessages", () => {
    test("prints each message as NDJSON line", async () => {
      const msgs = [
        fakeMessage(),
        fakeMessage({ id: "msg-2", content: "second" }),
      ];
      const executor = mock(() => Promise.resolve(msgs));

      await recentMessages(
        {
          config: configPath,
          guildId: "guild-1",
          channelIds: [],
          limit: 50,
        },
        executor
      );

      expect(lines).toHaveLength(2);
      const first = JSON.parse(lines[0]);
      expect(first.id).toBe("msg-1");
      expect(first.content).toBe("hello world");

      const second = JSON.parse(lines[1]);
      expect(second.id).toBe("msg-2");
    });

    test("passes options to executor", async () => {
      const executor = mock(() => Promise.resolve([]));

      await recentMessages(
        {
          config: configPath,
          guildId: "guild-1",
          channelIds: ["ch-1", "ch-2"],
          limit: 75,
        },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "guild-1", {
        channelIds: ["ch-1", "ch-2"],
        limit: 75,
      });
    });

    test("uses default limit 50 via dispatcher", async () => {
      const executor = mock(() => Promise.resolve([]));

      await recentMessages(
        {
          config: configPath,
          guildId: "guild-1",
          channelIds: [],
          limit: 50,
        },
        executor
      );

      expect(executor).toHaveBeenCalledWith("fake-token", "guild-1", {
        channelIds: [],
        limit: 50,
      });
    });

    test("rejects limit below 1", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        recentMessages(
          {
            config: configPath,
            guildId: "guild-1",
            channelIds: [],
            limit: 0,
          },
          executor
        )
      ).rejects.toThrow("Limit must be 1-100");
    });

    test("rejects limit above 100", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        recentMessages(
          {
            config: configPath,
            guildId: "guild-1",
            channelIds: [],
            limit: 101,
          },
          executor
        )
      ).rejects.toThrow("Limit must be 1-100");
    });

    test("rejects NaN limit", async () => {
      const executor = mock(() => Promise.resolve([]));

      await expect(
        recentMessages(
          {
            config: configPath,
            guildId: "guild-1",
            channelIds: [],
            limit: Number.NaN,
          },
          executor
        )
      ).rejects.toThrow("Limit must be 1-100");
    });

    test("prints nothing when executor returns empty array", async () => {
      const executor = mock(() => Promise.resolve([]));

      await recentMessages(
        {
          config: configPath,
          guildId: "guild-1",
          channelIds: [],
          limit: 50,
        },
        executor
      );

      expect(lines).toHaveLength(0);
    });
  });

  // --- buildSearchParams ---

  describe("buildSearchParams", () => {
    test("sets scalar params", () => {
      const params = buildSearchParams({
        content: "hello",
        authorIds: [],
        authorType: "bot",
        channelIds: [],
        has: "link",
        limit: 10,
        offset: 50,
      });

      expect(params.get("q")).toBe("hello");
      expect(params.get("author_type")).toBe("bot");
      expect(params.get("has")).toBe("link");
      expect(params.get("limit")).toBe("10");
      expect(params.get("offset")).toBe("50");
    });

    test("repeats author_id for multiple authors", () => {
      const params = buildSearchParams({
        authorIds: ["user-1", "user-2", "user-3"],
        channelIds: [],
        limit: 25,
        offset: 0,
      });

      expect(params.getAll("author_id")).toEqual([
        "user-1",
        "user-2",
        "user-3",
      ]);
    });

    test("repeats channel_id for multiple channels", () => {
      const params = buildSearchParams({
        authorIds: [],
        channelIds: ["ch-1", "ch-2"],
        limit: 25,
        offset: 0,
      });

      expect(params.getAll("channel_id")).toEqual(["ch-1", "ch-2"]);
    });

    test("omits optional params when not provided", () => {
      const params = buildSearchParams({
        authorIds: [],
        channelIds: [],
        limit: 25,
        offset: 0,
      });

      expect(params.has("q")).toBe(false);
      expect(params.has("author_type")).toBe(false);
      expect(params.has("has")).toBe(false);
      expect(params.has("author_id")).toBe(false);
      expect(params.has("channel_id")).toBe(false);
      expect(params.get("limit")).toBe("25");
      expect(params.get("offset")).toBe("0");
    });

    test("appends sort_by and sort_order when provided", () => {
      const params = buildSearchParams({
        authorIds: [],
        channelIds: [],
        limit: 25,
        offset: 0,
        sortBy: "timestamp",
        sortOrder: "desc",
      });

      expect(params.get("sort_by")).toBe("timestamp");
      expect(params.get("sort_order")).toBe("desc");
    });

    test("omits sort_by and sort_order when not provided", () => {
      const params = buildSearchParams({
        authorIds: [],
        channelIds: [],
        limit: 25,
        offset: 0,
      });

      expect(params.has("sort_by")).toBe(false);
      expect(params.has("sort_order")).toBe(false);
    });

    test("includes all params when fully specified", () => {
      const params = buildSearchParams({
        content: "test",
        authorIds: ["u1"],
        authorType: "user",
        channelIds: ["c1"],
        has: "image",
        limit: 5,
        offset: 100,
      });

      expect(params.get("q")).toBe("test");
      expect(params.getAll("author_id")).toEqual(["u1"]);
      expect(params.get("author_type")).toBe("user");
      expect(params.getAll("channel_id")).toEqual(["c1"]);
      expect(params.get("has")).toBe("image");
      expect(params.get("limit")).toBe("5");
      expect(params.get("offset")).toBe("100");
    });
  });

  // --- extractSearchHits ---

  describe("extractSearchHits", () => {
    test("extracts middle element from 3-element groups", () => {
      const groups = [
        ["a", "b", "c"],
        ["d", "e", "f"],
      ];

      expect(extractSearchHits(groups)).toEqual(["b", "e"]);
    });

    test("extracts element from single-element groups", () => {
      const groups = [["x"], ["y"]];

      expect(extractSearchHits(groups)).toEqual(["x", "y"]);
    });

    test("filters out empty groups", () => {
      const groups = [["a", "b", "c"], [], ["d"]];

      expect(extractSearchHits(groups)).toEqual(["b", "d"]);
    });

    test("returns empty array for empty input", () => {
      expect(extractSearchHits([])).toEqual([]);
    });

    test("returns empty array when all groups are empty", () => {
      expect(extractSearchHits([[], [], []])).toEqual([]);
    });
  });

  // --- messagesCommand dispatcher ---

  describe("messagesCommand dispatcher", () => {
    test("rejects unknown subcommand", async () => {
      await expect(
        messagesCommand(["unknown"], { config: configPath })
      ).rejects.toThrow(
        "Usage: ddd messages <list|send|edit|delete|react|search|recent>"
      );
    });

    test("rejects missing subcommand", async () => {
      await expect(messagesCommand([], { config: configPath })).rejects.toThrow(
        "Usage: ddd messages <list|send|edit|delete|react|search|recent>"
      );
    });

    test("rejects list without channel_id", async () => {
      await expect(
        messagesCommand(["list"], { config: configPath })
      ).rejects.toThrow("Usage: ddd messages list <channel_id>");
    });

    test("rejects send without channel_id", async () => {
      await expect(
        messagesCommand(["send"], { config: configPath })
      ).rejects.toThrow("Usage: ddd messages send <channel_id>");
    });

    test("rejects edit without channel_id or message_id", async () => {
      await expect(
        messagesCommand(["edit"], { config: configPath })
      ).rejects.toThrow("Usage: ddd messages edit <channel_id> <message_id>");
    });

    test("rejects edit with only channel_id", async () => {
      await expect(
        messagesCommand(["edit", "ch-1"], { config: configPath })
      ).rejects.toThrow("Usage: ddd messages edit <channel_id> <message_id>");
    });

    test("rejects delete without channel_id or message_id", async () => {
      await expect(
        messagesCommand(["delete"], { config: configPath })
      ).rejects.toThrow("Usage: ddd messages delete <channel_id> <message_id>");
    });

    test("rejects react without emoji", async () => {
      await expect(
        messagesCommand(["react", "ch-1", "msg-1"], { config: configPath })
      ).rejects.toThrow(
        "Usage: ddd messages react <channel_id> <message_id> <emoji>"
      );
    });

    test("rejects react without message_id and emoji", async () => {
      await expect(
        messagesCommand(["react", "ch-1"], { config: configPath })
      ).rejects.toThrow(
        "Usage: ddd messages react <channel_id> <message_id> <emoji>"
      );
    });

    test("rejects search without guild_id", async () => {
      await expect(
        messagesCommand(["search"], { config: configPath })
      ).rejects.toThrow("Usage: ddd messages search <guild_id> [flags]");
    });

    test("rejects recent without guild_id", async () => {
      await expect(
        messagesCommand(["recent"], { config: configPath })
      ).rejects.toThrow("Usage: ddd messages recent <guild_id> [flags]");
    });
  });
});
