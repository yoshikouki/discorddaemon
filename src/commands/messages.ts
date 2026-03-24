import type { Client, TextBasedChannel } from "discord.js";
import { GatewayIntentBits } from "discord.js";
import { loadConfig } from "../config";
import { withDiscordClient } from "../discord";
import { buildMessageInfo, type MessageInfo } from "../message-info";
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

// --- Helpers ---

async function fetchTextChannel(
  client: Client<true>,
  channelId: string
): Promise<TextBasedChannel> {
  const channel = await client.channels.fetch(channelId);
  if (!(channel && "messages" in channel)) {
    throw new Error(`Channel ${channelId} is not a text channel`);
  }
  return channel as TextBasedChannel;
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
      const message = await (
        channel as Extract<TextBasedChannel, { send: unknown }>
      ).send({ content });
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
  if (!content) {
    content = await stdinReader();
  }

  if (!content) {
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
  if (!content) {
    content = await stdinReader();
  }

  if (!content) {
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

// --- Dispatcher ---

export async function messagesCommand(
  positionals: string[],
  values: {
    config?: string;
    content?: string;
    limit?: string;
    before?: string;
    after?: string;
    around?: string;
  }
): Promise<void> {
  const subcommand = positionals[0];

  switch (subcommand) {
    case "list": {
      const channelId = positionals[1];
      if (!channelId) {
        throw new Error("Usage: ddd messages list <channel_id> [-n limit]");
      }
      await listMessages({
        config: values.config,
        channelId,
        limit: values.limit ? Number.parseInt(values.limit, 10) : 50,
        before: values.before,
        after: values.after,
        around: values.around,
      });
      break;
    }
    case "send": {
      const channelId = positionals[1];
      if (!channelId) {
        throw new Error("Usage: ddd messages send <channel_id> [-m content]");
      }
      await sendMessage({
        config: values.config,
        channelId,
        content: values.content,
      });
      break;
    }
    case "edit": {
      const channelId = positionals[1];
      const messageId = positionals[2];
      if (!(channelId && messageId)) {
        throw new Error(
          "Usage: ddd messages edit <channel_id> <message_id> [-m content]"
        );
      }
      await editMessage({
        config: values.config,
        channelId,
        messageId,
        content: values.content,
      });
      break;
    }
    case "delete": {
      const channelId = positionals[1];
      const messageId = positionals[2];
      if (!(channelId && messageId)) {
        throw new Error("Usage: ddd messages delete <channel_id> <message_id>");
      }
      await deleteMessage({
        config: values.config,
        channelId,
        messageId,
      });
      break;
    }
    case "react": {
      const channelId = positionals[1];
      const messageId = positionals[2];
      const emoji = positionals[3];
      if (!(channelId && messageId && emoji)) {
        throw new Error(
          "Usage: ddd messages react <channel_id> <message_id> <emoji>"
        );
      }
      await reactMessage({
        config: values.config,
        channelId,
        messageId,
        emoji,
      });
      break;
    }
    default:
      throw new Error("Usage: ddd messages <list|send|edit|delete|react> ...");
  }
}
