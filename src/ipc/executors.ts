import type { ChannelInfo } from "../commands/channels";
import type {
  GuildResolverFn,
  MessageDeleteExecutor,
  MessageEditExecutor,
  MessageListExecutor,
  MessageReactExecutor,
  MessageRecentExecutor,
  MessageSearchExecutor,
  MessageSendExecutor,
} from "../commands/messages";
import type { MessageInfo } from "../message-info";
import { IpcClient } from "./client";
import { probeDaemon } from "./probe";
import { ConnectionRefusedError } from "./protocol";

// --- Generic hybrid executor factory ---

/**
 * Creates a hybrid executor that tries IPC first and falls back to one-shot.
 *
 * Read-only commands use safeToRetry=true: any IPC error triggers fallback.
 * Write commands use safeToRetry=false: only ConnectionRefusedError (request
 * never sent) triggers fallback. Other errors are re-thrown to prevent
 * double-execution of side effects.
 */
function createHybridExecutor<Args extends unknown[], T>(
  ipcExecutor: (...args: Args) => Promise<T>,
  oneshotExecutor: (...args: Args) => Promise<T>,
  options: { safeToRetry: boolean } = { safeToRetry: true }
): (...args: Args) => Promise<T> {
  return async (...args: Args): Promise<T> => {
    const token = args[0] as string;
    const probe = await probeDaemon(token);
    if (!probe.available) {
      return oneshotExecutor(...args);
    }

    try {
      return await ipcExecutor(...args);
    } catch (err) {
      if (err instanceof ConnectionRefusedError) {
        // Request never sent — safe to fallback for any command
        return oneshotExecutor(...args);
      }
      if (options.safeToRetry) {
        // Read-only command — safe to fallback regardless of failure mode
        return oneshotExecutor(...args);
      }
      // Side-effect command and request may have been sent — NOT safe to retry
      throw err;
    }
  };
}

// --- IPC executors (talk to daemon via socket) ---

const ipcListExecutor: MessageListExecutor = (_token, channelId, options) => {
  const client = new IpcClient();
  return client.call<MessageInfo[]>("messages/list", {
    channelId,
    ...options,
  });
};

const ipcSendExecutor: MessageSendExecutor = (_token, channelId, content) => {
  const client = new IpcClient();
  return client.call<MessageInfo>("messages/send", { channelId, content });
};

const ipcEditExecutor: MessageEditExecutor = (
  _token,
  channelId,
  messageId,
  content
) => {
  const client = new IpcClient();
  return client.call<MessageInfo>("messages/edit", {
    channelId,
    messageId,
    content,
  });
};

const ipcDeleteExecutor: MessageDeleteExecutor = (
  _token,
  channelId,
  messageId
) => {
  const client = new IpcClient();
  return client.call<void>("messages/delete", { channelId, messageId });
};

const ipcReactExecutor: MessageReactExecutor = (
  _token,
  channelId,
  messageId,
  emoji
) => {
  const client = new IpcClient();
  return client.call<void>("messages/react", {
    channelId,
    messageId,
    emoji,
  });
};

const ipcSearchExecutor: MessageSearchExecutor = (_token, guildId, options) => {
  const client = new IpcClient();
  return client.call<MessageInfo[]>("messages/search", {
    guildId,
    ...options,
  });
};

const ipcRecentExecutor: MessageRecentExecutor = (_token, guildId, options) => {
  const client = new IpcClient();
  return client.call<MessageInfo[]>("messages/recent", {
    guildId,
    ...options,
  });
};

// --- IPC channels fetcher ---

function ipcChannelsFetcher(_token: string): Promise<ChannelInfo[]> {
  const client = new IpcClient();
  return client.call<ChannelInfo[]>("channels/list", {});
}

// --- IPC guild resolver ---

const ipcGuildResolver: GuildResolverFn = async (
  _token,
  configGuild?,
  cliGuild?
) => {
  if (cliGuild) {
    return cliGuild;
  }
  if (configGuild) {
    return configGuild;
  }
  const client = new IpcClient();
  const result = await client.call<{ guildId: string }>("guild/resolve", {});
  return result.guildId;
};

// --- Hybrid executor exports ---

// We need the one-shot executors from messages.ts.
// Import them lazily to avoid circular dependency issues.
// The default executors are private in messages.ts, so we import the
// impl functions and withDiscordClient to construct one-shot executors.
import { GatewayIntentBits } from "discord.js";
import { fetchDiscordChannels } from "../commands/channels";
import {
  deleteMessageImpl,
  editMessageImpl,
  listMessagesImpl,
  defaultGuildResolver as oneshotGuildResolver,
  reactMessageImpl,
  recentMessagesImpl,
  searchMessagesImpl,
  sendMessageImpl,
} from "../commands/messages";
import { withDiscordClient } from "../discord";

const oneshotListExecutor: MessageListExecutor = (token, channelId, options) =>
  withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    (client) => listMessagesImpl(client, channelId, options)
  );

const oneshotSendExecutor: MessageSendExecutor = (token, channelId, content) =>
  withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    (client) => sendMessageImpl(client, channelId, content)
  );

const oneshotEditExecutor: MessageEditExecutor = (
  token,
  channelId,
  messageId,
  content
) =>
  withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    (client) => editMessageImpl(client, channelId, messageId, content)
  );

const oneshotDeleteExecutor: MessageDeleteExecutor = (
  token,
  channelId,
  messageId
) =>
  withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    (client) => deleteMessageImpl(client, channelId, messageId)
  );

const oneshotReactExecutor: MessageReactExecutor = (
  token,
  channelId,
  messageId,
  emoji
) =>
  withDiscordClient(
    token,
    [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    (client) => reactMessageImpl(client, channelId, messageId, emoji)
  );

const oneshotSearchExecutor: MessageSearchExecutor = (
  token,
  guildId,
  options
) =>
  withDiscordClient(token, [GatewayIntentBits.Guilds], (client) =>
    searchMessagesImpl(client, guildId, options)
  );

const oneshotRecentExecutor: MessageRecentExecutor = (
  token,
  guildId,
  options
) =>
  withDiscordClient(token, [GatewayIntentBits.Guilds], (client) =>
    recentMessagesImpl(client, guildId, options)
  );

// Read-only commands: safeToRetry = true (default)
export const hybridListExecutor = createHybridExecutor(
  ipcListExecutor,
  oneshotListExecutor
);

export const hybridSearchExecutor = createHybridExecutor(
  ipcSearchExecutor,
  oneshotSearchExecutor
);

export const hybridRecentExecutor = createHybridExecutor(
  ipcRecentExecutor,
  oneshotRecentExecutor
);

// Side-effect commands: safeToRetry = false
export const hybridSendExecutor = createHybridExecutor(
  ipcSendExecutor,
  oneshotSendExecutor,
  { safeToRetry: false }
);

export const hybridEditExecutor = createHybridExecutor(
  ipcEditExecutor,
  oneshotEditExecutor,
  { safeToRetry: false }
);

export const hybridDeleteExecutor = createHybridExecutor(
  ipcDeleteExecutor,
  oneshotDeleteExecutor,
  { safeToRetry: false }
);

export const hybridReactExecutor = createHybridExecutor(
  ipcReactExecutor,
  oneshotReactExecutor,
  { safeToRetry: false }
);

// Channels: read-only
export const hybridChannelsFetcher = createHybridExecutor<
  [string],
  ChannelInfo[]
>(ipcChannelsFetcher, fetchDiscordChannels);

// Guild resolver: read-only
export const hybridGuildResolver: GuildResolverFn = async (
  token,
  configGuild?,
  cliGuild?
) => {
  // Short-circuit if guild is already known
  if (cliGuild) {
    return cliGuild;
  }
  if (configGuild) {
    return configGuild;
  }

  const probe = await probeDaemon(token);
  if (!probe.available) {
    return oneshotGuildResolver(token, configGuild, cliGuild);
  }

  try {
    return await ipcGuildResolver(token, configGuild, cliGuild);
  } catch (err) {
    if (err instanceof ConnectionRefusedError) {
      return oneshotGuildResolver(token, configGuild, cliGuild);
    }
    // Read-only — safe to fallback
    return oneshotGuildResolver(token, configGuild, cliGuild);
  }
};
