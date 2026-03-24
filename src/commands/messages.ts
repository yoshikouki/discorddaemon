import type { Client } from "discord.js";
import { GatewayIntentBits } from "discord.js";
import { loadConfig } from "../config";
import { withDiscordClient } from "../discord";
import {
  buildMessageInfo,
  buildMessageInfoFromRaw,
  type MessageInfo,
  type RawDiscordMessage,
} from "../message-info";
import { readStdin } from "../stdin";

// --- DI types ---

export type MessageListExecutor = (
  token: string,
  channelId: string,
  options: { limit: number; before?: string; after?: string; around?: string }
) => Promise<MessageInfo[]>;

export type MessageSendExecutor = (
  token: string,
  channelId: string,
  content: string
) => Promise<MessageInfo>;

export type MessageEditExecutor = (
  token: string,
  channelId: string,
  messageId: string,
  content: string
) => Promise<MessageInfo>;

export type MessageDeleteExecutor = (
  token: string,
  channelId: string,
  messageId: string
) => Promise<void>;

export type MessageReactExecutor = (
  token: string,
  channelId: string,
  messageId: string,
  emoji: string
) => Promise<void>;

export type MessageSearchExecutor = (
  token: string,
  guildId: string,
  options: {
    content?: string;
    authorIds: string[];
    authorType?: string;
    channelIds: string[];
    has?: string;
    limit: number;
    offset: number;
  }
) => Promise<MessageInfo[]>;

// --- Exported pure helpers ---

export function buildSearchParams(options: {
  content?: string;
  authorIds: string[];
  authorType?: string;
  channelIds: string[];
  has?: string;
  limit: number;
  offset: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (options.content) {
    params.append("q", options.content);
  }
  if (options.authorType) {
    params.append("author_type", options.authorType);
  }
  if (options.has) {
    params.append("has", options.has);
  }
  for (const id of options.authorIds) {
    params.append("author_id", id);
  }
  for (const id of options.channelIds) {
    params.append("channel_id", id);
  }
  params.append("limit", String(options.limit));
  params.append("offset", String(options.offset));
  return params;
}

export function extractSearchHits<T>(groups: T[][]): T[] {
  return groups
    .filter((g) => g.length > 0)
    .map((g) => g[Math.floor(g.length / 2)]);
}

// --- Helpers ---

async function fetchTextChannel(client: Client<true>, channelId: string) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }
  return channel;
}

// --- Production executors ---

function defaultListExecutor(
  token: string,
  channelId: string,
  options: { limit: number; before?: string; after?: string; around?: string }
): Promise<MessageInfo[]> {
  return withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    async (client) => {
      const channel = await fetchTextChannel(client, channelId);
      const fetchOpts: Record<string, unknown> = { limit: options.limit };
      if (options.before) {
        fetchOpts.before = options.before;
      }
      if (options.after) {
        fetchOpts.after = options.after;
      }
      if (options.around) {
        fetchOpts.around = options.around;
      }
      const messages = await channel.messages.fetch(fetchOpts);
      return [...messages.values()].map(buildMessageInfo);
    }
  );
}

function defaultSendExecutor(
  token: string,
  channelId: string,
  content: string
): Promise<MessageInfo> {
  return withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    async (client) => {
      const channel = await fetchTextChannel(client, channelId);
      if (!channel.isSendable()) {
        throw new Error(`Channel ${channelId} is not sendable`);
      }
      const message = await channel.send({ content });
      return buildMessageInfo(message);
    }
  );
}

function defaultEditExecutor(
  token: string,
  channelId: string,
  messageId: string,
  content: string
): Promise<MessageInfo> {
  return withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    async (client) => {
      const channel = await fetchTextChannel(client, channelId);
      const message = await channel.messages.edit(messageId, { content });
      return buildMessageInfo(message);
    }
  );
}

function defaultDeleteExecutor(
  token: string,
  channelId: string,
  messageId: string
): Promise<void> {
  return withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    async (client) => {
      const channel = await fetchTextChannel(client, channelId);
      await channel.messages.delete(messageId);
    }
  );
}

function defaultReactExecutor(
  token: string,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  return withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    async (client) => {
      const channel = await fetchTextChannel(client, channelId);
      await channel.messages.react(messageId, emoji);
    }
  );
}

function defaultSearchExecutor(
  token: string,
  guildId: string,
  options: {
    content?: string;
    authorIds: string[];
    authorType?: string;
    channelIds: string[];
    has?: string;
    limit: number;
    offset: number;
  }
): Promise<MessageInfo[]> {
  return withDiscordClient(
    token,
    [GatewayIntentBits.Guilds],
    async (client) => {
      const params = buildSearchParams(options);

      const response = (await client.rest.get(
        `/guilds/${guildId}/messages/search`,
        { query: params }
      )) as { messages: RawDiscordMessage[][]; total_results: number };

      const hits = extractSearchHits(response.messages);

      let guildName: string | null = null;
      try {
        const guild = await client.guilds.fetch(guildId);
        guildName = guild.name;
      } catch {
        guildName = guildId;
      }

      const channelIds = [...new Set(hits.map((m) => m.channel_id))];
      const channelNames = new Map<string, string | null>();
      for (const cid of channelIds) {
        try {
          const ch = await client.channels.fetch(cid);
          channelNames.set(
            cid,
            ch && "name" in ch ? (ch.name as string) : null
          );
        } catch {
          channelNames.set(cid, null);
        }
      }

      return hits.map((raw) =>
        buildMessageInfoFromRaw(raw, {
          guildId,
          guildName,
          channelNames,
        })
      );
    }
  );
}

// --- Subcommands ---

export async function listMessages(
  args: {
    config?: string;
    channelId: string;
    limit: number;
    before?: string;
    after?: string;
    around?: string;
  },
  executor: MessageListExecutor = defaultListExecutor
): Promise<void> {
  if (!(args.limit >= 1 && args.limit <= 100)) {
    throw new Error("Limit must be 1-100");
  }

  const exclusive = [args.before, args.after, args.around].filter(Boolean);
  if (exclusive.length > 1) {
    throw new Error("--before, --after, and --around are mutually exclusive");
  }

  const config = await loadConfig(args.config);
  const messages = await executor(config.token, args.channelId, {
    limit: args.limit,
    before: args.before,
    after: args.after,
    around: args.around,
  });

  for (const msg of messages) {
    console.log(JSON.stringify(msg));
  }
}

export async function sendMessage(
  args: {
    config?: string;
    channelId: string;
    content?: string;
  },
  executor: MessageSendExecutor = defaultSendExecutor,
  stdinReader: () => Promise<string | undefined> = readStdin
): Promise<void> {
  let content = args.content;
  if (content === undefined) {
    content = await stdinReader();
  }

  if (content === undefined) {
    throw new Error("Content required: use --content or pipe to stdin");
  }

  if (!content.trim()) {
    throw new Error("Content must not be empty");
  }

  const config = await loadConfig(args.config);
  const message = await executor(config.token, args.channelId, content);
  console.log(JSON.stringify(message));
}

export async function editMessage(
  args: {
    config?: string;
    channelId: string;
    messageId: string;
    content?: string;
  },
  executor: MessageEditExecutor = defaultEditExecutor,
  stdinReader: () => Promise<string | undefined> = readStdin
): Promise<void> {
  let content = args.content;
  if (content === undefined) {
    content = await stdinReader();
  }

  if (content === undefined) {
    throw new Error("Content required: use --content or pipe to stdin");
  }

  if (!content.trim()) {
    throw new Error("Content must not be empty");
  }

  const config = await loadConfig(args.config);
  const message = await executor(
    config.token,
    args.channelId,
    args.messageId,
    content
  );
  console.log(JSON.stringify(message));
}

export async function deleteMessage(
  args: {
    config?: string;
    channelId: string;
    messageId: string;
  },
  executor: MessageDeleteExecutor = defaultDeleteExecutor
): Promise<void> {
  const config = await loadConfig(args.config);
  await executor(config.token, args.channelId, args.messageId);
}

export async function reactMessage(
  args: {
    config?: string;
    channelId: string;
    messageId: string;
    emoji: string;
  },
  executor: MessageReactExecutor = defaultReactExecutor
): Promise<void> {
  const config = await loadConfig(args.config);
  await executor(config.token, args.channelId, args.messageId, args.emoji);
}

const VALID_HAS_VALUES = new Set([
  "link",
  "embed",
  "file",
  "video",
  "image",
  "sound",
]);

export async function searchMessages(
  args: {
    config?: string;
    guildId: string;
    content?: string;
    authorIds: string[];
    authorType?: string;
    channelIds: string[];
    has?: string;
    limit: number;
    offset: number;
  },
  executor: MessageSearchExecutor = defaultSearchExecutor
): Promise<void> {
  if (!(args.limit >= 1 && args.limit <= 25)) {
    throw new Error("Limit must be 1-25");
  }

  if (!(args.offset >= 0 && args.offset <= 9975)) {
    throw new Error("Offset must be 0-9975");
  }

  const trimmedContent = args.content?.trim() || undefined;

  const hasFilter =
    trimmedContent ||
    args.authorIds.length > 0 ||
    args.authorType ||
    args.channelIds.length > 0 ||
    args.has;
  if (!hasFilter) {
    throw new Error(
      "Search requires at least one filter: use --content, --author-id, --author-type, --channel-id, or --has"
    );
  }

  if (
    args.authorType &&
    args.authorType !== "user" &&
    args.authorType !== "bot"
  ) {
    throw new Error('author-type must be "user" or "bot"');
  }

  if (args.has && !VALID_HAS_VALUES.has(args.has)) {
    throw new Error(
      "has must be one of: link, embed, file, video, image, sound"
    );
  }

  const config = await loadConfig(args.config);
  const messages = await executor(config.token, args.guildId, {
    content: trimmedContent,
    authorIds: args.authorIds,
    authorType: args.authorType,
    channelIds: args.channelIds,
    has: args.has,
    limit: args.limit,
    offset: args.offset,
  });

  for (const msg of messages) {
    console.log(JSON.stringify(msg));
  }
}

// --- Dispatcher helpers ---

interface DispatcherValues {
  after?: string;
  around?: string;
  "author-id"?: string[];
  "author-type"?: string;
  before?: string;
  "channel-id"?: string[];
  config?: string;
  content?: string;
  has?: string;
  limit?: string;
  offset?: string;
}

function dispatchList(positionals: string[], values: DispatcherValues) {
  const channelId = positionals[1];
  if (!channelId) {
    throw new Error("Usage: ddd messages list <channel_id> [-n limit]");
  }
  return listMessages({
    config: values.config,
    channelId,
    limit: values.limit ? Number.parseInt(values.limit, 10) : 50,
    before: values.before,
    after: values.after,
    around: values.around,
  });
}

function dispatchSend(positionals: string[], values: DispatcherValues) {
  const channelId = positionals[1];
  if (!channelId) {
    throw new Error("Usage: ddd messages send <channel_id> [-m content]");
  }
  return sendMessage({
    config: values.config,
    channelId,
    content: values.content,
  });
}

function dispatchEdit(positionals: string[], values: DispatcherValues) {
  const channelId = positionals[1];
  const messageId = positionals[2];
  if (!(channelId && messageId)) {
    throw new Error(
      "Usage: ddd messages edit <channel_id> <message_id> [-m content]"
    );
  }
  return editMessage({
    config: values.config,
    channelId,
    messageId,
    content: values.content,
  });
}

function dispatchDelete(positionals: string[], values: DispatcherValues) {
  const channelId = positionals[1];
  const messageId = positionals[2];
  if (!(channelId && messageId)) {
    throw new Error("Usage: ddd messages delete <channel_id> <message_id>");
  }
  return deleteMessage({
    config: values.config,
    channelId,
    messageId,
  });
}

function dispatchReact(positionals: string[], values: DispatcherValues) {
  const channelId = positionals[1];
  const messageId = positionals[2];
  const emoji = positionals[3];
  if (!(channelId && messageId && emoji)) {
    throw new Error(
      "Usage: ddd messages react <channel_id> <message_id> <emoji>"
    );
  }
  return reactMessage({
    config: values.config,
    channelId,
    messageId,
    emoji,
  });
}

function dispatchSearch(positionals: string[], values: DispatcherValues) {
  const guildId = positionals[1];
  if (!guildId) {
    throw new Error("Usage: ddd messages search <guild_id> [flags]");
  }
  return searchMessages({
    config: values.config,
    guildId,
    content: values.content,
    authorIds: values["author-id"] ?? [],
    authorType: values["author-type"],
    channelIds: values["channel-id"] ?? [],
    has: values.has,
    limit: values.limit ? Number.parseInt(values.limit, 10) : 25,
    offset: values.offset ? Number.parseInt(values.offset, 10) : 0,
  });
}

// --- Dispatcher ---

export async function messagesCommand(
  positionals: string[],
  values: DispatcherValues
): Promise<void> {
  const subcommand = positionals[0];

  switch (subcommand) {
    case "list":
      await dispatchList(positionals, values);
      break;
    case "send":
      await dispatchSend(positionals, values);
      break;
    case "edit":
      await dispatchEdit(positionals, values);
      break;
    case "delete":
      await dispatchDelete(positionals, values);
      break;
    case "react":
      await dispatchReact(positionals, values);
      break;
    case "search":
      await dispatchSearch(positionals, values);
      break;
    default:
      throw new Error(
        "Usage: ddd messages <list|send|edit|delete|react|search> ..."
      );
  }
}
