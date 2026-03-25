import type { Client } from "discord.js";
import { GatewayIntentBits } from "discord.js";
import { loadConfig } from "../config";
import { withDiscordClient } from "../discord";
import {
  hybridDeleteExecutor,
  hybridEditExecutor,
  hybridGuildResolver,
  hybridListExecutor,
  hybridReactExecutor,
  hybridRecentExecutor,
  hybridSearchExecutor,
  hybridSendExecutor,
} from "../ipc/executors";
import {
  buildMessageInfo,
  buildMessageInfoFromRaw,
  type MessageInfo,
  type RawDiscordMessage,
} from "../message-info";
import { readStdin } from "../stdin";
import {
  VALID_AUTHOR_TYPES,
  VALID_HAS_VALUES,
  validateEnum,
  validateLimit,
  validateMutuallyExclusive,
  validateOffset,
  validateSearchFilters,
} from "../validators";

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

export type MessageRecentExecutor = (
  token: string,
  guildId: string,
  options: {
    channelIds: string[];
    limit: number;
  }
) => Promise<MessageInfo[]>;

export type GuildResolverFn = (
  token: string,
  configGuild?: string,
  cliGuild?: string
) => Promise<string>;

// --- Exported pure helpers ---

export function buildSearchParams(options: {
  content?: string;
  authorIds: string[];
  authorType?: string;
  channelIds: string[];
  has?: string;
  limit: number;
  offset: number;
  sortBy?: string;
  sortOrder?: string;
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
  if (options.sortBy) {
    params.append("sort_by", options.sortBy);
  }
  if (options.sortOrder) {
    params.append("sort_order", options.sortOrder);
  }
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

async function resolveGuildContext(
  client: Client<true>,
  guildId: string
): Promise<{
  guildName: string | null;
}> {
  let guildName: string | null = null;
  try {
    const guild = await client.guilds.fetch(guildId);
    guildName = guild.name;
  } catch {
    guildName = guildId;
  }
  return { guildName };
}

async function resolveChannelNames(
  client: Client<true>,
  channelIds: string[]
): Promise<Map<string, string | null>> {
  const channelNames = new Map<string, string | null>();
  for (const cid of channelIds) {
    try {
      const ch = await client.channels.fetch(cid);
      channelNames.set(cid, ch && "name" in ch ? (ch.name as string) : null);
    } catch {
      channelNames.set(cid, null);
    }
  }
  return channelNames;
}

// --- Impl functions (business logic, used by both one-shot and IPC) ---

export async function listMessagesImpl(
  client: Client<true>,
  channelId: string,
  options: { limit: number; before?: string; after?: string; around?: string }
): Promise<MessageInfo[]> {
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

export async function sendMessageImpl(
  client: Client<true>,
  channelId: string,
  content: string
): Promise<MessageInfo> {
  const channel = await fetchTextChannel(client, channelId);
  if (!channel.isSendable()) {
    throw new Error(`Channel ${channelId} is not sendable`);
  }
  const message = await channel.send({ content });
  return buildMessageInfo(message);
}

export async function editMessageImpl(
  client: Client<true>,
  channelId: string,
  messageId: string,
  content: string
): Promise<MessageInfo> {
  const channel = await fetchTextChannel(client, channelId);
  const message = await channel.messages.edit(messageId, { content });
  return buildMessageInfo(message);
}

export async function deleteMessageImpl(
  client: Client<true>,
  channelId: string,
  messageId: string
): Promise<void> {
  const channel = await fetchTextChannel(client, channelId);
  await channel.messages.delete(messageId);
}

export async function reactMessageImpl(
  client: Client<true>,
  channelId: string,
  messageId: string,
  emoji: string
): Promise<void> {
  const channel = await fetchTextChannel(client, channelId);
  await channel.messages.react(messageId, emoji);
}

export async function searchMessagesImpl(
  client: Client<true>,
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
  const params = buildSearchParams(options);

  const response = (await client.rest.get(
    `/guilds/${guildId}/messages/search`,
    { query: params }
  )) as { messages: RawDiscordMessage[][]; total_results: number };

  const hits = extractSearchHits(response.messages);

  const { guildName } = await resolveGuildContext(client, guildId);

  const channelIds = [...new Set(hits.map((m) => m.channel_id))];
  const channelNames = await resolveChannelNames(client, channelIds);

  return hits.map((raw) =>
    buildMessageInfoFromRaw(raw, {
      guildId,
      guildName: guildName ?? guildId,
      channelNames,
    })
  );
}

export async function recentMessagesImpl(
  client: Client<true>,
  guildId: string,
  options: {
    channelIds: string[];
    limit: number;
  }
): Promise<MessageInfo[]> {
  const pageSize = 25;
  const allHits: RawDiscordMessage[] = [];

  for (let offset = 0; offset < options.limit; offset += pageSize) {
    const remaining = options.limit - offset;
    const currentLimit = Math.min(pageSize, remaining);
    const params = buildSearchParams({
      authorIds: [],
      channelIds: options.channelIds,
      limit: currentLimit,
      offset,
      sortBy: "timestamp",
      sortOrder: "desc",
    });

    const response = (await client.rest.get(
      `/guilds/${guildId}/messages/search`,
      { query: params }
    )) as { messages: RawDiscordMessage[][]; total_results: number };

    const hits = extractSearchHits(response.messages);
    allHits.push(...hits);

    if (hits.length < currentLimit) {
      break;
    }
  }

  const { guildName } = await resolveGuildContext(client, guildId);

  const channelIds = [...new Set(allHits.map((m) => m.channel_id))];
  const channelNames = await resolveChannelNames(client, channelIds);

  return allHits.map((raw) =>
    buildMessageInfoFromRaw(raw, {
      guildId,
      guildName: guildName ?? guildId,
      channelNames,
    })
  );
}

export function defaultGuildResolver(
  token: string,
  configGuild?: string,
  cliGuild?: string
): Promise<string> {
  if (cliGuild) {
    return Promise.resolve(cliGuild);
  }
  if (configGuild) {
    return Promise.resolve(configGuild);
  }
  return withDiscordClient(token, [GatewayIntentBits.Guilds], (client) => {
    const guilds = client.guilds.cache;
    if (guilds.size === 0) {
      throw new Error("Bot is not in any guild");
    }
    if (guilds.size === 1) {
      const first = guilds.first();
      if (!first) {
        throw new Error("Bot is not in any guild");
      }
      return Promise.resolve(first.id);
    }
    const list = guilds
      .map((g) => `  ${g.id} ${g.name}`)
      .toJSON()
      .join("\n");
    throw new Error(
      `Multiple guilds found. Specify guild_id or set default_guild in config:\n${list}`
    );
  });
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
  executor: MessageListExecutor = hybridListExecutor
): Promise<void> {
  validateLimit(args.limit, 1, 100);

  validateMutuallyExclusive(
    { before: args.before, after: args.after, around: args.around },
    ["before", "after", "around"],
    "--before, --after, and --around are mutually exclusive"
  );

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
  executor: MessageSendExecutor = hybridSendExecutor,
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
  executor: MessageEditExecutor = hybridEditExecutor,
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
  executor: MessageDeleteExecutor = hybridDeleteExecutor
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
  executor: MessageReactExecutor = hybridReactExecutor
): Promise<void> {
  const config = await loadConfig(args.config);
  await executor(config.token, args.channelId, args.messageId, args.emoji);
}

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
  executor: MessageSearchExecutor = hybridSearchExecutor
): Promise<void> {
  validateLimit(args.limit, 1, 25);
  validateOffset(args.offset);

  const trimmedContent = args.content?.trim() || undefined;

  validateSearchFilters({
    content: trimmedContent,
    authorIds: args.authorIds,
    authorType: args.authorType,
    channelIds: args.channelIds,
    has: args.has,
  });

  if (args.authorType) {
    validateEnum(
      args.authorType,
      VALID_AUTHOR_TYPES,
      'author-type must be "user" or "bot"'
    );
  }

  if (args.has) {
    validateEnum(
      args.has,
      VALID_HAS_VALUES,
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

export async function recentMessages(
  args: {
    config?: string;
    guildId?: string;
    channelIds: string[];
    limit: number;
  },
  executor: MessageRecentExecutor = hybridRecentExecutor,
  guildResolver: GuildResolverFn = hybridGuildResolver
): Promise<void> {
  validateLimit(args.limit, 1, 100);

  const config = await loadConfig(args.config);
  const guildId = await guildResolver(
    config.token,
    config.defaultGuild,
    args.guildId
  );
  const messages = await executor(config.token, guildId, {
    channelIds: args.channelIds,
    limit: args.limit,
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

function dispatchRecent(positionals: string[], values: DispatcherValues) {
  const guildId = positionals[1]; // may be undefined — resolved inside recentMessages
  return recentMessages({
    config: values.config,
    guildId,
    channelIds: values["channel-id"] ?? [],
    limit: values.limit ? Number.parseInt(values.limit, 10) : 50,
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
    case "recent":
      await dispatchRecent(positionals, values);
      break;
    default:
      throw new Error(
        "Usage: ddd messages <list|send|edit|delete|react|search|recent> ..."
      );
  }
}
